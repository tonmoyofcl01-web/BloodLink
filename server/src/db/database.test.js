import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { generatePotentialMatches } from '../modules/matching/service.js';
import { createNotifications, notifyRequestStatus } from '../modules/notifications/service.js';
import { createApp } from '../app.js';
import bcrypt from 'bcryptjs';
import { hashSecret } from '../lib/crypto.js';

test('configured MySQL database is reachable and all migrations are applied', async () => {
  const prisma = new PrismaClient();
  try {
    const [connection] = await prisma.$queryRaw`SELECT DATABASE() AS databaseName, VERSION() AS mysqlVersion, @@character_set_database AS characterSet, @@collation_database AS collation`;
    assert.equal(connection.databaseName, new URL(env.DATABASE_URL).pathname.slice(1));
    assert.equal(String(connection.mysqlVersion).split('.')[0], '8');
    assert.equal(connection.characterSet.toLowerCase(), 'utf8mb4');
    console.info(`[database check] ${connection.databaseName}, MySQL ${connection.mysqlVersion}, ${connection.characterSet}/${connection.collation}`);

    const rows = await prisma.$queryRaw`SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
    const tables = new Set(rows.map((row) => row.tableName));
    for (const table of ['users', 'sessions', 'email_verification_tokens', 'admin_accounts', 'blood_groups', 'donor_profiles', 'blood_requests', 'request_matches', 'notifications', 'organizations', 'organization_memberships', 'organization_verification_events', '_prisma_migrations']) {
      assert.ok(tables.has(table), `Expected table ${table} to exist`);
    }
    console.info(`[database check] tables: ${[...tables].sort().join(', ')}`);

    const migrations = await prisma.$queryRaw`SELECT migration_name AS migrationName, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations WHERE migration_name IN ('20261103000000_initial', '20261103020000_donor_profiles', '20261103030000_blood_requests', '20261103040000_smart_matching', '20261103050000_notifications_organizations') AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(migrations.length, 5);
    const unresolvedFailures = await prisma.$queryRaw`SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    assert.equal(Number(unresolvedFailures[0].count), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('blood groups, donor discovery filters, and request lifecycle work transactionally', async () => {
  const prisma = new PrismaClient();
  const codes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  try {
    const groups = await prisma.bloodGroup.findMany({ select: { id: true, code: true } });
    assert.deepEqual(new Set(groups.map((group) => group.code)), new Set(codes));
    const byCode = new Map(groups.map((group) => [group.code, group.id]));
    const rollback = new Error('rollback-test-transaction');

    await assert.rejects(prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {
        email: `donor-db-test-${randomUUID()}@example.invalid`,
        fullName: 'Synthetic Donor Test', passwordHash: 'test-only-hash', status: 'ACTIVE', emailVerifiedAt: new Date(),
      } });
      let profile = await tx.donorProfile.create({ data: {
        userId: user.id, displayName: 'Test Donor', bloodGroupId: byCode.get(codes[0]),
        division: 'Test Division', district: 'Test District', area: 'Test Area',
      } });
      assert.equal(profile.availabilityStatus, 'PAUSED');
      assert.equal(profile.discoveryConsentAt, null);

      for (const code of codes) {
        profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { bloodGroupId: byCode.get(code) }, include: { bloodGroup: true } });
        assert.equal(profile.bloodGroup.code, code);
      }
      profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { displayName: 'Edited Donor', area: 'Updated Area', availabilityStatus: 'AVAILABLE' } });
      assert.equal(profile.displayName, 'Edited Donor');
      assert.equal(profile.area, 'Updated Area');
      assert.equal(profile.availabilityStatus, 'AVAILABLE');

      const consentedAt = new Date();
      profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { discoveryConsentAt: consentedAt, consentVersion: 'donor-discovery-v1', consentUpdatedAt: consentedAt } });
      assert.ok(profile.discoveryConsentAt);
      profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { discoveryConsentAt: null, consentUpdatedAt: new Date() } });
      assert.equal(profile.discoveryConsentAt, null);

      const queryDonor = async ({ name, group = 'O+', division = 'North', district = 'Metro', area = 'East', availability = 'AVAILABLE', consent = true, userStatus = 'ACTIVE' }) => {
        const donorUser = await tx.user.create({ data: { email: `discovery-${randomUUID()}@example.invalid`, fullName: name, passwordHash: 'test-only-hash', status: userStatus } });
        return tx.donorProfile.create({ data: {
          userId: donorUser.id, displayName: name, bloodGroupId: byCode.get(group), division, district, area,
          availabilityStatus: availability, discoveryConsentAt: consent ? new Date() : null,
          consentVersion: consent ? 'donor-discovery-v1' : null,
        } });
      };
      await queryDonor({ name: 'Eligible Exact Area' });
      await queryDonor({ name: 'Eligible Neighbor Area', area: 'West' });
      await queryDonor({ name: 'Eligible Neighbor District', district: 'Harbor' });
      await queryDonor({ name: 'No Consent', consent: false });
      await queryDonor({ name: 'Paused', availability: 'PAUSED' });
      await queryDonor({ name: 'Inactive', userStatus: 'SUSPENDED' });
      await queryDonor({ name: 'Wrong Group', group: 'A+' });
      const eligibleWhere = {
        bloodGroupId: byCode.get('O+'), division: 'North', district: 'Metro', area: 'East',
        availabilityStatus: 'AVAILABLE', discoveryConsentAt: { not: null },
        user: { is: { status: 'ACTIVE', deletedAt: null } },
      };
      const exactCandidates = await tx.donorProfile.findMany({ where: eligibleWhere, include: { bloodGroup: true } });
      assert.deepEqual(exactCandidates.map((candidate) => candidate.displayName), ['Eligible Exact Area']);
      const districtCandidates = await tx.donorProfile.findMany({ where: { ...eligibleWhere, area: undefined }, include: { bloodGroup: true } });
      assert.deepEqual(new Set(districtCandidates.map((candidate) => candidate.displayName)), new Set(['Eligible Exact Area', 'Eligible Neighbor Area']));

      const bloodRequest = await tx.bloodRequest.create({ data: {
        requesterUserId: user.id, bloodGroupId: byCode.get('O+'), unitsRequested: 2,
        division: 'North', district: 'Metro', area: 'East', urgency: 'URGENT', neededAt: new Date(Date.now() + 60_000),
      } });
      const generated = await generatePotentialMatches(tx, bloodRequest.id);
      assert.equal(generated.candidates, 3);
      assert.equal(generated.created, 3);
      assert.equal(await tx.notification.count({ where: { type: 'DONOR_OPPORTUNITY' } }), 3);
      const repeated = await generatePotentialMatches(tx, bloodRequest.id);
      assert.equal(repeated.created, 0);
      assert.equal(await tx.notification.count({ where: { type: 'DONOR_OPPORTUNITY' } }), 3);
      const persistedMatches = await tx.requestMatch.findMany({ where: { requestId: bloodRequest.id }, select: { locationRank: true, matchStatus: true } });
      assert.deepEqual(persistedMatches.map((match) => match.locationRank).sort((a, b) => b - a), [3, 2, 1]);
      assert.ok(persistedMatches.every((match) => match.matchStatus === 'NOTIFIED'));
      const paused = await tx.bloodRequest.updateMany({ where: { id: bloodRequest.id, requesterUserId: user.id, status: 'OPEN' }, data: { status: 'PAUSED' } });
      assert.equal(paused.count, 1);
      const requestAfterPause = await tx.bloodRequest.findUnique({ where: { id: bloodRequest.id }, select: { updatedAt: true } });
      await notifyRequestStatus(tx, bloodRequest.id, 'PAUSED', requestAfterPause.updatedAt);
      assert.equal(await tx.notification.count({ where: { type: 'REQUEST_STATUS' } }), 4);
      const statusNotifications = await tx.notification.findMany({ where: { type: 'REQUEST_STATUS' }, select: { userId: true, referenceType: true, referenceId: true } });
      assert.equal(statusNotifications.filter((item) => item.referenceType === 'OPPORTUNITY').length, 3);
      assert.equal(statusNotifications.filter((item) => item.referenceType === 'REQUEST').length, 1);

      const organization = await tx.organization.create({ data: {
        name: 'Synthetic Test Hospital', type: 'HOSPITAL', registrationNumber: `TEST-${randomUUID()}`,
        division: 'North', district: 'Metro', area: 'Central', publicContactPhone: '+8801000000000',
        verificationInfo: 'Synthetic test record', createdByUserId: user.id,
      } });
      assert.equal(organization.status, 'PENDING');
      const membership = await tx.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: 'OWNER' } });
      assert.equal(membership.status, 'ACTIVE');
      await tx.organizationVerificationEvent.create({ data: { organizationId: organization.id, actorUserId: user.id, action: 'SUBMITTED', toStatus: 'PENDING' } });
      await tx.organization.update({ where: { id: organization.id }, data: { status: 'VERIFIED' } });
      await tx.organizationVerificationEvent.create({ data: { organizationId: organization.id, actorUserId: user.id, action: 'APPROVED', fromStatus: 'PENDING', toStatus: 'VERIFIED' } });
      assert.equal(await tx.organizationVerificationEvent.count({ where: { organizationId: organization.id } }), 2);

      const supportedTypes = ['DONOR_ACCEPTED', 'DONOR_DECLINED', 'DONOR_WITHDREW', 'ORGANIZATION_SUBMITTED', 'ORGANIZATION_APPROVED', 'ORGANIZATION_REJECTED', 'ORGANIZATION_SUSPENDED'];
      const eventRows = supportedTypes.map((type) => ({ userId: user.id, eventKey: `integration:${type}`, type, title: 'Synthetic event', message: 'Synthetic test notification.' }));
      await createNotifications(tx, eventRows);
      const duplicateInsert = await createNotifications(tx, eventRows);
      assert.equal(duplicateInsert.count, 0);
      assert.equal(await tx.notification.count({ where: { userId: user.id } }), 8);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('MySQL registration, verification, resend, token expiry, auth, and rate limits work end to end', async () => {
  const prisma = new PrismaClient();
  const runKey = randomUUID();
  const email = `verification-${runKey}@example.invalid`;
  const rateLimitEmail = `verification-limit-${runKey}@example.invalid`;
  const emails = new Set([email, rateLimitEmail]);
  const deliveries = new Map();
  const deliveryCounts = new Map();
  const app = createApp({
    prisma,
    env: { ...env, NODE_ENV: 'test', PORT: 0, CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session', SESSION_COOKIE_SECURE: 'false' },
    emailAdapter: async ({ email: recipient, url }) => {
      deliveries.set(recipient, url);
      deliveryCounts.set(recipient, (deliveryCounts.get(recipient) || 0) + 1);
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  const send = async (path, body) => {
    const response = await fetch(`${base}/api/v1/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { response, data: response.status === 204 ? null : await response.json() };
  };
  const extractToken = (recipient) => new URL(deliveries.get(recipient)).searchParams.get('token');
  try {
    const registration = await send('register', { email, fullName: 'Synthetic Verification', password: 'test-only-password-2026' });
    assert.equal(registration.response.status, 202);
    const firstToken = extractToken(email);
    assert.ok(firstToken);
    const firstRecord = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashSecret(firstToken) } });
    assert.ok(firstRecord);
    assert.ok(firstRecord.expiresAt > new Date());
    const pendingUser = await prisma.user.findUnique({ where: { email }, select: { status: true, emailVerifiedAt: true } });
    assert.equal(pendingUser.status, 'PENDING_VERIFICATION');
    assert.equal(pendingUser.emailVerifiedAt, null);

    const unverifiedLogin = await send('login', { email, password: 'test-only-password-2026' });
    assert.equal(unverifiedLogin.response.status, 403);
    assert.equal(unverifiedLogin.data.error.code, 'EMAIL_NOT_VERIFIED');
    const wrongPassword = await send('login', { email, password: 'wrong-test-password' });
    assert.equal(wrongPassword.response.status, 401);

    const duplicate = await send('register', { email, fullName: 'Synthetic Verification', password: 'test-only-password-2026' });
    assert.equal(duplicate.response.status, 202);
    assert.equal(duplicate.data.message, registration.data.message);
    assert.equal(deliveryCounts.get(email), 1);
    assert.match(duplicate.data.message, /If this address can be registered/);

    const invalid = await send('verify-email', { token: `invalid-${randomUUID()}` });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.data.error.code, 'INVALID_TOKEN');

    await prisma.emailVerificationToken.update({ where: { id: firstRecord.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await send('verify-email', { token: firstToken });
    assert.equal(expired.response.status, 400);
    assert.equal(expired.data.error.code, 'TOKEN_EXPIRED');

    const resend = await send('resend-verification', { email });
    assert.equal(resend.response.status, 202);
    assert.equal(deliveryCounts.get(email), 2);
    assert.match(resend.data.message, /If this address belongs to an unverified account/);
    const secondToken = extractToken(email);
    assert.ok(secondToken);
    assert.notEqual(secondToken, firstToken);
    const replaced = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashSecret(firstToken) } });
    const secondRecord = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashSecret(secondToken) } });
    assert.ok(replaced.usedAt);
    assert.ok(secondRecord && secondRecord.expiresAt > new Date());

    const invalidated = await send('verify-email', { token: firstToken });
    assert.equal(invalidated.response.status, 400);
    assert.equal(invalidated.data.error.code, 'TOKEN_ALREADY_USED');
    const verified = await send('verify-email', { token: secondToken });
    assert.equal(verified.response.status, 200);
    const activeUser = await prisma.user.findUnique({ where: { email }, select: { status: true, emailVerifiedAt: true } });
    assert.equal(activeUser.status, 'ACTIVE');
    assert.ok(activeUser.emailVerifiedAt);
    const reused = await send('verify-email', { token: secondToken });
    assert.equal(reused.response.status, 400);
    assert.equal(reused.data.error.code, 'TOKEN_ALREADY_USED');

    const alreadyVerified = await send('resend-verification', { email });
    assert.equal(alreadyVerified.response.status, 202);
    assert.equal(deliveryCounts.get(email), 2);
    assert.match(alreadyVerified.data.message, /If you already verified it, you can sign in/);
    const login = await send('login', { email, password: 'test-only-password-2026' });
    assert.equal(login.response.status, 200);
    assert.ok(cookie);
    const refreshedSession = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie } });
    assert.equal(refreshedSession.status, 200);
    assert.equal((await refreshedSession.json()).user.email, email);
    const logout = await send('logout', {});
    assert.equal(logout.response.status, 204);
    const revokedSession = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie } });
    assert.equal(revokedSession.status, 401);

    assert.equal((await send('register', { email: rateLimitEmail, fullName: 'Synthetic Rate Limit', password: 'test-only-password-2026' })).response.status, 202);
    // The resend budget is per client IP, shared across accounts; the first account
    // already used two requests, leaving three successful requests in this window.
    for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await send('resend-verification', { email: rateLimitEmail })).response.status, 202);
    const limited = await send('resend-verification', { email: rateLimitEmail });
    assert.equal(limited.response.status, 429);
    assert.equal(deliveryCounts.get(rateLimitEmail), 4);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } });
      const ids = users.map(({ id }) => id);
      if (!ids.length) return;
      await tx.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } });
      await tx.session.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
    await prisma.$disconnect();
  }
});

test('MySQL-backed HTTP workflow covers account verification through organization request authorization', async () => {
  const prisma = new PrismaClient();
  const runKey = randomUUID();
  const emailPrefix = `m6-${runKey}-`;
  const submittedEmails = new Map();
  const envForTest = { ...env, NODE_ENV: 'test', PORT: 0, CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session', SESSION_COOKIE_SECURE: 'false' };
  const app = createApp({ prisma, env: envForTest, emailAdapter: async ({ email, url }) => submittedEmails.set(email, url) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = new Map();
  const send = async (path, { method = 'GET', email, body } = {}) => {
    const headers = {};
    if (cookies.has(email)) headers.cookie = cookies.get(email);
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const cookie = response.headers.get('set-cookie');
    if (cookie && email) cookies.set(email, cookie.split(';')[0]);
    return { response, data: response.status === 204 ? null : await response.json() };
  };
  const signUpAndVerify = async (email, fullName) => {
    const registration = await send('/api/v1/auth/register', { method: 'POST', body: { email, fullName, password: 'test-only-password-2026' } });
    assert.equal(registration.response.status, 202);
    const staleToken = new URL(submittedEmails.get(email)).searchParams.get('token');
    assert.ok(staleToken);
    assert.equal((await send('/api/v1/auth/resend-verification', { method: 'POST', body: { email } })).response.status, 202);
    const verificationToken = new URL(submittedEmails.get(email)).searchParams.get('token');
    assert.notEqual(verificationToken, staleToken);
    assert.equal((await send('/api/v1/auth/verify-email', { method: 'POST', body: { token: staleToken } })).response.status, 400);
    const verifiedResponses = await Promise.all([
      send('/api/v1/auth/verify-email', { method: 'POST', body: { token: verificationToken } }),
      send('/api/v1/auth/verify-email', { method: 'POST', body: { token: verificationToken } }),
    ]);
    assert.deepEqual(verifiedResponses.map(({ response }) => response.status).sort(), [200, 400]);
    return verificationToken;
  };
  let adminEmail;
  try {
    const donorEmail = `${emailPrefix}donor@example.invalid`;
    const requesterEmail = `${emailPrefix}requester@example.invalid`;
    await signUpAndVerify(donorEmail, 'Synthetic Donor');
    const donorLogin = await send('/api/v1/auth/login', { method: 'POST', email: donorEmail, body: { email: donorEmail, password: 'test-only-password-2026' } });
    assert.equal(donorLogin.response.status, 200);

    await signUpAndVerify(requesterEmail, 'Synthetic Requester');
    const requesterLogin = await send('/api/v1/auth/login', { method: 'POST', email: requesterEmail, body: { email: requesterEmail, password: 'test-only-password-2026' } });
    assert.equal(requesterLogin.response.status, 200);

    const profile = await send('/api/v1/donors/me', { method: 'POST', email: donorEmail, body: { displayName: 'Synthetic donor', bloodGroup: 'O+', division: 'QA Division', district: 'QA District', area: 'QA Area' } });
    assert.equal(profile.response.status, 201);
    assert.equal((await send('/api/v1/donors/me/consent', { method: 'PATCH', email: donorEmail, body: { consented: true } })).response.status, 200);
    assert.equal((await send('/api/v1/donors/me/availability', { method: 'PATCH', email: donorEmail, body: { status: 'AVAILABLE' } })).response.status, 200);

    const requestBody = { bloodGroup: 'O+', unitsRequested: 2, division: ' qa division ', district: 'QA DISTRICT', area: 'qa area', urgency: 'URGENT', neededAt: new Date(Date.now() + 86_400_000).toISOString() };
    const createdRequest = await send('/api/v1/requests', { method: 'POST', email: requesterEmail, body: requestBody });
    assert.equal(createdRequest.response.status, 201);
    assert.equal(createdRequest.data.matching.created, 1);
    const requestId = createdRequest.data.request.id;
    const donorNotifications = await send('/api/v1/notifications', { email: donorEmail });
    assert.equal(donorNotifications.data.unreadCount, 1);
    assert.equal(donorNotifications.data.notifications[0].type, 'DONOR_OPPORTUNITY');
    const opportunities = await send('/api/v1/donors/me/opportunities', { email: donorEmail });
    const opportunityId = opportunities.data.opportunities[0].id;
    assert.ok(opportunityId);

    let response = await send(`/api/v1/donors/me/opportunities/${opportunityId}/respond`, { method: 'POST', email: donorEmail, body: { action: 'ACCEPT' } });
    assert.equal(response.response.status, 200);
    const matchSummary = await send(`/api/v1/requests/${requestId}/matches`, { email: requesterEmail });
    assert.equal(matchSummary.data.counts.accepted, 1);
    response = await send(`/api/v1/donors/me/opportunities/${opportunityId}/respond`, { method: 'POST', email: donorEmail, body: { action: 'WITHDRAW' } });
    assert.equal(response.response.status, 200);
    assert.ok((await send('/api/v1/notifications', { email: requesterEmail })).data.notifications.some((item) => item.type === 'DONOR_WITHDREW'));
    assert.equal((await send('/api/v1/notifications/read-all', { method: 'PATCH', email: requesterEmail })).response.status, 200);

    for (const status of ['PAUSED', 'OPEN', 'FULFILLED']) {
      response = await send(`/api/v1/requests/${requestId}/status`, { method: 'PATCH', email: requesterEmail, body: { status } });
      assert.equal(response.response.status, 200, `request status ${status}`);
    }

    const organizationEmail = requesterEmail;
    const application = await send('/api/v1/organizations', { method: 'POST', email: organizationEmail, body: {
      name: 'Synthetic Integration Hospital', type: 'HOSPITAL', registrationNumber: `M6-${runKey}`,
      division: 'QA Division', district: 'QA District', area: 'QA Area', publicContactPhone: '+8801000000000',
    } });
    assert.equal(application.response.status, 201);
    const organizationId = application.data.organization.id;
    const orgRequestBody = { ...requestBody, division: 'QA Division', district: 'QA District', area: 'QA Area' };
    assert.equal((await send(`/api/v1/organizations/mine/${organizationId}/requests`, { method: 'POST', email: organizationEmail, body: orgRequestBody })).response.status, 403);

    adminEmail = `${emailPrefix}admin@example.invalid`;
    const adminPassword = 'test-only-admin-password-2026';
    const admin = await prisma.user.create({ data: { email: adminEmail, fullName: 'Synthetic Integration Admin', passwordHash: await bcrypt.hash(adminPassword, 4), status: 'ACTIVE', emailVerifiedAt: new Date() } });
    await prisma.adminAccount.create({ data: { userId: admin.id } });
    const adminLogin = await send('/api/v1/auth/login', { method: 'POST', email: adminEmail, body: { email: adminEmail, password: adminPassword } });
    assert.equal(adminLogin.response.status, 200);
    assert.equal(adminLogin.data.user.isAdmin, true);
    response = await send(`/api/v1/admin/organizations/${organizationId}/decision`, { method: 'PATCH', email: adminEmail, body: { action: 'APPROVE' } });
    assert.equal(response.response.status, 200);
    assert.equal(response.data.organization.status, 'VERIFIED');
    const orgRequest = await send(`/api/v1/organizations/mine/${organizationId}/requests`, { method: 'POST', email: organizationEmail, body: orgRequestBody });
    assert.equal(orgRequest.response.status, 201);
    const dashboard = await send(`/api/v1/organizations/mine/${organizationId}/dashboard`, { email: organizationEmail });
    assert.equal(dashboard.data.requests.length, 1);
    assert.equal(dashboard.data.requestStatusCounts.OPEN, 1);
    response = await send(`/api/v1/admin/organizations/${organizationId}/decision`, { method: 'PATCH', email: adminEmail, body: { action: 'SUSPEND', reason: 'Synthetic test suspension.' } });
    assert.equal(response.data.organization.status, 'SUSPENDED');
    assert.equal((await send(`/api/v1/organizations/mine/${organizationId}/requests`, { method: 'POST', email: organizationEmail, body: orgRequestBody })).response.status, 403);

    const logout = await send('/api/v1/auth/logout', { method: 'POST', email: requesterEmail });
    assert.equal(logout.response.status, 204);
    assert.equal((await send('/api/v1/requests/mine', { email: requesterEmail })).response.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const emails = [...cookies.keys()];
    if (adminEmail) emails.push(adminEmail);
    if (emails.length) {
      await prisma.$transaction(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { in: [...new Set(emails)] } }, select: { id: true } });
        const userIds = users.map((item) => item.id);
        if (!userIds.length) return;
        const organizations = await tx.organization.findMany({ where: { createdByUserId: { in: userIds } }, select: { id: true } });
        const organizationIds = organizations.map((item) => item.id);
        const requests = await tx.bloodRequest.findMany({ where: { OR: [{ requesterUserId: { in: userIds } }, ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : [])] }, select: { id: true } });
        const requestIds = requests.map((item) => item.id);
        const donors = await tx.donorProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
        const donorIds = donors.map((item) => item.id);
        await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
        if (organizationIds.length) {
          await tx.organizationVerificationEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
          await tx.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
        }
        if (requestIds.length || donorIds.length) await tx.requestMatch.deleteMany({ where: { OR: [...(requestIds.length ? [{ requestId: { in: requestIds } }] : []), ...(donorIds.length ? [{ donorProfileId: { in: donorIds } }] : [])] } });
        if (requestIds.length) await tx.bloodRequest.deleteMany({ where: { id: { in: requestIds } } });
        if (organizationIds.length) await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
        if (donorIds.length) await tx.donorProfile.deleteMany({ where: { id: { in: donorIds } } });
        await tx.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
        await tx.session.deleteMany({ where: { userId: { in: userIds } } });
        await tx.adminAccount.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      });
    }
    await prisma.$disconnect();
  }
});

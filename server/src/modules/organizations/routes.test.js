import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';
import { hashSecret } from '../../lib/crypto.js';

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const env = { NODE_ENV: 'test', CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session', SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'false' };
const organizationId = '11111111-1111-4111-8111-111111111111';
const secondOrganizationId = '22222222-2222-4222-8222-222222222222';
const input = { name: 'Central Medical Center', type: 'HOSPITAL', registrationNumber: 'reg-2026-01', division: 'North', district: 'Metro', area: 'Central', publicContactPhone: '+8801000000000', verificationInfo: 'Licensed provider' };

function organizationPrisma(currentUser = 'member-user') {
  const organizations = new Map();
  const memberships = [];
  const events = [];
  const notifications = [];
  let sequence = 0;
  const prisma = {
    organizations, memberships, events, notifications,
    session: { findUnique: async ({ where }) => {
      const userId = new Map([['member', 'member-user'], ['user', 'regular-user'], ['admin', 'admin-user']]).get(Object.keys({ member: 'member', user: 'user', admin: 'admin' }).find((token) => hashSecret(token) === where.secretHash)) || currentUser;
      return { userId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: userId === 'admin-user' ? { revokedAt: null } : null } };
    } },
    $transaction: async (operation) => operation(prisma),
    organization: {
      create: async ({ data }) => {
        if ([...organizations.values()].some((org) => org.registrationNumber.toLowerCase() === data.registrationNumber.toLowerCase())) throw Object.assign(new Error('Unique'), { code: 'P2002' });
        const organization = { id: organizationId, ...data, createdAt: new Date(), updatedAt: new Date() };
        organizations.set(organization.id, organization); return organization;
      },
      findUnique: async ({ where, select }) => {
        const org = organizations.get(where.id);
        if (!org) return null;
        return { ...org, ...(select?.creator ? { creator: { fullName: 'Organization Owner', email: 'owner@example.invalid' } } : {}), ...(select?.verificationHistory ? { verificationHistory: events.filter((event) => event.organizationId === org.id) } : {}) };
      },
      findMany: async ({ where }) => [...organizations.values()].filter((org) => !where?.status || org.status === where.status),
      update: async ({ where, data }) => { const org = organizations.get(where.id); Object.assign(org, data, { updatedAt: new Date() }); return org; },
    },
    organizationMembership: {
      create: async ({ data }) => { const row = { id: `membership-${++sequence}`, ...data, createdAt: new Date(), updatedAt: new Date() }; memberships.push(row); return row; },
      findFirst: async ({ where }) => memberships.find((row) => row.organizationId === where.organizationId && row.userId === where.userId && row.status === where.status && (!where.organization?.is?.status || organizations.get(row.organizationId)?.status === where.organization.is.status)) || null,
      findMany: async ({ where }) => memberships.filter((row) => (!where.organizationId || row.organizationId === where.organizationId) && (!where.userId || row.userId === where.userId) && (!where.status || row.status === where.status)).map((row) => ({ ...row, user: { fullName: row.userId === 'member-user' ? 'Organization Owner' : 'Staff Member' }, organization: organizations.get(row.organizationId) })),
    },
    organizationVerificationEvent: {
      create: async ({ data }) => { const row = { id: `event-${events.length + 1}`, ...data, createdAt: new Date() }; events.push(row); return row; },
      findMany: async ({ where }) => events.filter((row) => row.organizationId === where.organizationId),
    },
    adminAccount: { findMany: async () => [{ userId: 'admin-user' }] },
    notification: { createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const item of data) {
        if (skipDuplicates && notifications.some((existing) => existing.eventKey === item.eventKey)) continue;
        notifications.push(item); count += 1;
      }
      return { count };
    } },
    bloodRequest: { findMany: async () => [] },
  };
  return prisma;
}

test('organization registration creates only pending applications and an owner membership; duplicate numbers are rejected', async () => {
  const prisma = organizationPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=member', 'content-type': 'application/json' };
    const forged = await fetch(`${base}/api/v1/organizations`, { method: 'POST', headers, body: JSON.stringify({ ...input, role: 'ADMIN', status: 'VERIFIED' }) });
    assert.equal(forged.status, 400);
    const created = await fetch(`${base}/api/v1/organizations`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.equal(result.organization.status, 'PENDING');
    assert.equal(result.organization.registrationNumber, 'REG-2026-01');
    assert.equal(prisma.memberships.length, 1);
    assert.equal(prisma.memberships[0].role, 'OWNER');
    assert.equal(prisma.memberships[0].userId, 'member-user');
    assert.equal(prisma.events[0].action, 'SUBMITTED');
    assert.equal(prisma.notifications[0].type, 'ORGANIZATION_SUBMITTED');
    const duplicate = await fetch(`${base}/api/v1/organizations`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(duplicate.status, 409);
    const pendingRequest = await fetch(`${base}/api/v1/organizations/mine/${organizationId}/requests`, { method: 'POST', headers, body: JSON.stringify({ bloodGroup: 'O+', unitsRequested: 1, division: 'North', district: 'Metro', area: 'Central', urgency: 'URGENT', neededAt: '2027-01-01T00:00:00.000Z' }) });
    assert.equal(pendingRequest.status, 403);
  });
});

test('only the bootstrapped admin can approve, reject, suspend, and inspect append-only verification history', async () => {
  const prisma = organizationPrisma();
  prisma.organizations.set(organizationId, { id: organizationId, ...input, registrationNumber: input.registrationNumber.toUpperCase(), status: 'PENDING', createdByUserId: 'member-user', createdAt: new Date(), updatedAt: new Date() });
  prisma.memberships.push({ id: 'membership-owner', organizationId, userId: 'member-user', role: 'OWNER', status: 'ACTIVE' });
  await withServer(createApp({ prisma, env }), async (base) => {
    const path = `${base}/api/v1/admin/organizations/${organizationId}/decision`;
    const body = (action, reason) => JSON.stringify({ action, ...(reason ? { reason } : {}) });
    const regularUser = await fetch(path, { method: 'PATCH', headers: { cookie: 'bloodlink_session=user', 'content-type': 'application/json' }, body: body('APPROVE') });
    assert.equal(regularUser.status, 403);
    const adminHeaders = { cookie: 'bloodlink_session=admin', 'content-type': 'application/json' };
    let response = await fetch(path, { method: 'PATCH', headers: adminHeaders, body: body('APPROVE') });
    assert.equal((await response.json()).organization.status, 'VERIFIED');
    assert.equal(prisma.events.at(-1).action, 'APPROVED');
    assert.equal(prisma.notifications.at(-1).type, 'ORGANIZATION_APPROVED');
    response = await fetch(path, { method: 'PATCH', headers: adminHeaders, body: body('SUSPEND', 'Credential review required.') });
    assert.equal((await response.json()).organization.status, 'SUSPENDED');
    assert.equal(prisma.events.at(-1).action, 'SUSPENDED');
    assert.equal(prisma.notifications.at(-1).type, 'ORGANIZATION_SUSPENDED');
    const organizationRequest = { bloodGroup: 'O+', unitsRequested: 1, division: 'North', district: 'Metro', area: 'Central', urgency: 'URGENT', neededAt: '2027-01-01T00:00:00.000Z' };
    response = await fetch(`${base}/api/v1/organizations/mine/${organizationId}/requests`, { method: 'POST', headers: { cookie: 'bloodlink_session=member', 'content-type': 'application/json' }, body: JSON.stringify(organizationRequest) });
    assert.equal(response.status, 403);
    response = await fetch(path, { method: 'PATCH', headers: adminHeaders, body: body('SUSPEND', 'Again') });
    assert.equal(response.status, 409);
    prisma.organizations.set(secondOrganizationId, { id: secondOrganizationId, ...input, registrationNumber: 'REG-SECOND', status: 'PENDING', createdByUserId: 'member-user', createdAt: new Date(), updatedAt: new Date() });
    prisma.memberships.push({ id: 'membership-second', organizationId: secondOrganizationId, userId: 'member-user', role: 'OWNER', status: 'ACTIVE' });
    response = await fetch(`${base}/api/v1/admin/organizations/${secondOrganizationId}/decision`, { method: 'PATCH', headers: adminHeaders, body: body('REJECT', 'Unable to verify this registration.') });
    assert.equal((await response.json()).organization.status, 'REJECTED');
    assert.equal(prisma.events.at(-1).action, 'REJECTED');
    assert.equal(prisma.notifications.at(-1).type, 'ORGANIZATION_REJECTED');
    response = await fetch(`${base}/api/v1/organizations/mine/${secondOrganizationId}/requests`, { method: 'POST', headers: { cookie: 'bloodlink_session=member', 'content-type': 'application/json' }, body: JSON.stringify(organizationRequest) });
    assert.equal(response.status, 403);
    response = await fetch(`${base}/api/v1/admin/organizations/${organizationId}`, { headers: { cookie: 'bloodlink_session=admin' } });
    assert.equal((await response.json()).organization.verificationHistory.length, 2);
    assert.equal(prisma.events.length, 3);
  });
});

test('administrator registration roles cannot be forged through public account registration', async () => {
  const prisma = organizationPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const response = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@example.invalid', fullName: 'New User', password: 'long-password-123', role: 'ADMIN', isAdmin: true }) });
    assert.equal(response.status, 400);
  });
});

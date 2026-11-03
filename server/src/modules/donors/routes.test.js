import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const env = {
  NODE_ENV: 'test', PORT: 0, CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session',
  SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'false',
};
const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const profileInput = (overrides = {}) => ({
  displayName: 'Donor Display', bloodGroup: 'O+', division: 'Division One', district: 'District Two', area: 'Community Three', ...overrides,
});

function donorPrisma({ ownerId = 'owner-user', initialProfile = null } = {}) {
  let profile = initialProfile;
  let idCounter = 0;
  const groupByCode = new Map(bloodGroups.map((code, index) => [code, { id: index + 1, code }]));
  const prisma = {
    session: { findUnique: async () => ({ userId: ownerId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: null } }) },
    bloodGroup: { findUnique: async ({ where }) => groupByCode.get(where.code) || null },
    donorProfile: {
      findUnique: async ({ where }) => profile?.userId === where.userId ? profile : null,
      create: async ({ data }) => {
        if (profile) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        profile = { id: `profile-${++idCounter}`, ...data, availabilityStatus: 'PAUSED', discoveryConsentAt: null, consentVersion: null, consentUpdatedAt: null, createdAt: new Date(), updatedAt: new Date(), bloodGroup: [...groupByCode.values()].find((group) => group.id === data.bloodGroupId) };
        return profile;
      },
      update: async ({ where, data }) => {
        if (!profile || where.userId !== profile.userId || where.userId !== ownerId) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        profile = { ...profile, ...data, updatedAt: new Date() };
        if (data.bloodGroupId) profile.bloodGroup = [...groupByCode.values()].find((group) => group.id === data.bloodGroupId);
        return profile;
      },
      findMany: async ({ where, skip, take }) => profile
        && profile.bloodGroupId === where.bloodGroupId && profile.division === where.division
        && (!where.district || profile.district === where.district) && (!where.area || profile.area === where.area)
        && profile.availabilityStatus === where.availabilityStatus && profile.discoveryConsentAt
        ? [{ displayName: profile.displayName, bloodGroup: { code: profile.bloodGroup.code }, email: 'private@example.invalid', exactAddress: 'Private address' }].slice(skip, skip + take)
        : [],
      count: async ({ where }) => profile
        && profile.bloodGroupId === where.bloodGroupId && profile.division === where.division
        && (!where.district || profile.district === where.district) && (!where.area || profile.area === where.area)
        && profile.availabilityStatus === where.availabilityStatus && profile.discoveryConsentAt ? 1 : 0,
    },
    $transaction: async (operation) => operation(prisma),
    requestMatch: { updateMany: async () => ({ count: 0 }) },
  };
  return prisma;
}

test('donor profile creation is optional, private, and starts paused without discovery consent', async () => {
  const prisma = donorPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const noSession = await fetch(`${base}/api/v1/donors/me`);
    assert.equal(noSession.status, 401);

    const headers = { cookie: 'bloodlink_session=owner-token', 'content-type': 'application/json' };
    const injected = await fetch(`${base}/api/v1/donors/me`, { method: 'POST', headers, body: JSON.stringify({ ...profileInput(), userId: 'another-user' }) });
    assert.equal(injected.status, 400);
    const sensitiveInput = await fetch(`${base}/api/v1/donors/me`, { method: 'POST', headers, body: JSON.stringify({ ...profileInput(), email: 'leak@example.com', phone: '+10000000000', exactAddress: '10 Example Street', coordinates: { lat: 1, lng: 2 } }) });
    assert.equal(sensitiveInput.status, 400);

    const created = await fetch(`${base}/api/v1/donors/me`, { method: 'POST', headers, body: JSON.stringify(profileInput()) });
    assert.equal(created.status, 201);
    const { profile } = await created.json();
    assert.equal(profile.availabilityStatus, 'PAUSED');
    assert.equal(profile.discoveryConsent, false);
    for (const sensitiveField of ['email', 'phone', 'phoneCiphertext', 'exactAddress', 'coordinates', 'userId']) assert.equal(sensitiveField in profile, false);

    const duplicate = await fetch(`${base}/api/v1/donors/me`, { method: 'POST', headers, body: JSON.stringify(profileInput()) });
    assert.equal(duplicate.status, 409);
  });
});

test('owners can edit profiles, select all blood groups, pause/resume, and withdraw discovery consent', async () => {
  const prisma = donorPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=owner-token', 'content-type': 'application/json' };
    await fetch(`${base}/api/v1/donors/me`, { method: 'POST', headers, body: JSON.stringify(profileInput()) });

    for (const bloodGroup of bloodGroups) {
      const edited = await fetch(`${base}/api/v1/donors/me`, { method: 'PUT', headers, body: JSON.stringify(profileInput({ displayName: `Donor ${bloodGroup}`, bloodGroup, area: 'Updated Area' })) });
      assert.equal(edited.status, 200);
      const { profile } = await edited.json();
      assert.equal(profile.bloodGroup, bloodGroup);
      assert.equal(profile.area, 'Updated Area');
    }

    let response = await fetch(`${base}/api/v1/donors/me/availability`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'AVAILABLE' }) });
    assert.equal((await response.json()).profile.availabilityStatus, 'AVAILABLE');
    response = await fetch(`${base}/api/v1/donors/me/availability`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'PAUSED' }) });
    assert.equal((await response.json()).profile.availabilityStatus, 'PAUSED');

    response = await fetch(`${base}/api/v1/donors/me/consent`, { method: 'PATCH', headers, body: JSON.stringify({ consented: true }) });
    assert.equal((await response.json()).profile.discoveryConsent, true);
    response = await fetch(`${base}/api/v1/donors/me/consent`, { method: 'PATCH', headers, body: JSON.stringify({ consented: false }) });
    assert.equal((await response.json()).profile.discoveryConsent, false);
  });
});

test('a different signed-in user cannot read or modify another donor profile', async () => {
  const prisma = donorPrisma({ ownerId: 'attacker-user', initialProfile: {
    id: 'victim-profile', userId: 'owner-user', displayName: 'Private Donor', bloodGroupId: 8,
    bloodGroup: { code: 'O-' }, division: 'Private Division', district: 'Private District', area: 'Private Area',
    availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), consentVersion: 'donor-discovery-v1', consentUpdatedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  } });
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=attacker-token', 'content-type': 'application/json' };
    const read = await fetch(`${base}/api/v1/donors/me`, { headers });
    assert.deepEqual(await read.json(), { profile: null });
    const update = await fetch(`${base}/api/v1/donors/me`, { method: 'PUT', headers, body: JSON.stringify(profileInput({ displayName: 'Intruder' })) });
    assert.equal(update.status, 404);
    const discovery = await fetch(`${base}/api/v1/donors/discover?bloodGroup=O-&division=Private%20Division&district=Private%20District&area=Private%20Area`, { headers });
    assert.equal(discovery.status, 200);
    const candidates = await discovery.json();
    assert.deepEqual(candidates.donors, [{ bloodGroup: 'O-', locationMatch: 'AREA' }]);
    assert.equal(JSON.stringify(candidates).includes('Private Area'), false);
    assert.equal(JSON.stringify(candidates).includes('private@example'), false);
  });
});

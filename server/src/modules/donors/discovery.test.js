import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const env = { NODE_ENV: 'test', CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session', SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'false' };

function discoveryPrisma() {
  const profiles = [
    { displayName: 'Eligible One', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null }, email: 'private@example.invalid', phone: 'private', id: 'private-account-id', exactAddress: 'private address' },
    { displayName: 'Eligible Two', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null } },
    { displayName: 'No Consent', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'AVAILABLE', discoveryConsentAt: null, user: { status: 'ACTIVE', deletedAt: null } },
    { displayName: 'Paused', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'PAUSED', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null } },
    { displayName: 'Inactive User', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'SUSPENDED', deletedAt: null } },
    { displayName: 'Wrong Group', bloodGroupId: 2, bloodGroup: { code: 'O-' }, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null } },
    { displayName: 'Neighbor Area', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Metro', area: 'West', availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null } },
    { displayName: 'Other District', bloodGroupId: 1, bloodGroup: { code: 'O+' }, division: 'North', district: 'Harbor', area: 'East', availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null } },
  ];
  let lastFind;
  const eligible = (where) => profiles.filter((profile) => profile.bloodGroupId === where.bloodGroupId
    && profile.division === where.division
    && (!where.district || profile.district === where.district)
    && (!where.area || profile.area === where.area)
    && profile.availabilityStatus === where.availabilityStatus
    && Boolean(profile.discoveryConsentAt) === (where.discoveryConsentAt.not === null)
    && profile.user.status === where.user.is.status
    && profile.user.deletedAt === null);
  return {
    session: { findUnique: async () => ({ userId: 'requester', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: null } }) },
    bloodGroup: { findUnique: async ({ where }) => ({ id: where.code === 'O+' ? 1 : where.code === 'O-' ? 2 : 3 }) },
    donorProfile: {
      findMany: async (args) => { lastFind = args; return eligible(args.where).slice(args.skip, args.skip + args.take); },
      count: async ({ where }) => eligible(where).length,
      get lastFind() { return lastFind; },
    },
  };
}

test('discovery filters exact parent/child areas, requires explicit eligibility, paginates, and returns safe summaries', async () => {
  const prisma = discoveryPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=requester' };
    const query = new URLSearchParams({ bloodGroup: 'O+', division: 'North', district: 'Metro', area: 'East', page: '2', limit: '1' });
    const response = await fetch(`${base}/api/v1/donors/discover?${query}`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.donors, [{ bloodGroup: 'O+', locationMatch: 'AREA' }]);
    assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
    assert.match(result.medicalNotice, /qualified medical professionals/i);
    assert.deepEqual(prisma.donorProfile.lastFind.where, {
      bloodGroupId: 1, division: 'North', district: 'Metro', area: 'East', availabilityStatus: 'AVAILABLE',
      discoveryConsentAt: { not: null }, user: { is: { status: 'ACTIVE', deletedAt: null } },
    });
    assert.deepEqual(prisma.donorProfile.lastFind.select, { bloodGroup: { select: { code: true } } });
    for (const secret of ['displayName', 'email', 'phone', 'id', 'accountId', 'exactAddress', 'area', 'division', 'district', 'userId']) assert.equal(secret in result.donors[0], false);

    const missingParent = await fetch(`${base}/api/v1/donors/discover?bloodGroup=O%2B&division=North&area=East`, { headers });
    assert.equal(missingParent.status, 400);
    const unauthenticated = await fetch(`${base}/api/v1/donors/discover?bloodGroup=O%2B&division=North`);
    assert.equal(unauthenticated.status, 401);
  });
});

test('donor discovery is rate limited to reduce scraping', async () => {
  const app = createApp({ prisma: discoveryPrisma(), env });
  await withServer(app, async (base) => {
    const headers = { cookie: 'bloodlink_session=requester' };
    const url = `${base}/api/v1/donors/discover?bloodGroup=O%2B&division=North`;
    let last;
    for (let index = 0; index < 31; index++) last = await fetch(url, { headers });
    assert.equal(last.status, 429);
    assert.equal((await last.json()).error.code, 'RATE_LIMITED');
  });
});

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
const matchId1 = '11111111-1111-4111-8111-111111111111';
const matchId2 = '22222222-2222-4222-8222-222222222222';

function opportunitiesPrisma({ sessionUser = 'donor-user', profileOwner = 'donor-user', consent = true, availability = 'AVAILABLE', requestStatus = 'OPEN' } = {}) {
  const profile = { id: 'donor-profile-private', userId: profileOwner, availabilityStatus: availability, discoveryConsentAt: consent ? new Date() : null, user: { status: 'ACTIVE', deletedAt: null } };
  const request = {
    id: 'private-request-id', status: requestStatus, neededAt: new Date('2027-01-01T00:00:00Z'),
    bloodGroup: { code: 'O+' }, unitsRequested: 2, urgency: 'URGENT', division: 'North', district: 'Metro', area: 'Exact private area',
    requesterUserId: 'requester-private-id', facilityName: 'Private Facility',
  };
  const matches = [
    { id: matchId1, donorProfileId: 'donor-profile-private', requestId: request.id, matchStatus: 'NOTIFIED', locationRank: 3, notifiedAt: new Date(), respondedAt: null, updatedAt: new Date(), request },
    { id: matchId2, donorProfileId: 'donor-profile-private', requestId: request.id, matchStatus: 'NOTIFIED', locationRank: 2, notifiedAt: new Date(), respondedAt: null, updatedAt: new Date(), request },
  ];
  const notifications = [];
  const prisma = {
    matches,
    notifications,
    session: { findUnique: async () => ({ userId: sessionUser, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: null } }) },
    $transaction: async (operation) => operation(prisma),
    donorProfile: { findUnique: async ({ where }) => where.userId === profileOwner ? profile : null },
    notification: { createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const item of data) {
        if (skipDuplicates && notifications.some((existing) => existing.eventKey === item.eventKey)) continue;
        notifications.push(item); count += 1;
      }
      return { count };
    } },
    bloodRequest: {
      findUnique: async () => request,
      updateMany: async ({ where, data }) => { if (request.status !== where.status) return { count: 0 }; Object.assign(request, data); return { count: 1 }; },
    },
    requestMatch: {
      findMany: async ({ where }) => matches.filter((match) => match.donorProfileId === where.donorProfileId),
      count: async ({ where }) => matches.filter((match) => match.donorProfileId === where.donorProfileId).length,
      findFirst: async ({ where }) => matches.find((match) => match.id === where.id && match.donorProfileId === where.donorProfileId) || null,
      updateMany: async ({ where, data }) => {
        const found = matches.filter((match) => (!where.id || match.id === where.id)
          && (!where.donorProfileId || match.donorProfileId === where.donorProfileId)
          && (!where.matchStatus || match.matchStatus === where.matchStatus));
        for (const match of found) Object.assign(match, data, { updatedAt: new Date() });
        return { count: found.length };
      },
    },
  };
  return prisma;
}

test('donors see only their own coarse opportunities and can accept, decline, and withdraw an acceptance', async () => {
  const prisma = opportunitiesPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=donor', 'content-type': 'application/json' };
    const list = await fetch(`${base}/api/v1/donors/me/opportunities`, { headers });
    const data = await list.json();
    assert.equal(list.status, 200);
    assert.equal(data.opportunities.length, 2);
    assert.deepEqual(data.opportunities[0].location, { division: 'North', district: 'Metro' });
    for (const secret of ['donorProfileId', 'requesterUserId', 'requestId', 'area', 'facilityName', 'email', 'phone', 'accountId']) assert.equal(secret in data.opportunities[0], false);
    assert.match(data.medicalNotice, /qualified medical professionals/i);

    let response = await fetch(`${base}/api/v1/donors/me/opportunities/${matchId1}/respond`, { method: 'POST', headers, body: JSON.stringify({ action: 'ACCEPT' }) });
    assert.equal((await response.json()).match.matchStatus, 'ACCEPTED');
    response = await fetch(`${base}/api/v1/donors/me/opportunities/${matchId1}/respond`, { method: 'POST', headers, body: JSON.stringify({ action: 'ACCEPT' }) });
    assert.equal(response.status, 409);
    response = await fetch(`${base}/api/v1/donors/me/opportunities/${matchId1}/respond`, { method: 'POST', headers, body: JSON.stringify({ action: 'WITHDRAW' }) });
    assert.equal((await response.json()).match.matchStatus, 'WITHDRAWN');

    response = await fetch(`${base}/api/v1/donors/me/opportunities/${matchId2}/respond`, { method: 'POST', headers, body: JSON.stringify({ action: 'DECLINE' }) });
    assert.equal((await response.json()).match.matchStatus, 'DECLINED');
    response = await fetch(`${base}/api/v1/donors/me/opportunities/${matchId2}/respond`, { method: 'POST', headers, body: JSON.stringify({ action: 'ACCEPT' }) });
    assert.equal(response.status, 409);
    assert.deepEqual(prisma.notifications.map((item) => item.type), ['DONOR_ACCEPTED', 'DONOR_WITHDREW', 'DONOR_DECLINED']);
    assert.ok(prisma.notifications.every((item) => item.userId === 'requester-private-id' && !/email|phone|area/i.test(item.message)));
  });
});

test('donor ownership, current consent, availability, and request status are rechecked before a response', async () => {
  const cases = [
    { label: 'another donor profile', config: { profileOwner: 'someone-else' }, expectedStatus: 404 },
    { label: 'withdrawn consent', config: { consent: false }, expectedStatus: 409 },
    { label: 'paused donor', config: { availability: 'PAUSED' }, expectedStatus: 409 },
    { label: 'closed request', config: { requestStatus: 'CLOSED' }, expectedStatus: 409 },
  ];
  for (const item of cases) {
    const prisma = opportunitiesPrisma(item.config);
    await withServer(createApp({ prisma, env }), async (base) => {
      const headers = { cookie: 'bloodlink_session=donor', 'content-type': 'application/json' };
      const response = await fetch(`${base}/api/v1/donors/me/opportunities/${matchId1}/respond`, { method: 'POST', headers, body: JSON.stringify({ action: 'ACCEPT' }) });
      assert.equal(response.status, item.expectedStatus, item.label);
      if (item.config.consent === false) assert.equal(prisma.matches[0].matchStatus, 'INVALIDATED');
      if (item.config.availability === 'PAUSED') assert.equal(prisma.matches[0].matchStatus, 'INVALIDATED');
    });
  }
});

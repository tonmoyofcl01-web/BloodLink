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
const baseRequest = (overrides = {}) => ({
  bloodGroup: 'O+', unitsRequested: 2, division: 'Division One', district: 'District Two', area: 'Area Three',
  urgency: 'URGENT', neededAt: '2027-01-01T09:00:00.000Z', facilityName: 'Central Hospital', publicNote: 'Needed today.', ...overrides,
});

function requestPrisma({ ownerId = 'owner-user', initial = [], donors = [] } = {}) {
  const groups = new Map(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((code, index) => [code, { id: index + 1, code }]));
  const records = new Map(initial.map((item) => [item.id, structuredClone(item)]));
  const matches = [];
  let sequence = records.size;
  const owned = (where) => [...records.values()].find((item) => item.id === where.id && (!where.requesterUserId || item.requesterUserId === where.requesterUserId) && (!where.status || item.status === where.status)) || null;
  const publicCopy = (record) => {
    if (!record) return null;
    const { requesterUserId: _owner, bloodGroupId: _groupId, ...safeFields } = record;
    return { ...safeFields, bloodGroup: { code: groups.get([...groups.keys()].find((code) => groups.get(code).id === record.bloodGroupId)).code } };
  };
  const prisma = {
    records,
    matches,
    session: { findUnique: async () => ({ userId: ownerId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: null } }) },
    $transaction: async (operation) => operation(prisma),
    bloodGroup: { findUnique: async ({ where }) => groups.get(where.code) || null },
    donorProfile: { findMany: async () => donors },
    bloodRequest: {
      create: async ({ data }) => {
        const id = `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
        const record = { id, ...data, status: 'OPEN', closedAt: null, createdAt: new Date(), updatedAt: new Date() };
        records.set(id, record);
        return publicCopy(record);
      },
      findMany: async ({ where, skip, take }) => [...records.values()]
        .filter((record) => record.requesterUserId === where.requesterUserId && (!where.status || record.status === where.status))
        .sort((a, b) => b.createdAt - a.createdAt).slice(skip, skip + take).map(publicCopy),
      count: async ({ where }) => [...records.values()].filter((record) => record.requesterUserId === where.requesterUserId && (!where.status || record.status === where.status)).length,
      findFirst: async ({ where }) => publicCopy(owned(where)),
      findUnique: async ({ where }) => {
        const record = records.get(where.id);
        if (!record) return null;
        const { requesterUserId: _owner, ...safeFields } = record;
        return { ...safeFields, bloodGroup: { code: [...groups.values()].find((group) => group.id === record.bloodGroupId).code } };
      },
      update: async ({ where, data }) => { const record = records.get(where.id); Object.assign(record, data, { updatedAt: new Date() }); return publicCopy(record); },
      updateMany: async ({ where, data }) => {
        const record = owned(where);
        if (!record || (where.neededAt?.lte && record.neededAt > where.neededAt.lte)) return { count: 0 };
        Object.assign(record, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    },
    requestMatch: {
      findMany: async ({ where }) => matches.filter((match) => (!where.requestId || match.requestId === where.requestId)
        && (!where.donorProfileId || (where.donorProfileId.in ? where.donorProfileId.in.includes(match.donorProfileId) : match.donorProfileId === where.donorProfileId))
        && (!where.notifiedAt || match.notifiedAt !== null)),
      count: async ({ where }) => matches.filter((match) => (!where.donorProfileId || match.donorProfileId === where.donorProfileId)).length,
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const item of data) {
          if (skipDuplicates && matches.some((match) => match.requestId === item.requestId && match.donorProfileId === item.donorProfileId)) continue;
          matches.push({ id: `match-${matches.length + 1}`, ...item, respondedAt: null, updatedAt: new Date(), request: records.get(item.requestId) });
          count += 1;
        }
        return { count };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const match of matches) {
          if ((!where.id || match.id === where.id) && (!where.requestId || match.requestId === where.requestId)
            && (!where.donorProfileId || match.donorProfileId === where.donorProfileId)
            && (!where.matchStatus || match.matchStatus === where.matchStatus)) { Object.assign(match, data, { updatedAt: new Date() }); count += 1; }
        }
        return { count };
      },
      findFirst: async ({ where }) => matches.find((match) => match.id === where.id && match.donorProfileId === where.donorProfileId) || null,
    },
  };
  return prisma;
}

test('authenticated users can create and list their requests; invalid or ownership fields are rejected', async () => {
  const prisma = requestPrisma({ donors: [{
    id: 'donor-profile-one', bloodGroupId: 7, division: 'division one', district: ' district two ', area: 'AREA THREE',
    availabilityStatus: 'AVAILABLE', discoveryConsentAt: new Date(), user: { status: 'ACTIVE', deletedAt: null },
  }] });
  await withServer(createApp({ prisma, env }), async (base) => {
    const unauth = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(baseRequest()) });
    assert.equal(unauth.status, 401);
    const headers = { cookie: 'bloodlink_session=owner', 'content-type': 'application/json' };
    const invalid = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers, body: JSON.stringify(baseRequest({ unitsRequested: 0 })) });
    assert.equal(invalid.status, 400);
    const injected = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers, body: JSON.stringify(baseRequest({ requesterUserId: 'attacker' })) });
    assert.equal(injected.status, 400);

    const response = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers, body: JSON.stringify(baseRequest()) });
    assert.equal(response.status, 201);
    const responseData = await response.json();
    const { request } = responseData;
    assert.equal(request.status, 'OPEN');
    assert.equal(request.bloodGroup, 'O+');
    assert.deepEqual(responseData.matching, { candidates: 1, created: 1 });
    for (const secret of ['requesterUserId', 'email', 'phone']) assert.equal(secret in request, false);

    const matchResponse = await fetch(`${base}/api/v1/requests/${request.id}/matches`, { headers });
    const matches = await matchResponse.json();
    assert.equal(matches.counts.potentialMatches, 1);
    assert.equal(matches.counts.pending, 1);
    assert.deepEqual(matches.matches[0], { status: 'NOTIFIED', locationMatch: 'AREA', notifiedAt: matches.matches[0].notifiedAt, respondedAt: null, updatedAt: matches.matches[0].updatedAt });
    for (const secret of ['donorProfileId', 'userId', 'email', 'phone', 'id']) assert.equal(secret in matches.matches[0], false);

    const list = await fetch(`${base}/api/v1/requests/mine?page=1&limit=1`, { headers });
    const data = await list.json();
    assert.equal(list.status, 200);
    assert.equal(data.requests.length, 1);
    assert.equal(data.pagination.total, 1);
    assert.equal(data.pagination.totalPages, 1);
  });
});

test('owners can edit, pause, reopen, cancel, and close requests with valid transitions only', async () => {
  const prisma = requestPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=owner', 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers, body: JSON.stringify(baseRequest()) });
    const first = (await created.json()).request;

    let response = await fetch(`${base}/api/v1/requests/${first.id}`, { method: 'PUT', headers, body: JSON.stringify(baseRequest({ unitsRequested: 4, facilityName: 'Updated Facility' })) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).request.unitsRequested, 4);
    response = await fetch(`${base}/api/v1/requests/${first.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'PAUSED' }) });
    assert.equal((await response.json()).request.status, 'PAUSED');
    response = await fetch(`${base}/api/v1/requests/${first.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'OPEN' }) });
    assert.equal((await response.json()).request.status, 'OPEN');
    response = await fetch(`${base}/api/v1/requests/${first.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'CLOSED' }) });
    assert.equal((await response.json()).request.status, 'CLOSED');
    response = await fetch(`${base}/api/v1/requests/${first.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'OPEN' }) });
    assert.equal(response.status, 409);
    response = await fetch(`${base}/api/v1/requests/${first.id}`, { method: 'PUT', headers, body: JSON.stringify(baseRequest()) });
    assert.equal(response.status, 409);

    const secondResponse = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers, body: JSON.stringify(baseRequest()) });
    const second = (await secondResponse.json()).request;
    response = await fetch(`${base}/api/v1/requests/${second.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'CANCELLED' }) });
    assert.equal((await response.json()).request.status, 'CANCELLED');
    assert.ok(prisma.records.get(second.id).closedAt instanceof Date);
    response = await fetch(`${base}/api/v1/requests/${second.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'FULFILLED' }) });
    assert.equal(response.status, 400);
  });
});

test('another account cannot retrieve, edit, or change status on a private request', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const prisma = requestPrisma({ ownerId: 'attacker', initial: [{ id, requesterUserId: 'owner', bloodGroupId: 8, unitsRequested: 1, division: 'Secret Division', district: 'Secret District', area: 'Secret Area', urgency: 'URGENT', neededAt: new Date(), facilityName: null, publicNote: null, status: 'OPEN', closedAt: null, createdAt: new Date(), updatedAt: new Date() }] });
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=attacker', 'content-type': 'application/json' };
    let response = await fetch(`${base}/api/v1/requests/${id}`, { headers });
    assert.equal(response.status, 404);
    response = await fetch(`${base}/api/v1/requests/${id}`, { method: 'PUT', headers, body: JSON.stringify(baseRequest()) });
    assert.equal(response.status, 404);
    response = await fetch(`${base}/api/v1/requests/${id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'CANCELLED' }) });
    assert.equal(response.status, 404);
    response = await fetch(`${base}/api/v1/requests/${id}/matches`, { headers });
    assert.equal(response.status, 404);
    assert.equal(prisma.records.get(id).status, 'OPEN');
  });
});

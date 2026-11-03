import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';
import { createNotifications, notifyRequestStatus } from './service.js';

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const env = { NODE_ENV: 'test', CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session', SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'false' };
const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';

function notificationPrisma() {
  const notifications = [
    { id: id1, userId: 'user-one', eventKey: 'request:one', type: 'DONOR_OPPORTUNITY', title: 'Opportunity', message: 'A request matches your donor profile.', referenceType: 'OPPORTUNITY', referenceId: id2, readAt: null, createdAt: new Date() },
    { id: '33333333-3333-4333-8333-333333333333', userId: 'user-one', eventKey: 'request:two', type: 'REQUEST_STATUS', title: 'Update', message: 'A request changed status.', referenceType: 'REQUEST', referenceId: id1, readAt: null, createdAt: new Date() },
    { id: id2, userId: 'user-two', eventKey: 'private', type: 'REQUEST_STATUS', title: 'Private', message: 'Private notification', referenceType: 'REQUEST', referenceId: id1, readAt: null, createdAt: new Date() },
  ];
  return {
    notifications,
    session: { findUnique: async () => ({ userId: 'user-one', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: null } }) },
    notification: {
      findMany: async ({ where, skip, take }) => notifications.filter((item) => item.userId === where.userId).slice(skip, skip + take),
      count: async ({ where }) => notifications.filter((item) => item.userId === where.userId && (!('readAt' in where) || item.readAt === where.readAt)).length,
      updateMany: async ({ where, data }) => {
        const found = notifications.filter((item) => item.userId === where.userId && (!where.id || item.id === where.id) && (!('readAt' in where) || item.readAt === where.readAt));
        for (const item of found) Object.assign(item, data);
        return { count: found.length };
      },
      findFirst: async ({ where }) => notifications.find((item) => item.id === where.id && item.userId === where.userId) || null,
    },
    requestMatch: { findFirst: async ({ where }) => where.id === id2 && where.donorProfile.is.userId === 'user-one' ? { id: id2 } : null },
    bloodRequest: { findFirst: async ({ where }) => where.id === id1 && where.requesterUserId === 'user-one' ? { id: id1 } : null, findUnique: async () => ({ organizationId: null }) },
  };
}

test('notifications are private to their owner, paginated, readable, and contain no donor contact or exact location', async () => {
  const prisma = notificationPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const headers = { cookie: 'bloodlink_session=one' };
    const list = await fetch(`${base}/api/v1/notifications?page=1&limit=1`, { headers });
    const data = await list.json();
    assert.equal(data.notifications.length, 1);
    assert.equal(data.unreadCount, 2);
    for (const secret of ['email', 'phone', 'exactAddress', 'preciseLocation', 'donorProfileId']) assert.equal(JSON.stringify(data).includes(secret), false);
    const foreignRead = await fetch(`${base}/api/v1/notifications/${id2}/read`, { method: 'PATCH', headers });
    assert.equal(foreignRead.status, 404);
    const read = await fetch(`${base}/api/v1/notifications/${id1}/read`, { method: 'PATCH', headers });
    assert.equal(read.status, 200);
    assert.ok(prisma.notifications[0].readAt);
    const markAll = await fetch(`${base}/api/v1/notifications/read-all`, { method: 'PATCH', headers });
    assert.deepEqual(await markAll.json(), { updated: 1 });
  });
});

test('opening a notification rechecks referenced opportunity ownership', async () => {
  const prisma = notificationPrisma();
  await withServer(createApp({ prisma, env }), async (base) => {
    const response = await fetch(`${base}/api/v1/notifications/${id1}/open`, { method: 'POST', headers: { cookie: 'bloodlink_session=one' } });
    assert.deepEqual(await response.json(), { destination: { view: 'opportunities', id: id2 } });
    prisma.requestMatch.findFirst = async () => null;
    const unauthorized = await fetch(`${base}/api/v1/notifications/${id1}/open`, { method: 'POST', headers: { cookie: 'bloodlink_session=one' } });
    assert.equal(unauthorized.status, 404);
  });
});

test('notification event insertion uses unique idempotency keys and skipDuplicates', async () => {
  const stored = new Map();
  const db = { notification: { createMany: async ({ data, skipDuplicates }) => {
    let count = 0;
    for (const row of data) {
      if (skipDuplicates && stored.has(row.eventKey)) continue;
      stored.set(row.eventKey, row);
      count += 1;
    }
    return { count };
  } } };
  const event = { userId: 'one', eventKey: 'same-event', type: 'REQUEST_STATUS', title: 'Paused', message: 'Request paused.' };
  assert.equal((await createNotifications(db, [event])).count, 1);
  assert.equal((await createNotifications(db, [event])).count, 0);
  assert.equal(stored.size, 1);
});

test('each request status event creates safe requester and donor notifications once', async () => {
  const stored = new Map();
  const db = {
    bloodRequest: { findUnique: async () => ({ id: id1, requesterUserId: 'requester-user' }) },
    requestMatch: { findMany: async () => [{ id: id2, donorProfile: { userId: 'donor-user' } }] },
    notification: { createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const row of data) {
        if (skipDuplicates && stored.has(row.eventKey)) continue;
        stored.set(row.eventKey, row); count += 1;
      }
      return { count };
    } },
  };
  const at = new Date('2026-11-03T12:00:00.000Z');
  for (const status of ['PAUSED', 'OPEN', 'CANCELLED', 'CLOSED', 'FULFILLED', 'EXPIRED']) {
    assert.equal((await notifyRequestStatus(db, id1, status, at)).count, 2);
    assert.equal((await notifyRequestStatus(db, id1, status, at)).count, 0);
  }
  assert.equal(stored.size, 12);
  assert.equal([...stored.values()].filter((item) => item.referenceType === 'OPPORTUNITY').length, 6);
  assert.equal([...stored.values()].filter((item) => item.referenceType === 'REQUEST').length, 6);
  assert.ok([...stored.values()].every((item) => !/email|phone|address|coordinates/i.test(`${item.title} ${item.message}`)));
});

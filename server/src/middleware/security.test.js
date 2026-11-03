import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { rateLimitStoreNames } from '../lib/rate-limit-store.js';

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const productionEnv = {
  NODE_ENV: 'production', PORT: 0, CLIENT_ORIGIN: 'https://bloodlink.example',
  DATABASE_URL: 'mysql://app:secret@db.example:3306/bloodlink?sslaccept=strict',
  REDIS_URL: 'rediss://redis.example:6379',
  SESSION_COOKIE_NAME: 'bloodlink_session', SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'true',
  SMTP_HOST: 'smtp.example.org', SMTP_PORT: 587, SMTP_SECURE: 'false', SMTP_USER: 'app@example.org', SMTP_PASSWORD: 'smtp-secret', EMAIL_FROM: 'noreply@example.org',
};

function testStores() {
  return Object.fromEntries(rateLimitStoreNames.map((name) => [name, {
    init() {}, increment: async () => ({ totalHits: 1, resetTime: new Date(Date.now() + 60_000) }),
    decrement() {}, resetKey() {},
  }]));
}

test('production rejects unsafe requests with missing or untrusted origins and accepts the configured HTTPS origin', async () => {
  const app = createApp({ prisma: {}, env: productionEnv, rateLimitStores: testStores(), emailAdapter: async () => {} });
  await withServer(app, async (base) => {
    let response = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'ORIGIN_REQUIRED');
    response = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    response = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { origin: productionEnv.CLIENT_ORIGIN } });
    assert.equal(response.status, 204);
  });
});

test('readiness endpoint reports database connectivity without exposing connection errors', async () => {
  const app = createApp({ prisma: { $queryRaw: async () => { throw new Error('private database details'); } }, env: productionEnv, rateLimitStores: testStores(), emailAdapter: async () => {} });
  await withServer(app, async (base) => {
    const liveness = await fetch(`${base}/api/v1/health`);
    assert.equal(liveness.status, 200);
    const readiness = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { status: 'not_ready' });
  });
});

test('production readiness remains unavailable while shared Redis is disconnected', async () => {
  const app = createApp({
    prisma: { $queryRaw: async () => 1 }, env: productionEnv, rateLimitStores: testStores(),
    rateLimitReady: () => false, emailAdapter: async () => {},
  });
  await withServer(app, async (base) => {
    const readiness = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { status: 'not_ready' });
  });
});

test('production app refuses to start without a connected shared rate-limit store', () => {
  assert.throws(() => createApp({ prisma: {}, env: productionEnv, emailAdapter: async () => {} }), /connected Redis store configured with REDIS_URL/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisStore } from 'rate-limit-redis';
import { createApp } from '../app.js';
import bcrypt from 'bcryptjs';
import { createRateLimitInfrastructure, createRedisRateLimitStores, getRateLimitClientIp, rateLimitStoreNames } from '../lib/rate-limit-store.js';

function createSharedRedisMock() {
  const counters = new Map();
  return async (command, ...args) => {
    if (command === 'SCRIPT' && args[0] === 'LOAD') return args[1].includes('INCR') ? 'mock-increment-script' : 'mock-get-script';
    if (command === 'EVALSHA') {
      const [script, , key, , windowMs] = args;
      const count = counters.get(key) || 0;
      if (script === 'mock-increment-script') {
        counters.set(key, count + 1);
        return [count + 1, Number(windowMs)];
      }
      return [count || false, Number(windowMs)];
    }
    if (command === 'DECR') {
      counters.set(args[0], Math.max(0, (counters.get(args[0]) || 0) - 1));
      return counters.get(args[0]);
    }
    if (command === 'DEL') return Number(counters.delete(args[0]));
    throw new Error(`Unexpected Redis command in test: ${command}`);
  };
}

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function makeTestApp(rateLimitStores, env = { NODE_ENV: 'test' }) {
  return createApp({ prisma: {}, env, rateLimitStores, emailAdapter: async () => {} });
}

test('Redis counters are shared across independently initialized application instances', async () => {
  const redisSendCommand = createSharedRedisMock();
  const appAStores = createRedisRateLimitStores(redisSendCommand);
  const appBStores = createRedisRateLimitStores(redisSendCommand);
  const appA = makeTestApp(appAStores);
  const appB = makeTestApp(appBStores);

  await withServer(appA, async (baseA) => withServer(appB, async (baseB) => {
    for (let index = 0; index < 45; index += 1) {
      assert.equal((await fetch(`${baseA}/api/v1/auth/unmatched`)).status, 404);
      assert.equal((await fetch(`${baseB}/api/v1/auth/unmatched`)).status, 404);
    }
    const limited = await fetch(`${baseB}/api/v1/auth/unmatched`);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  }));
});

test('untrusted forwarded-IP headers cannot bypass the limiter outside Vercel', async () => {
  const stores = createRedisRateLimitStores(createSharedRedisMock());
  const app = makeTestApp(stores);
  assert.equal(app.get('trust proxy'), false);
  await withServer(app, async (base) => {
    for (let index = 0; index < 90; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/unmatched`, {
        headers: {
          'x-forwarded-for': `198.51.100.${index + 1}`,
          'x-vercel-forwarded-for': `203.0.113.${index + 1}`,
          'x-real-ip': `192.0.2.${index + 1}`,
        },
      });
      assert.equal(response.status, 404);
    }
    const limited = await fetch(`${base}/api/v1/auth/unmatched`, {
      headers: { 'x-forwarded-for': '198.51.100.200', 'x-vercel-forwarded-for': '203.0.113.200', 'x-real-ip': '192.0.2.200' },
    });
    assert.equal(limited.status, 429);
  });
});

test('Vercel IP extraction trusts only its sanitized single-address X-Forwarded-For value', () => {
  const request = (headers) => ({ get: (name) => headers[name], socket: { remoteAddress: '127.0.0.1' } });
  assert.equal(getRateLimitClientIp(request({ 'x-forwarded-for': '198.51.100.25' }), { VERCEL: '1' }), '198.51.100.25');
  assert.equal(getRateLimitClientIp(request({ 'x-forwarded-for': '198.51.100.25, 10.0.0.2' }), { VERCEL: '1' }), '127.0.0.1');
  assert.equal(getRateLimitClientIp(request({ 'x-vercel-forwarded-for': '198.51.100.25', 'x-real-ip': '198.51.100.26' }), { VERCEL: '1' }), '127.0.0.1');
  assert.equal(getRateLimitClientIp(request({ 'x-forwarded-for': '198.51.100.25' }), {}), '127.0.0.1');
});

test('registration, verification, and resend have independent stricter limits', async () => {
  const redisSendCommand = createSharedRedisMock();
  const stores = createRedisRateLimitStores(redisSendCommand);
  const app = makeTestApp(stores);
  await withServer(app, async (base) => {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const registrationLimited = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(registrationLimited.status, 429);

    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const verificationLimited = await fetch(`${base}/api/v1/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(verificationLimited.status, 429);

    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/resend-verification`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const resendLimited = await fetch(`${base}/api/v1/auth/resend-verification`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(resendLimited.status, 429);
  });
});

test('login failures have their own limit and return retry information', async () => {
  const app = makeTestApp(createRedisRateLimitStores(createSharedRedisMock()));
  await withServer(app, async (base) => {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const loginLimited = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(loginLimited.status, 429);
    assert.equal((await loginLimited.json()).error.code, 'RATE_LIMITED');
    assert.ok(Number(loginLimited.headers.get('retry-after')) > 0);
  });
});

test('successful sign-ins do not consume the failed-login allowance', async () => {
  const passwordHash = await bcrypt.hash('correct test password', 4);
  const prisma = {
    user: { findUnique: async () => ({ id: 'active-user', email: 'person@example.org', fullName: 'Person', passwordHash, status: 'ACTIVE', deletedAt: null, adminAccount: null }) },
    session: { create: async () => {} },
  };
  const app = createApp({ prisma, env: { NODE_ENV: 'test', SESSION_COOKIE_NAME: 'session', SESSION_TTL_HOURS: 12 }, emailAdapter: async () => {} });
  await withServer(app, async (base) => {
    for (let index = 0; index < 12; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'person@example.org', password: 'correct test password' }) });
      assert.equal(response.status, 200);
    }
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'person@example.org', password: 'incorrect password' }) });
      assert.equal(response.status, 401);
    }
    const limited = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'person@example.org', password: 'incorrect password' }) });
    assert.equal(limited.status, 429);
  });
});

test('password-reset requests have their own email-abuse limit', async () => {
  const app = makeTestApp(createRedisRateLimitStores(createSharedRedisMock()));
  await withServer(app, async (base) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/password-reset/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const limited = await fetch(`${base}/api/v1/auth/password-reset/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

test('local development offers higher limits for repeated auth testing', async () => {
  const app = makeTestApp(undefined, { NODE_ENV: 'development' });
  await withServer(app, async (base) => {
    for (let index = 0; index < 60; index += 1) {
      const response = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const limited = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(limited.status, 429);
  });
});

test('Redis adapter uses a unique namespace for every rate-limit policy', () => {
  const stores = createRedisRateLimitStores(createSharedRedisMock());
  assert.equal(Object.keys(stores).length, rateLimitStoreNames.length);
  assert.ok(stores.auth instanceof RedisStore);
  assert.ok(stores.authRegister instanceof RedisStore);
  assert.notEqual(stores.auth.prefix, stores.authRegister.prefix);
  assert.ok(stores.authPasswordResetRequest instanceof RedisStore);
  assert.ok(stores.authPasswordResetConsume instanceof RedisStore);
});

test('production rate-limit infrastructure fails clearly when REDIS_URL is absent', async () => {
  await assert.rejects(
    createRateLimitInfrastructure({ NODE_ENV: 'production' }),
    /Production rate limiting requires REDIS_URL.*No in-memory fallback/,
  );
  const local = await createRateLimitInfrastructure({ NODE_ENV: 'development' });
  assert.equal(local.stores, undefined);
  await local.close();
});

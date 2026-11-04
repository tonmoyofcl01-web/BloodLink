import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../../app.js';

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  try { await callback(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const env = {
  NODE_ENV: 'test', PORT: 0, CLIENT_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_NAME: 'bloodlink_session',
  SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'false',
};

test('registration validates public input and creates no privileged fields', async () => {
  const created = [];
  const tokens = [];
  const prisma = {
    user: { findUnique: async () => null, create: async ({ data }) => { created.push(data); return { id: 'user-id', email: data.email }; } },
    emailVerificationToken: { create: async ({ data }) => tokens.push(data) },
    $transaction: async (operation) => operation(prisma),
  };
  const app = createApp({ prisma, env, emailAdapter: async () => {} });
  {
    await withServer(app, async (base) => {
      const injected = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.com', password: 'long-enough-password', fullName: 'Person', role: 'ADMIN' }),
      });
      assert.equal(injected.status, 400);
      assert.equal(created.length, 0);

      const wrongOrigin = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
        body: JSON.stringify({ email: 'other@example.com', password: 'long-enough-password', fullName: 'Person' }),
      });
      assert.equal(wrongOrigin.status, 403);
      assert.equal(created.length, 0);

      const response = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Person@Example.com', password: 'long-enough-password', fullName: 'Person' }),
      });
      assert.equal(response.status, 201);
      assert.equal(created[0].email, 'person@example.com');
      assert.equal('role' in created[0], false);
      assert.equal('adminAccount' in created[0], false);
      assert.match(created[0].passwordHash, /^\$2[aby]\$/);
      assert.equal(tokens.length, 1);
      assert.match(tokens[0].tokenHash, /^[a-f0-9]{64}$/);
    });
  }
});

test('registration and resend fail safely when SMTP is not configured without checking accounts', async () => {
  let lookups = 0;
  let creates = 0;
  const unavailable = async () => {};
  unavailable.isConfigured = false;
  const prisma = {
    user: { create: async () => { creates += 1; }, findUnique: async () => { lookups += 1; } },
  };
  await withServer(createApp({ prisma, env, emailAdapter: unavailable }), async (base) => {
    const register = await fetch(`${base}/api/v1/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', fullName: 'Person', password: 'long-enough-password' }),
    });
    const resend = await fetch(`${base}/api/v1/auth/resend-verification`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com' }),
    });
    assert.equal(register.status, 503);
    assert.equal(resend.status, 503);
    assert.equal((await register.json()).error.code, 'EMAIL_DELIVERY_UNAVAILABLE');
    assert.equal((await resend.json()).error.code, 'EMAIL_DELIVERY_UNAVAILABLE');
    assert.equal(creates, 0);
    assert.equal(lookups, 0);
  });
});

test('duplicate registration clearly distinguishes verified and pending accounts', async () => {
  let status = 'PENDING_VERIFICATION';
  let verifiedAt = null;
  let creates = 0;
  const prisma = {
    user: {
      findUnique: async () => ({ id: 'existing-user', status, emailVerifiedAt: verifiedAt, deletedAt: null }),
      create: async () => { creates += 1; },
    },
  };
  await withServer(createApp({ prisma, env, emailAdapter: async () => {} }), async (base) => {
    const register = () => fetch(`${base}/api/v1/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', fullName: 'Person', password: 'long-enough-password' }),
    });
    let response = await register();
    let result = await response.json();
    assert.equal(response.status, 409);
    assert.match(result.error.message, /not verified.*Resend/i);
    assert.equal(result.error.accountState, 'PENDING_VERIFICATION');
    status = 'ACTIVE';
    verifiedAt = new Date();
    response = await register();
    result = await response.json();
    assert.equal(response.status, 409);
    assert.match(result.error.message, /already exists and is verified. Sign in/i);
    assert.equal(result.error.accountState, 'VERIFIED');
    assert.equal(creates, 0);
  });
});

test('SMTP send failure is returned as a clear service error without revealing the raw adapter error', async () => {
  const prisma = {
    user: { findUnique: async () => null, create: async ({ data }) => ({ id: 'new-user', email: data.email }) },
    emailVerificationToken: { create: async () => {} },
    $transaction: async (operation) => operation(prisma),
  };
  const emailAdapter = async () => { throw new Error('private smtp transport details'); };
  emailAdapter.isConfigured = true;
  await withServer(createApp({ prisma, env, emailAdapter }), async (base) => {
    const response = await fetch(`${base}/api/v1/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', fullName: 'Person', password: 'long-enough-password' }),
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.error.code, 'EMAIL_DELIVERY_FAILED');
    assert.doesNotMatch(JSON.stringify(result), /private smtp transport details/);
  });
});

test('login sets an HttpOnly cookie and logout revokes its server-side session', async () => {
  const passwordHash = await bcrypt.hash('correct horse battery', 4);
  let sessionData;
  let sessionsCreated = 0;
  let revoked;
  const prisma = {
    user: { findUnique: async () => ({ id: 'user-id', email: 'person@example.com', fullName: 'Person', passwordHash, status: 'ACTIVE', deletedAt: null }) },
    session: {
      findUnique: async () => null,
      create: async ({ data }) => { sessionData = data; sessionsCreated += 1; },
      updateMany: async ({ where, data }) => { revoked = { where, data }; },
    },
  };
  await withServer(createApp({ prisma, env }), async (base) => {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', password: 'correct horse battery' }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const body = await response.json();
    assert.equal(body.user.id, 'user-id');
    assert.equal('session' in body, false);
    assert.equal(typeof sessionData.secretHash, 'string');
    const firstSessionData = sessionData;

    const repeatedLogin = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', password: 'correct horse battery' }),
    });
    assert.equal(repeatedLogin.status, 200);
    assert.equal((await repeatedLogin.json()).user.id, 'user-id');
    assert.equal(sessionsCreated, 2);

    const rawCookie = cookie.split(';')[0];
    const logout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: rawCookie } });
    assert.equal(logout.status, 204);
    assert.equal(revoked.where.secretHash, firstSessionData.secretHash);
    assert.ok(revoked.data.revokedAt instanceof Date);
  });
});

test('login identifies an unverified account only after its password is correct', async () => {
  const passwordHash = await bcrypt.hash('correct horse battery', 4);
  const prisma = {
    user: { findUnique: async () => ({ id: 'pending-user', email: 'person@example.com', fullName: 'Person', passwordHash, status: 'PENDING_VERIFICATION', deletedAt: null }) },
  };
  await withServer(createApp({ prisma, env }), async (base) => {
    const request = (password) => fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com', password }),
    });
    const wrongPassword = await request('wrong-password');
    assert.equal(wrongPassword.status, 401);
    assert.equal((await wrongPassword.json()).error.code, 'INVALID_CREDENTIALS');
    const correctPassword = await request('correct horse battery');
    assert.equal(correctPassword.status, 403);
    assert.equal((await correctPassword.json()).error.code, 'EMAIL_NOT_VERIFIED');
  });
});


test('database outages return a JSON 503 and the API continues serving requests', async () => {
  let databaseAvailable = false;
  const databaseError = new Error('connect ECONNREFUSED db.example:3306');
  databaseError.errorCode = 'P1001';
  const prisma = { user: { findUnique: async () => {
    if (!databaseAvailable) throw databaseError;
    return null;
  } } };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withServer(createApp({ prisma, env }), async (base) => {
      const request = () => fetch(`${base}/api/v1/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.com', password: 'correct horse battery' }),
      });
      const unavailable = await request();
      assert.equal(unavailable.status, 503);
      assert.match(unavailable.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await unavailable.json(), { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is temporarily unavailable. Check the API server output for connection details, then retry.' } });

      databaseAvailable = true;
      const recovered = await request();
      assert.equal(recovered.status, 401);
      assert.equal((await recovered.json()).error.code, 'INVALID_CREDENTIALS');
    });
  } finally { console.error = originalConsoleError; }
});

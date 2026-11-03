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
    user: { create: async ({ data }) => { created.push(data); return { id: 'user-id', email: data.email }; } },
    emailVerificationToken: { create: async ({ data }) => tokens.push(data) },
    $transaction: async (operation) => operation(prisma),
  };
  const app = createApp({ prisma, env });
  const originalInfo = console.info;
  console.info = () => {};
  try {
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
  } finally { console.info = originalInfo; }
});

test('login sets an HttpOnly cookie and logout revokes its server-side session', async () => {
  const passwordHash = await bcrypt.hash('correct horse battery', 4);
  let sessionData;
  let revoked;
  const prisma = {
    user: { findUnique: async () => ({ id: 'user-id', email: 'person@example.com', fullName: 'Person', passwordHash, status: 'ACTIVE', deletedAt: null }) },
    session: {
      findUnique: async () => null,
      create: async ({ data }) => { sessionData = data; },
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

    const rawCookie = cookie.split(';')[0];
    const logout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: rawCookie } });
    assert.equal(logout.status, 204);
    assert.equal(revoked.where.secretHash, sessionData.secretHash);
    assert.ok(revoked.data.revokedAt instanceof Date);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthMiddleware } from './auth.js';
import { hashSecret } from '../lib/crypto.js';

test('authorization denies anonymous and non-admin access to administrator routes', async () => {
  const auth = createAuthMiddleware({});
  const statuses = [];
  const res = { status(code) { statuses.push(code); return this; }, json() { return this; } };
  auth.requireAuth({}, res, () => assert.fail('anonymous user authorized'));
  auth.requireAdmin({ auth: { userId: 'u1', isAdmin: false } }, res, () => assert.fail('regular user authorized as admin'));
  assert.deepEqual(statuses, [401, 403]);
});

test('session middleware authenticates only an active user with a live, unrevoked session', async () => {
  const secret = 'random-session-secret';
  const middleware = createAuthMiddleware({ session: { findUnique: async ({ where }) => {
    assert.equal(where.secretHash, hashSecret(secret));
    return { userId: 'user-1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { status: 'ACTIVE', deletedAt: null, adminAccount: { revokedAt: null } } };
  } } });
  const req = { cookies: { bloodlink_session: secret } };
  await new Promise((resolve, reject) => middleware.optionalAuth(req, {}, (error) => error ? reject(error) : resolve()));
  assert.deepEqual(req.auth, { userId: 'user-1', isAdmin: true });
});

test('expired sessions do not authenticate', async () => {
  const middleware = createAuthMiddleware({ session: { findUnique: async () => ({ userId: 'user-1', revokedAt: null, expiresAt: new Date(Date.now() - 1), user: { status: 'ACTIVE', deletedAt: null, adminAccount: null } }) } });
  const req = { cookies: { bloodlink_session: 'random-session-secret' } };
  await new Promise((resolve, reject) => middleware.optionalAuth(req, {}, (error) => error ? reject(error) : resolve()));
  assert.equal(req.auth, undefined);
});

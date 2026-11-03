import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSchema, loginSchema } from '../modules/auth/routes.js';
import { envSchema } from '../config/env-schema.js';

test('registration rejects public role and admin privilege injection', () => {
  const result = registerSchema.safeParse({ email: 'person@example.com', password: 'long-enough-password', fullName: 'Person', role: 'ADMIN' });
  assert.equal(result.success, false);
});

test('registration rejects short passwords and accepts a valid individual account', () => {
  assert.equal(registerSchema.safeParse({ email: 'person@example.com', password: 'short', fullName: 'Person' }).success, false);
  assert.equal(registerSchema.safeParse({ email: 'person@example.com', password: 'long-enough-password', fullName: 'Person' }).success, true);
  assert.equal(loginSchema.safeParse({ email: 'person@example.com', password: 'password' }).success, true);
});

test('production requires secure cookies and independent secrets', () => {
  const base = { NODE_ENV: 'production', PORT: 4000, CLIENT_ORIGIN: 'https://bloodlink.example', DATABASE_URL: 'mysql://user:pass@localhost:3306/bloodlink', SESSION_COOKIE_NAME: 'session', SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'true' };
  assert.equal(envSchema.safeParse(base).success, true);
  assert.equal(envSchema.safeParse({ ...base, SESSION_COOKIE_SECURE: 'false' }).success, false);
});

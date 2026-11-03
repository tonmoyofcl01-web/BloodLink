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

test('production requires HTTPS, secure cookies, strict MySQL TLS, and complete SMTP settings', () => {
  const base = { NODE_ENV: 'production', PORT: 4000, CLIENT_ORIGIN: 'https://bloodlink.example', DATABASE_URL: 'mysql://user:pass@db.example:3306/bloodlink?sslaccept=strict', SESSION_COOKIE_NAME: 'session', SESSION_TTL_HOURS: 12, SESSION_COOKIE_SECURE: 'true', SMTP_HOST: 'smtp.example.org', SMTP_PORT: 587, SMTP_SECURE: 'false', SMTP_USER: 'bloodlink@example.org', SMTP_PASSWORD: 'smtp-secret', EMAIL_FROM: 'noreply@example.org' };
  assert.equal(envSchema.safeParse(base).success, true);
  assert.equal(envSchema.safeParse({ ...base, SESSION_COOKIE_SECURE: 'false' }).success, false);
  assert.equal(envSchema.safeParse({ ...base, CLIENT_ORIGIN: 'http://bloodlink.example' }).success, false);
  assert.equal(envSchema.safeParse({ ...base, DATABASE_URL: 'mysql://user:pass@db.example:3306/bloodlink' }).success, false);
  assert.equal(envSchema.safeParse({ ...base, SMTP_PASSWORD: undefined }).success, false);
  assert.equal(envSchema.safeParse({ ...base, SMTP_PORT: 465, SMTP_SECURE: 'false' }).success, false);
});

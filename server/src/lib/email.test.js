import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailAdapter } from './email.js';

test('production email adapter sends verification through authenticated SMTP with TLS required', async () => {
  let transportOptions;
  let message;
  const adapter = createEmailAdapter({
    NODE_ENV: 'production', SMTP_HOST: 'smtp.example.org', SMTP_PORT: 587, SMTP_SECURE: 'false',
    SMTP_USER: 'bloodlink@example.org', SMTP_PASSWORD: 'test-only-secret', EMAIL_FROM: 'noreply@example.org',
  }, (options) => {
    transportOptions = options;
    return { sendMail: async (value) => { message = value; } };
  });
  await adapter({ email: 'person@example.org', url: 'https://bloodlink.example/verify-email?token=abc123' });
  assert.equal(transportOptions.host, 'smtp.example.org');
  assert.equal(transportOptions.requireTLS, true);
  assert.deepEqual(transportOptions.auth, { user: 'bloodlink@example.org', pass: 'test-only-secret' });
  assert.equal(message.to, 'person@example.org');
  assert.match(message.text, /https:\/\/bloodlink\.example\/verify-email/);
  assert.match(message.html, /href="https:\/\/bloodlink\.example\/verify-email/);
  assert.match(message.html, /Verify email address/);
});

test('development sends through SMTP when configured instead of printing a link', async () => {
  let message;
  const lines = [];
  const originalInfo = console.info;
  console.info = (line) => lines.push(line);
  try {
    const adapter = createEmailAdapter({
      NODE_ENV: 'development', SMTP_HOST: 'smtp.example.org', SMTP_PORT: 587, SMTP_SECURE: 'false',
      SMTP_USER: 'bloodlink@example.org', SMTP_PASSWORD: 'test-only-secret', EMAIL_FROM: 'noreply@example.org',
    }, () => ({ sendMail: async (value) => { message = value; } }));
    await adapter({ email: 'person@example.org', url: 'http://localhost:5173/verify-email?token=synthetic' });
    assert.equal(message.to, 'person@example.org');
    assert.match(message.html, /href="http:\/\/localhost:5173\/verify-email/);
    assert.equal(lines.length, 0);
  } finally { console.info = originalInfo; }
});

test('partial local SMTP settings fail clearly instead of silently using the console adapter', () => {
  assert.throws(() => createEmailAdapter({ NODE_ENV: 'development', SMTP_HOST: 'smtp.example.org' }), /SMTP configuration is incomplete/);
});

test('unconfigured local email adapter fails without logging or exposing verification links', async () => {
  const lines = [];
  const originalInfo = console.info;
  console.info = (line) => lines.push(line);
  try {
    const adapter = createEmailAdapter({ NODE_ENV: 'development' });
    assert.equal(adapter.isConfigured, false);
    await assert.rejects(adapter({ email: 'person@example.org', url: 'http://localhost:5173/verify-email?token=synthetic-test-only' }), /SMTP environment variables/);
    assert.deepEqual(lines, []);
  } finally { console.info = originalInfo; }
});

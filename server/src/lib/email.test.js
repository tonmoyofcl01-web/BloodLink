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
});

test('development adapter is the only adapter that writes verification links to the console', async () => {
  const lines = [];
  const originalInfo = console.info;
  console.info = (line) => lines.push(line);
  try {
    const adapter = createEmailAdapter({ NODE_ENV: 'development' });
    await adapter({ email: 'person@example.org', url: 'http://localhost:5173/verify-email?token=dev' });
    assert.match(lines[0], /development email/);
    assert.match(lines[0], /token=dev/);
  } finally { console.info = originalInfo; }
});

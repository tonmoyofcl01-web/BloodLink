import test from 'node:test';
import assert from 'node:assert/strict';
import { authRequestError, readApiJson } from './api-response.js';

test('auth response reader returns JSON objects including API error payloads', async () => {
  const success = await readApiJson(new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200 }));
  assert.deepEqual(success, { user: { id: 'user-1' } });
  const failure = await readApiJson(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } }), { status: 401 }));
  assert.equal(failure.error.code, 'INVALID_CREDENTIALS');
});

test('auth response reader describes empty, malformed, and non-object responses with HTTP status', async () => {
  await assert.rejects(readApiJson(new Response('', { status: 502, statusText: 'Bad Gateway' })), /empty response \(HTTP 502 Bad Gateway\)/);
  await assert.rejects(readApiJson(new Response('<html>proxy failure</html>', { status: 502 })), /invalid JSON \(HTTP 502\).*proxy failure/);
  await assert.rejects(readApiJson(new Response('null', { status: 200 })), /unexpected response \(HTTP 200\)/);
});

test('auth transport errors retain the browser failure and direct developers to API logs', () => {
  assert.match(authRequestError(new TypeError('Failed to fetch'), 'sign-in'), /Failed to fetch.*terminal output/);
  assert.equal(authRequestError(new Error('Email or password is incorrect.'), 'sign-in'), 'Email or password is incorrect.');
});

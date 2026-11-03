import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerificationOnce } from './verification-once.js';

test('verification effect replay submits a one-time link only once', () => {
  const submitted = { current: false };
  let requests = 0;
  const submit = () => { requests += 1; };

  assert.equal(runVerificationOnce(submitted, submit), true);
  assert.equal(runVerificationOnce(submitted, submit), false);
  assert.equal(requests, 1);
});

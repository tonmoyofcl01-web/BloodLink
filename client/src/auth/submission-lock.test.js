import test from 'node:test';
import assert from 'node:assert/strict';
import { runSubmissionOnce } from './submission-lock.js';

test('overlapping auth form submissions run once and release the lock', async () => {
  const lock = { current: false };
  let calls = 0;
  let finishFirst;
  const first = runSubmissionOnce(lock, () => new Promise((resolve) => {
    calls += 1;
    finishFirst = resolve;
  }));
  assert.equal(await runSubmissionOnce(lock, async () => { calls += 1; }), false);
  assert.equal(calls, 1);
  finishFirst();
  assert.equal(await first, true);
  assert.equal(await runSubmissionOnce(lock, async () => { calls += 1; }), true);
  assert.equal(calls, 2);
});

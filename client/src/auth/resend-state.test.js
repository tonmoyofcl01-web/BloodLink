import test from 'node:test';
import assert from 'node:assert/strict';
import { canShowResendVerification, verificationUiState } from './resend-state.js';

test('successful registration confirms delivery and enables resend for that email', () => {
  const state = verificationUiState({ mode: 'register', ok: true, email: 'person@example.com' });
  assert.equal(state.resendEmail, 'person@example.com');
  assert.equal(canShowResendVerification('register', 'person@example.com', state.resendEmail), true);
});

test('an existing unverified account enables resend from explicit API account state', () => {
  const state = verificationUiState({ mode: 'register', ok: false, email: 'person@example.com', error: { code: 'EMAIL_ALREADY_REGISTERED', accountState: 'PENDING_VERIFICATION' } });
  assert.equal(state.resendEmail, 'person@example.com');
  assert.equal(state.verified, false);
});

test('an existing verified account never enables resend and is directed to sign in', () => {
  const state = verificationUiState({ mode: 'register', ok: false, email: 'person@example.com', error: { code: 'EMAIL_ALREADY_REGISTERED', accountState: 'VERIFIED' } });
  assert.equal(state.resendEmail, '');
  assert.equal(state.verified, true);
  assert.equal(canShowResendVerification('login', 'person@example.com', state.resendEmail), false);
});

test('SMTP delivery failure does not claim delivery or enable resend', () => {
  const state = verificationUiState({ mode: 'register', ok: false, email: 'person@example.com', error: { code: 'EMAIL_DELIVERY_FAILED' } });
  assert.equal(state.resendEmail, '');
});

test('unknown or invalid registration responses do not enable resend', () => {
  for (const error of [{ code: 'VALIDATION_ERROR' }, { code: 'ACCOUNT_NOT_FOUND' }, { code: 'EMAIL_ALREADY_REGISTERED', accountState: 'UNAVAILABLE' }]) {
    const state = verificationUiState({ mode: 'register', ok: false, email: 'person@example.com', error });
    assert.equal(state.resendEmail, '');
  }
});

test('editing the email hides a resend action associated with the previous address', () => {
  assert.equal(canShowResendVerification('login', 'changed@example.com', 'person@example.com'), false);
});

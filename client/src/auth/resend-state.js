export function verificationUiState({ mode, ok, error, email }) {
  if (mode === 'register' && ok) return { resendEmail: email, verified: false };
  if (mode === 'register' && error?.code === 'EMAIL_ALREADY_REGISTERED') {
    if (error.accountState === 'PENDING_VERIFICATION') return { resendEmail: email, verified: false };
    if (error.accountState === 'VERIFIED') return { resendEmail: '', verified: true };
  }
  if (mode === 'login' && error?.code === 'EMAIL_NOT_VERIFIED') return { resendEmail: email, verified: false };
  return { resendEmail: '', verified: false };
}

export function canShowResendVerification(mode, currentEmail, resendEmail) {
  return ['login', 'register'].includes(mode)
    && Boolean(currentEmail.trim())
    && currentEmail.trim().toLowerCase() === resendEmail.trim().toLowerCase();
}

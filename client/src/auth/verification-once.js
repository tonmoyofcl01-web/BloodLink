/** Prevents a one-time verification request from replaying when React Strict Mode re-runs effects. */
export function runVerificationOnce(submissionRef, submit) {
  if (submissionRef.current) return false;
  submissionRef.current = true;
  submit();
  return true;
}

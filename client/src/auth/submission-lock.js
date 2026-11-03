/** Runs one auth action at a time so repeated clicks/Enter presses cannot duplicate requests. */
export async function runSubmissionOnce(lockRef, submit) {
  if (lockRef.current) return false;
  lockRef.current = true;
  try {
    await submit();
    return true;
  } finally {
    lockRef.current = false;
  }
}

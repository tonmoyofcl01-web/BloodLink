/** Development-only adapter: prints verification URLs to the API console. */
export async function sendVerificationEmail({ email, url }) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('A production email provider must be configured before production use.');
  }
  console.info(`[development email] Verification for ${email}: ${url}`);
}

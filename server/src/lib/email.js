import nodemailer from 'nodemailer';

/** Creates a local logging adapter or a production SMTP adapter from validated settings. */
export function createEmailAdapter(env, createTransport = nodemailer.createTransport) {
  if (env.NODE_ENV !== 'production') {
    return async ({ email, url }) => console.info(`[development email] Verification for ${email}: ${url}`);
  }
  const secure = env.SMTP_SECURE === 'true';
  const transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    requireTLS: !secure,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return async ({ email, url }) => transporter.sendMail({
    from: env.EMAIL_FROM,
    to: email,
    subject: 'Verify your BloodLink account',
    text: `Verify your BloodLink account by opening this link: ${url}\n\nIf you did not create the account, ignore this message.`,
    html: `<p>Verify your BloodLink account:</p><p><a href="${url}">Verify email address</a></p><p>If you did not create the account, ignore this message.</p>`,
  });
}

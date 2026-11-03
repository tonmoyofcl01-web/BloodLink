import nodemailer from 'nodemailer';

const smtpSettings = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'];

/** Uses authenticated SMTP when configured; raw verification/reset links are never logged. */
export function createEmailAdapter(env, createTransport = nodemailer.createTransport) {
  const configuredSettings = smtpSettings.filter((key) => env[key] !== undefined && env[key] !== '');
  if (configuredSettings.length === 0 && env.NODE_ENV !== 'production') {
    const unavailableAdapter = async () => {
      throw new Error('Email delivery is not configured. Set the SMTP environment variables and restart BloodLink.');
    };
    unavailableAdapter.isConfigured = false;
    return unavailableAdapter;
  }
  if (configuredSettings.length !== smtpSettings.length) {
    throw new Error('SMTP configuration is incomplete. Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, and EMAIL_FROM together.');
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
  const smtpAdapter = async ({ email, url, type = 'verification' }) => {
    if (type === 'password-reset') {
      return transporter.sendMail({
        from: env.EMAIL_FROM,
        to: email,
        subject: 'Reset your BloodLink password',
        text: `A password reset was requested for your BloodLink account. If you made this request, reset your password within 30 minutes using this link:\n${url}\n\nIf you did not request a reset, ignore this message.`,
        html: `<div style="margin:0;background:#f1f5f9;padding:32px 12px;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#be123c;padding:24px 32px;color:#fff;font-size:18px;font-weight:700;letter-spacing:2px">BLOODLINK</div><div style="padding:32px"><h1 style="margin:0 0 16px;font-size:24px">Reset your password</h1><p style="font-size:16px;line-height:1.6">A password reset was requested for your BloodLink account.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;border-radius:10px;background:#be123c;padding:14px 22px;color:#fff;text-decoration:none;font-weight:700">Reset password</a></p><p style="font-size:13px;line-height:1.6;color:#475569">This single-use link expires in 30 minutes. If you did not request a password reset, ignore this message.</p></div></div></div>`,
      });
    }
    return transporter.sendMail({
      from: env.EMAIL_FROM,
      to: email,
      subject: 'Verify your BloodLink account',
      text: `Welcome to BloodLink. Verify your email address within 24 hours by opening this link:\n${url}\n\nIf you did not create this account, you can ignore this message.`,
      html: `<div style="margin:0;background:#f1f5f9;padding:32px 12px;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#be123c;padding:24px 32px;color:#fff;font-size:18px;font-weight:700;letter-spacing:2px">BLOODLINK</div><div style="padding:32px"><h1 style="margin:0 0 16px;font-size:24px">Verify your email</h1><p style="font-size:16px;line-height:1.6">Welcome to BloodLink. Confirm this email address to activate your account.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;border-radius:10px;background:#be123c;padding:14px 22px;color:#fff;text-decoration:none;font-weight:700">Verify email address</a></p><p style="font-size:13px;line-height:1.6;color:#475569">This link expires in 24 hours and can only be used once. If the button does not work, copy this link into your browser:<br><a href="${url}" style="overflow-wrap:anywhere;color:#0f766e">${url}</a></p><p style="font-size:13px;color:#64748b">If you did not create this account, you can ignore this message.</p></div></div></div>`,
    });
  };
  smtpAdapter.isConfigured = true;
  return smtpAdapter;
}

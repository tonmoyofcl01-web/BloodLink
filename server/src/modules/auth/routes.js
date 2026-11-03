import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { hashSecret, newSecret } from '../../lib/crypto.js';
import { createEmailAdapter } from '../../lib/email.js';

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(1).max(120),
}).strict();
export const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();
export const passwordResetRequestSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
export const passwordResetConsumeSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(128) }).strict();

const resetRequestMessage = 'If an active account uses that email, password-reset instructions will be sent.';

function registrationConflict(res, user) {
  let message = 'An account with this email already exists. Sign in or contact BloodLink support.';
  if (user?.status === 'PENDING_VERIFICATION') message = 'An account with this email already exists but is not verified. Resend the verification email to activate it.';
  else if (user?.status === 'ACTIVE' && user.emailVerifiedAt) message = 'An account with this email already exists and is verified. Sign in instead.';
  const accountState = user?.status === 'PENDING_VERIFICATION' && !user.deletedAt
    ? 'PENDING_VERIFICATION'
    : user?.status === 'ACTIVE' && user.emailVerifiedAt && !user.deletedAt ? 'VERIFIED' : 'UNAVAILABLE';
  return res.status(409).json({ error: { code: 'EMAIL_ALREADY_REGISTERED', message, accountState } });
}

async function deliverEmail(emailAdapter, message) {
  try { await emailAdapter(message); }
  catch {
    const error = new Error('Email delivery failed. Please try again later.');
    error.code = 'EMAIL_DELIVERY_FAILED';
    throw error;
  }
}

function sendTokenError(res, record, kind) {
  if (!record) return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: `This ${kind} link is invalid.` } });
  if (record.usedAt) return res.status(400).json({ error: { code: 'TOKEN_ALREADY_USED', message: `This ${kind} link was already used or replaced. Request a new link if needed.` } });
  if (record.expiresAt <= new Date()) return res.status(400).json({ error: { code: 'TOKEN_EXPIRED', message: `This ${kind} link has expired. Request a new one.` } });
  return null;
}

export function createAuthRouter({ prisma, env, emailAdapter = createEmailAdapter(env), rateLimiters = {} }) {
  const router = Router();
  const noRateLimit = (_req, _res, next) => next();
  const cookieOptions = {
    httpOnly: true, secure: env.SESSION_COOKIE_SECURE === 'true', sameSite: 'lax',
    path: '/', maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
  const emailUnavailable = (res) => res.status(503).json({ error: {
    code: 'EMAIL_DELIVERY_UNAVAILABLE',
    message: 'Email delivery is not configured. Ask the administrator to configure SMTP, then try again.',
  } });

  router.post('/register', rateLimiters.register || noRateLimit, async (req, res, next) => {
    try {
      const input = registerSchema.parse(req.body);
      const email = input.email.toLowerCase();
      if (emailAdapter.isConfigured === false) return emailUnavailable(res);
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true, deletedAt: true } });
      if (existing) return registrationConflict(res, existing);
      const passwordHash = await bcrypt.hash(input.password, 12);
      const rawToken = newSecret();
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, passwordHash, fullName: input.fullName } });
        await tx.emailVerificationToken.create({ data: {
          userId: created.id, tokenHash: hashSecret(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        } });
        return created;
      });
      const verifyUrl = `${env.CLIENT_ORIGIN}/verify-email?token=${encodeURIComponent(rawToken)}`;
      await deliverEmail(emailAdapter, { email, url: verifyUrl, type: 'verification' });
      return res.status(201).json({ message: 'Account created. Verification email sent. Open the link to activate your account.' });
    } catch (error) {
      if (error?.code === 'P2002') {
        const existing = await prisma.user.findUnique({ where: { email: String(req.body?.email || '').trim().toLowerCase() }, select: { id: true, status: true, emailVerifiedAt: true, deletedAt: true } });
        if (existing) return registrationConflict(res, existing);
      }
      next(error);
    }
  });

  router.post('/verify-email', rateLimiters.verify || noRateLimit, async (req, res, next) => {
    try {
      const { token } = z.object({ token: z.string().min(20).max(200) }).strict().parse(req.body);
      const tokenHash = hashSecret(token);
      const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!record) return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This verification link is invalid.' } });
      if (record.usedAt) return res.status(400).json({ error: { code: 'TOKEN_ALREADY_USED', message: 'This verification link has already been used. Try signing in.' } });
      if (record.expiresAt <= new Date()) return res.status(400).json({ error: { code: 'TOKEN_EXPIRED', message: 'This verification link has expired. Request a new one.' } });
      const verified = await prisma.$transaction(async (tx) => {
        const used = await tx.emailVerificationToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (used.count !== 1) return false;
        const activated = await tx.user.updateMany({ where: { id: record.userId, status: 'PENDING_VERIFICATION', deletedAt: null }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } });
        return activated.count === 1;
      });
      if (!verified) return res.status(400).json({ error: { code: 'TOKEN_ALREADY_USED', message: 'This verification link has already been used or is no longer valid. Try signing in or request a new link.' } });
      res.json({ message: 'Email verified. You can now sign in.' });
    } catch (error) { next(error); }
  });

  router.post('/resend-verification', rateLimiters.resend || noRateLimit, async (req, res, next) => {
    try {
      const { email: rawEmail } = z.object({ email: z.string().trim().email().max(254) }).strict().parse(req.body);
      if (emailAdapter.isConfigured === false) return emailUnavailable(res);
      const email = rawEmail.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true, deletedAt: true } });
      if (!user || user.deletedAt) return res.status(404).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'No account was found for this email address.' } });
      if (user.status === 'ACTIVE' && user.emailVerifiedAt) return res.status(409).json({ error: { code: 'ALREADY_VERIFIED', message: 'This account is already verified. Sign in instead.' } });
      if (user.status !== 'PENDING_VERIFICATION') return res.status(409).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account cannot receive a verification email. Contact BloodLink support.' } });
      if (user && user.status === 'PENDING_VERIFICATION') {
        const rawToken = newSecret();
        await prisma.$transaction(async (tx) => {
          await tx.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
          await tx.emailVerificationToken.create({ data: {
            userId: user.id, tokenHash: hashSecret(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          } });
        });
        const verifyUrl = `${env.CLIENT_ORIGIN}/verify-email?token=${encodeURIComponent(rawToken)}`;
        await deliverEmail(emailAdapter, { email, url: verifyUrl, type: 'verification' });
      }
      res.json({ message: 'Verification email sent. Use the newest link to verify your account.' });
    } catch (error) { next(error); }
  });

  router.post('/password-reset/request', rateLimiters.passwordResetRequest || noRateLimit, async (req, res, next) => {
    try {
      const { email: rawEmail } = passwordResetRequestSchema.parse(req.body);
      if (emailAdapter.isConfigured === false) return emailUnavailable(res);
      const email = rawEmail.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true, deletedAt: true } });
      if (user && user.status === 'ACTIVE' && user.emailVerifiedAt && !user.deletedAt) {
        const rawToken = newSecret();
        await prisma.$transaction(async (tx) => {
          const now = new Date();
          await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
          await tx.passwordResetToken.create({ data: {
            userId: user.id,
            tokenHash: hashSecret(rawToken),
            expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          } });
        });
        const resetUrl = `${env.CLIENT_ORIGIN}/reset-password?token=${encodeURIComponent(rawToken)}`;
        try {
          await deliverEmail(emailAdapter, { email, url: resetUrl, type: 'password-reset' });
        } catch {
            await prisma.passwordResetToken.updateMany({ where: { userId: user.id, tokenHash: hashSecret(rawToken), usedAt: null }, data: { usedAt: new Date() } });
          // Keep account existence and SMTP delivery failures out of the public response.
          console.warn('[auth] Password reset email delivery failed.');
        }
      }
      return res.status(202).json({ message: resetRequestMessage });
    } catch (error) { next(error); }
  });

  router.post('/password-reset/consume', rateLimiters.passwordResetConsume || noRateLimit, async (req, res, next) => {
    try {
      const { token, password } = passwordResetConsumeSchema.parse(req.body);
      const tokenHash = hashSecret(token);
      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: { select: { status: true, emailVerifiedAt: true, deletedAt: true } } } });
      const tokenProblem = sendTokenError(res, record, 'password-reset');
      if (tokenProblem) return tokenProblem;
      if (record.user.status !== 'ACTIVE' || !record.user.emailVerifiedAt || record.user.deletedAt) {
        return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This password-reset link is invalid.' } });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const inactiveAccount = Symbol('inactive-account');
      let resetSucceeded = false;
      try {
        resetSucceeded = await prisma.$transaction(async (tx) => {
          const now = new Date();
          const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
          if (consumed.count !== 1) return false;
          const updated = await tx.user.updateMany({ where: { id: record.userId, status: 'ACTIVE', emailVerifiedAt: { not: null }, deletedAt: null }, data: { passwordHash } });
          if (updated.count !== 1) throw inactiveAccount;
          await tx.passwordResetToken.updateMany({ where: { userId: record.userId, id: { not: record.id }, usedAt: null }, data: { usedAt: now } });
          await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
          return true;
        });
      } catch (error) {
        if (error === inactiveAccount) return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This password-reset link is invalid.' } });
        throw error;
      }
      if (!resetSucceeded) {
        const refreshed = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, select: { usedAt: true, expiresAt: true } });
        const tokenProblem = sendTokenError(res, refreshed, 'password-reset');
        if (tokenProblem) return tokenProblem;
        return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This password-reset link is no longer valid.' } });
      }
      return res.json({ message: 'Password updated. Your existing sessions have been signed out. Sign in with your new password.' });
    } catch (error) { next(error); }
  });

  router.post('/login', rateLimiters.login || noRateLimit, async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() }, include: { adminAccount: true } });
      const passwordMatches = user && await bcrypt.compare(input.password, user.passwordHash);
      if (!user || !passwordMatches || user.deletedAt) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
      if (user.status === 'PENDING_VERIFICATION') return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in. You can request a new verification link.' } });
      if (user.status !== 'ACTIVE') return res.status(403).json({ error: { code: 'ACCOUNT_INACTIVE', message: 'This account is not active. Contact BloodLink support.' } });
      const token = newSecret();
      const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
      await prisma.session.create({ data: { userId: user.id, secretHash: hashSecret(token), expiresAt } });
      res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions);
      res.json({ user: { id: user.id, fullName: user.fullName, email: user.email, isAdmin: Boolean(user.adminAccount && !user.adminAccount.revokedAt) } });
    } catch (error) { next(error); }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = req.cookies?.[env.SESSION_COOKIE_NAME];
      if (token) await prisma.session.updateMany({ where: { secretHash: hashSecret(token), revokedAt: null }, data: { revokedAt: new Date() } });
      res.clearCookie(env.SESSION_COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const token = req.cookies?.[env.SESSION_COOKIE_NAME];
      if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
      const session = await prisma.session.findUnique({ where: { secretHash: hashSecret(token) }, include: { user: { include: { adminAccount: true } } } });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE' || session.user.deletedAt) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
      res.json({ user: { id: session.user.id, fullName: session.user.fullName, email: session.user.email, isAdmin: Boolean(session.user.adminAccount && !session.user.adminAccount.revokedAt) } });
    } catch (error) { next(error); }
  });

  return router;
}

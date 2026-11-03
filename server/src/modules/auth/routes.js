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
const registrationMessage = 'If this address can be registered, verification instructions will be sent. If you already have an account, sign in or request another link.';

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
      if (emailAdapter.isConfigured === false) return emailUnavailable(res);
      const email = input.email.toLowerCase();
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
      await emailAdapter({ email, url: verifyUrl });
      return res.status(202).json({ message: registrationMessage });
    } catch (error) {
      if (error?.code === 'P2002') return res.status(202).json({ message: registrationMessage });
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
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, deletedAt: true } });
      if (user && user.status === 'PENDING_VERIFICATION' && !user.deletedAt) {
        const rawToken = newSecret();
        await prisma.$transaction(async (tx) => {
          await tx.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
          await tx.emailVerificationToken.create({ data: {
            userId: user.id, tokenHash: hashSecret(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          } });
        });
        const verifyUrl = `${env.CLIENT_ORIGIN}/verify-email?token=${encodeURIComponent(rawToken)}`;
        await emailAdapter({ email, url: verifyUrl });
      }
      res.status(202).json({ message: 'If this address belongs to an unverified account, new instructions have been sent. If you already verified it, you can sign in.' });
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

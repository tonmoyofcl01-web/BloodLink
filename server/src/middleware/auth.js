import { hashSecret } from '../lib/crypto.js';

export function createAuthMiddleware(prisma) {
  async function optionalAuth(req, _res, next) {
    try {
      const token = req.cookies?.[process.env.SESSION_COOKIE_NAME || 'bloodlink_session'];
      if (!token) return next();
      const session = await prisma.session.findUnique({
        where: { secretHash: hashSecret(token) },
        include: { user: { include: { adminAccount: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE' || session.user.deletedAt) return next();
      req.auth = { userId: session.userId, isAdmin: Boolean(session.user.adminAccount && !session.user.adminAccount.revokedAt) };
      next();
    } catch (error) { next(error); }
  }

  function requireAuth(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.auth?.isAdmin) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
    next();
  }

  return { optionalAuth, requireAuth, requireAdmin };
}

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { createAuthRouter } from './modules/auth/routes.js';
import { createDonorRouter } from './modules/donors/routes.js';
import { createRequestRouter } from './modules/requests/routes.js';
import { createNotificationRouter } from './modules/notifications/routes.js';
import { createOrganizationAdminRouter, createOrganizationRouter } from './modules/organizations/routes.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createRateLimitMiddleware, rateLimitStoreNames } from './lib/rate-limit-store.js';

export function createApp({ prisma, env, emailAdapter, rateLimitStores, rateLimitReady }) {
  if (env.NODE_ENV === 'production') {
    if (!env.REDIS_URL || !rateLimitStores) throw new Error('Production rate limiting requires a connected Redis store configured with REDIS_URL.');
    const missingStores = rateLimitStoreNames.filter((name) => !rateLimitStores[name]);
    if (missingStores.length) throw new Error(`Production rate-limit Redis stores are missing: ${missingStores.join(', ')}.`);
  }
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (env.NODE_ENV === 'production' && !origin) return res.status(403).json({ error: { code: 'ORIGIN_REQUIRED', message: 'A trusted request origin is required.' } });
      if (origin && origin !== env.CLIENT_ORIGIN) return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Request origin is not allowed.' } });
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Cross-site requests are not allowed.' } });
    }
    next();
  });
  const windowMs = 15 * 60 * 1000;
  const getLimiter = (name, limit, message) => createRateLimitMiddleware({
    limit, windowMs, store: rateLimitStores?.[name], env, message,
  });
  app.use('/api/v1/auth', getLimiter('auth', 30, 'Too many authentication requests. Try again later.'));
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (env.NODE_ENV === 'production' && !rateLimitReady?.()) return res.status(503).json({ status: 'not_ready' });
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });
  const auth = createAuthMiddleware(prisma, env);
  app.use('/api/v1', auth.optionalAuth);
  app.use('/api/v1/auth', createAuthRouter({
    prisma, env, emailAdapter,
    rateLimiters: {
      register: getLimiter('authRegister', 10, 'Too many registration attempts. Try again later.'),
      login: getLimiter('authLogin', 10, 'Too many sign-in attempts. Try again later.'),
      verify: getLimiter('authVerify', 10, 'Too many email verification attempts. Try again later.'),
      resend: getLimiter('authResend', 5, 'Too many verification email requests. Try again later.'),
    },
  }));
  app.use('/api/v1/donors', createDonorRouter({ prisma, requireAuth: auth.requireAuth, rateLimitStore: rateLimitStores?.donorDiscovery, env }));
  app.use('/api/v1/requests', createRequestRouter({ prisma, requireAuth: auth.requireAuth, rateLimitStore: rateLimitStores?.requestCreate, env }));
  app.use('/api/v1/notifications', createNotificationRouter({ prisma, requireAuth: auth.requireAuth }));
  app.use('/api/v1/organizations', createOrganizationRouter({ prisma, requireAuth: auth.requireAuth }));
  app.use('/api/v1/admin/organizations', createOrganizationAdminRouter({ prisma, requireAuth: auth.requireAuth, requireAdmin: auth.requireAdmin }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

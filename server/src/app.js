import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createAuthRouter } from './modules/auth/routes.js';
import { createDonorRouter } from './modules/donors/routes.js';
import { createRequestRouter } from './modules/requests/routes.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp({ prisma, env }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== env.CLIENT_ORIGIN) return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Request origin is not allowed.' } });
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Cross-site requests are not allowed.' } });
    }
    next();
  });
  app.use('/api/v1/auth', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication requests. Try again later.' } }),
  }));
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  const auth = createAuthMiddleware(prisma);
  app.use('/api/v1', auth.optionalAuth);
  app.use('/api/v1/auth', createAuthRouter({ prisma, env }));
  app.use('/api/v1/donors', createDonorRouter({ prisma, requireAuth: auth.requireAuth }));
  app.use('/api/v1/requests', createRequestRouter({ prisma, requireAuth: auth.requireAuth }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

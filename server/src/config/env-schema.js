import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().trim().min(1).optional(),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('bloodlink_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
}).superRefine((value, ctx) => {
  let redisProtocol;
  if (value.REDIS_URL) {
    try {
      const redisUrl = new URL(value.REDIS_URL);
      redisProtocol = redisUrl.protocol;
      if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL must use redis:// or rediss://.' });
    } catch { ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL must be a valid Redis connection URL.' }); }
  }
  if (value.NODE_ENV !== 'production') return;
  if (!value.REDIS_URL) ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'Production shared rate limiting requires REDIS_URL.' });
  else if (redisProtocol !== 'rediss:') ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'Production REDIS_URL must use rediss:// TLS.' });
  if (value.SESSION_COOKIE_SECURE !== 'true') ctx.addIssue({ code: 'custom', path: ['SESSION_COOKIE_SECURE'], message: 'Secure cookies are required in production.' });
  const clientOrigin = new URL(value.CLIENT_ORIGIN);
  if (clientOrigin.protocol !== 'https:' || clientOrigin.pathname !== '/' || clientOrigin.search || clientOrigin.hash) ctx.addIssue({ code: 'custom', path: ['CLIENT_ORIGIN'], message: 'The production client origin must be an HTTPS origin without a path, query, or fragment.' });
  if (!/^[A-Za-z0-9_-]+$/.test(value.SESSION_COOKIE_NAME)) ctx.addIssue({ code: 'custom', path: ['SESSION_COOKIE_NAME'], message: 'Session cookie name contains unsupported characters.' });
  try {
    const databaseUrl = new URL(value.DATABASE_URL);
    if (databaseUrl.protocol !== 'mysql:') ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Production database must use MySQL.' });
    if (['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Production database must not use a local host.' });
    if (databaseUrl.searchParams.get('sslaccept') !== 'strict') ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Production MySQL must set sslaccept=strict.' });
  } catch { ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL must be a valid MySQL connection URL.' }); }
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM']) {
    if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production.` });
  }
  if (value.SMTP_PORT === 465 && value.SMTP_SECURE !== 'true') ctx.addIssue({ code: 'custom', path: ['SMTP_SECURE'], message: 'Port 465 requires implicit SMTP TLS.' });
  if (value.SMTP_PORT && value.SMTP_PORT !== 465 && value.SMTP_SECURE === 'true') ctx.addIssue({ code: 'custom', path: ['SMTP_SECURE'], message: 'Use STARTTLS (SMTP_SECURE=false) for non-465 SMTP ports.' });
});

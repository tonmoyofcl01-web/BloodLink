import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default('bloodlink_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && value.SESSION_COOKIE_SECURE !== 'true') ctx.addIssue({ code: 'custom', path: ['SESSION_COOKIE_SECURE'], message: 'Secure cookies are required in production.' });
});

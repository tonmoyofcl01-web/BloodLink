import { isIP } from 'node:net';
import { createClient } from 'redis';
import { RedisStore } from 'rate-limit-redis';
import rateLimit from 'express-rate-limit';

export const rateLimitStoreNames = [
  'auth', 'authRegister', 'authLogin', 'authVerify', 'authResend', 'authPasswordResetRequest', 'authPasswordResetConsume', 'donorDiscovery', 'requestCreate',
];

export function getRateLimitClientIp(req, env) {
  let ip;
  if (env.VERCEL === '1') {
    // Vercel overwrites X-Forwarded-For with the client IP before invoking a function.
    // Only trust this header on Vercel; do not enable Express trust proxy.
    const forwardedIp = req.get('x-forwarded-for')?.trim();
    if (forwardedIp && !forwardedIp.includes(',') && isIP(forwardedIp)) ip = forwardedIp;
  }
  ip ??= req.socket?.remoteAddress ?? req.ip;
  if (!ip || !isIP(ip)) throw new Error('A valid client IP is required for rate limiting.');
  return ip;
}

export function createRedisRateLimitStores(sendCommand) {
  return Object.fromEntries(rateLimitStoreNames.map((name) => [name, new RedisStore({
    sendCommand,
    prefix: `bloodlink:rate-limit:${name}:`,
  })]));
}

/** Connect the shared Redis backend when configured, and always require it in production. */
export async function createRateLimitInfrastructure(env) {
  if (!env.REDIS_URL) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Production rate limiting requires REDIS_URL (redis:// or rediss://). No in-memory fallback is allowed.');
    }
    return { stores: undefined, close: async () => {} };
  }

  const client = createClient({ url: env.REDIS_URL });
  client.on('error', (error) => console.error(`[rate-limit Redis] ${error.name || 'connection error'}`));
  try {
    await client.connect();
  } catch {
    client.destroy();
    throw new Error('Unable to connect to REDIS_URL; shared rate limiting is required and the server was not started.');
  }

  const sendCommand = (...command) => client.sendCommand(command);
  const stores = createRedisRateLimitStores(sendCommand);
  try {
    await Promise.all(Object.values(stores).flatMap((store) => [store.incrementScriptSha, store.getScriptSha]));
  } catch {
    await client.quit().catch(() => client.destroy());
    throw new Error('Unable to initialize Redis rate-limit scripts; verify REDIS_URL permissions and availability.');
  }
  return {
    stores,
    isReady: () => client.isReady,
    close: async () => {
      if (client.isOpen) {
        try { await client.quit(); }
        catch { client.destroy(); }
      }
    },
  };
}

export function createRateLimitMiddleware({ limit, windowMs, store, env, message, skipSuccessfulRequests = false }) {
  const options = {
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    skipSuccessfulRequests,
    keyGenerator: (req) => getRateLimitClientIp(req, env),
    handler: (req, res) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(((req.rateLimit?.resetTime?.getTime() || Date.now() + windowMs) - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message, retryAfterSeconds } });
    },
  };
  if (store) options.store = store;
  return rateLimit(options);
}

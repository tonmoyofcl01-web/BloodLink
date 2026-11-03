import { env } from './config/env.js';
import { prisma } from './db.js';
import { createApp } from './app.js';
import { createRateLimitInfrastructure } from './lib/rate-limit-store.js';

const rateLimitInfrastructure = await createRateLimitInfrastructure(env);
const app = createApp({ prisma, env, rateLimitStores: rateLimitInfrastructure.stores, rateLimitReady: rateLimitInfrastructure.isReady });
const server = app.listen(env.PORT, () => console.info(`BloodLink API listening on port ${env.PORT}`));

async function shutdown() {
  server.close(async () => {
    await rateLimitInfrastructure.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

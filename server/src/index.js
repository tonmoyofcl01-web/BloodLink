import { env } from './config/env.js';
import { prisma } from './db.js';
import { createApp } from './app.js';

const app = createApp({ prisma, env });
const server = app.listen(env.PORT, () => console.info(`BloodLink API listening on port ${env.PORT}`));

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

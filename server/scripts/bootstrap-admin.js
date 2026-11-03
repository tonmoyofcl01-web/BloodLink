import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const prisma = new PrismaClient();

try {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password || password.length < 20) throw new Error('Set ADMIN_BOOTSTRAP_EMAIL and a unique ADMIN_BOOTSTRAP_PASSWORD of at least 20 characters.');
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw`SELECT GET_LOCK('bloodlink_admin_bootstrap', 10) AS acquired`;
    if (Number(lock[0]?.acquired) !== 1) throw new Error('Could not acquire the one-time administrator bootstrap lock.');
    try {
      const adminCount = await tx.adminAccount.count();
      if (adminCount > 0) throw new Error('Administrator bootstrap has already been used; it cannot create or elevate another account.');
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new Error('That email already belongs to an account; bootstrap cannot elevate existing accounts.');
      const user = await tx.user.create({ data: { email, fullName: 'BloodLink Administrator', passwordHash, emailVerifiedAt: new Date(), status: 'ACTIVE' } });
      await tx.adminAccount.create({ data: { userId: user.id } });
    } finally {
      await tx.$queryRaw`SELECT RELEASE_LOCK('bloodlink_admin_bootstrap')`;
    }
  });
  console.info(`Created the initial administrator account for ${email}. Remove the bootstrap credentials from the environment now.`);
} catch (error) {
  console.error(`Administrator bootstrap failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await prisma.$queryRaw`SELECT RELEASE_LOCK('bloodlink_admin_bootstrap')`; } catch {}
  await prisma.$disconnect();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

test('configured MySQL database is reachable and all migrations are applied', async () => {
  const prisma = new PrismaClient();
  try {
    const [connection] = await prisma.$queryRaw`SELECT DATABASE() AS databaseName, VERSION() AS mysqlVersion, @@character_set_database AS characterSet, @@collation_database AS collation`;
    assert.equal(connection.databaseName, new URL(env.DATABASE_URL).pathname.slice(1));
    assert.equal(String(connection.mysqlVersion).split('.')[0], '8');
    assert.equal(connection.characterSet.toLowerCase(), 'utf8mb4');
    console.info(`[database check] ${connection.databaseName}, MySQL ${connection.mysqlVersion}, ${connection.characterSet}/${connection.collation}`);

    const rows = await prisma.$queryRaw`SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
    const tables = new Set(rows.map((row) => row.tableName));
    for (const table of ['users', 'sessions', 'email_verification_tokens', 'admin_accounts', 'blood_groups', 'donor_profiles', '_prisma_migrations']) {
      assert.ok(tables.has(table), `Expected table ${table} to exist`);
    }
    console.info(`[database check] tables: ${[...tables].sort().join(', ')}`);

    const migrations = await prisma.$queryRaw`SELECT migration_name AS migrationName, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations WHERE migration_name IN ('20261103000000_initial', '20261103020000_donor_profiles') AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(migrations.length, 2);
    const unresolvedFailures = await prisma.$queryRaw`SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    assert.equal(Number(unresolvedFailures[0].count), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('blood groups are seeded and donor profile lifecycle writes work transactionally', async () => {
  const prisma = new PrismaClient();
  const codes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  try {
    const groups = await prisma.bloodGroup.findMany({ select: { id: true, code: true } });
    assert.deepEqual(new Set(groups.map((group) => group.code)), new Set(codes));
    const byCode = new Map(groups.map((group) => [group.code, group.id]));
    const rollback = new Error('rollback-test-transaction');

    await assert.rejects(prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {
        email: `donor-db-test-${crypto.randomUUID()}@example.invalid`,
        fullName: 'Synthetic Donor Test', passwordHash: 'test-only-hash', status: 'ACTIVE', emailVerifiedAt: new Date(),
      } });
      let profile = await tx.donorProfile.create({ data: {
        userId: user.id, displayName: 'Test Donor', bloodGroupId: byCode.get(codes[0]),
        division: 'Test Division', district: 'Test District', area: 'Test Area',
      } });
      assert.equal(profile.availabilityStatus, 'PAUSED');
      assert.equal(profile.discoveryConsentAt, null);

      for (const code of codes) {
        profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { bloodGroupId: byCode.get(code) }, include: { bloodGroup: true } });
        assert.equal(profile.bloodGroup.code, code);
      }
      profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { displayName: 'Edited Donor', area: 'Updated Area', availabilityStatus: 'AVAILABLE' } });
      assert.equal(profile.displayName, 'Edited Donor');
      assert.equal(profile.area, 'Updated Area');
      assert.equal(profile.availabilityStatus, 'AVAILABLE');

      const consentedAt = new Date();
      profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { discoveryConsentAt: consentedAt, consentVersion: 'donor-discovery-v1', consentUpdatedAt: consentedAt } });
      assert.ok(profile.discoveryConsentAt);
      profile = await tx.donorProfile.update({ where: { userId: user.id }, data: { discoveryConsentAt: null, consentUpdatedAt: new Date() } });
      assert.equal(profile.discoveryConsentAt, null);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});

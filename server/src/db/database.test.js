import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

test('configured MySQL database is reachable and has the initial Milestone 1 migration', async () => {
  const prisma = new PrismaClient();
  try {
    const [connection] = await prisma.$queryRaw`SELECT DATABASE() AS databaseName, VERSION() AS mysqlVersion, @@character_set_database AS characterSet, @@collation_database AS collation`;
    assert.equal(connection.databaseName, new URL(env.DATABASE_URL).pathname.slice(1));
    assert.equal(String(connection.mysqlVersion).split('.')[0], '8');
    assert.equal(connection.characterSet.toLowerCase(), 'utf8mb4');
    console.info(`[database check] ${connection.databaseName}, MySQL ${connection.mysqlVersion}, ${connection.characterSet}/${connection.collation}`);

    const rows = await prisma.$queryRaw`SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
    const tables = new Set(rows.map((row) => row.tableName));
    for (const table of ['users', 'sessions', 'email_verification_tokens', 'admin_accounts', '_prisma_migrations']) {
      assert.ok(tables.has(table), `Expected table ${table} to exist`);
    }
    console.info(`[database check] tables: ${[...tables].sort().join(', ')}`);

    const migrations = await prisma.$queryRaw`SELECT migration_name AS migrationName, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations WHERE migration_name = '20261103000000_initial'`;
    assert.equal(migrations.length, 1);
    assert.ok(migrations[0].finishedAt);
    assert.equal(migrations[0].rolledBackAt, null);
  } finally {
    await prisma.$disconnect();
  }
});

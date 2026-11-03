# BloodLink project progress

## Completed

- Milestone 1: project foundation and authentication.
- Local database setup completed for Milestone 1 on 2026-11-03.

## Changed files

- Root setup: `package.json`, `package-lock.json`, `.gitignore`, `compose.yaml`, `README.md`.
- Client: `client/package.json`, Vite/Tailwind/PostCSS configs, `client/index.html`, `client/src/{App.jsx,main.jsx,index.css}`.
- Server: `server/package.json`, `.env.example`, `server/src/{app.js,index.js,db.js}`, config, middleware, auth module, crypto/email helpers, and tests.
- Database/admin: `server/prisma/schema.prisma`, initial migration and lock file, `server/scripts/bootstrap-admin.js`.
- Database follow-up: root and server `test:db` scripts; read-only `server/src/db/database.test.js`.
- Environment: `server/.env` was read for validation and left unchanged.

## Tests and checks

- `npm test`: passed, 8 tests.
- `npm run test:db`: passed, 1 read-only integration test. Connected to `bloodlink` on MySQL 8.0.46; database charset `utf8mb4`, collation `utf8mb4_unicode_ci`.
- Expected tables verified: `users`, `sessions`, `email_verification_tokens`, `admin_accounts`, `_prisma_migrations`.
- `npm run db:migrate`: applied `20261103000000_initial`; rerun confirmed no pending migrations.
- `npm run db:generate`: passed after migration.
- `npm run build`: passed, Vite production build.
- Prisma schema validation: passed using a temporary `DATABASE_URL`.
- `npm audit`: 3 high severity reports remain in Prisma 6 CLI's transitive `deepmerge-ts` dependency; npm only offers a breaking Prisma 7 upgrade.

## Next task

- Wait for approval before beginning Milestone 2.

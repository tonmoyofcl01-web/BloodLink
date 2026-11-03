# BloodLink project progress

## Completed

- Milestone 1: project foundation and authentication.
- Local database setup completed for Milestone 1 on 2026-11-03.
- Milestone 2: donor profiles and explicit discovery consent.
- Milestone 3: private emergency blood requests and consent-filtered donor discovery.

## Changed files

- Root setup: `package.json`, `package-lock.json`, `.gitignore`, `compose.yaml`, `README.md`.
- Client: `client/package.json`, Vite/Tailwind/PostCSS configs, `client/index.html`, `client/src/{App.jsx,main.jsx,index.css}`.
- Server: `server/package.json`, `.env.example`, `server/src/{app.js,index.js,db.js}`, config, middleware, auth module, crypto/email helpers, and tests.
- Database/admin: `server/prisma/schema.prisma`, initial migration and lock file, `server/scripts/bootstrap-admin.js`.
- Database follow-up: root and server `test:db` scripts; database integration tests use read queries and roll back their synthetic profile lifecycle transaction.
- Milestone 2: `server/prisma/migrations/20261103020000_donor_profiles/migration.sql`, `server/prisma/seed.js`, donor API routes/tests, updated Prisma schema, `client/src/App.jsx`, Tailwind dark mode, and updated package scripts/README.
- Milestone 3: `server/prisma/migrations/20261103030000_blood_requests/migration.sql`, request/discovery API routes and tests, MySQL integration coverage, request/discovery UI components, app navigation, and updated package test scripts.
- Environment: `server/.env` was read for validation and left unchanged.

## Tests and checks

- `npm test`: passed, 8 tests.
- `npm run test:db`: passed, 1 read-only integration test. Connected to `bloodlink` on MySQL 8.0.46; database charset `utf8mb4`, collation `utf8mb4_unicode_ci`.
- Expected tables verified: `users`, `sessions`, `email_verification_tokens`, `admin_accounts`, `_prisma_migrations`.
- `npm run db:migrate`: applied `20261103000000_initial`; rerun confirmed no pending migrations.
- `npm run db:generate`: passed after migration.
- `npm run build`: passed, Vite production build.
- Prisma schema validation: passed using a temporary `DATABASE_URL`.
- Milestone 2 migration: applied `20261103020000_donor_profiles` additively; no existing application tables were dropped or recreated.
- `npm run db:seed`: passed twice; ensured all eight blood groups idempotently.
- `npm test`: passed, 11 tests, including donor create/edit, all blood groups, availability, consent withdrawal, ownership, privacy, and authentication regression coverage.
- `npm run test:db`: passed, 2 integration tests, including MySQL connection/schema verification and a transaction-rolled-back donor profile lifecycle against MySQL 8.0.46.
- `npm run build`: passed with responsive donor management and persisted light/dark theme.
- Prisma validation and client generation: passed after adding donor models.
- Milestone 3 migration: applied `20261103030000_blood_requests` additively; MySQL reports no pending migrations.
- `npm test`: passed, 16 tests covering authentication, donor profile and consent behavior, request creation/edit/status transitions/ownership, donor eligibility/location filters, privacy, pagination, and discovery rate limits.
- `npm run test:db`: passed, 2 MySQL integration tests covering all three migrations, blood-group data, exact area/district/division filtering, active/consent/availability filters, and request persistence in a rolled-back synthetic-data transaction.
- `npm run build`: passed for the request and donor discovery interface.
- Prisma validation and client generation: passed with the Milestone 3 schema.
- `npm audit`: 3 high severity reports remain in Prisma 6 CLI's transitive `deepmerge-ts` dependency; npm only offers a breaking Prisma 7 upgrade.

## Next task

- Wait for approval before beginning Milestone 4.

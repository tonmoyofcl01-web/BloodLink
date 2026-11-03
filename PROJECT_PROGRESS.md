# BloodLink project progress

## Completed

- Milestone 1: project foundation and authentication.
- Local database setup completed for Milestone 1 on 2026-11-03.
- Milestone 2: donor profiles and explicit discovery consent.
- Milestone 3: private emergency blood requests and consent-filtered donor discovery.
- Milestone 4: smart candidate matching, donor opportunities and responses, requester match summaries.
- Milestone 5: private in-app notifications, organization registration, administrator verification, and verified organization dashboard.

## Changed files

- Root setup: `package.json`, `package-lock.json`, `.gitignore`, `compose.yaml`, `README.md`.
- Client: `client/package.json`, Vite/Tailwind/PostCSS configs, `client/index.html`, `client/src/{App.jsx,main.jsx,index.css}`.
- Server: `server/package.json`, `.env.example`, `server/src/{app.js,index.js,db.js}`, config, middleware, auth module, crypto/email helpers, and tests.
- Database/admin: `server/prisma/schema.prisma`, initial migration and lock file, `server/scripts/bootstrap-admin.js`.
- Database follow-up: root and server `test:db` scripts; database integration tests use read queries and roll back their synthetic profile lifecycle transaction.
- Milestone 2: `server/prisma/migrations/20261103020000_donor_profiles/migration.sql`, `server/prisma/seed.js`, donor API routes/tests, updated Prisma schema, `client/src/App.jsx`, Tailwind dark mode, and updated package scripts/README.
- Milestone 3: `server/prisma/migrations/20261103030000_blood_requests/migration.sql`, request/discovery API routes and tests, MySQL integration coverage, request/discovery UI components, app navigation, and updated package test scripts.
- Milestone 4: additive migration `server/prisma/migrations/20261103040000_smart_matching/migration.sql`, matching service and tests, donor opportunity API/UI and tests, request match summary API/UI and tests, MySQL rollback integration coverage, Prisma schema and test scripts.
- Milestone 5: additive migration `server/prisma/migrations/20261103050000_notifications_organizations/migration.sql`; notification and organization APIs/services/tests; organization verification UI, dashboard and request creation; notification dropdown/page; matching, donor response and request status notification hooks; MySQL integration coverage.
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
- Milestone 4: `npm run db:generate` and Prisma schema validation passed; `npm run db:migrate` applied `20261103040000_smart_matching` additively to MySQL 8.0.46.
- Milestone 4: `npm test` passed, 22 tests covering authentication/donor/request regressions, ranking and fair rotation, duplicate prevention, request and donor ownership, consent/availability rechecks, response lifecycle, and privacy.
- Milestone 4: `npm run test:db` passed, 2 MySQL integration tests; synthetic matching rows were created inside a transaction and rolled back. Verified `request_matches` and all four applied migrations.
- Milestone 4: `npm run build` passed for the React/Vite client.
- Milestone 5: Prisma validation/client generation passed; `npm run db:migrate` applied the new migration additively; `prisma migrate status` confirmed no pending migrations.
- Milestone 5: `npm test` passed, 29 tests covering all notification event types and idempotency, notification privacy/ownership/reference authorization, organization registration and duplicate numbers, pending restrictions, admin authorization, approval/rejection/suspension, audit history, and prior authentication/donor/request/matching tests.
- Milestone 5: `npm run test:db` passed, 2 MySQL integration tests against MySQL 8.0.46. Synthetic notifications, organizations, memberships, audits, and matching rows were verified inside a rolled-back transaction; all five migrations and expected tables were verified.
- Milestone 5: `npm run build` passed for the React/Vite client; `git diff --check` passed.

## Next task

- Wait for approval before beginning Milestone 6.

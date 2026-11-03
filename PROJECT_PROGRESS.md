# BloodLink project progress

## Completed milestones

- M1: project foundation, authentication, sessions, verification adapter and administrator bootstrap.
- M2: optional donor profiles and explicit discovery consent.
- M3: emergency requests and privacy-preserving donor discovery.
- M4: candidate matching and donor responses.
- M5: in-app notifications and organization verification.
- M6: production configuration validation, SMTP verification adapter, origin checks, readiness endpoint, transactional request/matching updates, accessible dialog behavior, and deployment documentation.

## M6 changes

- API: SMTP email adapter/config validation; safer email verification and resend; origin/auth configuration, readiness endpoint, request and opportunity transaction handling; MySQL end-to-end workflow tests.
- Client: same-origin API defaults and Vite proxy, email verification resend UI, focus visibility and reduced-motion support, keyboard-accessible organization decision dialog.
- Docs/dependencies: `README.md`, `docs/DEPLOYMENT.md`, `.env.example`, server package/lockfile (Nodemailer).
- `server/.env` was preserved.

## M6 checks

- `npm test`: passed, 33 tests.
- `npm run test:db`: passed, 3 MySQL integration tests against MySQL 8.0.46; verified all 5 migrations and expected tables, including the authenticated HTTP workflow.
- `npm run build`: passed.
- Prisma migration status: up to date; no M6 database migration was needed.
- `git diff --check`: passed (Git emitted line-ending conversion notices only).
- `npm audit --omit=dev`: reports 3 high-severity findings in the Prisma 6 CLI transitive `deepmerge-ts` dependency. npm's proposed fix upgrades to Prisma 7 and is breaking; it was not applied.
- Browser-based responsive/manual QA was unavailable because no browser surface was exposed in this session. A real SMTP delivery smoke check also remains deployment-specific because production SMTP credentials were not provided.

## Remaining issues

- Password reset, automated SMS, live chat, advanced analytics, and complex inventory management are outside the current release scope.
- Before production launch, configure real SMTP and complete its delivery smoke check; perform browser/device QA in an environment with an available browser.

## Final release-readiness review

- Audit: `npm audit --omit=dev --json` reports three high-severity nodes for one advisory, GHSA-ggr8-5vv4-36mx (recursive-object stack exhaustion): `prisma@6.19.3 -> @prisma/config@6.19.3 -> deepmerge-ts@7.1.5`. `prisma` is a server devDependency and the lock marks this CLI chain `devOptional`; the vulnerable merge is in CLI config loading, not API request execution. No `prisma.config.*` file exists in this project. `deepmerge-ts >=8.0.0` is the patched line, but npm metadata shows Prisma 6.19.3 is the latest Prisma 6 release and still pins 7.1.5. npm's suggested fix is Prisma 7.10.1 (major). No upgrade or override was applied.
- Prisma 7 requires code changes including a MySQL driver adapter and different `PrismaClient` setup, datasource URL in `prisma.config.*`, generated-client output/import changes, and CLI migration/config updates; see [official upgrade guide](https://www.prisma.io/docs/orm/v6/more/upgrades/to-v7). Any such migration needs approval.
- Rate limiting at the time of this review used an in-memory store and was not suitable for multi-instance Vercel deployment; the approved follow-up below replaces production counters with a shared Redis store.
- Documentation: removed the unused `SESSION_SECRET` reference; documented exact production environment requirements, MySQL strict TLS, secure HttpOnly cookies, additive migration command, one-time administrator bootstrap, real SMTP verification procedure, serverless rate-limit limitation, and manual browser QA checklist.
- Git review: only `server/.env.example` matches tracked `.env` filenames; `server/.env` is ignored and absent from Git history paths checked. Tracked email/phone examples are reserved/example values and synthetic test fixtures; no real donor data was found.
- Focused checks: 13 auth, validation, SMTP adapter, and security tests passed, including one-process auth limit behavior (30 allowed, 31st returns 429). Prisma migration status is up to date (5 migrations). `git diff --check` passed with line-ending notices. `npm audit --omit=dev` reproduced 3 high findings.
- Real SMTP delivery and manual browser/device QA were not run. Checklist is in `docs/DEPLOYMENT.md`.

## Approved shared rate-limit hardening

- Production and any environment with `REDIS_URL` now connect a `redis` client and use `rate-limit-redis`; local development without `REDIS_URL` retains express-rate-limit's memory store. Production validation requires `rediss://`, and startup fails without a connected Redis store or loaded scripts. Redis store errors do not pass requests through; readiness also checks Redis.
- Existing request/discovery limits now use shared stores. Auth keeps a global 30 / 15 minute IP cap and adds independent limits: registration 10, login 10, verification 10, resend 5 per 15 minutes. Redis namespaces separate all seven policies.
- Vercel requests use the platform-overwritten single client IP in `X-Forwarded-For` only when `VERCEL=1`; elsewhere forwarded headers are ignored and Express proxy trust remains disabled.
- Dependencies added: `rate-limit-redis@4.2.3` (compatible with existing express-rate-limit 7) and Redis client `redis@6.3.1`. Prisma packages unchanged; no Redis provider selected.
- Tests added for counters shared between separately initialized apps through a shared Redis-command test backend, spoofed forwarded headers, Vercel IP extraction, separate auth limits, production missing-Redis failure, and namespaces.
- Setup: set `REDIS_URL=rediss://...` in Vercel Production/Preview/Development environments that run the API. Local development remains in-memory by default; optional local Redis uses `REDIS_URL=redis://127.0.0.1:6379`. Detailed steps are in `docs/DEPLOYMENT.md` and `server/.env.example`.
- Validation: `npm test` passed, 42 tests. Added rate-limit tests cover two independently initialized apps sharing a Redis-command backend, forged forwarding headers, Vercel extraction, endpoint-specific limits, Redis namespace separation, production missing-Redis startup failure, and Redis readiness. The focused suite uses a Redis command test double; no live Redis endpoint was configured or contacted.
- `npm audit --omit=dev` reports the same three Prisma CLI `deepmerge-ts` findings from the prior review; the new Redis dependencies produced no additional reported advisories. Prisma was not changed.
- `git diff --check` passed with line-ending conversion notices. No database migration or schema change.

## Final project closeout verification

- `npm test`: passed, 42 tests. `npm run test`: passed, 42 tests. `npm run test:db`: passed, 3 MySQL integration tests against MySQL 8.0.46. `npm run build`: passed. Prisma schema validation passed; all five migrations are applied and status is up to date. `git diff --check` passed (line-ending notices only).
- Local development smoke check: API liveness and readiness returned 200; Vite `/api/v1/health` proxy returned 200. No test accounts were registered.
- `npm audit --omit=dev`: reproduced the same three high-severity report entries for GHSA-ggr8-5vv4-36mx, all in the Prisma 6 CLI chain (`prisma -> @prisma/config -> deepmerge-ts@7.1.5`). No Prisma 7 upgrade or override was made.
- Security code review covered origin validation/CSRF protection, HttpOnly/Secure/SameSite cookies and database-backed session revocation, one-time administrator bootstrap, donor response privacy/ownership, consent-based discovery, and Redis-backed production rate limits. Automated authorization/privacy coverage remains in the passing tests.
- Docker is not installed. `server/.env` has no `REDIS_URL` or SMTP variables (only presence was checked; values were not printed), so no live Redis connection or SMTP delivery was attempted. Redis behavior was verified using the Redis command test double; missing production Redis, non-TLS production URL, startup failure, and readiness behavior are tested.
- Browser list is unavailable. Native Chrome UI automation was attempted, but its safety guard stopped before navigating to the local app because it could not confirm the current URL. No browser journeys or viewport checks are claimed as passed; manual checklist is in `docs/DEPLOYMENT.md`.
- Git scan: only `server/.env.example` is tracked among `.env` paths; `server/.env` is ignored. No real donor details were found in tracked data; test contact information is synthetic. No push or deployment was performed.
- Documentation finalized in `README.md` and `docs/DEPLOYMENT.md`. Academic demonstration is ready using synthetic/local data. Public production use remains conditional on live Redis and SMTP setup, browser QA, and an explicit risk decision for the Prisma CLI advisory.

## Registration and email-verification workflow fix

- Root cause: React Strict Mode replays mount effects in development, while the verification effect submitted a one-use token twice. The first request activated the account; the replay displayed an already-consumed-token error. Resend correctly did not send mail for the now-verified account, which made the original UI symptom confusing.
- Added a one-submit-per-page-load guard to the verification effect. Registration now uses the same status and generic response for new and duplicate addresses, and the UI displays that response. Resend gives the same enumeration-safe response for unknown, pending, and verified addresses; it directs already-verified users to sign in without revealing account existence.
- Verification errors now distinguish invalid, expired, and already-used links. Resending still atomically invalidates earlier unused tokens before persisting a fresh hashed token.
- MySQL integration coverage now exercises synthetic registration and duplicate registration, token hash persistence and expiration, invalid/expired/reused tokens, resend and prior-token invalidation, verified-account resend, per-IP rate limiting, and login/logout. No schema migration was needed; existing data was preserved and test rows were removed.
- Validation: `npm test` passed (42 tests); `npm run test:db` passed (4 MySQL tests against the existing `bloodlink` database); `npm run build` passed; `git diff --check` passed (line-ending notices only). An initial integration run exposed a test assumption: the resend limit is shared by client IP across accounts. The test was corrected to account for that existing policy, then the full DB test passed.
- Changed files: `client/src/App.jsx`, `server/src/modules/auth/routes.js`, `server/src/modules/auth/routes.test.js`, `server/src/db/database.test.js`, and this progress log. `server/.env` was not modified. No frontend browser journey was run in this task.

## Authentication/email finalization follow-up

- Development now uses Nodemailer SMTP when all six SMTP settings are present. With no local SMTP configured, registration and resend fail with a safe 503 before database lookup or account creation; development no longer logs raw verification URLs. Partial SMTP configuration fails clearly. Production continues to require SMTP.
- The sign-in route reports `EMAIL_NOT_VERIFIED` only after a correct password, while wrong-password and unknown-account responses remain generic. The sign-in UI offers resend after that response and guards auth/resend submissions against duplicate clicks. Verification submission has a tested once-only guard for Strict Mode effect replay.
- SMTP credentials are absent from local `server/.env` (presence-only inspection). A live API smoke test returned `503 EMAIL_DELIVERY_UNAVAILABLE` for both register and resend. No real SMTP delivery or account creation was attempted. `server/.env` was not modified.
- Validation: `npm test` and `npm run test` each passed (1 client guard test + 45 server tests); `npm run test:db` passed (4 MySQL integration tests); `npm run build` passed; Prisma schema validation passed; migration status is up to date (5 migrations); `git diff --check` passed (line-ending notices only).
- Actual browser dashboard login/logout was not performed: the email field value was unavailable to browser accessibility, and password entry is reserved for the user. The browser automation host is unavailable. No authentication or verification tokens were entered or displayed.
- Changed files: `client/src/App.jsx`, `client/src/auth/verification-once.js`, `client/src/auth/verification-once.test.js`, `package.json`, `README.md`, `docs/DEPLOYMENT.md`, `server/.env.example`, `server/src/lib/email.js`, `server/src/lib/email.test.js`, `server/src/modules/auth/routes.js`, `server/src/modules/auth/routes.test.js`, `server/src/db/database.test.js`, and this progress log.

## Authentication UX and reliability follow-up

- Added password reset request and consume endpoints with random single-use tokens, SHA-256 hashes in MySQL, 30-minute expiry, atomic superseding/consumption, and session revocation after password change. Added only the additive `password_reset_tokens` table migration; no existing tables or user rows were removed.
- Registration now returns actionable duplicate-address feedback, including pending verification state. Resend confirms successful sending and reports already-verified accounts; password-reset requests remain enumeration-safe. README and deployment guidance document the enumeration tradeoff and auth limits.
- Added forgot/reset-password screens, confirmation validation, retry-after messaging, duplicate-submit protection, and SMTP HTML password-reset email. SMTP failure cleanup invalidates only the token belonging to that failed request.
- Migration `20261104000000_password_reset_tokens` applied to the configured local MySQL database. MySQL 8.0.46, the new table, and all six migrations verified. Synthetic test rows are cleaned up by integration tests.
- Tests: `npm test` and `npm run test` each passed (2 client + 52 server tests); `npm run test:db` passed (4 MySQL integration tests); `npm run build` passed; Prisma validation and migration status passed; `git diff --check` passed (line-ending notices only).
- Prisma Client generation was attempted but Windows returned `EPERM` while renaming the loaded query-engine DLL. The database integration suite successfully exercised the generated `passwordResetToken` model. Retry `npm run db:generate` after stopping local Node/Vite/API processes.
- Browser: Chrome loaded the running BloodLink app and showed its existing authenticated workspace. An isolated registration attempt against the pre-opened controlled mailbox returned the expected already-verified duplicate message. No new account was created, no email was sent, and no existing account was changed. Live delivery and full registration-to-dashboard browser journey remain pending a fresh controlled mailbox address. The isolated browser window was closed after the attempt.
- Files changed in this follow-up: `client/src/App.jsx`, `client/src/auth/submission-lock.js`, `client/src/auth/submission-lock.test.js`, `package.json`, `README.md`, `docs/DEPLOYMENT.md`, `server/prisma/schema.prisma`, migration `server/prisma/migrations/20261104000000_password_reset_tokens/migration.sql`, `server/src/app.js`, `server/src/db/database.test.js`, `server/src/lib/email.js`, `server/src/lib/email.test.js`, `server/src/lib/rate-limit-store.js`, `server/src/middleware/errors.js`, `server/src/middleware/rate-limit.test.js`, `server/src/modules/auth/routes.js`, `server/src/modules/auth/routes.test.js`, and this progress log. `server/.env` was not modified.

## Conditional resend-verification UI fix

- The resend action now appears only after successful registration, an API-confirmed pending account, or an authenticated-password response explicitly identifying an unverified account. It is hidden for verified accounts, SMTP delivery failures, and invalid/unknown responses; verified duplicate registration returns to Sign In.
- Added explicit `accountState` metadata to duplicate-registration errors so the UI does not infer verification state from message text. Email edits and new auth submissions clear stale resend eligibility. Existing submission locks remain in use.
- Tests: `npm test` passed (8 client tests and 52 server tests); `npm run build` passed; `git diff --check` passed (line-ending notices only).
- Changed files: `client/src/App.jsx`, new `client/src/auth/resend-state.js`, new `client/src/auth/resend-state.test.js`, root `package.json`, `server/src/modules/auth/routes.js`, `server/src/modules/auth/routes.test.js`, and this progress log.

## Notification navigation and admin organization review fix

- Root cause confirmed against MySQL: the admin had 10 unread `ORGANIZATION_SUBMITTED` notifications. All used `referenceType=ORGANIZATION`, all referenced organization rows that were absent, and there were zero duplicate application/admin pairs. The database integration test cleanup removed synthetic organizations but had only removed notifications addressed to synthetic applicant users; submission notifications addressed to the real admin were left orphaned because notification reference IDs are polymorphic and have no organization foreign key.
- Admin notification open now routes to the exact `admin-organizations` review ID even if the application no longer exists. The admin workspace loads that ID directly, including applications outside the current status filter. Missing records show a clear deleted/unavailable explanation and a Back to notifications action.
- Individual reads are checked and persisted before navigation; unread count is shared between the bell and full notification page and refreshed after read operations. In-flight guards prevent repeated clicks from sending duplicate requests. API unread counts continue to use the actual unread rows.
- New organization submission notifications retain the organization ID and unique per-application/admin event key. The MySQL test cleanup now removes only notifications referencing its own synthetic organization IDs before deleting those test organizations. Existing 10 notifications were preserved; after MySQL tests, the count remained 10 unread, all 10 references remain absent, and duplicate application/admin pairs remain 0.
- Tests/checks: `npm test` passed (8 client + 53 server tests); `npm run test` passed (8 client + 53 server tests); `npm run test:db` passed (4 MySQL integration tests); `npm run build` passed; Prisma validation passed; migration status is up to date (6 migrations); `git diff --check` passed with line-ending notices only.
- No schema or database migration was required. `server/.env` was not modified.
- Changed files: `client/src/App.jsx`, `client/src/features/notifications/NotificationsCenter.jsx`, `client/src/features/organizations/OrganizationWorkspace.jsx`, `server/src/db/database.test.js`, `server/src/modules/notifications/routes.js`, `server/src/modules/notifications/routes.test.js`, `server/src/modules/organizations/routes.test.js`, and this progress log.

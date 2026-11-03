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

- Password reset, shared multi-instance rate-limit storage, automated SMS, live chat, advanced analytics, and complex inventory management are outside the current release scope.
- Before production launch, configure real SMTP and complete its delivery smoke check; perform browser/device QA in an environment with an available browser.

No next milestone started.

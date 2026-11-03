# Deployment guide

## Configuration

Deploy the Express API and static Vite client behind HTTPS. Serve the client and `/api/v1` from one origin where possible; otherwise set the client build variable `VITE_API_URL` to the API base URL and configure the API's exact `CLIENT_ORIGIN`.

Set production `NODE_ENV=production`, `SESSION_COOKIE_SECURE=true`, and `CLIENT_ORIGIN` to the HTTPS origin only (no path). The session cookie name must contain only letters, numbers, `_` or `-`; `SESSION_TTL_HOURS` defaults to 12. Session tokens are random and stored hashed in MySQL, so this application has no `SESSION_SECRET` variable. Configure `DATABASE_URL` for MySQL 8.0+ with `sslaccept=strict`; add the provider-supported certificate parameters when required by your database host. Keep credentials in the hosting secret manager, never in source control.

Production variable checklist: `NODE_ENV=production`, deployment-assigned `PORT`, exact HTTPS `CLIENT_ORIGIN`, MySQL `DATABASE_URL` with strict TLS validation, `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, and `SESSION_COOKIE_SECURE=true`. `VITE_API_URL` is a client build-time variable and is only needed when the API uses a different origin. `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` are one-time inputs, not normal runtime configuration.

Production must also have `REDIS_URL` set to a Redis-compatible TLS URL (`rediss://...`) in the deployment secret manager. The URL may contain credentials, so do not commit it, print it in logs, or paste it into support messages. The server validates the scheme, connects before listening, and exits with a configuration error if the variable is missing or Redis is unreachable. It does not fall back to memory in production. If Redis becomes unavailable after startup, rate-limited requests fail closed with server errors rather than bypassing the limit.

Verification email requires authenticated SMTP:

- Port 587: `SMTP_SECURE=false`; the application requires STARTTLS.
- Port 465: `SMTP_SECURE=true` for implicit TLS.
- Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM`.

Before serving traffic, install dependencies, generate Prisma Client, apply additive migrations with `npm run db:migrate`, build the client with `npm run build`, then start the API with `npm --workspace server start`. The API exposes `/api/v1/health` for liveness and `/api/v1/health/ready` for database and production Redis readiness. Route requests to those paths through the HTTPS proxy.

Bootstrap an administrator only through the one-time `npm run admin:bootstrap` command from a controlled operator machine or CI job that can reach the production database. Provide `ADMIN_BOOTSTRAP_EMAIL` and a unique `ADMIN_BOOTSTRAP_PASSWORD` of at least 20 characters through that job's secret environment. Do not expose the bootstrap credentials to a Vercel build or API function. Remove them immediately after successful execution. Public registration cannot grant administrator privileges.

## Real verification-email smoke test

1. Use a controlled test mailbox and a sender address on a domain authorized by your SMTP provider. Configure that domain's SPF, DKIM, and DMARC records as directed by the provider.
2. Set all production SMTP values in the hosting secret manager: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM`. Use port 587 with `SMTP_SECURE=false` (the app requires STARTTLS), or port 465 with `SMTP_SECURE=true` (implicit TLS).
3. Set the app's `CLIENT_ORIGIN` to the exact deployed HTTPS origin and deploy. Confirm `/api/v1/health/ready` returns `200` before testing.
4. Register a new test account through the deployed HTTPS interface. Check the controlled mailbox's inbox and spam folder. Confirm the sender and subject are expected, then open the verification link; it should point to the correct HTTPS origin.
5. Confirm the app reports verification success, then sign in. Confirm the authenticated state survives a page refresh and logout ends the session. Reusing the verification link should be rejected.
6. Test “resend verification” with a pending test account. The newer link should work and the superseded link should fail. Also try an unknown address; the response should not reveal whether an account exists.
7. Review provider delivery logs and application logs for successful delivery or errors. Do not log or share SMTP passwords, verification tokens, or full verification URLs. Delete the test account after the smoke test if it is no longer needed.

## Serverless rate limiting

All current rate-limit policies use `express-rate-limit`; Redis-backed environments share counters through `rate-limit-redis`. Limits are: authentication-wide 30 requests per 15 minutes per client IP; registration 10/15 minutes; login 10/15 minutes; email verification 10/15 minutes; resend verification 5/15 minutes; donor discovery 30/10 minutes; and request creation 10/15 minutes. Endpoint counters have separate Redis key namespaces. Local development uses the built-in memory store unless `REDIS_URL` is explicitly set.

For optional local shared-store testing, start a local Redis instance bound only to your machine (for example `docker run --rm --name bloodlink-redis -p 127.0.0.1:6379:6379 redis:7-alpine`) and set `REDIS_URL=redis://127.0.0.1:6379` in `server/.env`. Remove the variable to return to the in-memory development store. Do not use this unauthenticated local URL in production.

For Vercel, provision any Redis-compatible service you choose separately, then add its TLS connection URL as `REDIS_URL` under the Vercel project's Environment Variables for every environment where the API runs. Redeploy after setting it. This project does not select or purchase a provider. Vercel automatically sets `VERCEL=1`; the application then uses `X-Forwarded-For`, which Vercel documents as overwritten with the actual client IP before the function runs ([Vercel request headers](https://vercel.com/docs/headers/request-headers)). Express `trust proxy` remains disabled. Do not place an untrusted proxy in front of Vercel or rely on arbitrary `X-Real-IP` / `X-Forwarded-For` values. If using a proxy in front of Vercel, follow Vercel's trusted-proxy setup and adjust extraction only after reviewing that topology.

## Manual browser QA checklist

Run this checklist at approximately 390×844 (mobile), 768×1024 (tablet), and 1440×900 (desktop), in current Chrome, Edge, Firefox, and Safari where available. Check keyboard-only navigation and browser zoom as well as touch input.

- [ ] At each viewport, verify navigation, forms, cards, dialogs, dropdowns, and tables fit without horizontal overflow; controls remain usable with touch and keyboard.
- [ ] Switch light/dark themes; verify readable text, status colors, focus rings, dialog/backdrop contrast, and persistence after refresh. Enable reduced motion and confirm transitions are minimized.
- [ ] Register a new individual, handle validation and duplicate-email messaging, verify with the real-email steps above, sign in, refresh, and sign out.
- [ ] Create/edit a donor profile, keep consent off and confirm the donor is undiscoverable; enable consent and verify discovery, then pause/resume availability and withdraw consent. Confirm all states update and no contact or precise location appears.
- [ ] Create and manage a blood request; check empty, loading, error, confirmation, and success states. Review donor candidates and requester match responses; confirm medical-safety notice remains visible.
- [ ] As a donor, review My Opportunities, accept/decline and permitted withdrawal, then confirm updated status and response history.
- [ ] Register an organization and verify it remains pending with verified-only features blocked. As an administrator, inspect, approve, reject with reason, suspend a verified organization, and review history. As a non-admin, confirm all administrator screens and APIs deny access.
- [ ] Trigger notification events; verify unread count, dropdown and full list, timestamps/icons, mark-one-read, mark-all-read, navigation to authorized references, and responsive layout. Confirm a different account cannot open referenced private records.
- [ ] Inspect network responses for donor email, phone, account ID, exact address/coordinates, and private organizational data; none should appear in discovery, matches, or notification payloads.

## Database backups and recovery

Schedule encrypted, off-host MySQL backups with a retention policy appropriate to the deployment. For example, run `mysqldump --single-transaction --routines --triggers --events bloodlink` using credentials supplied through a protected MySQL option file or secret manager; do not put passwords in command arguments or commit backup files.

For a recovery drill, restore a backup into an isolated recovery database first, verify the expected tables and row counts, then apply the application migrations compatible with that release and run `npm run test:db` against the isolated instance. Record the recovery point and elapsed recovery time. Do not restore over production as a routine test.

## Operational limits

- In production, Redis is mandatory for all configured rate limits; keep its URL available in the runtime secret manager.
- Automated SMS, password reset, live chat, analytics, and complex inventory management are not included.
- No donor suitability or compatibility decision is automated; qualified medical professionals must verify both.
- Configure SMTP and complete a real verification-email smoke check in the target environment before launch.
- Monitor database/Redis readiness, API errors, SMTP delivery, backups, session revocation, and credential rotation.

# Deployment guide

## Configuration

Deploy the Express API and static Vite client behind HTTPS. Serve the client and `/api/v1` from one origin where possible; otherwise set the client build variable `VITE_API_URL` to the API base URL and configure the API's exact `CLIENT_ORIGIN`.

Set production `NODE_ENV=production`, a long random `SESSION_SECRET`, `SESSION_COOKIE_SECURE=true`, and `CLIENT_ORIGIN` to the HTTPS origin only (no path). Configure `DATABASE_URL` for MySQL 8.0+ with `sslaccept=strict`; add the provider-supported certificate parameters when required by your database host. Keep credentials in the hosting secret manager, never in source control.

Verification email requires authenticated SMTP:

- Port 587: `SMTP_SECURE=false`; the application requires STARTTLS.
- Port 465: `SMTP_SECURE=true` for implicit TLS.
- Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM`.

Before serving traffic, install dependencies, generate Prisma Client, apply additive migrations with `npm run db:migrate`, build the client with `npm run build`, then start the API with `npm --workspace server start`. The API exposes `/api/v1/health` for liveness and `/api/v1/health/ready` for database readiness. Route requests to those paths through the HTTPS proxy.

Bootstrap an administrator only through the one-time `npm run admin:bootstrap` command with a unique email and a password of at least 20 characters. Remove the bootstrap credentials immediately after successful execution. Public registration cannot grant administrator privileges.

## Database backups and recovery

Schedule encrypted, off-host MySQL backups with a retention policy appropriate to the deployment. For example, run `mysqldump --single-transaction --routines --triggers --events bloodlink` using credentials supplied through a protected MySQL option file or secret manager; do not put passwords in command arguments or commit backup files.

For a recovery drill, restore a backup into an isolated recovery database first, verify the expected tables and row counts, then apply the application migrations compatible with that release and run `npm run test:db` against the isolated instance. Record the recovery point and elapsed recovery time. Do not restore over production as a routine test.

## Operational limits

- Rate limits are process-local; use a shared store before running multiple API instances.
- Automated SMS, password reset, live chat, analytics, and complex inventory management are not included.
- No donor suitability or compatibility decision is automated; qualified medical professionals must verify both.
- Configure SMTP and complete a real verification-email smoke check in the target environment before launch.
- Monitor database readiness, API errors, SMTP delivery, backups, and session-secret rotation.

# BloodLink

BloodLink is a privacy-focused blood donor and emergency network. It supports individual accounts, optional consent-based donor profiles, emergency requests, candidate matching and responses, in-app notifications, and verified hospital/blood bank accounts.

## Stack

- React, Vite, Tailwind CSS
- Node.js, Express.js (ES modules)
- MySQL 8.0+, Prisma ORM
- JavaScript (`.js` / `.jsx`)

## Local development

Requirements: Node.js 20+, npm, and MySQL 8.0+.

1. Copy `server/.env.example` to `server/.env`; set `DATABASE_URL` and the session cookie settings. Session tokens are generated randomly and stored hashed in MySQL; there is no `SESSION_SECRET` setting.
2. Run `npm install`, then `npm run db:generate`, `npm run db:migrate`, and `npm run db:seed` from the repository root.
3. Start both services with `npm run dev`. Vite proxies `/api/v1` to Express. The default API base is `/api/v1`; set `VITE_API_URL` only when hosting the API on a different origin.
4. For the first administrator, configure `ADMIN_BOOTSTRAP_EMAIL` and a unique `ADMIN_BOOTSTRAP_PASSWORD` (at least 20 characters), run `npm run admin:bootstrap` once, then remove those bootstrap values.

Development email verification links are logged by the development-only email adapter. Production requires authenticated SMTP; see [deployment guide](docs/DEPLOYMENT.md).
Production also requires a TLS Redis-compatible `REDIS_URL` for shared rate limiting; local development uses memory unless you opt into a local Redis URL. Setup steps are in the deployment guide.

## Release readiness

See [deployment guide](docs/DEPLOYMENT.md) for production environment variables, SMTP and Redis setup, migrations, administrator bootstrap, backups, recovery, and browser QA. The local final run passed automated, MySQL integration, Prisma validation, migration, and build checks. A real Redis endpoint, production SMTP credentials, and browser QA still need environment-specific verification before public production use. The known Prisma CLI advisory is documented in `PROJECT_PROGRESS.md`; no Prisma upgrade was made.

## Checks

- `npm test` — API and unit tests
- `npm run test:db` — MySQL integration tests using synthetic data
- `npm run build` — production client build
- `npm --workspace server exec prisma migrate status` — migration status

## Privacy and medical safety

Donor discovery requires explicit current consent. Public discovery and match summaries use coarse location and do not expose donor email, phone, account identifiers, exact address, or precise coordinates. Candidate matching ranks operational location factors; it is not medical approval. Qualified medical professionals must verify donor suitability and blood compatibility. BloodLink does not invent eligibility or donation cooldown rules.

## Release scope

This release includes authentication and email verification, donor profiles and consent, emergency requests, discovery, matching and donor responses, notifications, organization registration and administrator verification, and a basic verified organization dashboard. Live chat, advanced analytics, automated SMS, and complex inventory management are deferred. Password reset is not implemented yet.

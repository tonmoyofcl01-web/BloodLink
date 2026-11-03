# BloodLink

BloodLink is a privacy-focused blood donor and emergency network.

## Milestone 1 setup

Requirements: Node.js 20+, Docker Compose (or MySQL 8.0+), and npm.

1. Start local MySQL with `docker compose up -d mysql` (or provide your own MySQL 8.0+ instance). Copy `server/.env.example` to `server/.env` and set the matching MySQL database URL. Set `SESSION_COOKIE_SECURE=true` behind HTTPS.
2. Install dependencies with `npm install`.
3. Generate Prisma Client and deploy the initial migration with `npm run db:generate` and `npm run db:migrate`.
4. Optionally set the one-time administrator bootstrap email and a unique password of at least 20 characters, then run `npm run admin:bootstrap`. The script refuses to elevate an existing account or create a second active administrator.
5. Run `npm run dev` for the Vite client and Express API.

In development, email verification URLs are printed to the API server console. Production startup requires a real email adapter; the development adapter intentionally refuses to send in production.

Run automated server tests using `npm test`.

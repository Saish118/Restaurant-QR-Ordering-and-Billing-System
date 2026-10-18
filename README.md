# Restaurant SaaS pilot

A Next.js + NestJS/Fastify modular monolith with PostgreSQL/Prisma and Supabase Auth. Phase 1–2 foundation; separate from the existing habit-ai application.

Architecture, schema relationships, role flows, tenant isolation, visit/order model and issues: [docs/architecture.md](docs/architecture.md).
Current and planned API endpoints: [docs/api.md](docs/api.md).

## Supabase project

Dedicated Free-plan project: restaurant-saas-pilot, ref geuyxwyjpallkvcyccuj, Mumbai (ap-south-1), organisation Saish Joshi.
Dashboard: https://supabase.com/dashboard/project/geuyxwyjpallkvcyccuj
The foundation SQL was applied with the connector. No paid host, storage bucket or monitoring account was provisioned. The API is not deployed.

## Install and configure

Use Node 22.12+ (tested locally with Node 26) and npm. From this directory:

```sh
npm ci
cp -n .env.example .env
cp -n apps/web/.env.example apps/web/.env.local
npm run db:generate
```

The frontend local env already contains this project’s publishable key. Set the corresponding publishable key in the root backend env file. Never put a service-role key or database connection string in NEXT_PUBLIC variables. The API loads the root .env when invoked with the root npm scripts. The frontend reads apps/web/.env.local.

Set DIRECT_URL to an administrative direct/session-pooler connection used only for migration/operator commands. Set DATABASE_URL to a different, restricted restaurant_app connection; the API refuses privileged connections.

The migration creates restaurant_app with NOLOGIN so there is no default cloud password. In the Supabase SQL editor, enable login and assign a unique strong password using your password manager; do not commit it:

```sql
ALTER ROLE restaurant_app LOGIN PASSWORD 'REPLACE_WITH_A_UNIQUE_SECRET';
```

Use the Supabase Connect dialog's session-pooler connection, replace the username with restaurant_app.PROJECT_REF and insert that password. Keep SSL enabled on hosted connections. Use a certificate-verified TLS connection; do not set rejectUnauthorized:false. The app pool is limited to five connections per API instance. Budget total connections before adding instances.

For a new empty database, apply migrations with `npm run db:deploy`. For this existing Supabase project, first baseline the two already-applied connector migrations once using `npx prisma migrate resolve --applied 202610180001_foundation` and `npx prisma migrate resolve --applied 202610180002_rls_initplans` with DIRECT_URL set correctly. Do not replay it or run db push. SQL migrations are authoritative for RLS, checks and partial indexes that Prisma cannot fully express. No separate Supabase migration history is maintained locally.

## Provision first operator and owner

1. Create/invite a user through Supabase Authentication and complete email/password setup. Copy the verified Auth user UUID.
2. Using the migration connection, run:

```sh
npx tsx scripts/bootstrap-admin.ts VERIFIED_AUTH_USER_UUID 'Operator name'
```

3. Start API and frontend in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

4. Open http://localhost:3000 and sign in. The platform admin can create a restaurant by supplying an existing verified owner's Auth UUID and name. The same UUID can own multiple restaurants. Sign in as that owner to see only assigned restaurants.

The bootstrap command intentionally requires operator database access. No default passwords or administrator accounts are seeded. Owner/Auth invitation is a manual pilot onboarding step; automated invitations are not implemented.

## Local database verification

Use an isolated PostgreSQL 16+ database. The migration operator must be able to create the restaurant_app role. Apply the checked-in SQL/migrations and create a login/password for that role. For local-only tests, use a loopback database with disposable data and configure TEST_ADMIN_DATABASE_URL. Do not point integration tests at a customer database.

```sh
npm run typecheck
npm test
TEST_ADMIN_DATABASE_URL=postgresql://LOCAL_ADMIN@127.0.0.1:55439/restaurant npm run test:db
npm run build
npx playwright install chromium
npx playwright test
```

The API integration tests use a fake verifier only inside the test process to isolate business authorization from the remote identity provider. Actual token verification uses Supabase getUser; a real user login requires the operator account described above.

## Implemented and next

Implemented: repository/env handling, frontend account/workspace UI, Supabase token verification, explicit membership/role checks, restricted transaction-local database context, RLS on all 19 tables, composite foreign keys, active-session/idempotency constraints, atomic restaurant provisioning, owner settings, restaurant status/QR controls and audit records.

Not yet implemented: staff PIN endpoints, menus/tables UI, orders/bills, guest capability exchange, realtime subscription authorization, storage uploads, offline service worker, subscription enforcement, payment/GST integrations and full operational dashboards. The PWA manifest is present; offline caching is intentionally deferred until cache boundaries are tested. The next phase is menu and table management, followed by visit/session and staff ordering.

Before a live pilot, complete the operational phases and reliability tests, configure authentication abuse protection/MFA, verify restore capability and actual Free-tier quotas, and test weak-network reconnect flows. This foundation is not a production readiness claim.

## Current local pilot setup

The ignored root `.env` now contains a restricted restaurant_app connection for this Supabase project, plus the publishable Auth key. Both local env files are configured on this Mac; preserve them instead of overwriting them with examples. The API explicitly resolves the root env file even when npm runs it from apps/api. It never needs the migration/admin database password.

The pooler connection uses `sslmode=verify-full` and `sslrootcert` pointing to the checked-in public Supabase CA certificate at `config/certs/supabase-ca-2021.crt`. This public certificate was downloaded from the certificate link in the project’s Database Settings. The private database password exists only in the ignored local env file with owner-only permissions. When deploying or moving to another computer, configure fresh environment secrets and the appropriate certificate path; never commit a connection string containing a password. Runtime access was enabled using an environment-specific role configuration operation, not a checked-in password migration.

The first verified Auth account has been granted platform-admin access. `Demo Restaurant` is provisioned with the same account as owner, QR ordering disabled and a pilot trial subscription. No sample orders or payments were created. To create the demo on another environment after bootstrapping a verified administrator:

```sh
npx tsx scripts/seed-demo.ts VERIFIED_ADMIN_AUTH_USER_UUID
```

The command uses backend permission checks and is idempotent by the demo slug; it does not create an Auth account or overwrite an existing restaurant. Real user passwords must be set directly in Supabase, never passed in chat or shell arguments.

English, मराठी and हिन्दी are available throughout the current UI, with a remembered device preference. See [language guidance](docs/languages.md). Menu and ordering workflows are still subsequent phases.

Panel entry points: `http://localhost:3000/admin` is the English-only main system administration panel. `http://localhost:3000` is restaurant/hotel management with English, Marathi and Hindi. The same account can have both roles; each entry point displays controls for its purpose. Customer QR screens will also support the three languages when implemented.

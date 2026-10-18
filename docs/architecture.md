# Restaurant SaaS pilot architecture

This repository implements the Phase 1 and Phase 2 foundation. The target is a low-cost pilot for 2–3 restaurants. Ordering, PIN login, QR guest access and real-time delivery are subsequent phases, not working features in this foundation.

## Repository and module boundaries

```
apps/web/                 Next.js App Router, Tailwind, shadcn/ui-compatible primitives, PWA manifest
apps/api/src/
  auth/                   Supabase access-token verification, request identity
  database/               Prisma, transaction-local tenant context, RLS safety check
  restaurants/            Current memberships, restaurant access, owner settings
  super-admin/            Provision restaurants/owners, suspend/activate, QR feature flag
  common/                 Environment and request validation
packages/database/prisma/ Schema and SQL migrations (single migration authority)
docs/                     Architecture and API contract
scripts/                  Explicit operator bootstrap
 tests/                   Unit, database integration and Playwright smoke test
```

Later Nest modules: staff owns credentials/revocation; roles-permissions owns action policies; tables owns physical tables; menu owns categories/items; dining-sessions owns visit lifecycle; orders owns tickets and immutable snapshots; kitchen exposes narrow status actions; billing computes/finalizes totals; payments-placeholder records manual payments; service-requests owns service tasks; reports owns read queries; audit-logs records actions inside originating transactions; subscriptions owns pilot entitlement. Settings is currently inside restaurants. Split modules when their implementation begins; do not create empty modules that imply completed features. Order-items stay inside orders because they share a transaction boundary.

## Initial schema and relationships

The SQL migration and introspected Prisma schema are the executable definitions.

| Entity                      | Ownership and relationships                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- |
| users                       | Global verified auth subject; active flag checked on every API request                |
| platform_admins             | Global operator allowlist; manually bootstrapped, no public grant endpoint            |
| restaurants                 | Tenant root, status TRIAL/ACTIVE/SUSPENDED/CLOSED                                     |
| restaurant_users            | User membership and role; unique restaurant/user                                      |
| restaurant_settings         | One per restaurant; QR flag controlled by super admin                                 |
| subscriptions               | One pilot subscription per restaurant, trial expiry timestamp                         |
| staff, staff_sessions       | Restaurant PIN accounts, Argon2id hashes, hashed session token and revocation/version |
| tables                      | Permanent physical table and random QR reference                                      |
| menu_categories, menu_items | Restaurant-owned menu; composite category foreign key                                 |
| dining_sessions             | One visit per table; partial unique index permits only one live visit                 |
| guest_capabilities          | Hashed random credential bound to a single visit, expiry and revocation               |
| orders                      | Separate tickets linked to a visit; source and actor; request hash/idempotency key    |
| order_items                 | Ordered name, price and tax snapshots; quantity and item preparation status           |
| bills                       | One bill per visit; integer minor-unit totals; finalized timestamp                    |
| payments                    | Manual cash/UPI records only; gateway absent                                          |
| service_requests            | Visit-bound service/bill request                                                      |
| audit_logs                  | Append-only to runtime role; tenant nullable for platform-level actions               |

Every tenant child relationship uses composite (restaurant_id, id) foreign keys where it links tenant records. UUIDs do not substitute for authorization. Indexes lead with restaurant_id for active queries. Global identities intentionally have no restaurant_id: users can own multiple restaurants. Staff and guest session rows must never be exposed to clients. Historical records are retained rather than cascade-deleted.

## Authentication and authorization

1. Super admin and owners sign in through Supabase Auth. The frontend holds the session in memory in this foundation; refresh/relogin is required after a reload. Tokens are sent as Bearer headers over HTTPS in deployment. No service-role key exists in the frontend or API configuration.
2. Nest calls Supabase `getUser(token)` to verify identity. It does not trust decoded browser claims or editable user metadata. The local users.active flag is checked immediately; platform admin eligibility and restaurant membership are queried from PostgreSQL on every request.
3. Initial super admin is bootstrapped by a migration operator using a verified Supabase Auth user UUID. No self-service super-admin registration exists.
4. Owner onboarding initially uses the Supabase dashboard to invite/create the Auth user, then a platform-admin API call supplies that verified UUID. No server-side email invite implementation yet. Never accept a UUID supplied by an unprivileged caller to assign membership.
5. Owners can read their restaurant/settings and edit non-plan settings. Only super admin can create tenants, change restaurant status or enable QR. Waiter/chef Supabase-linked memberships can read their restaurant but cannot change owner settings. Production PIN sign-in is deliberately not enabled yet.
6. Planned PIN flow: owner creates staff account; Argon2id hashes PIN with a random salt. Login requires restaurant + staff identifier + PIN; never identify a person by PIN alone. Transactionally track attempts/lockouts in PostgreSQL so restarts and multiple API instances cannot reset limits. Return a random opaque session token stored only as a hash. Check expiry, active staff, version and revocation on every use. Reset PIN increments version and revokes sessions. Public PIN endpoints must not ship until database-backed rate limiting and device enrollment are implemented.
7. Planned QR flow: permanent reference opens public menu only. Staff opens a visit and issues a fresh random join code or approves the guest. Exchange it for a random visit capability, stored as hash in PostgreSQL. Every guest API checks restaurant status, QR flag, visit OPEN, expiry/revocation and visit ownership. Never let a permanent QR mint access to whichever visit is active. Each phone gets a capability. Close revokes all capabilities; reopening never revives an old token.

## Tenant isolation and RLS

The API connects using restaurant_app, a non-owner NOBYPASSRLS role. Migrations use a separate administrative connection. Startup refuses a superuser, bypassrls role or public-table owner. Business tables have ENABLE and FORCE ROW LEVEL SECURITY. Supabase anon/authenticated have no direct access to business tables; all business writes go through Nest.

Each request starts a Prisma interactive transaction, initializes user/tenant/role/admin context using transaction-local set_config, reads account/admin/membership records, checks restaurant status, then sets the authorized tenant and role. Work executes only on the transaction client. On commit/rollback settings disappear, preventing connection-pool leakage. Browser restaurant IDs are selectors and never proof of permission. Context variables are trusted backend inputs, not an additional authentication system. SQL injection and database credential compromise remain outside that boundary: use parameterized SQL everywhere, protect credentials, and keep API role inaccessible to browsers.

RLS enforces tenant scope. Nest enforces action-level permissions. An owner cannot get another restaurant's row by changing an object ID. Super-admin bypass of tenant scope is intentional and explicit; mutations write audit records. Support impersonation is not implemented. Runtime cannot insert platform_admins, alter identity activation or rewrite audit records. Future narrow read models must keep chefs away from billing data and all staff away from credential hashes.

## Visit and running-order state model

- Physical table: active/disabled; display status derives from live session and payment state, not a second mutable status column.
- Visit: OPEN -> BILLING -> CLOSED; OPEN/BILLING -> CANCELLED only with permission and explicit reconciliation. Reopening creates a new visit/capability by default. Any exceptional reopen needs its own audited policy.
- Ticket: NEW -> READY -> SERVED; authorized cancellation must preserve original snapshots and record reason/actor. Item-level READY supports partial preparation; ticket status is derived/updated transactionally.
- Bill: running while visit OPEN; freeze/recompute and reject new orders in BILLING; finalize and close only after manual payment reconciliation. Failed/pending payment must not free the table.

Placing an order will lock the dining_sessions row FOR UPDATE, check OPEN, look up idempotency key, compare canonical request hash, fetch menu prices/availability, insert a new ticket and snapshots, update the running bill and commit. Closing/billing locks that same visit row. Same key/same payload returns original ticket; same key/different payload returns 409. Reusing a key in a different visit cannot reveal old data. No order totals are accepted from browsers. Use integer minor units and a documented per-line rounding rule; use BigInt and serialize decimal strings where PostgreSQL bigint is exposed. A bill is the sum of noncancelled snapshot lines, not current menu prices.

Realtime notifications only happen after commit. Planned Supabase private Broadcast topics must check current restaurant membership/staff session and expire promptly. Do not grant broad business-table access just to enable subscriptions. Staff opaque sessions require a backend-issued short-lived realtime authorization token or a backend event bridge; this is a Phase 9 prerequisite. Reconnect always refetches authorized API state. Periodic reconciliation covers lost notifications. Do not claim durable delivery from Broadcast.

## Architecture issues resolved before coding

- The default Prisma database role in some quickstarts bypasses RLS. This implementation explicitly does not use it for runtime.
- Supabase Auth, guest capabilities and custom PIN sessions are different identity types. Staff session verification and realtime authorization must be implemented together before live staff realtime ships.
- A copied permanent QR cannot prove physical presence; staff-issued fresh visit access is required.
- Free hosting may pause/sleep and has usage limits; pilot capacity and uptime must be measured. No production uptime promise or automatic scale claim is made.
- Database transactions and idempotency come before ordering UI. Realtime is a hint, not order confirmation.
- Trial timestamps are recorded but automated subscription enforcement is not enabled. Restaurant status is the explicit pilot access control.
- No online payments, tax compliance automation or receipt delivery is implemented. Tax configuration needs business validation before billing ships.
- Storage is not provisioned yet. Later private buckets need tenant-scoped object paths, policy tests and signed URLs. PWA caches static assets only; never cache authenticated API responses, bills, tokens or queued order success.
- Persistent low-cost Node hosting is preferable for Nest; pick a provider after checking actual free-plan sleep/connection limits. No paid host or external monitoring account is created.

## Validation gates

Run migration against clean PostgreSQL; introspect/validate/generate Prisma; typecheck and build both apps; database integration checks for owner/admin permissions, tenant reads/writes, cross-tenant foreign keys, inactive memberships/accounts, suspended tenants and pool reuse. Phase 5+ adds concurrent order/close and idempotency tests. Playwright smoke tests current frontend only; it does not establish unimplemented order flows.

## References checked

- https://supabase.com/docs/guides/database/prisma
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/realtime/authorization
- https://supabase.com/changelog.md (2026-10-12 TLS change: use modern clients)
- https://nextjs.org/docs/app/getting-started/installation
- https://docs.nestjs.com/first-steps

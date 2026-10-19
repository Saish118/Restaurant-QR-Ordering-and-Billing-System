# Foundation verification

Verified locally on 18 October 2026 using Node 26 and PostgreSQL 16.

- TypeScript checks passed for web and API.
- Next.js production build and NestJS TypeScript build passed.
- Two unit tests passed for role restrictions and strict request validation.
- Two database integration suites passed against disposable PostgreSQL: RLS/ownership/session constraints/context reset; API identity, role and tenant checks, provisioning, duplicate conflict, suspension, revocation and audit.
- One Playwright smoke test passed in installed Chrome at 390px mobile width; login fields visible, no horizontal overflow. Full-page screenshot inspected.
- npm audit reported zero known vulnerabilities in the installed dependency tree.
- Supabase project has 19 business tables, all with RLS enabled. Security advisor returned no findings. Performance RLS initplan warnings were fixed; remaining unused-index informational findings are expected on an empty project and those indexes are retained for intended queries.

The API integration verifier is replaced only inside the test process; it does not test a real Supabase user login. Hosted connectivity and the first operator were configured in the update below. Operational ordering, PIN, QR, billing and realtime workflows are not implemented or tested in this phase. The service worker is also deferred; the PWA manifest alone does not provide offline operation. Load capacity and disaster recovery have not been validated.

## Login setup and language update

- Verified the restricted hosted database connection uses restaurant_app without RLS bypass. The client-to-pooler connection is encrypted and the server certificate is verified with the official Supabase CA.
- A confirmed Auth account was provisioned as platform admin; Demo Restaurant was created through the backend and linked to that account as owner. A repeated setup does not need another restaurant.
- Five unit tests pass, including translation completeness and locale fallback/formatting.
- Both PostgreSQL integration suites pass after changing root environment resolution.
- Five Playwright scenarios pass: mobile sign-in and persisted language choice for English/Marathi/Hindi, plus translated workspace/settings/error handling using mocked identity/API responses, and a JavaScript-disabled credential submission check.
- Both application builds and TypeScript checks pass. Marathi mobile layout was visually inspected.
- Real password entry is performed by the user. Browser tests do not collect or retain the user's password.

- The user confirmed real sign-in with their own password and visibility of Demo Restaurant. No password was supplied to the agent.
- Sign-in forms use POST as a non-JavaScript fallback, so failed hydration cannot put credentials in URL query parameters. Browser tests use localhost consistently with the running app and configured API origin.

The latest Supabase security advisor flags leaked-password protection as disabled. Supabase makes that feature available on Pro and above, so the Free pilot has not been upgraded. Track this limitation before production rollout: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Panel language scope update

Seven browser scenarios pass after separating `/admin` (English-only platform administration) from `/` (multilingual restaurant/hotel management). Coverage verifies that a saved Marathi preference does not translate admin or expose its language selector, that the preference remains available on returning to restaurant management, and that a restaurant-only account is denied entry to the platform-admin workspace. Both application builds pass. No database or backend authorization changes were needed.

## Menu tables and main-admin product access

Six unit tests pass, including exact integer price conversion. Three PostgreSQL integration suites pass, including tenant ownership for categories/items/tables, main-admin-only restaurant/QR control, raw owner-context rejection of QR/subscription changes, QR preview rejection in billing-only mode, availability updates preserving dish metadata, active-visit table protection and menu changes preserving historical order-price snapshots. Nine browser scenarios cover mobile menu/table workflows, multilingual restaurant management, English-only administration and restricted QR preview controls. Both application builds pass. The mobile menu screen was visually inspected.

The new mode-control migration is applied to the pilot Supabase project. No plan flag or customer data was changed by tests: backend integration tests run only in disposable local PostgreSQL and browser tests mock their data. The hosted database advisor reports only the existing Free-plan leaked-password-protection warning, documented above. Customer QR ordering, dining-session APIs and billing flows are still not implemented; generated QR images are marked as setup previews.

## Super Admin management extension (2026-10-19)

TypeScript, six unit tests, four disposable PostgreSQL integration suites and both application builds pass. The new database suite exercises actual restricted-role/RLS access, restaurant profile/subscription lifecycle, expired-date rejection, trial start/extend/end, owner membership disable across multiple restaurants, manually recorded receipt idempotency/conflict/voiding, correct collection totals, QR rotation, Argon2id PIN reset, archive/restore, sanitized audit data and admin-only log access. Auth account creation/reset is tested with an in-process provider substitute; no hosted owner passwords are changed by tests. Missing-provider responses and platform-admin password protection are checked.

New hosted tables `subscription_receipts`, `restaurant_activity`, `error_logs` have ENABLE/FORCE RLS. Advisor findings for missing foreign-key indexes and duplicate permissive admin-read policies were fixed. Remaining performance notices are unused indexes on this pilot, retained for their intended access patterns. The existing Free-plan leaked-password-protection warning remains (link above). No paid resources were provisioned. UTC transaction setup fixes an expiry bug exposed when the local server default zone is Asia/Kolkata.

Functional checks do not establish concurrent-customer capacity, disaster recovery or production readiness. In-panel owner Auth actions still require a server-only secret key, and reserved premium features/storage are explicitly not represented as live integrations.

Ten browser scenarios pass across the updated checks, including a mobile admin flow for exact subscription amounts, manual receipt entry and owner membership disable, with unavailable Auth buttons disabled. QR entitlement/previews and English-only admin isolation remain covered; the existing restaurant language tests still pass. Desktop support and mobile admin screenshots were visually inspected. A read-only live backend-controller smoke check through `restaurant_app` returned Demo Restaurant, actual dashboard totals, usage counters and Auth-configuration status. The unauthenticated live admin endpoint returned 401 and API health returned 200.

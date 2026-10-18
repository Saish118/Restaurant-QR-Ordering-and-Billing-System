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

# Super Admin console

Open `/admin` for English-only platform administration. Restaurant management at `/` retains English, Marathi and Hindi. Customer ordering remains a later phase.

## Implemented controls

| Area                  | Behavior                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restaurant management | Search/paginate restaurants; edit name, URL slug, address, phone, GST number and time zone; Trial/Active/Expired/Suspended/Closed states; archive and restore as suspended.                                                                                                           |
| Product access        | Only platform admins change QR versus billing-only mode or feature flags. Owners cannot purchase/enable these through the management UI or API.                                                                                                                                       |
| Owner accounts        | Link an existing verified Auth UUID; enable/disable an individual restaurant membership. Optional server Auth adapter creates logins and resets passwords.                                                                                                                            |
| Subscription          | Setup and recurring amounts in integer paise, monthly/yearly cycle, paid/unpaid, trial dates/actions and subscription expiry. Expiry is enforced on authenticated restaurant requests.                                                                                                |
| Payments              | Manually record received subscription payments, retry using an idempotency UUID, void with reason while retaining history. Dashboard shows cash collections recorded this month in INR, excluding voided/future receipts; it is not recurring-revenue accounting or gateway charging. |
| Features              | QR mode plus waiter/kitchen access flags; reserved flags for payments, GST invoices, messaging, advanced reports and `premium_*` additions. UI explicitly identifies unfinished integrations.                                                                                         |
| Usage                 | Table/staff counts, orders today/month in restaurant time zone, finalized bills, last authenticated restaurant activity/login. Storage usage is unavailable until tenant storage is provisioned.                                                                                      |
| Support               | View configuration; reset staff PIN using Argon2id, reset lockout and revoke sessions; regenerate table QR and revoke affected guest capabilities; latest 100 audit/sanitized error records.                                                                                          |
| Dashboard             | Restaurant totals by effective state, new accounts this month, total orders, manually recorded monthly collections, database/API health and honest configuration status for external services.                                                                                        |

## Auth administration setup

The pilot uses only a publishable key for normal Auth verification. To enable in-panel owner account creation/password reset, add `SUPABASE_SECRET_KEY` to the root backend `.env` using a server-only Supabase secret key. Restart the API. Never put it in `apps/web/.env.local`, `NEXT_PUBLIC_*`, source control, screenshots or chat. Business queries continue through the restricted `restaurant_app` role and RLS; the Auth adapter is the only use of the privileged client.

Without this key, create users in Supabase Authentication yourself and link their verified UUID. The console disables in-panel login creation and reset. No owner emails, invitations or SMS messages are sent automatically.

Account creation compensates a failed application-database insert by deleting only the newly created Auth identity; compensation failures append a sanitized error code. Review orphan identities if that code appears. Password reset invalidates pre-reset application tokens across that owner's restaurants before calling the external provider. If the provider fails, the password is unchanged but a fresh sign-in is required. Platform admin passwords cannot be reset through restaurant support. Membership disable affects one restaurant; it does not ban a shared Supabase identity globally.

## Data and operational limits

Restaurant deletion is implemented as archive: access stops, QR is disabled, guest capabilities are revoked, and financial/audit data is preserved. Restore does not automatically activate the account or QR mode. Explicit status alone does not bypass a past trial/expiry date; update dates or trial controls too.

Request transactions set UTC explicitly to avoid timestamp interpretation errors in the installed PostgreSQL adapter. User-entered dates are interpreted in the operator's local time, sent as ISO timestamps, and stored as timestamptz. Activity is sampled once per minute; system-admin inspection does not impersonate owner activity.

QR previews remain setup artifacts: `/qr/...` customer ordering is not implemented. Enabling reserved payment/GST/messaging/report flags does not create those modules. Staff provisioning/login UI is also pending; PIN support applies to existing staff rows.

The health screen verifies the database by querying it and reports API uptime. It does not claim an external Auth/Storage/Sentry probe or production monitoring. Logs contain action codes/request references, not credentials or raw request bodies. Retention/export, MFA enforcement, production request throttling, load testing, backups/recovery exercises and deployment are remaining production work. Capacity for 1,000 simultaneous customers has not been demonstrated by these functional checks.

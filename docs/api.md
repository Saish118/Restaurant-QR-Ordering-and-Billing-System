# MVP API contract

Base /v1. JSON only. Authentication is Bearer access token unless noted. No credential tokens in URLs. UUID selectors are validated; unknown body fields are rejected.

## Implemented in Phase 2

| Method and path                 | Permission                 | Behavior                                                                                                         |
| ------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET /health                     | Public                     | Process liveness                                                                                                 |
| GET /me                         | Provisioned active account | Current memberships; platform-admin indicator                                                                    |
| GET /restaurants/:id            | Member / super admin       | Authorized tenant summary                                                                                        |
| GET /restaurants/:id/settings   | Owner / super admin        | Settings                                                                                                         |
| PATCH /restaurants/:id/settings | Owner / super admin        | address, customerBillVisible, waiterAllTables; all three required; audited                                       |
| GET /admin/restaurants          | Super admin                | Most recent 100 restaurants; pagination is future work                                                           |
| POST /admin/restaurants         | Super admin                | name, slug, ownerUserId, ownerName, optional qrOrderingEnabled; atomic tenant + owner + settings + trial + audit |
| PATCH /admin/restaurants/:id    | Super admin                | status and qrOrderingEnabled required; audited                                                                   |

401 invalid/missing token; 403 missing membership/role, disabled identity or suspended tenant; 400 malformed inputs. Mutation constraint failures are mapped to 409 by the exception filter. Unexpected failures return generic 500 without database details.

## Planned endpoints by module

These are contracts to implement in later phases; no successful placeholder routes exist.

| Phase             | Routes                                                                                   | Permission                                    |
| ----------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| 3                 | GET/POST /restaurants/:id/menu/categories; PATCH /:categoryId                            | Staff read, owner write                       |
| 3                 | GET/POST /restaurants/:id/menu/items; PATCH /:itemId                                     | Staff read, owner write                       |
| 3                 | GET/POST /restaurants/:id/tables; PATCH /:tableId; GET /:tableId/qr                      | Staff read, owner write/QR                    |
| 4                 | POST /restaurants/:id/tables/:tableId/sessions; GET /restaurants/:id/sessions/:sessionId | Owner/waiter                                  |
| 4                 | POST /restaurants/:id/sessions/:sessionId/billing; POST /:sessionId/close                | Owner                                         |
| 5–6               | POST /restaurants/:id/sessions/:sessionId/orders                                         | Owner/waiter, Idempotency-Key required        |
| 5                 | GET /restaurants/:id/kitchen; POST /restaurants/:id/orders/:orderId/ready                | Chef/owner; narrow kitchen response           |
| 5–6               | GET /restaurants/:id/sessions/:sessionId/bill                                            | Owner; waiter only if permitted               |
| 7                 | GET /qr/:reference/menu                                                                  | Public, enabled restaurant only               |
| 7                 | POST /qr/:reference/join                                                                 | Fresh staff-approved visit code; rate limited |
| 7                 | GET /guest/session; POST /guest/orders; GET /guest/bill                                  | Guest capability; visibility flag for bill    |
| 8                 | POST /restaurants/:id/bills/:billId/payments/manual                                      | Owner                                         |
| 8                 | GET /restaurants/:id/reports/sales; GET /restaurants/:id/history/bills                   | Owner; bounded date filters/pagination        |
| Later staff auth  | POST /staff/login; POST /staff/logout                                                    | Rate-limited PIN exchange/revocation          |
| Later staff admin | POST /restaurants/:id/staff; POST /staff/:staffId/reset-pin; POST /staff/:staffId/revoke | Owner; audited                                |
| Later             | GET/POST /restaurants/:id/service-requests; PATCH /:requestId                            | Valid visit/staff, role restrictions          |

Order input will contain only session selector, item IDs, quantities and bounded notes. No client unit prices/tax/totals/role/restaurant ownership claims are accepted. Staff and QR invoke the same order domain service. Listing endpoints must be paginated before production.

## Phase 3 implemented endpoints

| Method and path                                    | Permission                             | Behavior                                                                                             |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET /restaurants/:id/menu/categories               | Restaurant staff / owner / super admin | Up to 200 tenant categories                                                                          |
| POST /restaurants/:id/menu/categories              | Owner / super admin                    | name, optional sortOrder; audited                                                                    |
| PATCH /restaurants/:id/menu/categories/:categoryId | Owner / super admin                    | name and optional sortOrder; tenant-scoped; audited                                                  |
| GET /restaurants/:id/menu/items                    | Restaurant staff / owner / super admin | Up to 1,000 tenant dishes                                                                            |
| POST /restaurants/:id/menu/items                   | Owner / super admin                    | categoryId, name, priceMinor; optional taxBps, available, vegetarian, special                        |
| PATCH /restaurants/:id/menu/items/:itemId          | Owner / super admin                    | Partial update; omitted fields stay unchanged; audited                                               |
| GET /restaurants/:id/tables                        | Restaurant staff / owner / super admin | Up to 500 physical tables; never includes qr_reference                                               |
| POST /restaurants/:id/tables                       | Owner / super admin                    | label only; works in billing-only mode; audited                                                      |
| PATCH /restaurants/:id/tables/:tableId             | Owner / super admin                    | label and/or active; active visits prevent disabling; audited                                        |
| GET /admin/restaurants/:id/tables/:tableId/qr      | Super admin only                       | Returns setup preview SVG and URL; QR access must already be enabled and the table/restaurant active |

Menu/table mutations reject unknown fields. A restaurant cannot add product-access fields to a table or menu request to enable QR. Missing or foreign-tenant child records return 404 after restaurant authorization. Prices are integer minor units; the UI accepts rupees and converts without floating-point rounding. Current requests are small-restaurant pilot lists with explicit caps; pagination is required before lifting those caps.

`qr_ordering_enabled` is the product-mode entitlement, controlled exclusively through the main-admin restaurant endpoint. Subscription payment processing is not implemented. Owners see the purchased mode read-only. Subscription changes and QR flag changes are additionally protected by an invoker trigger under the restricted runtime database role. A suspended tenant remains blocked even with a valid staff login.

The generated table QR is a setup preview only. Its customer menu/order URL will become functional with the customer module. Do not treat the permanent QR reference as an active-visit credential. Future guest endpoints must independently check restaurant status, QR entitlement and fresh dining-session capability on every request.

## Super Admin management extension

Every route below verifies Supabase identity and active platform-admin membership. Prefix `/v1` applies. Non-admin callers receive 403 even when an optional provider is unavailable.

- `GET /admin/overview`: counts, recorded monthly payment collections and health/configuration status.
- `GET /admin/restaurants?search=&page=1&includeArchived=false`: up to 100 accounts/page, effective expiry status.
- `POST /admin/restaurants/onboard`: optional Auth-backed owner creation plus restaurant provisioning. Requires server secret key. Existing-user provisioning remains `POST /admin/restaurants`.
- `GET /admin/restaurants/:id/management`: settings, subscription, owners, usage, staff summaries and last 50 receipts; no staff hashes or passwords.
- `PATCH /admin/restaurants/:id/profile`: name, slug, address, contactPhone, gstNumber, timeZone.
- `POST /admin/restaurants/:id/archive` with reason; `POST .../restore`: preserve history, restore suspended.
- `PATCH .../subscription`: plan, setupAmountMinor, recurringAmountMinor, billingCycle, paymentStatus, trialStartedAt, trialEndsAt, expiresAt (nullable ISO dates).
- `POST .../trial`: action START/END/EXTEND, days 1–365.
- `POST .../receipts`: amountMinor > 0, kind SETUP/RECURRING, idempotencyKey UUID, optional paidAt. Repeating the same key/data returns the original receipt; different data returns 409.
- `POST .../receipts/:receiptId/void`: reason. Voiding does not automatically change the manually managed subscription paid/unpaid label.
- `PATCH .../features`: flags object; catalog keys or `premium_[a-z0-9_]{1,48}` only.
- `POST .../owners/link`: userId, displayName. Supply a verified existing Auth UUID.
- `POST .../owners/login`: email, displayName, password (12–128 chars), optional Auth configuration required.
- `PATCH .../owners/:userId/access`: active boolean, scoped to restaurant membership.
- `POST .../owners/:userId/reset-password`: password (12–128 chars); protects platform admins, invalidates existing application tokens.
- `POST .../staff/:staffId/reset-pin`: pin, 6–8 digits; Argon2id hashing and session revocation.
- `POST .../tables/:tableId/regenerate-qr`: reason; QR entitlement and current account access required. Previous guest capabilities are revoked.
- `GET /admin/audit?restaurantId=...` and `GET /admin/errors`: latest 100 records.

See [super-admin.md](super-admin.md) for operational semantics and deferred integrations.

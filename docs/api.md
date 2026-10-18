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

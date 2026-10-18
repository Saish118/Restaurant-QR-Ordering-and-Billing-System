# Product access and responsibilities

The main system administrator manages restaurant accounts, access status and QR entitlement. Restaurant owners cannot create another restaurant, activate their own account, change subscriptions or enable QR. This is enforced in the backend and, for product entitlements, by the database as well as the screen layout.

| Action                                     | Main admin                | Restaurant owner    |
| ------------------------------------------ | ------------------------- | ------------------- |
| Create restaurant account                  | Yes                       | No                  |
| Activate, pause or close restaurant access | Yes                       | No                  |
| Enable or disable QR ordering entitlement  | Yes                       | No                  |
| Generate/download table QR previews        | Yes, only with QR enabled | No                  |
| Manage menu, prices and availability       | Yes                       | Own restaurant only |
| Manage physical dining tables              | Yes                       | Own restaurant only |
| View current billing-only or QR mode       | Yes                       | Read-only           |

Billing-only restaurants still need physical tables, menus and dining sessions for waiter ordering and running bills. Adding a physical table does not enable QR, and owner table responses exclude the permanent QR reference. Billing-only restaurants have no working QR preview/generation action, including for the main admin until QR access is explicitly enabled.

The current pilot uses manual main-admin entitlement changes. Payment/subscription purchase automation is a later integration. The subscriptions.plan field is not editable by owners and is not used as a second conflicting mode switch; restaurant_settings.qr_ordering_enabled is authoritative for QR availability.

The main-admin panel remains English-only at /admin. Restaurant management at / retains English, Marathi and Hindi. Customer screens will retain all three when built. QR generation is a setup preview; customer menu/session ordering is not implemented yet.

Future session creation must lock the same physical-table row used by table disable before checking table availability, so opening a session cannot race disabling the table. Menu price changes affect future orders only; previously stored order snapshots must never be rewritten.

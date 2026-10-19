"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { priceInput, priceToMinor } from "../lib/money";
type Call = (path: string, method?: string, body?: unknown) => Promise<any>;
type Restaurant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  effective_status: string;
  deleted_at: string | null;
};
const tabs = [
  "Profile",
  "Owners",
  "Subscription",
  "Features",
  "Usage",
  "Support",
] as const;
const money = (value: number | string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(value) / 100,
  );
const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN") : "No activity recorded";
const localDate = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const iso = (value: FormDataEntryValue | null) =>
  value ? new Date(String(value)).toISOString() : null;
function fields(form: HTMLFormElement) {
  return new FormData(form);
}
function Text({
  name,
  label,
  value = "",
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  value?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        autoComplete={type === "password" ? "new-password" : "off"}
        minLength={type === "password" ? 12 : undefined}
        maxLength={type === "password" ? 128 : undefined}
      />
    </label>
  );
}
export function AdminConsole({
  call,
  onSignOut,
}: {
  call: Call;
  onSignOut: () => Promise<void>;
}) {
  const api = useRef(call);
  api.current = call;
  const [overview, setOverview] = useState<any>(null),
    [restaurants, setRestaurants] = useState<Restaurant[]>([]),
    [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Profile"),
    [screen, setScreen] = useState("restaurants"),
    [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  const [tables, setTables] = useState<any[]>([]),
    [qr, setQr] = useState<any>(null),
    [qrImage, setQrImage] = useState("");
  const receiptKey = useRef("");
  const base = detail ? `/admin/restaurants/${detail.restaurant.id}` : "";
  async function reload(id?: string) {
    const [o, r] = await Promise.all([
      api.current("/admin/overview"),
      api.current(
        `/admin/restaurants?search=${encodeURIComponent(search)}&includeArchived=${archived}&page=${page}`,
      ),
    ]);
    setOverview(o);
    setRestaurants(r);
    if (id) {
      const loaded = await api.current(`/admin/restaurants/${id}/management`);
      setDetail(loaded);
      if (!loaded.settings?.qr_ordering_enabled) {
        setQr(null);
        setQrImage("");
      }
      setRevision((v) => v + 1);
    }
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await work();
      setMessage("Changes saved.");
    } catch (e) {
      setError(true);
      setMessage(
        e instanceof Error ? e.message : "The action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      api.current("/admin/overview"),
      api.current(
        `/admin/restaurants?search=${encodeURIComponent(search)}&includeArchived=${archived}&page=${page}`,
      ),
    ])
      .then(([o, r]) => {
        if (active) {
          setOverview(o);
          setRestaurants(r);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage("Unable to load the admin dashboard. Refresh to retry.");
        }
      });
    return () => {
      active = false;
    };
  }, [search, archived, page]);
  async function open(r: Restaurant) {
    await run(async () => {
      setDetail(await api.current(`/admin/restaurants/${r.id}/management`));
      setTab("Profile");
      setQr(null);
      setQrImage("");
      setRevision((v) => v + 1);
      setScreen("restaurants");
    });
  }
  function submit(
    event: FormEvent<HTMLFormElement>,
    work: (data: FormData) => Promise<void>,
  ) {
    event.preventDefault();
    const f = event.currentTarget;
    const data = fields(f);
    void run(async () => {
      await work(data);
      await reload(detail?.restaurant.id);
      if (f.dataset.clear) f.reset();
    });
  }
  async function update(path: string, body: unknown, method = "PATCH") {
    await api.current(`${base}${path}`, method, body);
  }
  async function showLogs(kind: "audit" | "errors", tenant = false) {
    await run(async () => {
      setLogs(
        await api.current(
          `/admin/${kind}${tenant ? `?restaurantId=${detail.restaurant.id}` : ""}`,
        ),
      );
      setScreen(kind);
    });
  }
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <small>RESTAURANT PLATFORM</small>
          <h1>Super Admin</h1>
          <p>Manage restaurant accounts, plans and access.</p>
        </div>
        <button disabled={busy} onClick={() => void run(onSignOut)}>
          Sign out
        </button>
      </header>
      <nav aria-label="Platform navigation">
        {["restaurants", "health"].map((s) => (
          <button
            key={s}
            aria-pressed={screen === s}
            onClick={() => setScreen(s)}
          >
            {s === "restaurants" ? "Restaurants" : "System health"}
          </button>
        ))}
        <button onClick={() => void showLogs("audit")}>Audit logs</button>
        <button onClick={() => void showLogs("errors")}>Error logs</button>
        <button
          disabled={busy}
          onClick={() => void run(() => reload(detail?.restaurant.id))}
        >
          Refresh
        </button>
      </nav>
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={error ? "admin-error" : "admin-notice"}
        >
          {message}
        </p>
      )}
      {overview && (
        <section aria-label="Platform totals" className="admin-stats">
          {Object.entries(overview.stats).map(([key, value]) => (
            <article key={key}>
              <span>
                {key
                  .replaceAll("_", " ")
                  .replace(" minor", " (recorded payments)")}
              </span>
              <strong>
                {key.includes("minor") ? money(value as string) : String(value)}
              </strong>
            </article>
          ))}
        </section>
      )}
      {screen === "health" && overview && (
        <section className="admin-card">
          <h2>System health</h2>
          <dl>
            {Object.entries(overview.health).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v).replaceAll("_", " ")}</dd>
              </div>
            ))}
          </dl>
          <p>
            The database responds to this dashboard query. Authentication
            configuration is present; the external provider is not probed here.
            Storage tracking is not configured.
          </p>
          <p>
            Owner login creation and password reset:{" "}
            {overview.authManagementAvailable
              ? "configured"
              : "unavailable until the server-only Supabase secret key is configured"}
            .
          </p>
        </section>
      )}
      {(screen === "audit" || screen === "errors") && (
        <section className="admin-card">
          <h2>{screen === "audit" ? "Audit logs" : "Sanitized error logs"}</h2>
          <p>
            Latest 100 entries. Passwords, PINs and request bodies are excluded.
          </p>
          {logs.length === 0 ? (
            <p>No entries recorded.</p>
          ) : (
            <div className="admin-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action / code</th>
                    <th>Restaurant / route</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td>{stamp(l.created_at)}</td>
                      <td>{l.action ?? l.code}</td>
                      <td>{l.restaurant_id ?? l.route ?? "Platform"}</td>
                      <td>
                        <details>
                          <summary>Details</summary>
                          <pre>{JSON.stringify(l, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {screen === "restaurants" && (
        <div className="admin-layout">
          <aside className="admin-card">
            <h2>Restaurants</h2>
            <label>
              Search
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Name or URL name"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setPage(1);
                }}
              />
              Include archived
            </label>
            <button
              onClick={() => {
                setCreating(!creating);
                setDetail(null);
              }}
            >
              Add restaurant
            </button>
            <div className="admin-restaurant-list">
              {restaurants.map((r) => (
                <button
                  key={r.id}
                  aria-pressed={detail?.restaurant.id === r.id}
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    void open(r);
                  }}
                >
                  <strong>{r.name}</strong>
                  <small>
                    {r.deleted_at
                      ? "Archived"
                      : (r.effective_status ?? r.status)}{" "}
                    · {r.slug}
                  </small>
                </button>
              ))}
              {restaurants.length === 0 && <p>No restaurants found.</p>}
            </div>
            <div className="admin-actions">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                disabled={restaurants.length < 100}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </aside>
          <section className="admin-card" aria-label="Restaurant details">
            {creating ? (
              <>
                <h2>Add restaurant</h2>
                <p>
                  Use an existing Supabase Auth user ID, or create a new owner
                  login when Auth administration is configured.
                </p>
                <form
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      const newLogin = d.get("newLogin") === "on";
                      await api.current(
                        newLogin
                          ? "/admin/restaurants/onboard"
                          : "/admin/restaurants",
                        "POST",
                        {
                          name: d.get("name"),
                          slug: d.get("slug"),
                          ownerName: d.get("ownerName"),
                          ...(newLogin
                            ? {
                                ownerEmail: d.get("ownerEmail"),
                                password: d.get("password"),
                              }
                            : {
                                ownerUserId: d.get("ownerUserId"),
                                ...(d.get("ownerEmail")
                                  ? { ownerEmail: d.get("ownerEmail") }
                                  : {}),
                              }),
                          qrOrderingEnabled: d.has("qr"),
                        },
                      );
                      setCreating(false);
                    })
                  }
                >
                  <fieldset disabled={busy}>
                    <Text name="name" label="Restaurant name" required />
                    <Text
                      name="slug"
                      label="URL name (lowercase, hyphens)"
                      required
                    />
                    <Text name="ownerName" label="Owner name" required />
                    <Text
                      name="ownerUserId"
                      label="Existing owner Auth user ID"
                    />
                    <Text name="ownerEmail" label="Owner email" type="email" />
                    <label>
                      <input
                        type="checkbox"
                        name="newLogin"
                        disabled={!overview?.authManagementAvailable}
                      />
                      Create a new owner login
                    </label>
                    <Text
                      name="password"
                      label="New login password (at least 12 characters)"
                      type="password"
                    />
                    <label>
                      <input name="qr" type="checkbox" />
                      Enable QR ordering access
                    </label>
                    <button type="submit">Create restaurant</button>
                  </fieldset>
                </form>
              </>
            ) : !detail ? (
              <>
                <h2>Select a restaurant</h2>
                <p>
                  Choose a restaurant to manage its account, subscription and
                  support settings.
                </p>
              </>
            ) : (
              <>
                <div className="admin-detail-title">
                  <div>
                    <h2>{detail.restaurant.name}</h2>
                    <p>
                      {detail.restaurant.deleted_at
                        ? "Archived account"
                        : (detail.effectiveStatus ??
                          detail.restaurant.status)}{" "}
                      ·{" "}
                      {detail.settings?.qr_ordering_enabled
                        ? "QR mode"
                        : "Billing-only mode"}
                    </p>
                  </div>
                  <button onClick={() => void showLogs("audit", true)}>
                    Account audit
                  </button>
                </div>
                <nav aria-label="Restaurant sections">
                  {tabs.map((t) => (
                    <button
                      key={t}
                      aria-pressed={tab === t}
                      onClick={() => {
                        setTab(t);
                        if (t === "Support")
                          void run(async () => {
                            setTables(
                              await api.current(
                                `/restaurants/${detail.restaurant.id}/tables`,
                              ),
                            );
                          });
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </nav>
                <fieldset
                  disabled={busy}
                  key={`${detail.restaurant.id}-${revision}-${tab}`}
                >
                  {tab === "Profile" && (
                    <>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (d) =>
                            update("/profile", {
                              name: d.get("name"),
                              slug: d.get("slug"),
                              address: d.get("address"),
                              contactPhone: d.get("phone"),
                              gstNumber: d.get("gst"),
                              timeZone: d.get("zone"),
                            }),
                          )
                        }
                      >
                        <Text
                          name="name"
                          label="Restaurant name"
                          value={detail.restaurant.name}
                          required
                        />
                        <Text
                          name="slug"
                          label="URL name"
                          value={detail.restaurant.slug}
                          required
                        />
                        <Text
                          name="address"
                          label="Address"
                          value={detail.settings?.address ?? ""}
                        />
                        <Text
                          name="phone"
                          label="Contact phone"
                          value={detail.settings?.contact_phone ?? ""}
                        />
                        <Text
                          name="gst"
                          label="GST number"
                          value={detail.settings?.gst_number ?? ""}
                        />
                        <Text
                          name="zone"
                          label="Time zone"
                          value={detail.settings?.time_zone ?? "Asia/Kolkata"}
                          required
                        />
                        <button>Save details</button>
                      </form>
                      {!detail.restaurant.deleted_at ? (
                        <>
                          <form
                            onSubmit={(e) =>
                              submit(e, async (d) =>
                                update("", {
                                  status: d.get("status"),
                                  qrOrderingEnabled: d.has("qr"),
                                }),
                              )
                            }
                          >
                            <label>
                              Account status
                              <select
                                aria-label="Account status"
                                name="status"
                                defaultValue={detail.restaurant.status}
                              >
                                {[
                                  "TRIAL",
                                  "ACTIVE",
                                  "EXPIRED",
                                  "SUSPENDED",
                                  "CLOSED",
                                ].map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                name="qr"
                                defaultChecked={
                                  detail.settings?.qr_ordering_enabled
                                }
                              />
                              QR ordering enabled
                            </label>
                            <p>
                              Only Super Admin can change the purchased mode. QR
                              codes are setup previews until customer ordering
                              is built.
                            </p>
                            <button>Save access</button>
                          </form>
                          <form
                            onSubmit={(e) =>
                              submit(e, async (d) =>
                                update(
                                  "/archive",
                                  { reason: d.get("reason") },
                                  "POST",
                                ),
                              )
                            }
                          >
                            <h3>Archive restaurant</h3>
                            <p>
                              Disables access and QR ordering. Bills and audit
                              history remain available.
                            </p>
                            <Text
                              name="reason"
                              label="Archive reason (at least 3 characters)"
                              required
                            />
                            <button>Archive restaurant</button>
                          </form>
                        </>
                      ) : (
                        <button
                          onClick={() =>
                            void run(async () => {
                              await update("/restore", {}, "POST");
                              await reload(detail.restaurant.id);
                            })
                          }
                        >
                          Restore as suspended
                        </button>
                      )}
                    </>
                  )}
                  {tab === "Owners" && (
                    <>
                      <h3>Owner accounts</h3>
                      {detail.owners.map((o: any) => (
                        <article className="admin-subcard" key={o.user_id}>
                          <strong>{o.display_name}</strong>
                          <p>
                            {o.email ?? "Email not recorded"} ·{" "}
                            {o.active ? "Access enabled" : "Access disabled"}
                          </p>
                          <small>{o.user_id}</small>
                          <button
                            onClick={() =>
                              void run(async () => {
                                await update(`/owners/${o.user_id}/access`, {
                                  active: !o.active,
                                });
                                await reload(detail.restaurant.id);
                              })
                            }
                          >
                            {o.active
                              ? "Disable restaurant access"
                              : "Enable restaurant access"}
                          </button>
                          {!o.platform_admin && (
                            <form
                              data-clear
                              onSubmit={(e) =>
                                submit(e, async (d) =>
                                  update(
                                    `/owners/${o.user_id}/reset-password`,
                                    { password: d.get("password") },
                                    "POST",
                                  ),
                                )
                              }
                            >
                              <Text
                                name="password"
                                type="password"
                                label="New owner password"
                                required
                              />
                              <button
                                disabled={!detail.authManagementAvailable}
                              >
                                Reset password
                              </button>
                            </form>
                          )}
                          {o.platform_admin && (
                            <p>
                              Platform administrator passwords must be managed
                              through account security.
                            </p>
                          )}
                        </article>
                      ))}
                      <p>
                        Disabling access affects this restaurant membership. A
                        shared account may still access other restaurants.
                      </p>
                      {!detail.authManagementAvailable && (
                        <p className="admin-notice">
                          Create logins in Supabase Authentication and link
                          their user ID below. In-panel creation and password
                          reset require the server-only Supabase secret key.
                        </p>
                      )}
                      <form
                        data-clear
                        onSubmit={(e) =>
                          submit(e, async (d) =>
                            update(
                              "/owners/link",
                              {
                                userId: d.get("userId"),
                                displayName: d.get("displayName"),
                              },
                              "POST",
                            ),
                          )
                        }
                      >
                        <h3>Link existing owner</h3>
                        <Text
                          name="userId"
                          label="Supabase Auth user ID"
                          required
                        />
                        <Text name="displayName" label="Owner name" required />
                        <button>Link owner</button>
                      </form>
                      <form
                        data-clear
                        onSubmit={(e) =>
                          submit(e, async (d) =>
                            update(
                              "/owners/login",
                              {
                                email: d.get("email"),
                                displayName: d.get("displayName"),
                                password: d.get("password"),
                              },
                              "POST",
                            ),
                          )
                        }
                      >
                        <h3>Create owner login</h3>
                        <Text
                          name="email"
                          label="Email"
                          type="email"
                          required
                        />
                        <Text name="displayName" label="Name" required />
                        <Text
                          name="password"
                          label="Password"
                          type="password"
                          required
                        />
                        <button disabled={!detail.authManagementAvailable}>
                          Create login
                        </button>
                      </form>
                    </>
                  )}
                  {tab === "Subscription" && (
                    <>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (d) => {
                            const setup = priceToMinor(String(d.get("setup"))),
                              recurring = priceToMinor(
                                String(d.get("recurring")),
                              );
                            if (setup === null || recurring === null)
                              throw Error(
                                "Enter amounts with up to two decimal places.",
                              );
                            await update("/subscription", {
                              plan: d.get("plan"),
                              setupAmountMinor: setup,
                              recurringAmountMinor: recurring,
                              billingCycle: d.get("cycle"),
                              paymentStatus: d.get("paid"),
                              trialStartedAt: iso(d.get("start")),
                              trialEndsAt: iso(d.get("end")),
                              expiresAt: iso(d.get("expires")),
                            });
                          })
                        }
                      >
                        <Text
                          name="plan"
                          label="Plan name"
                          value={detail.subscription?.plan ?? "pilot"}
                          required
                        />
                        <Text
                          name="setup"
                          label="Setup amount (₹)"
                          value={priceInput(
                            detail.subscription?.setup_amount_minor ?? 0,
                          )}
                          required
                        />
                        <Text
                          name="recurring"
                          label="Recurring amount (₹)"
                          value={priceInput(
                            detail.subscription?.recurring_amount_minor ?? 0,
                          )}
                          required
                        />
                        <label>
                          Billing cycle
                          <select
                            aria-label="Billing cycle"
                            name="cycle"
                            defaultValue={
                              detail.subscription?.billing_cycle ?? "MONTHLY"
                            }
                          >
                            <option>MONTHLY</option>
                            <option>YEARLY</option>
                          </select>
                        </label>
                        <label>
                          Payment status
                          <select
                            aria-label="Payment status"
                            name="paid"
                            defaultValue={
                              detail.subscription?.payment_status ?? "UNPAID"
                            }
                          >
                            <option>UNPAID</option>
                            <option>PAID</option>
                          </select>
                        </label>
                        <Text
                          name="start"
                          label="Trial start (your local time)"
                          type="datetime-local"
                          value={localDate(
                            detail.subscription?.trial_started_at,
                          )}
                        />
                        <Text
                          name="end"
                          label="Trial end (your local time)"
                          type="datetime-local"
                          value={localDate(detail.subscription?.trial_ends_at)}
                        />
                        <Text
                          name="expires"
                          label="Subscription expiry (your local time)"
                          type="datetime-local"
                          value={localDate(detail.subscription?.expires_at)}
                        />
                        <button>Save subscription</button>
                      </form>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (d) =>
                            update(
                              "/trial",
                              {
                                action: d.get("action"),
                                days: Number(d.get("days")),
                              },
                              "POST",
                            ),
                          )
                        }
                      >
                        <h3>Trial controls</h3>
                        <label>
                          Action
                          <select aria-label="Trial action" name="action">
                            <option>START</option>
                            <option>EXTEND</option>
                            <option>END</option>
                          </select>
                        </label>
                        <label>
                          Days
                          <input
                            name="days"
                            type="number"
                            min="1"
                            max="365"
                            defaultValue="14"
                            required
                          />
                        </label>
                        <button>Apply trial action</button>
                      </form>
                      <form
                        data-clear
                        onSubmit={(e) =>
                          submit(e, async (d) => {
                            const amount = priceToMinor(
                              String(d.get("amount")),
                            );
                            if (amount === null || amount === 0)
                              throw Error("Enter a payment greater than zero.");
                            receiptKey.current ||= crypto.randomUUID();
                            await update(
                              "/receipts",
                              {
                                amountMinor: amount,
                                kind: d.get("kind"),
                                idempotencyKey: receiptKey.current,
                              },
                              "POST",
                            );
                            receiptKey.current = "";
                          })
                        }
                      >
                        <h3>Record received payment</h3>
                        <p>
                          Manual receipt only. No charge is made. These receipts
                          produce the monthly collections figure.
                        </p>
                        <Text
                          name="amount"
                          label="Amount received (₹)"
                          required
                        />
                        <label>
                          Payment for
                          <select aria-label="Payment for" name="kind">
                            <option>RECURRING</option>
                            <option>SETUP</option>
                          </select>
                        </label>
                        <button>Record payment</button>
                      </form>
                      <h3>Recent receipts</h3>
                      {detail.receipts.map((r: any) => (
                        <article key={r.id} className="admin-subcard">
                          <p>
                            {money(r.amount_minor)} · {r.kind} ·{" "}
                            {stamp(r.paid_at)} {r.voided_at ? "· Voided" : ""}
                          </p>
                          {!r.voided_at && (
                            <form
                              onSubmit={(e) =>
                                submit(e, async (d) =>
                                  update(
                                    `/receipts/${r.id}/void`,
                                    { reason: d.get("reason") },
                                    "POST",
                                  ),
                                )
                              }
                            >
                              <Text
                                name="reason"
                                label="Reason to void receipt"
                                required
                              />
                              <button>Void receipt</button>
                            </form>
                          )}
                        </article>
                      ))}
                    </>
                  )}
                  {tab === "Features" && (
                    <>
                      <h3>Feature access</h3>
                      <p>
                        Flags reserve access; enabling an unfinished feature
                        does not build or connect it. QR mode is controlled in
                        Profile.
                      </p>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (d) =>
                            update("/features", {
                              flags: Object.fromEntries(
                                detail.featureCatalog.map((f: any) => [
                                  f.key,
                                  d.has(f.key),
                                ]),
                              ),
                            }),
                          )
                        }
                      >
                        {detail.featureCatalog.map((f: any) => (
                          <label className="admin-subcard" key={f.key}>
                            <span>
                              <input
                                type="checkbox"
                                name={f.key}
                                defaultChecked={
                                  detail.settings?.feature_flags?.[f.key] ===
                                  true
                                }
                              />
                              {f.name}
                            </span>
                            <small>{f.note}</small>
                          </label>
                        ))}
                        <button>Save feature access</button>
                      </form>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (d) =>
                            update("/features", {
                              flags: {
                                [String(d.get("key"))]: d.has("enabled"),
                              },
                            }),
                          )
                        }
                      >
                        <h3>Future premium access</h3>
                        <Text
                          name="key"
                          label="Feature key (premium_ followed by lowercase letters, digits or underscores)"
                          required
                        />
                        <label>
                          <input name="enabled" type="checkbox" />
                          Enabled
                        </label>
                        <button>Save premium flag</button>
                      </form>
                      <pre>
                        {JSON.stringify(
                          detail.settings?.feature_flags,
                          null,
                          2,
                        )}
                      </pre>
                    </>
                  )}
                  {tab === "Usage" && (
                    <>
                      <h3>Restaurant usage</h3>
                      <dl>
                        {Object.entries(detail.usage).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k.replaceAll("_", " ")}</dt>
                            <dd>
                              {k.startsWith("last_")
                                ? stamp(v as string)
                                : v === null
                                  ? "Not configured"
                                  : String(v)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p>
                        Order counters use the restaurant time zone. Activity is
                        updated at most once per minute on authenticated
                        restaurant requests.
                      </p>
                    </>
                  )}
                  {tab === "Support" && (
                    <>
                      <h3>Support tools</h3>
                      <details>
                        <summary>Restaurant configuration</summary>
                        <pre>
                          {JSON.stringify(
                            {
                              restaurant: detail.restaurant,
                              settings: detail.settings,
                              subscription: detail.subscription,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                      <h3>Reset staff PIN</h3>
                      {detail.staff.length === 0 && (
                        <p>No staff accounts yet.</p>
                      )}
                      {detail.staff.map((s: any) => (
                        <form
                          data-clear
                          key={s.id}
                          onSubmit={(e) =>
                            submit(e, async (d) =>
                              update(
                                `/staff/${s.id}/reset-pin`,
                                { pin: d.get("pin") },
                                "POST",
                              ),
                            )
                          }
                        >
                          <strong>
                            {s.name} · {s.role}
                          </strong>
                          <label>
                            New PIN (6–8 digits)
                            <input
                              name="pin"
                              type="password"
                              inputMode="numeric"
                              pattern="[0-9]{6,8}"
                              required
                              autoComplete="new-password"
                            />
                          </label>
                          <button>Reset PIN and revoke staff sessions</button>
                        </form>
                      ))}
                      <h3>Table QR setup</h3>
                      <p>
                        QR ordering must be enabled. Regenerating invalidates
                        the previous table code and guest capabilities. Customer
                        ordering is not built yet.
                      </p>
                      {tables.map((t) => (
                        <article className="admin-subcard" key={t.id}>
                          <strong>{t.label ?? t.name}</strong>
                          <button
                            disabled={
                              !detail.settings?.qr_ordering_enabled || !t.active
                            }
                            onClick={() =>
                              void run(async () => {
                                const q = await api.current(
                                  `/admin/restaurants/${detail.restaurant.id}/tables/${t.id}/qr`,
                                );
                                setQr(q);
                                const QR = await import("qrcode");
                                setQrImage(
                                  await QR.toDataURL(
                                    q.url ?? q.previewUrl ?? q.setupUrl,
                                  ),
                                );
                              })
                            }
                          >
                            Preview QR
                          </button>
                          <form
                            onSubmit={(e) =>
                              submit(e, async (d) => {
                                await update(
                                  `/tables/${t.id}/regenerate-qr`,
                                  { reason: d.get("reason") },
                                  "POST",
                                );
                                setQr(null);
                                setQrImage("");
                              })
                            }
                          >
                            <Text
                              name="reason"
                              label="QR regeneration reason"
                              required
                            />
                            <button
                              disabled={
                                !detail.settings?.qr_ordering_enabled ||
                                !t.active
                              }
                            >
                              Regenerate table QR
                            </button>
                          </form>
                        </article>
                      ))}
                      {qr && (
                        <div>
                          {qrImage && (
                            <img
                              src={qrImage}
                              width={200}
                              height={200}
                              alt="Table QR setup preview"
                            />
                          )}
                          <p>{qr.label} · Setup preview</p>
                          <a href={qrImage} download="table-qr-preview.png">
                            Download QR preview
                          </a>
                        </div>
                      )}
                      <h3>Troubleshooting</h3>
                      <p>
                        Check account status, trial/expiry dates, membership
                        access and purchased feature flags. Use audit history
                        for changes and sanitized error logs for request
                        references.
                      </p>
                      <button onClick={() => void showLogs("audit", true)}>
                        View restaurant audit
                      </button>
                    </>
                  )}
                </fieldset>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

"use client";
import { useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Button } from "../components/ui/button";
type Membership = {
  restaurant_id: string;
  name: string;
  role: string;
  status: string;
};
type Account = {
  userId: string;
  platformAdmin: boolean;
  memberships: Membership[];
};
type Restaurant = { id: string; name: string; slug: string; status: string };
type Settings = {
  address: string | null;
  qr_ordering_enabled: boolean;
  customer_bill_visible: boolean;
  waiter_all_tables: boolean;
};
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export default function Page() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  async function request(
    path: string,
    access = token,
    method = "GET",
    body?: unknown,
  ) {
    const fresh = await client?.auth.getSession();
    const active = fresh?.data.session?.access_token ?? access;
    const res = await fetch(`${api}/v1${path}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${active}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
      throw new Error(
        res.status === 403
          ? "Your account cannot access this action."
          : res.status === 401
            ? "Your session expired. Please sign in again."
            : `Request failed (${res.status}).`,
      );
    return res.json();
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to complete action.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
        key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error("Sign-in is not configured yet.");
      const auth =
        client ??
        createClient(url, key, {
          auth: {
            persistSession: false,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });
      setClient(auth);
      const { data: result, error } = await auth.auth.signInWithPassword({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      if (error || !result.session)
        throw new Error("Could not sign in. Check your email and password.");
      const access = result.session.access_token;
      const me: Account = await request("/me", access);
      setToken(access);
      setAccount(me);
      if (me.platformAdmin)
        setRestaurants(await request("/admin/restaurants", access));
    });
  }
  async function choose(restaurant: Restaurant) {
    await run(async () => {
      const fresh = await client?.auth.getSession();
      const access = fresh?.data.session?.access_token ?? token;
      setToken(access);
      const data: Settings = await request(
        `/restaurants/${restaurant.id}/settings`,
        access,
      );
      setSelected(restaurant);
      setSettings(data);
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      await request(`/restaurants/${selected!.id}/settings`, token, "PATCH", {
        address: String(data.get("address")),
        customerBillVisible: data.has("bill"),
        waiterAllTables: data.has("tables"),
      });
      setMessage("Restaurant settings saved.");
    });
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await run(async () => {
      await request("/admin/restaurants", token, "POST", {
        name: String(data.get("name")),
        slug: String(data.get("slug")),
        ownerName: String(data.get("ownerName")),
        ownerUserId: String(data.get("ownerId")),
        qrOrderingEnabled: data.has("qr"),
      });
      setRestaurants(await request("/admin/restaurants"));
      form.reset();
      setMessage("Restaurant created with owner access.");
    });
  }
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-stone-200 px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-950 text-xl font-bold text-lime-100">
            T
          </span>
          <span className="text-xl font-bold tracking-tight">
            tablehouse<span className="text-lime-700">.</span>
          </span>
        </div>
        <span className="rounded-full border border-emerald-900/15 px-3 py-1 text-xs font-semibold">
          Restaurant workspace
        </span>
      </header>
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-12 lg:grid-cols-[1fr_1.2fr] lg:py-20">
        <section>
          <p className="mb-5 text-xs font-bold tracking-[.2em] text-emerald-700">
            A LITTLE LESS BUSYWORK
          </p>
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Your restaurant.
            <br />
            Working together.
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-stone-600">
            One workspace for your team, your tables, and every order in
            between.
          </p>
          <div className="mt-12 space-y-6 border-t border-stone-200 pt-7">
            {[
              [
                "01",
                "A place for every role",
                "Owners, waiters and kitchen staff work together.",
              ],
              [
                "02",
                "Every visit, kept separate",
                "A fresh table session for each customer group.",
              ],
              [
                "03",
                "One connected bill",
                "Additional orders belong to the same visit.",
              ],
            ].map(([n, title, description]) => (
              <div key={n} className="flex gap-4">
                <span className="pt-1 text-xs text-stone-400">{n}</span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-stone-500">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-10 text-xs leading-5 text-stone-500">
            Pilot setup · Account and restaurant management are available.
            <br />
            Ordering and kitchen workflows are coming in the next phase.
          </p>
        </section>
        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-9">
          {!account ? (
            <>
              <span className="text-xs font-semibold text-emerald-700">
                OWNER & PLATFORM ACCESS
              </span>
              <h2 className="mt-3 text-2xl font-semibold">Welcome back</h2>
              <p className="mt-2 text-sm text-stone-500">
                Sign in with the account provided during setup.
              </p>
              <form onSubmit={login} className="mt-8 space-y-5">
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@restaurant.com"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <Button disabled={busy} className="w-full">
                  {busy ? "Signing in…" : "Sign in to your workspace"}
                </Button>
              </form>
              <p className="mt-6 text-xs leading-5 text-stone-500">
                Need access? Contact your platform administrator.
                <br />
                Staff PIN and customer QR access will be added separately.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-emerald-700">
                    {account.platformAdmin
                      ? "PLATFORM ADMIN"
                      : "YOUR RESTAURANTS"}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">Workspace</h2>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await client?.auth.signOut();
                      setToken("");
                      setAccount(null);
                      setSelected(null);
                      setSettings(null);
                      setRestaurants([]);
                    })
                  }
                >
                  Sign out
                </Button>
              </div>
              <div className="mt-6 space-y-3">
                {(account.platformAdmin
                  ? restaurants
                  : account.memberships
                      .filter((m) => m.role === "OWNER")
                      .map((m) => ({
                        id: m.restaurant_id,
                        name: m.name,
                        status: m.status,
                        slug: "",
                      }))
                ).map((r) => (
                  <button
                    disabled={busy}
                    key={r.id}
                    onClick={() => choose(r)}
                    className="flex w-full items-center justify-between rounded-xl border border-stone-200 p-4 text-left"
                  >
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-xs text-stone-500">{r.status} →</span>
                  </button>
                ))}
                {!account.platformAdmin && account.memberships.length === 0 && (
                  <p>No restaurant access has been assigned yet.</p>
                )}
              </div>
              {selected && settings && (
                <form
                  key={selected.id}
                  onSubmit={save}
                  className="mt-8 space-y-4 border-t border-stone-200 pt-6"
                >
                  <h3 className="font-semibold">{selected.name} settings</h3>
                  <label>
                    Address
                    <textarea
                      name="address"
                      defaultValue={settings.address ?? ""}
                      key={selected.id}
                    />
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="bill"
                      defaultChecked={settings.customer_bill_visible}
                    />
                    Show running bill to customers
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="tables"
                      defaultChecked={settings.waiter_all_tables}
                    />
                    Waiters can see all tables
                  </label>
                  <p className="text-xs text-stone-500">
                    QR ordering:{" "}
                    {settings.qr_ordering_enabled ? "Enabled" : "Disabled"}
                  </p>
                  <Button disabled={busy}>Save settings</Button>
                  {account.platformAdmin && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await request(
                              `/admin/restaurants/${selected.id}`,
                              token,
                              "PATCH",
                              {
                                status:
                                  selected.status === "SUSPENDED"
                                    ? "ACTIVE"
                                    : "SUSPENDED",
                                qrOrderingEnabled: settings.qr_ordering_enabled,
                              },
                            );
                            setRestaurants(await request("/admin/restaurants"));
                            setSelected(null);
                            setSettings(null);
                          })
                        }
                      >
                        {selected.status === "SUSPENDED"
                          ? "Activate restaurant"
                          : "Suspend restaurant"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await request(
                              `/admin/restaurants/${selected.id}`,
                              token,
                              "PATCH",
                              {
                                status: selected.status,
                                qrOrderingEnabled:
                                  !settings.qr_ordering_enabled,
                              },
                            );
                            setSettings({
                              ...settings,
                              qr_ordering_enabled:
                                !settings.qr_ordering_enabled,
                            });
                          })
                        }
                      >
                        Toggle QR access
                      </Button>
                    </div>
                  )}
                </form>
              )}
              {account.platformAdmin && (
                <form
                  onSubmit={create}
                  className="mt-8 space-y-4 border-t border-stone-200 pt-6"
                >
                  <h3 className="font-semibold">Add a restaurant</h3>
                  <label>
                    Restaurant name
                    <input name="name" maxLength={120} required />
                  </label>
                  <label>
                    URL slug
                    <input
                      name="slug"
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      required
                    />
                  </label>
                  <label>
                    Owner name
                    <input name="ownerName" required />
                  </label>
                  <label>
                    Owner Auth user ID
                    <input
                      name="ownerId"
                      required
                      placeholder="UUID from Supabase Authentication"
                    />
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" name="qr" />
                    Enable QR ordering
                  </label>
                  <Button disabled={busy}>Create restaurant</Button>
                </form>
              )}
            </>
          )}
          {message && (
            <p
              role="status"
              className="mt-6 rounded-xl bg-stone-100 p-4 text-sm"
            >
              {message}
            </p>
          )}
        </section>
      </div>
      <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-stone-500">
        Tablehouse · Restaurant pilot
      </footer>
    </main>
  );
}

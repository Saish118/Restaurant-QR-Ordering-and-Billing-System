"use client";
import { useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Button } from "../components/ui/button";
import { useLanguage } from "../lib/i18n/provider";
import { languages, type MessageKey } from "../lib/i18n/messages";
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
class ActionError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
  }
}
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export default function Page() {
  const { language, setLanguage, t } = useLanguage();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [isError, setIsError] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [ownAccount, setOwnAccount] = useState(true);
  const [confirmPause, setConfirmPause] = useState(false);
  const statusLabels: Record<string, string> = {
    TRIAL: t.trial,
    ACTIVE: t.active,
    SUSPENDED: t.suspended,
    CLOSED: t.closed,
  };
  async function request(
    path: string,
    access = token,
    method = "GET",
    body?: unknown,
  ) {
    const fresh = await client?.auth.getSession();
    const active = fresh?.data.session?.access_token ?? access;
    let res: Response;
    try {
      res = await fetch(`${api}/v1${path}`, {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${active}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ActionError("network");
    }
    if (!res.ok)
      throw new ActionError(
        res.status === 403
          ? "forbidden"
          : res.status === 401
            ? "expired"
            : res.status === 409
              ? "conflict"
              : res.status === 400
                ? "invalid"
                : "failed",
      );
    return res.json();
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setIsError(false);
    try {
      await work();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof ActionError ? error.key : "failed");
    } finally {
      setBusy(false);
    }
  }
  function valid(form: HTMLFormElement) {
    if (form.checkValidity()) return true;
    setIsError(true);
    setMessage(
      (form.elements.namedItem("email") as HTMLInputElement | null)?.validity
        .typeMismatch
        ? "invalidEmail"
        : "required",
    );
    return false;
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid(event.currentTarget)) return;
    const data = new FormData(event.currentTarget);
    await run(async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
        key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new ActionError("notConfigured");
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
      if (error || !result.session) throw new ActionError("loginFailed");
      const access = result.session.access_token;
      const me: Account = await request("/me", access);
      const list: Restaurant[] = me.platformAdmin
        ? await request("/admin/restaurants", access)
        : [];
      setToken(access);
      setRestaurants(list);
      setAccount(me);
    });
  }
  async function choose(restaurant: Restaurant) {
    await run(async () => {
      const data: Settings = await request(
        `/restaurants/${restaurant.id}/settings`,
      );
      setSelected(restaurant);
      setSettings(data);
      setConfirmPause(false);
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
      setMessage("saved");
    });
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!valid(form)) return;
    const data = new FormData(form);
    await run(async () => {
      await request("/admin/restaurants", token, "POST", {
        name: String(data.get("name")),
        slug: String(data.get("slug")),
        ownerName: String(data.get("ownerName")),
        ownerUserId: ownAccount ? account!.userId : String(data.get("ownerId")),
        qrOrderingEnabled: data.has("qr"),
      });
      setRestaurants(await request("/admin/restaurants"));
      form.reset();
      setMessage("created");
    });
  }
  async function updateAccess(pause: boolean) {
    await run(async () => {
      await request(`/admin/restaurants/${selected!.id}`, token, "PATCH", {
        status: pause ? "SUSPENDED" : "ACTIVE",
        qrOrderingEnabled: settings!.qr_ordering_enabled,
      });
      setRestaurants(await request("/admin/restaurants"));
      setSelected(null);
      setSettings(null);
      setConfirmPause(false);
      setMessage("changed");
    });
  }
  const restaurantList = account?.platformAdmin
    ? restaurants
    : (account?.memberships
        .filter((m) => m.role === "OWNER")
        .map((m) => ({
          id: m.restaurant_id,
          name: m.name,
          status: m.status,
          slug: "",
        })) ?? []);
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 border-b border-stone-200 px-5 py-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-xl bg-emerald-950 text-xl font-bold text-lime-100"
          >
            T
          </span>
          <span className="text-xl font-bold tracking-tight">{t.appName}</span>
        </div>
        <fieldset className="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">
          <legend className="sr-only">Language / भाषा</legend>
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={language === l.code}
              onClick={() => setLanguage(l.code)}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-emerald-700 ${language === l.code ? "bg-white text-emerald-900 shadow-sm" : "text-stone-600 hover:bg-white/70"}`}
            >
              {l.name}
            </button>
          ))}
        </fieldset>
      </header>
      <div
        className={`mx-auto px-5 py-8 sm:py-12 ${account ? "max-w-3xl" : "max-w-lg"}`}
      >
        {!account ? (
          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-9">
            <p className="mb-3 text-sm font-medium text-emerald-700">
              {t.workspace}
            </p>
            <h1 className="text-3xl font-semibold leading-normal tracking-tight">
              {t.welcome}
            </h1>
            <p className="mt-2 leading-7 text-stone-600">{t.loginHelp}</p>
            <form
              method="post"
              noValidate
              onSubmit={login}
              className="mt-7 space-y-5"
              aria-busy={busy}
            >
              <label>
                {t.email}
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </label>
              <label>
                {t.password}
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="flex items-center gap-3 font-normal">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                {t.showPassword}
              </label>
              <Button disabled={busy} className="w-full text-base">
                {busy ? t.signingIn : t.signIn}
              </Button>
            </form>
            <p className="mt-6 text-sm leading-6 text-stone-500">
              {t.accessHelp}
            </p>
          </section>
        ) : (
          <>
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-emerald-700">
                  {account.platformAdmin ? t.admin : t.owner}
                </p>
                <h1 className="mt-1 text-2xl font-semibold leading-normal">
                  {selected ? selected.name : t.yourRestaurants}
                </h1>
                {!selected && (
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {t.chooseRestaurant}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { error } = await client!.auth.signOut();
                    if (error) throw new ActionError("failed");
                    setToken("");
                    setAccount(null);
                    setSelected(null);
                    setSettings(null);
                    setRestaurants([]);
                    setShowPassword(false);
                  })
                }
              >
                {t.signOut}
              </Button>
            </div>
            {!selected ? (
              <>
                <section className="space-y-3" aria-label={t.yourRestaurants}>
                  {restaurantList.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-stone-200 bg-white p-1"
                    >
                      <button
                        disabled={busy}
                        onClick={() => choose(r)}
                        className="flex min-h-20 w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-700"
                      >
                        <span className="font-semibold">{r.name}</span>
                        <span className="flex shrink-0 items-center gap-3 text-sm text-stone-600">
                          <span>{statusLabels[r.status] ?? t.status}</span>
                          <span aria-hidden>→</span>
                        </span>
                      </button>
                    </div>
                  ))}
                  {restaurantList.length === 0 && (
                    <p className="rounded-2xl border border-stone-200 bg-white p-6 leading-7">
                      {account.platformAdmin
                        ? t.noRestaurants
                        : account.memberships.length
                          ? t.ownerOnly
                          : t.noAccess}
                    </p>
                  )}
                </section>
                {account.platformAdmin && (
                  <details className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
                    <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                      + {t.addRestaurant}
                    </summary>
                    <form
                      method="post"
                      noValidate
                      onSubmit={create}
                      className="mt-5 space-y-5"
                      aria-busy={busy}
                    >
                      <label>
                        {t.restaurantName}
                        <input name="name" maxLength={120} required />
                      </label>
                      <label>
                        {t.slug}
                        <input
                          name="slug"
                          pattern="[a-z0-9]+(-[a-z0-9]+)*"
                          maxLength={100}
                          autoCapitalize="none"
                          spellCheck={false}
                          aria-describedby="slug-help"
                          required
                        />
                      </label>
                      <p
                        id="slug-help"
                        className="text-sm leading-6 text-stone-500"
                      >
                        {t.slugHelp}
                      </p>
                      <label>
                        {t.ownerName}
                        <input name="ownerName" maxLength={120} required />
                      </label>
                      <label className="flex items-center gap-3 font-normal">
                        <input
                          type="checkbox"
                          checked={ownAccount}
                          onChange={(e) => setOwnAccount(e.target.checked)}
                        />
                        {t.useMyAccount}
                      </label>
                      {!ownAccount && (
                        <label>
                          {t.ownerId}
                          <input
                            name="ownerId"
                            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                            aria-describedby="owner-help"
                            required
                          />
                          <span
                            id="owner-help"
                            className="text-sm font-normal leading-6 text-stone-500"
                          >
                            {t.ownerIdHelp}
                          </span>
                        </label>
                      )}
                      <label className="flex items-center gap-3 font-normal">
                        <input type="checkbox" name="qr" />
                        {t.enableQr}
                      </label>
                      <Button disabled={busy} className="w-full sm:w-auto">
                        {busy ? t.saving : t.createRestaurant}
                      </Button>
                    </form>
                  </details>
                )}
              </>
            ) : (
              settings && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelected(null);
                      setSettings(null);
                      setMessage(null);
                      setConfirmPause(false);
                    }}
                    className="mb-5 min-h-11 text-sm font-semibold text-emerald-800"
                  >
                    ← {t.back}
                  </button>
                  <form
                    method="post"
                    key={selected.id}
                    onSubmit={save}
                    className="space-y-5 rounded-2xl border border-stone-200 bg-white p-6"
                    aria-busy={busy}
                  >
                    <h2 className="text-lg font-semibold">{t.settings}</h2>
                    <label>
                      {t.address}
                      <textarea
                        name="address"
                        rows={3}
                        maxLength={500}
                        defaultValue={settings.address ?? ""}
                      />
                    </label>
                    <label className="flex items-center gap-3 font-normal">
                      <input
                        type="checkbox"
                        name="bill"
                        defaultChecked={settings.customer_bill_visible}
                      />
                      {t.showBill}
                    </label>
                    <label className="flex items-center gap-3 font-normal">
                      <input
                        type="checkbox"
                        name="tables"
                        defaultChecked={settings.waiter_all_tables}
                      />
                      {t.allTables}
                    </label>
                    <p className="text-sm leading-6">
                      {t.qrOrdering}:{" "}
                      <strong>
                        {settings.qr_ordering_enabled ? t.enabled : t.disabled}
                      </strong>
                    </p>
                    <Button disabled={busy} className="w-full sm:w-auto">
                      {busy ? t.saving : t.save}
                    </Button>
                  </form>
                  {account.platformAdmin && (
                    <details className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
                      <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                        {t.adminControls}
                      </summary>
                      <p className="my-4 text-sm leading-6 text-stone-500">
                        {t.qrNotice}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Button
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
                              setMessage("changed");
                            })
                          }
                        >
                          {settings.qr_ordering_enabled
                            ? t.turnQrOff
                            : t.turnQrOn}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            selected.status === "SUSPENDED"
                              ? updateAccess(false)
                              : setConfirmPause(true)
                          }
                        >
                          {selected.status === "SUSPENDED"
                            ? t.activate
                            : t.suspend}
                        </Button>
                      </div>
                      {confirmPause && (
                        <div
                          role="group"
                          aria-label={t.confirmPause}
                          className="mt-5 rounded-xl bg-amber-50 p-4"
                        >
                          <p className="mb-4 leading-7">{t.confirmPause}</p>
                          <div className="flex flex-wrap gap-3">
                            <Button
                              disabled={busy}
                              onClick={() => updateAccess(true)}
                            >
                              {t.confirm}
                            </Button>
                            <Button
                              disabled={busy}
                              variant="outline"
                              onClick={() => setConfirmPause(false)}
                            >
                              {t.cancel}
                            </Button>
                          </div>
                        </div>
                      )}
                    </details>
                  )}
                </>
              )
            )}
          </>
        )}
        {message && (
          <p
            role={isError ? "alert" : "status"}
            className={`mt-5 rounded-xl border p-4 text-sm leading-7 ${isError ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}
          >
            {t[message]}
          </p>
        )}
        <footer className="mt-7 text-center text-sm leading-6 text-stone-500">
          <p>{t.pilot}</p>
          <p className="mt-1">{t.pilotHelp}</p>
        </footer>
      </div>
    </main>
  );
}

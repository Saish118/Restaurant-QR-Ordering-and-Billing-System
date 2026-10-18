"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { useLanguage } from "../lib/i18n/provider";
import { type MessageKey, formatMoney } from "../lib/i18n/messages";
import { priceToMinor, priceInput } from "../lib/money";
type Category = { id: string; name: string; sort_order: number };
type Dish = {
  id: string;
  category_id: string;
  name: string;
  price_minor: number;
  available: boolean;
  vegetarian: boolean;
  special: boolean;
};
type Table = { id: string; label: string; active: boolean };
type Call = (path: string, method?: string, body?: unknown) => Promise<any>;
export function RestaurantTools({
  restaurantId,
  view,
  platformPanel,
  qrEnabled,
  call,
}: {
  restaurantId: string;
  view: "menu" | "tables";
  platformPanel: boolean;
  qrEnabled: boolean;
  call: Call;
}) {
  const { t, language } = useLanguage(platformPanel);
  const [categories, setCategories] = useState<Category[]>([]),
    [items, setItems] = useState<Dish[]>([]),
    [tables, setTables] = useState<Table[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState<MessageKey | null>(null),
    [error, setError] = useState(false);
  const [editing, setEditing] = useState<Dish | null>(null),
    [editingCategory, setEditingCategory] = useState<Category | null>(null),
    [qr, setQr] = useState<{ label: string; svg: string } | null>(null);
  const base = `/restaurants/${restaurantId}`;
  async function load() {
    if (view === "menu") {
      const [cats, dishes] = await Promise.all([
        call(`${base}/menu/categories`),
        call(`${base}/menu/items`),
      ]);
      setCategories(cats);
      setItems(dishes);
    } else setTables(await call(`${base}/tables`));
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage(null);
    setQr(null);
    setEditing(null);
    setEditingCategory(null);
    (async () => {
      try {
        if (view === "menu") {
          const [cats, dishes] = await Promise.all([
            call(`${base}/menu/categories`),
            call(`${base}/menu/items`),
          ]);
          if (alive) {
            setCategories(cats);
            setItems(dishes);
          }
        } else {
          const rows = await call(`${base}/tables`);
          if (alive) setTables(rows);
        }
      } catch {
        if (alive) {
          setError(true);
          setMessage("failed");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [restaurantId, view]);
  async function run(work: () => Promise<void>, success: MessageKey) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setError(false);
    try {
      await work();
      await load();
      setMessage(success);
    } catch (e) {
      const key = (e as { key?: MessageKey }).key;
      setError(true);
      setMessage(key ?? "failed");
    } finally {
      setBusy(false);
    }
  }
  function required(form: HTMLFormElement) {
    if (form.checkValidity()) return true;
    setError(true);
    setMessage("required");
    return false;
  }
  async function categorySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!required(form)) return;
    const data = new FormData(form);
    await run(
      async () => {
        await call(
          `${base}/menu/categories${editingCategory ? `/${editingCategory.id}` : ""}`,
          editingCategory ? "PATCH" : "POST",
          {
            name: String(data.get("name")),
            sortOrder: editingCategory?.sort_order ?? 0,
          },
        );
        setEditingCategory(null);
        form.reset();
      },
      editingCategory ? "saved" : "categoryAdded",
    );
  }
  async function dishSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!required(form)) return;
    const data = new FormData(form);
    const price = priceToMinor(String(data.get("price")));
    if (price === null) {
      setError(true);
      setMessage("invalidPrice");
      return;
    }
    await run(async () => {
      await call(
        `${base}/menu/items${editing ? `/${editing.id}` : ""}`,
        editing ? "PATCH" : "POST",
        {
          name: String(data.get("name")),
          categoryId: String(data.get("category")),
          priceMinor: price,
          vegetarian: data.has("vegetarian"),
          special: data.has("special"),
          available: data.has("available"),
        },
      );
      setEditing(null);
      form.reset();
    }, "dishSaved");
  }
  async function tableSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!required(form)) return;
    const data = new FormData(form);
    await run(async () => {
      await call(`${base}/tables`, "POST", {
        label: String(data.get("label")),
      });
      form.reset();
    }, "tableAdded");
  }
  return (
    <section
      className="space-y-5"
      aria-label={view === "menu" ? t.menu : t.diningTables}
    >
      {loading ? (
        <p role="status" className="p-5">
          {t.loading}
        </p>
      ) : view === "menu" ? (
        <>
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="mb-4 text-lg font-semibold">{t.categories}</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  type="button"
                  disabled={busy}
                  key={c.id}
                  onClick={() => setEditingCategory(c)}
                  className="min-h-11 rounded-xl border border-stone-200 px-3 text-sm"
                  aria-label={`${t.editCategory}: ${c.name}`}
                >
                  {c.name} · {t.edit}
                </button>
              ))}
            </div>
            <form
              method="post"
              noValidate
              key={editingCategory?.id ?? "new-category"}
              onSubmit={categorySubmit}
              className="space-y-4"
            >
              <label>
                {t.categoryName}
                <input
                  name="name"
                  defaultValue={editingCategory?.name ?? ""}
                  maxLength={120}
                  required
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy}>
                  {editingCategory ? t.save : t.addCategory}
                </Button>
                {editingCategory && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    type="button"
                    onClick={() => setEditingCategory(null)}
                  >
                    {t.cancel}
                  </Button>
                )}
              </div>
            </form>
          </section>
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="mb-4 text-lg font-semibold">
              {editing ? t.editDish : t.addDish}
            </h2>
            {!categories.length ? (
              <p className="leading-7 text-stone-600">{t.categoryFirst}</p>
            ) : (
              <form
                method="post"
                noValidate
                key={editing?.id ?? "new-dish"}
                onSubmit={dishSubmit}
                className="space-y-4"
              >
                <label>
                  {t.dishName}
                  <input
                    name="name"
                    maxLength={160}
                    defaultValue={editing?.name ?? ""}
                    required
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    {t.category}
                    <select
                      aria-label={t.category}
                      name="category"
                      defaultValue={editing?.category_id ?? ""}
                      required
                    >
                      <option value="">{t.selectCategory}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.price}
                    <input
                      name="price"
                      inputMode="decimal"
                      defaultValue={
                        editing ? priceInput(editing.price_minor) : ""
                      }
                      required
                    />
                  </label>
                </div>
                <label>
                  <input
                    type="checkbox"
                    name="vegetarian"
                    defaultChecked={editing?.vegetarian ?? true}
                  />
                  {t.vegetarian}
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="special"
                    defaultChecked={editing?.special ?? false}
                  />
                  {t.specialDish}
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="available"
                    defaultChecked={editing?.available ?? true}
                  />
                  {t.available}
                </label>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={busy}>
                    {editing ? t.save : t.addDish}
                  </Button>
                  {editing && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      {t.cancel}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </section>
          <section className="space-y-3" aria-label={t.menu}>
            {!items.length ? (
              <p className="p-4 text-stone-500">{t.noDishes}</p>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-stone-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">{item.name}</h3>
                      <p className="mt-1 text-sm text-stone-600">
                        {formatMoney(item.price_minor, language)} ·{" "}
                        {item.vegetarian ? t.vegetarian : t.nonVegetarian}
                        {item.special ? ` · ${t.specialDish}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-stone-500">
                        {
                          categories.find((c) => c.id === item.category_id)
                            ?.name
                        }
                      </p>
                    </div>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => setEditing(item)}
                      aria-label={`${t.editDish}: ${item.name}`}
                    >
                      {t.edit}
                    </Button>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={item.available}
                    onClick={() =>
                      run(
                        () =>
                          call(`${base}/menu/items/${item.id}`, "PATCH", {
                            available: !item.available,
                          }),
                        "dishSaved",
                      )
                    }
                    className={`mt-4 min-h-11 rounded-xl px-4 text-sm font-semibold ${item.available ? "bg-emerald-50 text-emerald-900" : "bg-stone-100 text-stone-600"}`}
                  >
                    {item.available ? t.available : t.unavailable}
                  </button>
                </article>
              ))
            )}
          </section>
        </>
      ) : (
        <>
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="mb-4 text-lg font-semibold">{t.addTable}</h2>
            <form
              method="post"
              noValidate
              onSubmit={tableSubmit}
              className="space-y-4"
            >
              <label>
                {t.tableName}
                <input name="label" maxLength={60} required />
              </label>
              <Button disabled={busy}>{t.addTable}</Button>
            </form>
          </section>
          {platformPanel && !qrEnabled && (
            <p className="rounded-xl bg-amber-50 p-4 text-sm leading-7">
              {t.qrPlanRequired}
            </p>
          )}
          {tables.length === 0 ? (
            <p className="p-4 text-stone-500">{t.noTables}</p>
          ) : (
            tables.map((table) => (
              <article
                key={table.id}
                className="rounded-2xl border border-stone-200 bg-white p-5"
              >
                <h3 className="mb-4 break-words font-semibold">
                  {table.label} · {table.active ? t.enabled : t.disabled}
                </h3>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          call(`${base}/tables/${table.id}`, "PATCH", {
                            active: !table.active,
                          }),
                        "tableSaved",
                      )
                    }
                  >
                    {table.active ? t.disableTable : t.enableTable}
                  </Button>
                  {platformPanel && qrEnabled && table.active && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          setQr(
                            await call(
                              `/admin/restaurants/${restaurantId}/tables/${table.id}/qr`,
                            ),
                          );
                        }, "saved")
                      }
                    >
                      {t.previewQr}
                    </Button>
                  )}
                </div>
              </article>
            ))
          )}
          {qr && qrEnabled && platformPanel && (
            <section className="rounded-2xl border border-stone-200 bg-white p-5">
              <h2 className="font-semibold">
                {t.qrPreview}: {qr.label}
              </h2>
              <img
                className="mx-auto my-4 max-w-full"
                width={256}
                height={256}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`}
                alt={`${t.qrPreview}: ${qr.label}`}
              />
              <p className="mb-4 text-sm leading-7 text-stone-600">
                {t.qrPreviewOnly}
              </p>
              <a
                className="inline-flex min-h-11 items-center rounded-xl bg-emerald-950 px-5 text-sm font-semibold text-white"
                download="table-qr.svg"
                href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`}
              >
                {t.downloadQr}
              </a>
            </section>
          )}
        </>
      )}
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={`rounded-xl p-4 text-sm leading-7 ${error ? "bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-900"}`}
        >
          {t[message]}
        </p>
      )}
    </section>
  );
}

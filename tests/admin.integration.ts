import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
test("Super Admin lifecycle, receipts, support tools and expiry enforce tenant boundaries", async () => {
  const connection = process.env.TEST_ADMIN_DATABASE_URL;
  assert.ok(connection);
  const restricted = new URL(connection);
  restricted.searchParams.set("options", "-c role=restaurant_app");
  process.env.DATABASE_URL = restricted.toString();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
  process.env.WEB_ORIGIN = "http://localhost:3000";
  const { createApp } = await import("../apps/api/src/app");
  const { TokenVerifier, UnauthorizedException } = await import(
    "../apps/api/src/auth/auth.module"
  );
  const { IdentityAdmin } = await import(
    "../apps/api/src/super-admin/identity-admin"
  );
  const db = new Client({ connectionString: connection });
  await db.connect();
  const admin = randomUUID(),
    owner = randomUUID(),
    waiter = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  const users = [admin, owner, waiter];
  const tenants = [a, b];
  for (const id of users)
    await db.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
      id,
      "Admin integration",
    ]);
  await db.query("INSERT INTO platform_admins(user_id) VALUES($1)", [admin]);
  for (const id of tenants) {
    await db.query(
      "INSERT INTO restaurants(id,name,slug) VALUES($1,'Admin integration',$2)",
      [id, `admin-test-${id}`],
    );
    await db.query(
      "INSERT INTO restaurant_settings(restaurant_id) VALUES($1)",
      [id],
    );
    await db.query(
      "INSERT INTO subscriptions(restaurant_id,trial_ends_at) VALUES($1,now()+interval '14 days')",
      [id],
    );
  }
  await db.query(
    "INSERT INTO restaurant_users(restaurant_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'WAITER'),($4,$2,'OWNER')",
    [a, owner, waiter, b],
  );
  const app = await createApp();
  let issuedAt = Math.floor(Date.now() / 1000) - 10;
  const identities: Record<string, string> = { admin, owner, waiter };
  app.get(TokenVerifier).verify = async (token) => {
    if (!identities[token]) throw new UnauthorizedException();
    return {
      id: identities[token],
      issuedAt,
      lastSignInAt: new Date().toISOString(),
    };
  };
  const call = (
    method: "GET" | "POST" | "PATCH",
    path: string,
    token = "admin",
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/v1${path}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  const expect = async (
    method: "GET" | "POST" | "PATCH",
    path: string,
    payload?: object,
    status = 200,
    token = "admin",
  ) => {
    const r = await call(method, path, token, payload);
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  };
  const base = `/admin/restaurants/${a}`;
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await expect("GET", "/admin/overview", undefined, 403, "owner");
    await expect("GET", `${base}/management`, undefined, 403, "owner");
    await expect("GET", `${base}/management`);
    await expect("PATCH", `${base}/profile`, {
      name: "Edited restaurant",
      slug: `admin-test-${a}`,
      address: "Pune",
      contactPhone: "12345",
      gstNumber: "",
      timeZone: "Asia/Kolkata",
    });
    await expect("PATCH", `${base}/subscription`, {
      plan: "pro",
      setupAmountMinor: 50000,
      recurringAmountMinor: 150000,
      billingCycle: "YEARLY",
      paymentStatus: "UNPAID",
      trialStartedAt: null,
      trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
      expiresAt: null,
    });
    const before = Number(
      (await expect("GET", "/admin/overview")).stats.monthly_collections_minor,
    );
    const payment = {
      amountMinor: 12345,
      kind: "RECURRING",
      idempotencyKey: randomUUID(),
    };
    const receipt = await expect("POST", `${base}/receipts`, payment, 201);
    const retry = await expect("POST", `${base}/receipts`, payment, 201);
    assert.equal(receipt.id, retry.id);
    await expect(
      "POST",
      `${base}/receipts`,
      { ...payment, amountMinor: 100 },
      409,
    );
    assert.equal(
      Number(
        (await expect("GET", "/admin/overview")).stats
          .monthly_collections_minor,
      ),
      before + 12345,
    );
    await expect(
      "POST",
      `/admin/restaurants/${b}/receipts/${receipt.id}/void`,
      { reason: "Wrong tenant" },
      404,
    );
    await expect(
      "POST",
      `${base}/receipts/${receipt.id}/void`,
      { reason: "Entry corrected" },
      201,
    );
    assert.equal(
      Number(
        (await expect("GET", "/admin/overview")).stats
          .monthly_collections_minor,
      ),
      before,
    );
    await expect("PATCH", `${base}/features`, {
      flags: { waiter_portal: false, premium_exports: true },
    });
    await expect("GET", `/restaurants/${a}/tables`, undefined, 403, "waiter");
    await expect(
      "PATCH",
      `${base}/features`,
      { flags: { invented_flag: true } },
      400,
    );
    await expect(
      "PATCH",
      `${base}/features`,
      { flags: { online_payments: true } },
      403,
      "owner",
    );
    await expect("PATCH", `${base}/owners/${owner}/access`, { active: false });
    await expect("GET", `/restaurants/${a}/tables`, undefined, 403, "owner");
    await expect("GET", `/restaurants/${b}/tables`, undefined, 200, "owner");
    await expect("PATCH", `${base}/owners/${owner}/access`, { active: true });
    await expect("POST", `${base}/trial`, { action: "END" }, 201);
    await expect("GET", `/restaurants/${a}/tables`, undefined, 403, "owner");
    assert.equal(
      (await expect("GET", "/admin/restaurants")).find((r: any) => r.id === a)
        .effective_status,
      "EXPIRED",
    );
    await expect("POST", `${base}/trial`, { action: "EXTEND", days: 7 }, 201);
    await expect("GET", `/restaurants/${a}/tables`, undefined, 200, "owner");
    await db.query(
      "UPDATE subscriptions SET trial_ends_at=now()-interval '1 second' WHERE restaurant_id=$1",
      [a],
    );
    await expect("GET", `/restaurants/${a}/tables`, undefined, 403, "owner");
    await expect("POST", `${base}/trial`, { action: "START", days: 14 }, 201);
    const table = await expect(
      "POST",
      `/restaurants/${a}/tables`,
      { label: "T1" },
      201,
    );
    await expect("GET", `${base}/tables/${table.id}/qr`, undefined, 403);
    await expect("PATCH", base, { status: "TRIAL", qrOrderingEnabled: true });
    const qr = await expect("GET", `${base}/tables/${table.id}/qr`);
    await expect(
      "POST",
      `${base}/tables/${table.id}/regenerate-qr`,
      { reason: "Replace damaged code" },
      201,
    );
    assert.notEqual(
      (await expect("GET", `${base}/tables/${table.id}/qr`)).url,
      qr.url,
    );
    const staff = randomUUID();
    await db.query(
      "INSERT INTO staff(id,restaurant_id,name,role,pin_hash) VALUES($1,$2,'Test staff','WAITER','old')",
      [staff, a],
    );
    await expect(
      "POST",
      `${base}/staff/${staff}/reset-pin`,
      { pin: "836291" },
      201,
    );
    const stored = (
      await db.query("SELECT pin_hash,session_version FROM staff WHERE id=$1", [
        staff,
      ])
    ).rows[0];
    assert.ok(await argon2.verify(stored.pin_hash, "836291"));
    assert.equal(stored.session_version, 2);
    await expect(
      "POST",
      `${base}/owners/login`,
      {
        email: "owner@example.com",
        displayName: "Owner",
        password: "test-only-strong-pass",
      },
      503,
    );
    await expect(
      "POST",
      `${base}/owners/login`,
      {
        email: "owner@example.com",
        displayName: "Owner",
        password: "test-only-strong-pass",
      },
      403,
      "owner",
    );
    // Auth provider is substituted: no hosted account or password is changed by this test.
    const provider = app.get(IdentityAdmin);
    Object.defineProperty(provider, "available", { get: () => true });
    let created = 0,
      reset = 0;
    provider.create = async (email) => {
      created++;
      const id = randomUUID();
      users.push(id);
      return { id, email };
    };
    provider.reset = async () => {
      reset++;
    };
    provider.removeNewAccount = async () => {};
    await expect(
      "POST",
      `${base}/owners/login`,
      {
        email: "owner@example.com",
        displayName: "New Owner",
        password: "test-only-strong-pass",
      },
      201,
    );
    assert.equal(created, 1);
    await expect(
      "POST",
      `${base}/owners/${admin}/reset-password`,
      { password: "test-only-strong-pass" },
      404,
    );
    await expect(
      "POST",
      `${base}/owners/link`,
      { userId: admin, displayName: "Platform admin" },
      201,
    );
    await expect(
      "POST",
      `${base}/owners/${admin}/reset-password`,
      { password: "test-only-strong-pass" },
      403,
    );
    await expect(
      "POST",
      `${base}/owners/${owner}/reset-password`,
      { password: "test-only-strong-pass" },
      201,
    );
    assert.equal(reset, 1);
    await expect("GET", `/restaurants/${b}/tables`, undefined, 403, "owner");
    issuedAt = Math.ceil(Date.now() / 1000) + 1;
    await expect("GET", `/restaurants/${b}/tables`, undefined, 200, "owner");
    await expect("POST", `${base}/archive`, { reason: "Account closure" }, 201);
    await expect("GET", `/restaurants/${a}/tables`, undefined, 403, "owner");
    assert.ok(
      !(await expect("GET", "/admin/restaurants")).some((r: any) => r.id === a),
    );
    assert.ok(
      (await expect("GET", "/admin/restaurants?includeArchived=true")).some(
        (r: any) => r.id === a,
      ),
    );
    await expect(
      "PATCH",
      base,
      { status: "ACTIVE", qrOrderingEnabled: true },
      409,
    );
    await expect("POST", `${base}/restore`, {}, 201);
    assert.equal(
      (await expect("GET", `${base}/management`)).restaurant.status,
      "SUSPENDED",
    );
    const audit = await expect("GET", `/admin/audit?restaurantId=${a}`);
    assert.ok(audit.some((l: any) => l.action === "STAFF_PIN_RESET"));
    assert.ok(!JSON.stringify(audit).includes("836291"));
    assert.ok(!JSON.stringify(audit).includes("test-only-strong-pass"));
    await expect("GET", "/admin/errors", undefined, 403, "owner");
    await expect("GET", "/admin/errors");
    assert.ok((await expect("GET", `${base}/management`)).usage.last_activity);
  } finally {
    await app.close();
    for (const table of [
      "guest_capabilities",
      "staff_sessions",
      "restaurant_activity",
      "subscription_receipts",
      "audit_logs",
      "order_items",
      "orders",
      "bills",
      "dining_sessions",
      "menu_items",
      "menu_categories",
      "tables",
      "staff",
      "subscriptions",
      "restaurant_settings",
      "restaurant_users",
    ])
      await db.query(
        `DELETE FROM ${table} WHERE restaurant_id=ANY($1::uuid[])`,
        [tenants],
      );
    await db.query("DELETE FROM restaurants WHERE id=ANY($1::uuid[])", [
      tenants,
    ]);
    await db.query("DELETE FROM platform_admins WHERE user_id=$1", [admin]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.end();
  }
});

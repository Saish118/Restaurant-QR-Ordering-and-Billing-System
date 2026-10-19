import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
test("menu/table ownership, immutable price snapshots and main-admin-only QR entitlement", async () => {
  const connection = process.env.TEST_ADMIN_DATABASE_URL;
  assert.ok(connection);
  const restricted = new URL(connection);
  restricted.searchParams.set("options", "-c role=restaurant_app");
  process.env.DATABASE_URL = restricted.toString();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-key";
  process.env.WEB_ORIGIN = "http://localhost:3000";
  const { createApp } = await import("../apps/api/src/app");
  const { TokenVerifier, UnauthorizedException } = await import(
    "../apps/api/src/auth/auth.module"
  );
  const db = new Client({ connectionString: connection });
  await db.connect();
  const admin = randomUUID(),
    owner = randomUUID(),
    other = randomUUID(),
    waiter = randomUUID(),
    chef = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  const users = [admin, owner, other, waiter, chef],
    tenants = [a, b];
  for (const id of users)
    await db.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
      id,
      "Catalog test",
    ]);
  await db.query("INSERT INTO platform_admins(user_id) VALUES($1)", [admin]);
  for (const id of tenants) {
    await db.query(
      "INSERT INTO restaurants(id,name,slug) VALUES($1,'Catalog',$2)",
      [id, `catalog-${id}`],
    );
    await db.query(
      "INSERT INTO restaurant_settings(restaurant_id) VALUES($1)",
      [id],
    );
    await db.query("INSERT INTO subscriptions(restaurant_id) VALUES($1)", [id]);
  }
  for (const [id, tenant, role] of [
    [owner, a, "OWNER"],
    [other, b, "OWNER"],
    [waiter, a, "WAITER"],
    [chef, a, "CHEF"],
  ])
    await db.query(
      "INSERT INTO restaurant_users(user_id,restaurant_id,role) VALUES($1,$2,$3)",
      [id, tenant, role],
    );
  const app = await createApp();
  const tokens: Record<string, string> = { admin, owner, other, waiter, chef };
  app.get(TokenVerifier).verify = async (token) => {
    if (!tokens[token]) throw new UnauthorizedException();
    return { id: tokens[token] };
  };
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const call = (
      method: "GET" | "POST" | "PATCH",
      path: string,
      token = "owner",
      payload?: object,
    ) =>
      app.inject({
        method,
        url: `/v1${path}`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
    const base = `/restaurants/${a}`,
      otherBase = `/restaurants/${b}`;
    assert.equal(
      (
        await call("POST", "/admin/restaurants", "owner", {
          name: "Blocked",
          slug: `blocked-${a}`,
          ownerUserId: owner,
          ownerName: "Owner",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await call("PATCH", `/admin/restaurants/${a}`, "owner", {
          status: "ACTIVE",
          qrOrderingEnabled: true,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await call("PATCH", `${base}/settings`, "owner", {
          address: "A",
          customerBillVisible: false,
          waiterAllTables: true,
          qr_ordering_enabled: true,
        })
      ).statusCode,
      400,
    );
    const category = await call("POST", `${base}/menu/categories`, "owner", {
      name: "Main course",
    });
    assert.equal(category.statusCode, 201, category.body);
    const categoryId = category.json().id;
    const bCategory = await call(
      "POST",
      `${otherBase}/menu/categories`,
      "other",
      { name: "Private" },
    );
    const bCatId = bCategory.json().id;
    for (const role of ["waiter", "chef"]) {
      assert.equal(
        (
          await call("POST", `${base}/menu/categories`, role, {
            name: "Not allowed",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await call("GET", `${base}/menu/items`, role)).statusCode,
        200,
      );
    }
    assert.equal(
      (await call("GET", `${otherBase}/menu/items`)).statusCode,
      403,
    );
    assert.equal(
      (
        await call("POST", `${base}/menu/items`, "owner", {
          categoryId: bCatId,
          name: "Cross tenant",
          priceMinor: 100,
        })
      ).statusCode,
      404,
    );
    const item = await call("POST", `${base}/menu/items`, "owner", {
      categoryId,
      name: "Dish",
      priceMinor: 10050,
      taxBps: 500,
      vegetarian: false,
      special: true,
    });
    assert.equal(item.statusCode, 201, item.body);
    const itemId = item.json().id;
    assert.equal(
      (
        await call("POST", `${base}/menu/items`, "owner", {
          categoryId,
          name: "Bad price",
          priceMinor: 1.5,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call("PATCH", `${base}/menu/items/${itemId}`, "owner", {
          available: false,
        })
      ).statusCode,
      200,
    );
    const items = (await call("GET", `${base}/menu/items`)).json();
    assert.equal(items[0].available, false);
    assert.equal(items[0].vegetarian, false);
    assert.equal(items[0].special, true);
    assert.equal(items[0].tax_bps, 500);
    assert.equal(
      (
        await call("PATCH", `${otherBase}/menu/items/${itemId}`, "other", {
          priceMinor: 1,
        })
      ).statusCode,
      404,
    );
    const table = await call("POST", `${base}/tables`, "owner", {
      label: "Table 1",
    });
    assert.equal(table.statusCode, 201, table.body);
    const tableId = table.json().id;
    assert.equal(table.json().qr_reference, undefined);
    assert.equal(
      (await call("POST", `${base}/tables`, "owner", { label: "Table 1" }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await call("POST", `${base}/tables`, "owner", {
          label: "Table 2",
          qrOrderingEnabled: true,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call("PATCH", `${otherBase}/tables/${tableId}`, "other", {
          active: false,
        })
      ).statusCode,
      404,
    );
    const qrPath = `/admin/restaurants/${a}/tables/${tableId}/qr`;
    assert.equal((await call("GET", qrPath, "admin")).statusCode, 403);
    assert.equal((await call("GET", qrPath, "owner")).statusCode, 403);
    assert.equal(
      (
        await call("PATCH", `/admin/restaurants/${a}`, "admin", {
          status: "ACTIVE",
          qrOrderingEnabled: true,
        })
      ).statusCode,
      200,
    );
    const qr = await call("GET", qrPath, "admin");
    assert.equal(qr.statusCode, 200, qr.body);
    assert.ok(qr.json().svg.includes("<svg"));
    assert.ok(qr.json().url.startsWith("http://localhost:3000/qr/"));
    assert.equal((await call("GET", qrPath, "owner")).statusCode, 403);
    await call("PATCH", `/admin/restaurants/${a}`, "admin", {
      status: "ACTIVE",
      qrOrderingEnabled: false,
    });
    assert.equal((await call("GET", qrPath, "admin")).statusCode, 403);
    // Test the database guard directly under an otherwise-authorized owner context.
    for (const sql of [
      "UPDATE restaurant_settings SET qr_ordering_enabled=true WHERE restaurant_id=$1",
      "UPDATE subscriptions SET plan='QR' WHERE restaurant_id=$1",
    ]) {
      await db.query("BEGIN");
      await db.query("SET LOCAL ROLE restaurant_app");
      await db.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.restaurant_id',$2,true),set_config('app.role','OWNER',true),set_config('app.is_admin','false',true)",
        [owner, a],
      );
      await assert.rejects(
        db.query(sql, [a]),
        (e: { code: string }) => e.code === "42501",
      );
      await db.query("ROLLBACK");
    }
    const sessionId = randomUUID(),
      orderId = randomUUID();
    await db.query(
      "INSERT INTO dining_sessions(id,restaurant_id,table_id) VALUES($1,$2,$3)",
      [sessionId, a, tableId],
    );
    await db.query(
      "INSERT INTO orders(id,restaurant_id,dining_session_id,source,idempotency_key,request_hash,actor_type,actor_id) VALUES($1,$2,$3,'STAFF',$4,'test','USER',$5)",
      [orderId, a, sessionId, randomUUID(), owner],
    );
    await db.query(
      "INSERT INTO order_items(restaurant_id,order_id,menu_item_id,name_snapshot,unit_price_minor,tax_bps_snapshot,quantity) VALUES($1,$2,$3,'Dish',10050,500,1)",
      [a, orderId, itemId],
    );
    assert.equal(
      (
        await call("PATCH", `${base}/menu/items/${itemId}`, "owner", {
          priceMinor: 20990,
          name: "Renamed",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await db.query(
          "SELECT unit_price_minor FROM order_items WHERE order_id=$1",
          [orderId],
        )
      ).rows[0].unit_price_minor,
      10050,
    );
    assert.equal(
      (
        await call("PATCH", `${base}/tables/${tableId}`, "owner", {
          active: false,
        })
      ).statusCode,
      409,
    );
    await db.query(
      "UPDATE dining_sessions SET status='CLOSED',closed_at=now() WHERE id=$1",
      [sessionId],
    );
    assert.equal(
      (
        await call("PATCH", `${base}/tables/${tableId}`, "owner", {
          active: false,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await call("GET", `${base}/tables`)).json()[0].qr_reference,
      undefined,
    );
  } finally {
    await app.close();
    await db.query("ROLLBACK");
    for (const table of [
      "restaurant_activity",
      "subscription_receipts",
      "audit_logs",
      "order_items",
      "orders",
      "dining_sessions",
      "menu_items",
      "menu_categories",
      "tables",
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

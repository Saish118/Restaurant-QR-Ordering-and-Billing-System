import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
test("API tenant and role enforcement, atomic provisioning, suspension and audit", async () => {
  const connection = process.env.TEST_ADMIN_DATABASE_URL;
  assert.ok(connection, "Disposable admin connection required");
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
  const db = new Client({ connectionString: connection });
  await db.connect();
  const admin = randomUUID(),
    owner = randomUUID(),
    waiter = randomUUID(),
    chef = randomUUID(),
    outsider = randomUUID();
  const a = randomUUID(),
    b = randomUUID();
  const ids = [a, b];
  const users = [admin, owner, waiter, chef, outsider];
  for (const id of users)
    await db.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
      id,
      "API test",
    ]);
  await db.query("INSERT INTO platform_admins(user_id) VALUES($1)", [admin]);
  for (const id of ids) {
    await db.query(
      "INSERT INTO restaurants(id,name,slug) VALUES($1,'Test',$2)",
      [id, `test-${id}`],
    );
    await db.query(
      "INSERT INTO restaurant_settings(restaurant_id) VALUES($1)",
      [id],
    );
  }
  for (const [id, tenant, role] of [
    [owner, a, "OWNER"],
    [waiter, a, "WAITER"],
    [chef, a, "CHEF"],
    [outsider, b, "OWNER"],
  ])
    await db.query(
      "INSERT INTO restaurant_users(restaurant_id,user_id,role) VALUES($1,$2,$3)",
      [tenant, id, role],
    );
  const app = await createApp();
  const tokens: Record<string, string> = {
    admin,
    owner,
    waiter,
    chef,
    outsider,
  };
  app.get(TokenVerifier).verify = async (token: string) => {
    const id = tokens[token];
    if (!id) {
      throw new UnauthorizedException();
    }
    return { id };
  };
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const call = (
      method: "GET" | "PATCH" | "POST",
      url: string,
      token?: string,
      payload?: unknown,
    ) =>
      app.inject({
        method,
        url: `/v1${url}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as object | undefined,
      });
    assert.equal((await call("GET", "/me")).statusCode, 401);
    assert.equal((await call("GET", "/me", "bad")).statusCode, 401);
    assert.equal(
      (await call("GET", `/restaurants/${a}`, "owner")).statusCode,
      200,
    );
    assert.equal(
      (await call("GET", `/restaurants/${b}`, "owner")).statusCode,
      403,
    );
    assert.equal(
      (await call("GET", "/admin/restaurants", "owner")).statusCode,
      403,
    );
    for (const role of ["waiter", "chef"])
      assert.equal(
        (
          await call("PATCH", `/restaurants/${a}/settings`, role, {
            address: "x",
            customerBillVisible: true,
            waiterAllTables: true,
          })
        ).statusCode,
        403,
      );
    assert.equal(
      (
        await call("PATCH", `/restaurants/${a}/settings`, "owner", {
          address: "Updated",
          customerBillVisible: true,
          waiterAllTables: false,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await call("PATCH", `/restaurants/${a}/settings`, "owner", {
          address: "x",
          customerBillVisible: true,
          waiterAllTables: true,
          qrOrderingEnabled: true,
        })
      ).statusCode,
      400,
    );
    const created = await call("POST", "/admin/restaurants", "admin", {
      name: "Created",
      slug: `new-${a}`,
      ownerUserId: owner,
      ownerName: "Existing owner",
    });
    assert.equal(created.statusCode, 201, created.body);
    ids.push(created.json().id);
    assert.equal(
      (
        await db.query("SELECT * FROM subscriptions WHERE restaurant_id=$1", [
          ids[2],
        ])
      ).rowCount,
      1,
    );
    const duplicate = await call("POST", "/admin/restaurants", "admin", {
      name: "Duplicate",
      slug: `new-${a}`,
      ownerUserId: owner,
      ownerName: "Existing owner",
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(
      (
        await call("PATCH", `/admin/restaurants/${a}`, "admin", {
          status: "SUSPENDED",
          qrOrderingEnabled: false,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await call("GET", `/restaurants/${a}`, "owner")).statusCode,
      403,
    );
    await db.query("UPDATE users SET active=false WHERE id=$1", [outsider]);
    assert.equal((await call("GET", "/me", "outsider")).statusCode, 403);
    assert.ok(
      (await db.query("SELECT * FROM audit_logs WHERE restaurant_id=$1", [a]))
        .rowCount! >= 2,
    );
    await db.query(
      "UPDATE restaurant_users SET active=false WHERE user_id=$1 AND restaurant_id=$2",
      [owner, ids[2]],
    );
    assert.equal(
      (await call("GET", `/restaurants/${ids[2]}`, "owner")).statusCode,
      403,
    );
  } finally {
    await app.close();
    for (const table of [
      "restaurant_activity",
      "subscription_receipts",
      "audit_logs",
      "subscriptions",
      "restaurant_settings",
      "restaurant_users",
    ])
      await db.query(
        `DELETE FROM ${table} WHERE restaurant_id=ANY($1::uuid[])`,
        [ids],
      );
    await db.query("DELETE FROM restaurants WHERE id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM platform_admins WHERE user_id=$1", [admin]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.end();
  }
});

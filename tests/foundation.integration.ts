import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
// Isolated disposable database only. Everything inserted here rolls back.
test("real PostgreSQL RLS, composite ownership, session uniqueness and context reset", async () => {
  assert.ok(
    process.env.TEST_ADMIN_DATABASE_URL,
    "Set TEST_ADMIN_DATABASE_URL to disposable migrated database",
  );
  const db = new Client({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  await db.connect();
  const owner = randomUUID(),
    other = randomUUID(),
    a = randomUUID(),
    b = randomUUID(),
    ta = randomUUID(),
    tb = randomUUID();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO users(id,display_name) VALUES($1,$3),($2,$3)", [
      owner,
      other,
      "Test",
    ]);
    await db.query(
      "INSERT INTO restaurants(id,name,slug) VALUES($1,'A',$3),($2,'B',$4)",
      [a, b, `a-${a}`, `b-${b}`],
    );
    await db.query(
      "INSERT INTO restaurant_users(restaurant_id,user_id,role) VALUES($1,$3,'OWNER'),($2,$4,'OWNER')",
      [a, b, owner, other],
    );
    await db.query(
      "INSERT INTO tables(id,restaurant_id,label) VALUES($1,$3,'1'),($2,$4,'1')",
      [ta, tb, a, b],
    );
    await db.query("SET LOCAL ROLE restaurant_app");
    await db.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.restaurant_id',$2,true),set_config('app.role','OWNER',true),set_config('app.is_admin','false',true)",
      [owner, a],
    );
    assert.equal((await db.query("SELECT * FROM tables")).rows.length, 1);
    assert.equal(
      (await db.query("SELECT * FROM tables WHERE id=$1", [tb])).rows.length,
      0,
    );
    assert.equal((await db.query("SELECT * FROM restaurants")).rows.length, 1);
    async function rejected(sql: string, values: unknown[], code: string) {
      await db.query("SAVEPOINT reject");
      await assert.rejects(
        db.query(sql, values),
        (e: { code: string }) => e.code === code,
      );
      await db.query("ROLLBACK TO SAVEPOINT reject");
    }
    await rejected(
      "INSERT INTO tables(restaurant_id,label) VALUES($1,'forbidden')",
      [b],
      "42501",
    );
    await rejected(
      "INSERT INTO dining_sessions(restaurant_id,table_id) VALUES($1,$2)",
      [a, tb],
      "23503",
    );
    await db.query(
      "INSERT INTO dining_sessions(restaurant_id,table_id) VALUES($1,$2)",
      [a, ta],
    );
    await rejected(
      "INSERT INTO dining_sessions(restaurant_id,table_id) VALUES($1,$2)",
      [a, ta],
      "23505",
    );
    await rejected(
      "INSERT INTO platform_admins(user_id) VALUES($1)",
      [owner],
      "42501",
    );
    await rejected("UPDATE audit_logs SET action='tamper'", [], "42501");
    assert.equal(
      (
        await db.query(
          "UPDATE users SET active=false WHERE id=$1 RETURNING id",
          [owner],
        )
      ).rows.length,
      0,
    );
    await db.query("ROLLBACK");
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE restaurant_app");
    assert.equal((await db.query("SELECT * FROM tables")).rows.length, 0);
    await db.query("ROLLBACK");
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});

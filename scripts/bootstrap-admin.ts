import "dotenv/config";
import { Client } from "pg";
import { z } from "zod";
const userId = z.uuid().parse(process.argv[2]);
const name = z.string().min(1).max(120).parse(process.argv[3]);
if (!process.env.DIRECT_URL)
  throw new Error("DIRECT_URL migration connection required");
// Supply the UUID of a verified Supabase Auth user. Never accepts email/user metadata as privilege.
const client = new Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
    [userId, name],
  );
  await client.query(
    "INSERT INTO platform_admins(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",
    [userId],
  );
  await client.query(
    "INSERT INTO audit_logs(actor_id,action,target_id) VALUES($1,'PLATFORM_ADMIN_BOOTSTRAPPED',$1)",
    [userId],
  );
  await client.query("COMMIT");
  console.log("Platform administrator provisioned.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

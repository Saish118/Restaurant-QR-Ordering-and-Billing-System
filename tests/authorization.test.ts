import { test } from "node:test";
import assert from "node:assert/strict";
import { requireRole, uuid, parse } from "../apps/api/src/common/validation";
import { z } from "zod";
test("owner-only operations reject waiter and chef", () => {
  for (const role of ["WAITER", "CHEF", ""])
    assert.throws(() => requireRole(role, ["OWNER", "SUPER_ADMIN"]));
  requireRole("OWNER", ["OWNER", "SUPER_ADMIN"]);
});
test("UUID selectors and unknown privilege fields fail closed", () => {
  assert.throws(() => uuid("not-an-id"));
  assert.throws(() =>
    parse(z.object({ address: z.string() }).strict(), {
      address: "A",
      role: "SUPER_ADMIN",
    }),
  );
});

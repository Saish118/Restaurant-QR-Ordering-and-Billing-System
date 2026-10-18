import { test } from "node:test";
import assert from "node:assert/strict";
import { priceToMinor, priceInput } from "../apps/web/lib/money";
test("menu prices parse to integer minor units exactly", () => {
  for (const [input, want] of [
    ["0", 0],
    ["0.10", 10],
    ["125.50", 12550],
    ["10.1", 1010],
    [" 99.99 ", 9999],
  ] as const)
    assert.equal(priceToMinor(input), want);
  for (const input of ["-1", "1.234", "abc", "1e3", "Infinity", "1000001", ""])
    assert.equal(priceToMinor(input), null);
  assert.equal(priceInput(12550), "125.50");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messages,
  languages,
  preferredLanguage,
  formatMoney,
} from "../apps/web/lib/i18n/messages";
test("all UI messages are present in English Marathi and Hindi", () => {
  const keys = Object.keys(messages.en).sort();
  for (const { code } of languages) {
    assert.deepEqual(Object.keys(messages[code]).sort(), keys);
    for (const value of Object.values(messages[code]))
      assert.ok(value.trim().length > 0);
  }
});
test("saved language wins, supported browser language is detected, unknown values fall back", () => {
  assert.equal(preferredLanguage("mr", "hi-IN"), "mr");
  assert.equal(preferredLanguage(null, "hi-IN"), "hi");
  assert.equal(preferredLanguage("bad", "mr-IN"), "mr");
  assert.equal(preferredLanguage(null, "fr-FR"), "en");
});
test("money is formatted with restaurant currency in each locale", () => {
  for (const { code } of languages)
    assert.ok(formatMoney(12550, code).includes("₹"));
});

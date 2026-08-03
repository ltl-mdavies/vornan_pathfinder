import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Jobs exposes a verified Lift order recovery and replacement workflow", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /Link Lift Order/);
  assert.match(source, /Replace Lift Order Link/);
  assert.match(source, /\/lift-order-association\/verify/);
  assert.match(source, /\/lift-order-association`/);
  assert.match(source, /expected_current_order_number/);
  assert.match(source, /required_confirmation/);
  assert.match(source, /Lift order association history/);
  assert.match(source, /Pathfinder reads the order from Lift and verifies the customer/);
  assert.doesNotMatch(source, /Skip Lift verification/);
});

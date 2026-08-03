import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual Lift order association remains inside the authenticated admin API boundary", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

  assert.match(source, /app\.use\("\/api", requirePathfinderAuth\)/);
  assert.match(source, /\/api\/customers\/:liftCustomerId\/jobs\/:jobId\/lift-order-association\/verify/);
  assert.match(source, /\/api\/customers\/:liftCustomerId\/jobs\/:jobId\/lift-order-association"/);
  assert.match(source, /verifyLiftOrderAssociation/);
  assert.match(source, /expected_current_order_number/);
  assert.match(source, /status_links_rebound/);
  assert.match(source, /res\.locals\.authUser\?\.email/);
  assert.doesNotMatch(source, /\/public\/[^"'`]*lift-order-association/);
});

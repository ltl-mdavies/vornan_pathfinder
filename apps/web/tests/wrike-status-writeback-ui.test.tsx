import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("job actions present a Larger Than Life Wrike writeback with exact confirmation", () => {
  assert.match(source, /Post Status to Wrike/);
  assert.match(source, /Larger Than Life print order created successfully via Pathfinder/);
  assert.match(source, /POST \$\{selectedJobDetail\.target_order_number\} TO WRIKE/);
  assert.match(source, /source_evidence\?\.provider === "wrike"/);
  assert.match(source, /wrike-status-writeback/);
});

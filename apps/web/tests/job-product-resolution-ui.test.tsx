import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("shows the Lift product name below the resolved identifier in job review", () => {
  assert.match(appSource, /result\.resolved_product_identifier[\s\S]*?className="cell-meta"/);
  assert.match(appSource, /Lift product: \$\{result\.product_name\}/);
  assert.match(appSource, /Lift product name unavailable/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("shows the Lift product name below the resolved identifier in job review", () => {
  assert.match(appSource, /result\.resolved_product_identifier[\s\S]*?className="cell-meta"/);
  assert.match(appSource, /Lift product: \$\{result\.product_name\}/);
  assert.match(appSource, /Lift product name unavailable/);
});

test("manual product approval reports only confirmed row-level persistence", () => {
  assert.match(appSource, /productMappingSaveFeedback/);
  assert.match(appSource, /Saving this mapping…/);
  assert.match(appSource, /Mapping saved\. Regenerate the preview when all products are mapped\./);
  assert.match(appSource, /Mapping already saved\./);
  assert.match(appSource, /role=\{saveFeedback\.state === "error" \? "alert" : "status"\}/);
  assert.match(appSource, /disabled=\{saveFeedback\?\.state === "saving"\}/);
  assert.match(appSource, /Pathfinder could not confirm this mapping\. Reload before taking another action\./);
});

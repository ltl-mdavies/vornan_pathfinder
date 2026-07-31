import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appSource, styles] = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8")
]);

test("requires the exact approved-task phrase for every Wrike rehearsal action", () => {
  assert.match(appSource, /PREPARE WRIKE PREVIEW \$\{activeWrikeConfig\.approved_discovery_task_id\.trim\(\)\}/);
  assert.match(appSource, /task_id: activeWrikeConfig\.approved_discovery_task_id\.trim\(\)/);
  assert.match(appSource, /confirmation_phrase: wrikeManualIntakeConfirmation/);
  assert.match(appSource, /Confirm this one-task rehearsal/);
  assert.match(appSource, /it will not submit the order to Lift/);
});

test("keeps the rehearsal confirmation readable and responsive", () => {
  assert.match(styles, /\.wrike-manual-intake-confirmation \{/);
  assert.match(styles, /\.wrike-manual-intake-confirmation code \{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /@media[\s\S]*?\.wrike-manual-intake-confirmation \{[\s\S]*?grid-template-columns: 1fr/);
});

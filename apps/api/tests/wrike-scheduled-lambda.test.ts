import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isWrikeScheduledIntakeEvent } from "../src/wrike-scheduled-intake.js";

test("recognizes the production discovery, submit, and writeback scheduler event", () => {
  assert.equal(
    isWrikeScheduledIntakeEvent({
      source: "pathfinder.wrike",
      "detail-type": "Wrike Scheduled Intake",
      detail: { automation: "discover_prepare_submit_writeback" }
    }),
    true
  );
});

test("retains the legacy prepare-only event and rejects unrelated events", () => {
  assert.equal(
    isWrikeScheduledIntakeEvent({
      source: "pathfinder.wrike",
      "detail-type": "Wrike Scheduled Intake",
      detail: { prepare_only: true }
    }),
    true
  );
  assert.equal(
    isWrikeScheduledIntakeEvent({
      source: "pathfinder.wrike",
      "detail-type": "Wrike Scheduled Intake",
      detail: { automation: "unknown" }
    }),
    false
  );
  assert.equal(
    isWrikeScheduledIntakeEvent({
      source: "other",
      "detail-type": "Wrike Scheduled Intake",
      detail: { automation: "discover_prepare_submit_writeback" }
    }),
    false
  );
});

test("scheduled Lambda coalesces full-store reads within one invocation", async () => {
  const source = await readFile(new URL("../src/lambda.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /withPathfinderStoreReadScope\(\(\) => runConfiguredWrikeScheduledIntake\(\)\)/
  );
  assert.match(source, /recordConfiguredWrikeScheduledIntakeFailure/);
  assert.match(source, /throw error/);
  assert.doesNotMatch(source, /retry|setTimeout/);
});

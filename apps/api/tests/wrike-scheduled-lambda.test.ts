import assert from "node:assert/strict";
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

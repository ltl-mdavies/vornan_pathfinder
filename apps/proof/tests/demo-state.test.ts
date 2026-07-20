import assert from "node:assert/strict";
import test from "node:test";
import { demoActivityForHash } from "../src/demo.ts";

test("keeps reviewer activity aggregate-only in the dedicated visual QA fixture", () => {
  assert.deepEqual(demoActivityForHash("#/proof/activity-qa"), {
    identified_reviewers: 2,
    last_activity_at: "2026-07-20T17:15:00.000Z",
    reviewer_names_visible: false
  });
  assert.deepEqual(demoActivityForHash("#/proof"), {
    identified_reviewers: 0,
    last_activity_at: null,
    reviewer_names_visible: false
  });
});

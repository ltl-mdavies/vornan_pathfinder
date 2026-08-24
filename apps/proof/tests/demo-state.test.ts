import assert from "node:assert/strict";
import test from "node:test";
import { demoActivityForHash, demoOrderForHash } from "../src/demo.ts";

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

test("keeps the revised-art upload visual QA fixture scoped to one current attachment", () => {
  const order = demoOrderForHash("#/proof/revision-upload-qa");
  assert.equal(order.access.revision_upload_enabled, true);
  assert.equal(order.tasks[0]?.attachment_id, "27085010");
  assert.equal(order.tasks.length, 1);
  assert.equal(order.tasks[0]?.sibling_count, 1);
});

test("keeps the decision-flow visual QA fixture scoped to one reviewable proof", () => {
  const order = demoOrderForHash("#/proof/decision-flow-qa");
  assert.deepEqual(order.access, {
    scope: "review",
    decisions_enabled: true,
    review_experience: "simple",
    revision_upload_enabled: true
  });
  assert.equal(order.tasks.length, 1);
  assert.equal(order.tasks[0]?.attachment_id, "27085010");
  assert.equal(order.tasks[0]?.feedback_required, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoTransformationSummary, quantityDraftMatches, saveQuantityDraft } from "../src/quantity-review-state.ts";
import type { ProofTask } from "../src/types.ts";

function tasks(count = 4): ProofTask[] {
  return Array.from({ length: count }, (_, index) => ({
    task_id: `task-${index + 1}`,
    line_number: "4",
    product_name: "Wall panel",
    quantity: 20,
    state: "pending",
    sibling_index: index + 1,
    sibling_count: count,
    feedback_required: false,
    feedback_acknowledged: false,
    current_version: {
      version_id: `version-${index + 1}`,
      created_at: "2026-08-05T12:00:00.000Z",
      filename: `creative-${index + 1}.pdf`,
      content_type: "application/pdf",
      preview_kind: "pdf",
      preview_url: null,
      download_url: null,
      approval_status: "PENDING",
      approved_at: null,
      comments: [],
      technical_checks: [],
      current: true
    },
    versions: []
  }));
}

test("saves a complete quantity assignment without creating an approval result", () => {
  const proofTasks = tasks();
  const values = { "task-1": "8", "task-2": "4", "task-3": "4", "task-4": "4" };
  const draft = saveQuantityDraft({ groupId: "line-4", tasks: proofTasks, values, now: new Date("2026-08-05T13:00:00.000Z") });
  assert.equal(draft.saved_at, "2026-08-05T13:00:00.000Z");
  assert.equal(draft.line_quantity, 20);
  assert.equal(quantityDraftMatches(draft, proofTasks, values), true);
  assert.equal("approved" in draft, false);
});

test("fails closed until all creative quantities equal the line quantity", () => {
  assert.throws(() => saveQuantityDraft({
    groupId: "line-4",
    tasks: tasks(),
    values: { "task-1": "8", "task-2": "4", "task-3": "4", "task-4": "3" },
    now: new Date("2026-08-05T13:00:00.000Z")
  }));
});

test("supports staging one creative for the full line quantity", () => {
  const stagedTask = tasks(1);
  const draft = saveQuantityDraft({
    groupId: "line-4",
    tasks: stagedTask,
    values: { "task-1": "20" },
    now: new Date("2026-08-05T13:00:00.000Z")
  });
  assert.deepEqual(draft.values, { "task-1": "20" });
  assert.equal(quantityDraftMatches(draft, stagedTask, { "task-1": "20" }), true);
});

test("summarizes a reshaped line after the simulated authoritative refresh", () => {
  const summary = buildDemoTransformationSummary(tasks(), { "task-1": "8", "task-2": "4", "task-3": "4", "task-4": "4" });
  assert.equal(summary.source_line_number, "4");
  assert.equal(summary.source_line_quantity, 20);
  assert.deepEqual(summary.lines.map((line) => [line.resulting_line_number, line.quantity]), [["4", 8], ["5", 4], ["6", 4], ["7", 4]]);
});

test("supports a large 20-proof quantity assignment without changing the summary shape", () => {
  const proofTasks = tasks(20);
  const values = Object.fromEntries(proofTasks.map((task) => [task.task_id, "1"]));
  const draft = saveQuantityDraft({ groupId: "line-4", tasks: proofTasks, values, now: new Date("2026-08-05T13:00:00.000Z") });
  assert.equal(Object.keys(draft.values).length, 20);
  assert.equal(buildDemoTransformationSummary(proofTasks, values).lines.length, 20);
});

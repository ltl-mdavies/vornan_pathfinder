import assert from "node:assert/strict";
import test from "node:test";
import type { AllocationStatus } from "../src/api";
import { protectedAllocationAttachments } from "../src/creative-approval-state";

function batch(state: AllocationStatus["state"]): AllocationStatus {
  return { batch_id: "batch", state, automatic_retry: false, source_line_number: "4", line_quantity: 12,
    entries: (["confirmed", "submitted", "pending"] as const).map((state, index) => ({
      task_id: `task-${index}`, attachment_id: String(index), filename: null, quantity: 4, state, resulting_line_number: null
    })) };
}
test("paused batches protect both confirmed and uncertain submissions from stale task data", () => {
  assert.deepEqual(protectedAllocationAttachments(batch("paused"), false), ["0", "1"]);
  assert.deepEqual(protectedAllocationAttachments(batch("paused"), true), ["0", "1"]);
});
test("active batches protect unsent intent as well as submitted creatives", () => {
  for (const state of ["ready", "checking"] as const) {
    assert.deepEqual(protectedAllocationAttachments(batch(state), false), ["0", "1", "2"]);
  }
});
test("completed batches retain protection until successful order refresh", () => {
  assert.deepEqual(protectedAllocationAttachments(batch("completed"), false), ["0", "1", "2"]);
  assert.deepEqual(protectedAllocationAttachments(batch("completed"), true), []);
});

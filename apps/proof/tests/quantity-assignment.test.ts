import assert from "node:assert/strict";
import test from "node:test";
import { summarizeQuantityAssignment } from "../src/quantity-assignment.ts";

test("requires an exact whole-number allocation across every proof", () => {
  const taskIds = ["creative-1", "creative-2", "creative-3"];
  assert.deepEqual(summarizeQuantityAssignment(20, taskIds, {
    "creative-1": "8",
    "creative-2": "7",
    "creative-3": "5"
  }), {
    assigned: 20,
    remaining: 0,
    complete: true,
    invalid_task_ids: []
  });

  assert.equal(summarizeQuantityAssignment(20, taskIds, {
    "creative-1": "8",
    "creative-2": "7"
  }).remaining, 5);
  assert.equal(summarizeQuantityAssignment(20, taskIds, {
    "creative-1": "11",
    "creative-2": "10"
  }).remaining, -1);
});

test("rejects fractional, negative, unsafe, and per-proof over-allocation values", () => {
  const taskIds = ["fractional", "negative", "too-large", "over-line"];
  const result = summarizeQuantityAssignment(20, taskIds, {
    fractional: "1.5",
    negative: "-1",
    "too-large": "99999999999999999999999",
    "over-line": "21"
  });
  assert.deepEqual(result.invalid_task_ids, taskIds);
  assert.equal(result.complete, false);
});

test("scales to a twenty-proof line without relying on positional navigation", () => {
  const taskIds = Array.from({ length: 20 }, (_, index) => `creative-${index + 1}`);
  const values = Object.fromEntries(taskIds.map((taskId) => [taskId, "1"]));
  assert.deepEqual(summarizeQuantityAssignment(20, taskIds, values), {
    assigned: 20,
    remaining: 0,
    complete: true,
    invalid_task_ids: []
  });
});

test("fails closed when the authoritative line quantity is unavailable", () => {
  assert.deepEqual(summarizeQuantityAssignment(null, ["creative-1"], { "creative-1": "1" }), {
    assigned: 1,
    remaining: null,
    complete: false,
    invalid_task_ids: []
  });
});

test("zero or empty creative quantities cannot complete an otherwise exact allocation", () => {
  const tasks = ["first", "second"];
  const zero = summarizeQuantityAssignment(12, tasks, { first: "12", second: "0" });
  assert.equal(zero.complete, false);
  assert.deepEqual(zero.invalid_task_ids, ["second"]);
  const empty = summarizeQuantityAssignment(12, tasks, { first: "12", second: "" });
  assert.equal(empty.complete, false);
  assert.equal(empty.remaining, 0);
  assert.deepEqual(empty.invalid_task_ids, [], "unfilled fields stay neutral until entered");
  assert.equal(summarizeQuantityAssignment(0, [], {}).complete, false);
  assert.equal(summarizeQuantityAssignment(12, tasks, { first: "5", second: "7" }).complete, true);
});

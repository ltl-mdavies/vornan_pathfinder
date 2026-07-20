import assert from "node:assert/strict";
import test from "node:test";
import {
  filterProofTasks,
  queueEmptyMessage,
  queueNavigationTarget,
  searchProofTasks,
  selectedVisibleTask
} from "../src/queue-state.ts";
import type { ProofTask } from "../src/types.ts";

function task(task_id: string, state: ProofTask["state"]): ProofTask {
  return {
    task_id,
    state,
    line_number: null,
    product_name: null,
    quantity: null,
    sibling_index: 1,
    sibling_count: 1,
    current_version: null,
    versions: []
  };
}

const tasks = [task("pending", "pending"), task("waiting", "waiting"), task("revised", "revised"), task("approved", "approved")];

test("filters the read-only queue without leaking a hidden selection into detail", () => {
  assert.deepEqual(filterProofTasks(tasks, "open").map((item) => item.task_id), ["pending", "waiting", "revised"]);
  const history = filterProofTasks(tasks, "history");
  assert.deepEqual(history.map((item) => item.task_id), ["approved"]);
  assert.equal(selectedVisibleTask(history, "pending")?.task_id, "approved");
  assert.equal(selectedVisibleTask([], "pending"), null);
});

test("supports bounded keyboard queue navigation", () => {
  assert.equal(queueNavigationTarget(tasks, "pending", "ArrowDown"), "waiting");
  assert.equal(queueNavigationTarget(tasks, "pending", "ArrowRight"), "waiting");
  assert.equal(queueNavigationTarget(tasks, "pending", "ArrowUp"), "approved");
  assert.equal(queueNavigationTarget(tasks, "pending", "ArrowLeft"), "approved");
  assert.equal(queueNavigationTarget(tasks, "waiting", "Home"), "pending");
  assert.equal(queueNavigationTarget(tasks, "waiting", "End"), "approved");
  assert.equal(queueNavigationTarget([], null, "Home"), null);
});

test("searches the filtered queue by product, line, filename, and state", () => {
  const searchable = [
    {
      ...task("north-wall", "pending"),
      line_number: "12",
      product_name: "North wall graphic",
      current_version: {
        version_id: "version-2",
        created_at: null,
        filename: "north-wall-v2.pdf",
        content_type: "application/pdf",
        preview_kind: "pdf" as const,
        preview_url: null,
        download_url: null,
        approval_status: "PENDING",
        approved_at: null,
        comments: [],
        current: true
      }
    },
    task("approved", "approved")
  ];
  assert.deepEqual(searchProofTasks(searchable, "north wall").map((item) => item.task_id), ["north-wall"]);
  assert.deepEqual(searchProofTasks(searchable, "12").map((item) => item.task_id), ["north-wall"]);
  assert.deepEqual(searchProofTasks(searchable, "V2.PDF").map((item) => item.task_id), ["north-wall"]);
  assert.deepEqual(searchProofTasks(searchable, "approved").map((item) => item.task_id), ["approved"]);
  assert.deepEqual(searchProofTasks(tasks, "regenerating").map((item) => item.task_id), ["revised"]);
  assert.equal(searchProofTasks(searchable, "  "), searchable);
});

test("distinguishes no-proof, no-open-proof, and filter-empty states", () => {
  assert.equal(queueEmptyMessage("all", []).title, "No proofs are available yet");
  assert.equal(queueEmptyMessage("open", tasks).title, "No open proofs");
  assert.equal(queueEmptyMessage("history", tasks).title, "No proofs match this view");
  assert.equal(queueEmptyMessage("all", tasks, "missing artwork").title, "No proofs match your search");
});

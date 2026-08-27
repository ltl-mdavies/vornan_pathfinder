import assert from "node:assert/strict";
import test from "node:test";
import {
  filterProofTasks,
  groupProofTasksByLine,
  lineGroupForTask,
  proofLineQueueSummary,
  queueFilterLabel,
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
  const approved = filterProofTasks(tasks, "approved");
  assert.deepEqual(approved.map((item) => item.task_id), ["approved"]);
  assert.equal(selectedVisibleTask(approved, "pending")?.task_id, "approved");
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
  assert.equal(queueEmptyMessage("approved", tasks).title, "No proofs match this view");
  assert.equal(queueEmptyMessage("all", tasks, "missing artwork").title, "No proofs match your search");
});

test("groups sibling proofs into stable line-level review units", () => {
  const grouped = groupProofTasksByLine([
    { ...task("line-1-proof-2", "approved"), line_number: "1", product_name: "One Sheet", quantity: 16, sibling_index: 2, sibling_count: 2 },
    { ...task("line-2-proof-1", "pending"), line_number: "2", product_name: "Pump topper", quantity: 7 },
    { ...task("line-1-proof-1", "pending"), line_number: "1", product_name: "One Sheet", quantity: 16, sibling_index: 1, sibling_count: 2 },
    task("unbound", "waiting")
  ]);

  assert.deepEqual(grouped.map((group) => group.group_id), ["line-1", "line-2", "task-unbound"]);
  assert.deepEqual(grouped[0]?.tasks.map((item) => item.task_id), ["line-1-proof-1", "line-1-proof-2"]);
  assert.equal(grouped[0]?.open_count, 1);
  assert.equal(grouped[0]?.reviewed_count, 1);
  assert.equal(lineGroupForTask(grouped, "line-1-proof-2")?.group_id, "line-1");
  assert.equal(lineGroupForTask(grouped, "missing")?.group_id, "line-1");
});

test("distinguishes lines awaiting a new proof from proofs awaiting review", () => {
  const waitingWithHistory = groupProofTasksByLine([
    {
      ...task("line-1-waiting", "waiting"),
      line_number: "1",
      quantity: 1,
      versions: [{
        version_id: "line-1-old-proof",
        created_at: null,
        filename: "line-1-old.pdf",
        content_type: "application/pdf",
        preview_kind: "pdf",
        preview_url: null,
        download_url: null,
        approval_status: "REJECTED",
        approved_at: null,
        comments: [],
        current: false
      }]
    }
  ])[0]!;
  const waitingWithoutHistory = groupProofTasksByLine([{ ...task("line-2-waiting", "waiting"), line_number: "2", quantity: 1 }])[0]!;
  const reviewable = groupProofTasksByLine([{
    ...task("line-3-pending", "pending"),
    line_number: "3",
    quantity: 1,
    current_version: {
      version_id: "line-3-proof",
      created_at: null,
      filename: "line-3.pdf",
      content_type: "application/pdf",
      preview_kind: "pdf",
      preview_url: null,
      download_url: null,
      approval_status: "PENDING",
      approved_at: null,
      comments: [],
      current: true
    }
  }])[0]!;

  assert.deepEqual(proofLineQueueSummary(waitingWithHistory), {
    review_label: "Awaiting new proof",
    proof_count_label: "1 prior proof",
    tone: "waiting",
    status_segments: [{ label: "Awaiting new proof", tone: "waiting" }]
  });
  assert.deepEqual(proofLineQueueSummary(waitingWithoutHistory), {
    review_label: "Awaiting proof",
    proof_count_label: "Proof pending",
    tone: "waiting",
    status_segments: [{ label: "Awaiting proof", tone: "waiting" }]
  });
  assert.deepEqual(proofLineQueueSummary(reviewable), {
    review_label: "Awaiting review",
    proof_count_label: "1 proof",
    tone: "open",
    status_segments: [{ label: "Awaiting review", tone: "open" }]
  });
});

test("counts current proofs on reviewable cards rather than comment-only history snapshots", () => {
  const current = {
    version_id: "line-1-current",
    created_at: null,
    filename: "line-1.pdf",
    content_type: "application/pdf",
    preview_kind: "pdf" as const,
    preview_url: null,
    download_url: null,
    approval_status: "PENDING",
    approved_at: null,
    comments: [{ text: "Please confirm trim.", created_at: null, attachments: [] }],
    current: true
  };
  const group = groupProofTasksByLine([{
    ...task("line-1-pending", "pending"),
    line_number: "1",
    current_version: current,
    versions: [current, { ...current, version_id: "line-1-pre-comment", comments: [], current: false }]
  }])[0]!;

  assert.deepEqual(proofLineQueueSummary(group), {
    review_label: "Awaiting review",
    proof_count_label: "1 proof",
    tone: "open",
    status_segments: [{ label: "Awaiting review", tone: "open" }]
  });
});

test("summarizes mixed proof states without relying on a card full of status chips", () => {
  const group = groupProofTasksByLine([
    { ...task("line-1-pending", "pending"), line_number: "1" },
    { ...task("line-1-approved", "approved"), line_number: "1", sibling_index: 2, sibling_count: 2 }
  ])[0]!;

  assert.deepEqual(proofLineQueueSummary(group), {
    review_label: "1 Awaiting review · 1 Approved",
    proof_count_label: "0 proofs",
    tone: "mixed",
    status_segments: [
      { label: "1 Awaiting review", tone: "open" },
      { label: "1 Approved", tone: "approved" }
    ]
  });
  assert.equal(queueFilterLabel("open"), "Open");
  assert.equal(queueFilterLabel("approved"), "Approved");
});

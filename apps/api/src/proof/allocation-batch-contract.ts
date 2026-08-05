import { createHash } from "node:crypto";
import type { ProofOrder, ProofTask } from "@pathfinder/proof-domain";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/;
const RECORD_TTL_SECONDS = 24 * 60 * 60;

export type ProofAllocationDraftEntry = {
  task_id: string;
  attachment_id: string;
  expected_task_version: number;
  expected_version_id: string;
  filename: string | null;
  quantity: number;
};

export type ProofAllocationDraftRecord = {
  draft_id: string;
  canonical_body_hash: string;
  order_number: string;
  order_line_id: string;
  line_number: string | null;
  line_quantity: number;
  expected_order_version: number;
  grant_id: string;
  participant_id: string;
  entries: ProofAllocationDraftEntry[];
  state: "draft";
  record_version: number;
  created_at: string;
  updated_at: string;
  expires_at_epoch: number;
};

export type ProofApprovalBatchChildState =
  | "pending"
  | "submission_uncertain"
  | "observed"
  | "confirmed"
  | "needs_attention";

export type ProofApprovalBatchChild = ProofAllocationDraftEntry & {
  sequence: number;
  state: ProofApprovalBatchChildState;
  response_classification: string | null;
};

export type ProofApprovalBatchRecord = {
  batch_id: string;
  draft_id: string;
  canonical_body_hash: string;
  order_number: string;
  source_order_line_id: string;
  source_line_number: string | null;
  line_quantity: number;
  expected_order_version: number;
  grant_id: string;
  participant_id: string;
  strategy: "reconcile_each_action" | "final_only_qa";
  state: "prepared" | "processing" | "reconciling" | "completed" | "needs_attention";
  children: ProofApprovalBatchChild[];
  automatic_retry: false;
  record_version: number;
  created_at: string;
  updated_at: string;
  expires_at_epoch: number;
};

export type ProofApprovalTransformationLine = {
  task_id: string;
  filename: string | null;
  requested_quantity: number;
  resulting_line_number: string | null;
  resulting_quantity: number | null;
  result: "approved" | "unresolved";
};

export type ProofApprovalTransformationSummary = {
  order_number: string;
  source_line_number: string | null;
  source_line_quantity: number;
  result: "completed" | "needs_attention";
  lines: ProofApprovalTransformationLine[];
};

export class ProofAllocationBatchContractError extends Error {
  constructor(public readonly code: "invalid" | "stale" | "transition", message: string) {
    super(message);
    this.name = "ProofAllocationBatchContractError";
  }
}

function digest(label: string, parts: unknown[]) {
  return createHash("sha256")
    .update(label)
    .update("\u0000")
    .update(JSON.stringify(parts))
    .digest("hex");
}

function identifier(value: string, label: string) {
  if (!IDENTIFIER.test(value)) {
    throw new ProofAllocationBatchContractError("invalid", `${label} is invalid.`);
  }
  return value;
}

function currentLineProofs(order: ProofOrder, selected: ProofTask) {
  return order.tasks
    .filter((task) => task.order_line_id === selected.order_line_id && task.actionable && Boolean(task.attachment_id && task.current_version))
    .sort((left, right) => {
      const leftIndex = left.sibling_index || Number.MAX_SAFE_INTEGER;
      const rightIndex = right.sibling_index || Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.task_id.localeCompare(right.task_id);
    });
}

export function buildProofAllocationDraft(input: {
  order: ProofOrder;
  task_quantities: Array<{ task_id: string; quantity: number }>;
  grant_id: string;
  participant_id: string;
  now: Date;
}): ProofAllocationDraftRecord {
  if (!Number.isFinite(input.now.getTime()) || input.task_quantities.length < 2 || input.task_quantities.length > 20) {
    throw new ProofAllocationBatchContractError("invalid", "Proof quantity allocation is invalid.");
  }
  const grantId = identifier(input.grant_id, "Proof grant");
  const participantId = identifier(input.participant_id, "Proof participant");
  const selected = input.order.tasks.find((task) => task.task_id === input.task_quantities[0]?.task_id);
  if (!selected?.order_line_id || !selected.quantity || !Number.isSafeInteger(selected.quantity) || selected.quantity <= 0) {
    throw new ProofAllocationBatchContractError("stale", "The selected Proof line is not currently allocatable.");
  }
  const proofs = currentLineProofs(input.order, selected);
  if (proofs.length !== input.task_quantities.length) {
    throw new ProofAllocationBatchContractError("stale", "The allocation no longer contains every current proof on the line.");
  }
  const quantities = new Map<string, number>();
  for (const entry of input.task_quantities) {
    if (quantities.has(entry.task_id) || !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0 || entry.quantity > selected.quantity) {
      throw new ProofAllocationBatchContractError("invalid", "Every proof requires one positive whole-number quantity.");
    }
    quantities.set(entry.task_id, entry.quantity);
  }
  if (proofs.some((task) => !quantities.has(task.task_id))) {
    throw new ProofAllocationBatchContractError("stale", "The allocation proof set is stale.");
  }
  const assigned = [...quantities.values()].reduce((total, quantity) => total + quantity, 0);
  if (assigned !== selected.quantity) {
    throw new ProofAllocationBatchContractError("invalid", "Proof quantities must equal the current Lift line quantity.");
  }
  const entries: ProofAllocationDraftEntry[] = proofs.map((task) => ({
    task_id: task.task_id,
    attachment_id: task.attachment_id!,
    expected_task_version: task.version,
    expected_version_id: task.current_version!.version_id,
    filename: task.current_version!.filename,
    quantity: quantities.get(task.task_id)!
  }));
  const canonicalBodyHash = digest("vornan-proof-allocation-draft-v1", [
    input.order.order_number,
    input.order.version,
    selected.order_line_id,
    selected.quantity,
    grantId,
    participantId,
    entries
  ]);
  const nowIso = input.now.toISOString();
  return {
    draft_id: `pdraft_${digest("vornan-proof-allocation-draft-id-v1", [input.order.order_number, selected.order_line_id, grantId, participantId])}`,
    canonical_body_hash: canonicalBodyHash,
    order_number: input.order.order_number,
    order_line_id: selected.order_line_id,
    line_number: selected.line_number,
    line_quantity: selected.quantity,
    expected_order_version: input.order.version,
    grant_id: grantId,
    participant_id: participantId,
    entries,
    state: "draft",
    record_version: 1,
    created_at: nowIso,
    updated_at: nowIso,
    expires_at_epoch: Math.floor(input.now.getTime() / 1000) + RECORD_TTL_SECONDS
  };
}

export function buildProofApprovalBatch(
  draft: ProofAllocationDraftRecord,
  strategy: ProofApprovalBatchRecord["strategy"],
  now: Date
): ProofApprovalBatchRecord {
  if (draft.state !== "draft" || draft.expires_at_epoch <= Math.floor(now.getTime() / 1000)) {
    throw new ProofAllocationBatchContractError("stale", "The Proof allocation draft has expired.");
  }
  const children = draft.entries.map((entry, index) => ({
    ...entry,
    sequence: index + 1,
    state: "pending" as const,
    response_classification: null
  }));
  const nowIso = now.toISOString();
  return {
    batch_id: `pbatch_${digest("vornan-proof-approval-batch-id-v1", [draft.draft_id, draft.canonical_body_hash])}`,
    draft_id: draft.draft_id,
    canonical_body_hash: digest("vornan-proof-approval-batch-v1", [draft.canonical_body_hash, strategy, children]),
    order_number: draft.order_number,
    source_order_line_id: draft.order_line_id,
    source_line_number: draft.line_number,
    line_quantity: draft.line_quantity,
    expected_order_version: draft.expected_order_version,
    grant_id: draft.grant_id,
    participant_id: draft.participant_id,
    strategy,
    state: "prepared",
    children,
    automatic_retry: false,
    record_version: 1,
    created_at: nowIso,
    updated_at: nowIso,
    expires_at_epoch: draft.expires_at_epoch
  };
}

export function startNextProofApproval(batch: ProofApprovalBatchRecord, now: Date) {
  if (batch.state !== "prepared" && batch.state !== "processing") {
    throw new ProofAllocationBatchContractError("transition", "This approval batch cannot start another proof.");
  }
  if (batch.children.some((child) => child.state === "submission_uncertain")) {
    throw new ProofAllocationBatchContractError("transition", "The current proof must be observed before another proof starts.");
  }
  const nextIndex = batch.children.findIndex((child) => child.state === "pending");
  if (nextIndex < 0) {
    throw new ProofAllocationBatchContractError("transition", "No pending proof remains in this approval batch.");
  }
  return {
    ...batch,
    state: "processing" as const,
    children: batch.children.map((child, index) => index === nextIndex ? { ...child, state: "submission_uncertain" as const } : child),
    record_version: batch.record_version + 1,
    updated_at: now.toISOString()
  };
}

export function observeCurrentProofApproval(input: {
  batch: ProofApprovalBatchRecord;
  classification: string;
  accepted: boolean;
  now: Date;
}) {
  const activeIndex = input.batch.children.findIndex((child) => child.state === "submission_uncertain");
  if (input.batch.state !== "processing" || activeIndex < 0) {
    throw new ProofAllocationBatchContractError("transition", "No submitted proof is awaiting observation.");
  }
  const children = input.batch.children.map((child, index) => index === activeIndex ? {
    ...child,
    state: input.accepted ? "observed" as const : "needs_attention" as const,
    response_classification: input.classification
  } : child);
  const needsAttention = children.some((child) => child.state === "needs_attention");
  const hasPending = children.some((child) => child.state === "pending");
  return {
    ...input.batch,
    state: needsAttention ? "needs_attention" as const : hasPending ? "processing" as const : "reconciling" as const,
    children,
    record_version: input.batch.record_version + 1,
    updated_at: input.now.toISOString()
  };
}

export function reconcileProofApprovalBatch(input: {
  batch: ProofApprovalBatchRecord;
  order: ProofOrder;
  now: Date;
}): { batch: ProofApprovalBatchRecord; summary: ProofApprovalTransformationSummary } {
  if (input.batch.state !== "reconciling" && input.batch.state !== "needs_attention") {
    throw new ProofAllocationBatchContractError("transition", "This approval batch is not ready for reconciliation.");
  }
  const lines = input.batch.children.map((child): ProofApprovalTransformationLine => {
    const current = [...input.order.tasks, ...input.order.archived_tasks]
      .find((task) => task.attachment_id === child.attachment_id);
    const approved = Boolean(current && (current.state === "approved" || current.state === "reference"));
    return {
      task_id: child.task_id,
      filename: child.filename,
      requested_quantity: child.quantity,
      resulting_line_number: current?.line_number ?? null,
      resulting_quantity: current?.quantity ?? null,
      result: approved ? "approved" : "unresolved"
    };
  });
  const completed = lines.every((line) => line.result === "approved");
  const state = completed ? "completed" as const : "needs_attention" as const;
  return {
    batch: {
      ...input.batch,
      state,
      children: input.batch.children.map((child, index) => ({
        ...child,
        state: lines[index]!.result === "approved" ? "confirmed" as const : "needs_attention" as const
      })),
      record_version: input.batch.record_version + 1,
      updated_at: input.now.toISOString()
    },
    summary: {
      order_number: input.batch.order_number,
      source_line_number: input.batch.source_line_number,
      source_line_quantity: input.batch.line_quantity,
      result: state,
      lines
    }
  };
}

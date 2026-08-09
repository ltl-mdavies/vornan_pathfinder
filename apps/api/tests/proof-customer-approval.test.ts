import assert from "node:assert/strict";
import test from "node:test";
import type { ProofAccessSession, ProofOrder } from "@pathfinder/proof-domain";
import type { ProofActionTargetConfig } from "../src/proof/action-target-store.ts";
import {
  createProofCustomerApprovalService,
  ProofCustomerApprovalError
} from "../src/proof/customer-approval-service.ts";

const now = new Date("2026-08-08T16:00:00.000Z");
const session: ProofAccessSession = {
  session_id: "psession_customer_approval",
  session_hash: "a".repeat(64),
  grant_id: "pgrant_customer_approval",
  order_number: "A0226753",
  scope: "review",
  csrf_hash: "b".repeat(64),
  participant_id: "pparticipant_customer_approval",
  created_at: now.toISOString(),
  expires_at: "2026-08-08T18:00:00.000Z",
  expires_at_epoch: 1_786_213_200,
  last_seen_at: now.toISOString(),
  ended_at: null
};

function proofOrder(state: "pending" | "approved" = "pending"): ProofOrder {
  const version = {
    version_id: "pversion_customer_approval",
    attachment_id: "27085012",
    created_at: "2026-08-08T15:00:00.000Z",
    filename: "customer-proof.pdf",
    content_type: "application/pdf",
    preview_url: null,
    download_url: null,
    approval_status: state === "approved" ? "APPROVED" : "PENDING",
    approved_by: state === "approved" ? "VORNAN_PROOF" : null,
    approved_at: state === "approved" ? now.toISOString() : null,
    comments: [{ text: "Check the trim note.", created_at: "2026-08-08T15:05:00.000Z", attachment: null }],
    detailed_report: null,
    feedback_fingerprint: "feedback-customer-approval-v1",
    current: true,
    archived_at: null
  };
  return {
    order_number: session.order_number,
    customer_id: "1249",
    customer_name: "LTL Demo",
    order_title: "Customer approval QA",
    order_status: state === "approved" ? "Approved" : "Pending Art Approval",
    health: "active",
    version: state === "approved" ? 2 : 1,
    lines: [{ order_line_id: "9748545", line_number: "1", step_number: state === "approved" ? 7.05 : 7.02, product_name: "Panel", quantity: 8, status: null, cancelled: false }],
    tasks: [{
      task_id: "ptask_customer_approval",
      order_line_id: "9748545",
      line_number: "1",
      attachment_id: version.attachment_id,
      product_name: "Panel",
      quantity: 8,
      state,
      actionable: state === "pending",
      sibling_index: 1,
      sibling_count: 1,
      version: 7,
      current_version: version,
      versions: [version],
      created_at: version.created_at,
      updated_at: now.toISOString(),
      archived_at: null
    }],
    archived_tasks: [],
    warnings: [],
    created_at: version.created_at,
    updated_at: now.toISOString(),
    last_synced_at: now.toISOString()
  };
}

const target = [{
  target_id: "lift-standard-graphics",
  adapter: "lift-standard-graphics",
  environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://proofing.example.invalid/order-import" }]
}] as ProofActionTargetConfig[];

const request = {
  task_id: "ptask_customer_approval",
  attachment_id: "27085012",
  expected_task_version: 7,
  expected_version_id: "pversion_customer_approval",
  idempotency_key: "customer-approval-key-0001",
  note: "Approved for production"
};

function runtime(enabled: boolean) {
  return {
    phase: "single_proof_customer_approval_foundation" as const,
    storage_driver: "dynamodb" as const,
    core_table_name: "ProofCore",
    audit_table_name: "ProofAudit",
    read: { order_read_url: "https://example.invalid/order", proof_report_read_url: "https://example.invalid/proof", timeout_ms: 15_000, concurrency: 5, proof_readable_min_step: null },
    feature_flags: { grant_creation: enabled, proof_link_email: false, public_read: enabled, approve: enabled, revision_upload: false, revision: false as const, undo: false as const },
    access: { public_base_url: "https://proof.vornan.co", grant_ttl_days: 14, session_ttl_minutes: 30, edge_shared_secret: "synthetic", grant_allowed_customer_ids: ["1249"], read_only_activation_expires_at: "2026-08-08T18:00:00.000Z" },
    sync: { queue_url: null, stale_after_minutes: 15, automatic_refresh_max_inactive_days: 14 },
    qa_lifecycle: { isolated_endpoint_confirmed: true, dedicated_credentials_confirmed: true, approval_cycle_confirmed: true, revision_cycle_confirmed: false, lift_writes_enabled: false as const }
  };
}

test("denies a dark customer approval gate before Lift reads, persistence, secrets, or transport", async () => {
  const calls: string[] = [];
  const service = createProofCustomerApprovalService({
    runtimeConfig: () => runtime(false),
    syncOrder: async () => { calls.push("sync"); throw new Error("must not run"); },
    readTargetConfig: async () => { calls.push("targets"); return target[0]!; },
    readCredentials: async () => { calls.push("credentials"); throw new Error("must not run"); },
    reserve: async () => { calls.push("reserve"); throw new Error("must not run"); },
    send: async () => { calls.push("send"); throw new Error("must not run"); }
  });
  await assert.rejects(
    () => service.approve({ session, request, correlation_id: "correlation-customer-approval" }),
    (error) => error instanceof ProofCustomerApprovalError && error.code === "disabled"
  );
  assert.deepEqual(calls, []);
});

test("persists the no-retry boundary before one quantity-free PUT and immediately reconciles", async () => {
  const pending = proofOrder();
  const approved = proofOrder("approved");
  const lifecycle: string[] = [];
  let syncCount = 0;
  let record: any;
  const service = createProofCustomerApprovalService({
    runtimeConfig: () => runtime(true),
    now: () => now,
    readTargetConfig: async () => target[0]!,
    syncOrder: async () => {
      syncCount += 1;
      lifecycle.push(syncCount === 1 ? "preflight-get" : "reconcile-get");
      return { order: syncCount === 1 ? pending : approved, diagnostics: null } as never;
    },
    getParticipant: async () => ({ participant_id: session.participant_id!, grant_id: session.grant_id, order_number: session.order_number, display_name: "Reviewer", email: "reviewer@example.invalid", first_seen_at: now.toISOString(), last_seen_at: now.toISOString() }),
    getFeedbackAcknowledgement: async () => ({ acknowledgement_id: "pack_customer_approval", grant_id: session.grant_id, participant_id: session.participant_id!, order_number: session.order_number, task_id: request.task_id, feedback_fingerprint: "feedback-customer-approval-v1", acknowledged_at: now.toISOString() }),
    reserve: async (contract) => {
      lifecycle.push("reserve");
      record = { ...contract, prepared_audit_event_id: `paudit_decision-${"c".repeat(64)}`, record_version: 1, created_at: now.toISOString(), updated_at: now.toISOString(), expires_at_epoch: Math.floor(now.getTime() / 1000) + 2_592_000 };
      return { status: "new" as const, record };
    },
    transition: async (input) => {
      lifecycle.push(`persist-${input.next_outcome}`);
      record = { ...record, outcome: input.next_outcome, record_version: record.record_version + 1, updated_at: now.toISOString() };
      return record;
    },
    readCredentials: async () => ({ base_url: "https://proofing.example.invalid/api", company_id: "91", action_user_name: "VORNAN_PROOF", client_id: "synthetic-client", client_secret: "synthetic-secret-material-for-tests" }),
    send: async ({ plan }) => {
      lifecycle.push("put");
      assert.deepEqual(plan.body, { approve: true, userName: "VORNAN_PROOF", comment: request.note });
      assert.equal(JSON.stringify(plan.body).includes("approvedQuantity"), false);
      return { status: 202, transport_error: false, classification: { classification: "success_observed_unconfirmed", confirmed: false, retryable: false, reconciliation: "authoritative_read_after_write_required", reason: "success_response_requires_authoritative_confirmation" } };
    },
    audit: async (event) => { lifecycle.push(`audit-${event.action}`); return event as never; }
  });
  const result = await service.approve({ session, request, correlation_id: "correlation-customer-approval" });
  assert.equal(result.outcome, "confirmed");
  assert.deepEqual(lifecycle, [
    "preflight-get", "reserve", "persist-submission_uncertain", "audit-proof.decision_submission_started",
    "put", "reconcile-get", "persist-confirmed", "audit-proof.decision_observed"
  ]);
});

test("rejects multiple or shared proofs before credentials or transport", async () => {
  const order = proofOrder();
  order.tasks.push({ ...order.tasks[0]!, task_id: "ptask_customer_approval_2", attachment_id: "27085013", current_version: { ...order.tasks[0]!.current_version!, version_id: "pversion_customer_approval_2", attachment_id: "27085013" } });
  let credentialReads = 0;
  let sends = 0;
  const service = createProofCustomerApprovalService({
    runtimeConfig: () => runtime(true),
    readTargetConfig: async () => target[0]!,
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    readCredentials: async () => { credentialReads += 1; throw new Error("must not run"); },
    send: async () => { sends += 1; throw new Error("must not run"); }
  });
  await assert.rejects(
    () => service.approve({ session, request, correlation_id: "correlation-customer-approval" }),
    (error) => error instanceof ProofCustomerApprovalError && error.code === "not_allowed"
  );
  assert.equal(credentialReads, 0);
  assert.equal(sends, 0);
});

test("never replays transport after the durable no-retry boundary", async () => {
  let credentialReads = 0;
  let sends = 0;
  const service = createProofCustomerApprovalService({
    runtimeConfig: () => runtime(true),
    now: () => now,
    readTargetConfig: async () => target[0]!,
    syncOrder: async () => ({ order: proofOrder(), diagnostics: null }) as never,
    getParticipant: async () => ({ participant_id: session.participant_id!, grant_id: session.grant_id, order_number: session.order_number, display_name: "Reviewer", email: "reviewer@example.invalid", first_seen_at: now.toISOString(), last_seen_at: now.toISOString() }),
    getFeedbackAcknowledgement: async () => ({ acknowledgement_id: "pack_customer_approval", grant_id: session.grant_id, participant_id: session.participant_id!, order_number: session.order_number, task_id: request.task_id, feedback_fingerprint: "feedback-customer-approval-v1", acknowledged_at: now.toISOString() }),
    reserve: async (contract) => ({
      status: "replay" as const,
      record: {
        ...contract,
        outcome: "reconciling" as const,
        prepared_audit_event_id: `paudit_decision-${"d".repeat(64)}`,
        record_version: 3,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        expires_at_epoch: Math.floor(now.getTime() / 1000) + 2_592_000
      }
    }),
    readCredentials: async () => { credentialReads += 1; throw new Error("must not run"); },
    send: async () => { sends += 1; throw new Error("must not run"); }
  });
  const result = await service.approve({ session, request, correlation_id: "correlation-customer-approval-replay" });
  assert.deepEqual(result, {
    status: "replay",
    outcome: "reconciling",
    automatic_retry: false,
    authoritative_refresh_completed: false
  });
  assert.equal(credentialReads, 0);
  assert.equal(sends, 0);
});

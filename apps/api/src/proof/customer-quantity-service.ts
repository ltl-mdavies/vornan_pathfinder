import type { ProofAccessSession, ProofAuditEvent, ProofOrder, ProofTask } from "@pathfinder/proof-domain";
import { buildLiftProofingRuntimeHeaders, buildLiftProofingRuntimePlan, sendLiftProofingRuntimeAction } from "@pathfinder/lift-proof-adapter/proofing-action-runtime";
import { readTargetEnvironmentProofingApiRuntimeCredentials } from "../lift-proofing-credentials.js";
import { readProofActionTargetConfig } from "./action-target-store.js";
import { assertCredentialBoundary, targetEnvironment, ProofCustomerApprovalError } from "./customer-approval-service.js";
import { prepareProofApprovalDecision } from "./decision-contract.js";
import { getProofFeedbackAcknowledgement, getProofParticipant } from "./store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { syncProofOrder } from "./service.js";
import { recordActionApproval, reopenConfirmedAction } from "./action-reopening-store.js";
import { allocationHash, listCustomerAllocations, readCustomerAllocation, replaceCustomerAllocation, reserveCustomerAllocation, type CustomerAllocation, type AllocationEntry } from "./customer-allocation-store.js";

export const customerAllocationsEnabled = () => process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_ALLOCATIONS === "true";
/** Exact customer/order pairs only. An empty or malformed release scope denies all. */
export function customerAllocationScopeAllowed(
  session: Pick<ProofAccessSession, "order_number" | "capability">,
  env: NodeJS.ProcessEnv = process.env
) {
  const scope = env.PATHFINDER_PROOF_CUSTOMER_ALLOCATION_SCOPE ?? "";
  if (!/^[0-9]{1,20}:A[0-9]{7,8}(,[0-9]{1,20}:A[0-9]{7,8}){0,24}$/.test(scope)) return false;
  return scope.split(",").includes(`${session.capability?.proof_customer_id}:${session.order_number}`);
}
export type AllocationRequest = {
  idempotency_key: string;
  entries: Array<{ task_id: string; attachment_id: string; expected_task_version: number; expected_version_id: string; quantity: number }>;
  note?: string | null;
};
type Context = { session: ProofAccessSession; correlation_id: string };
const fail = (code: "disabled" | "not_allowed" | "invalid" | "stale" | "conflict", message: string): never => { throw new ProofCustomerApprovalError(code, message); };
const id = /^[A-Za-z0-9_.:-]{1,180}$/;
export function publicAllocation(record: CustomerAllocation) {
  return {
    batch_id: record.batch_id, state: record.state, automatic_retry: false as const,
    source_line_number: record.source_line_number, line_quantity: record.line_quantity,
    entries: record.entries.map((e) => ({ task_id: e.task_id, attachment_id: e.attachment_id, filename: e.filename, quantity: e.quantity, state: e.state, resulting_line_number: e.resulting_line_number }))
  };
}
function audit(record: CustomerAllocation, context: Context, action: ProofAuditEvent["action"], entry?: AllocationEntry): ProofAuditEvent {
  return {
    event_id: `paudit_allocation-${allocationHash([record.batch_id, record.record_version])}`,
    action, outcome: "succeeded", occurred_at: record.updated_at,
    order_number: record.order_number, order_line_id: record.source_order_line_id,
    task_id: entry?.task_id ?? null, attachment_id: entry?.attachment_id ?? null,
    grant_id: record.grant_id, participant_id: record.participant_id,
    actor_type: "customer_session", actor_id: context.session.session_id, correlation_id: context.correlation_id,
    metadata: { source: "public_api", decision_kind: "approve", decision_outcome: action === "proof.decision_prepared" ? "prepared" : action === "proof.decision_submission_started" ? "submission_uncertain" : record.state === "completed" ? "confirmed" : "reconciling" }
  };
}
function normalize(request: AllocationRequest) {
  if (!request || typeof request.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(request.idempotency_key) || !Array.isArray(request.entries) || request.entries.length < 2 || request.entries.length > 20) fail("invalid", "Select all current creatives and assign their quantities.");
  const seen = new Set<string>();
  const attachments = new Set<string>();
  const entries = request.entries.map((e) => {
    if (!e || typeof e.task_id !== "string" || !id.test(e.task_id) || typeof e.attachment_id !== "string" || !/^\d{1,20}$/.test(e.attachment_id) || typeof e.expected_version_id !== "string" || !id.test(e.expected_version_id) || !Number.isSafeInteger(e.expected_task_version) || e.expected_task_version < 1 || !Number.isSafeInteger(e.quantity) || e.quantity < 1 || seen.has(e.task_id) || attachments.has(e.attachment_id)) fail("invalid", "Each creative needs a positive whole-number quantity and its current proof.");
    seen.add(e.task_id); attachments.add(e.attachment_id);
    return { task_id: e.task_id, attachment_id: e.attachment_id, expected_task_version: e.expected_task_version, expected_version_id: e.expected_version_id, quantity: e.quantity };
  }).sort((a, b) => a.attachment_id.localeCompare(b.attachment_id));
  if (request.note != null && (typeof request.note !== "string" || request.note.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(request.note))) fail("invalid", "The approval message is invalid.");
  return { entries, note: request.note?.trim() || null };
}
export function createCustomerAllocationService(deps: {
  enabled?: typeof customerAllocationsEnabled; runtime?: typeof getProofRuntimeConfig;
  scopeAllowed?: typeof customerAllocationScopeAllowed;
  sync?: typeof syncProofOrder; participant?: typeof getProofParticipant; acknowledgement?: typeof getProofFeedbackAcknowledgement;
  read?: typeof readCustomerAllocation; list?: typeof listCustomerAllocations; reserve?: typeof reserveCustomerAllocation; replace?: typeof replaceCustomerAllocation;
  target?: typeof readProofActionTargetConfig; credentials?: typeof readTargetEnvironmentProofingApiRuntimeCredentials;
  send?: typeof sendLiftProofingRuntimeAction; now?: () => Date;
  recordApproval?: typeof recordActionApproval; reopenAction?: typeof reopenConfirmedAction;
} = {}) {
  const enabled = deps.enabled ?? customerAllocationsEnabled;
  const runtime = deps.runtime ?? getProofRuntimeConfig;
  const sync = deps.sync ?? syncProofOrder;
  const participant = deps.participant ?? getProofParticipant;
  const acknowledgement = deps.acknowledgement ?? getProofFeedbackAcknowledgement;
  const read = deps.read ?? readCustomerAllocation;
  const reserve = deps.reserve ?? reserveCustomerAllocation;
  const replace = deps.replace ?? replaceCustomerAllocation;
  const now = deps.now ?? (() => new Date());
  function authorize(session: ProofAccessSession) {
    const config = runtime();
    if (!enabled() || !config.feature_flags.approve || !config.feature_flags.public_read) fail("disabled", "Creative approvals are not enabled for this review.");
    if (session.scope !== "review" || session.capability?.access_mode !== "review" || session.capability.review_experience !== "advanced" || !/^\d{1,20}$/.test(session.capability.proof_customer_id) || !session.participant_id) fail("not_allowed", "Identify the reviewer with approval access before submitting quantities.");
    if (!(deps.scopeAllowed ?? customerAllocationScopeAllowed)(session)) fail("not_allowed", "Creative approvals are not enabled for this order.");
  }
  function bound(record: CustomerAllocation | null, session: ProofAccessSession): CustomerAllocation {
    if (!record || record.order_number !== session.order_number || record.customer_id !== session.capability?.proof_customer_id || record.grant_id !== session.grant_id || record.participant_id !== session.participant_id) fail("not_allowed", "These approvals are not available in this review.");
    return record!;
  }
  async function loadOrder(context: Context) {
    const { order } = await sync(context.session.order_number, { allowed_customer_ids: [context.session.capability!.proof_customer_id], audit_context: { actor_type: "customer_session", actor_id: context.session.session_id, correlation_id: context.correlation_id, source: "public_api" } });
    if (order.order_number !== context.session.order_number || order.customer_id !== context.session.capability!.proof_customer_id) fail("not_allowed", "The order does not match this review.");
    return order;
  }
  async function validateDecision(order: ProofOrder, task: ProofTask, context: Context, note: string | null) {
    if (order.lines.some((line) => line.order_line_id === task.order_line_id && line.cancelled)) fail("stale", "This line has been cancelled and cannot be approved.");
    return prepareProofApprovalDecision({
      order, binding: { order_number: order.order_number, task_id: task.task_id, attachment_id: task.attachment_id!, expected_task_version: task.version, expected_version_id: task.current_version!.version_id },
      participant: await participant(context.session.grant_id, context.session.participant_id!), participant_id: context.session.participant_id,
      grant_id: context.session.grant_id, feedback_acknowledgement: await acknowledgement(context.session.grant_id, context.session.participant_id!, task.task_id),
      idempotency_key: `allocation-${allocationHash([task.task_id, task.current_version!.version_id])}`, note
    });
  }
  async function save(current: CustomerAllocation, next: CustomerAllocation, context: Context, action: ProofAuditEvent["action"], entry?: AllocationEntry) {
    const updated = { ...next, record_version: current.record_version + 1, updated_at: now().toISOString() };
    if (!await replace(current, updated, audit(updated, context, action, entry))) fail("conflict", "These approvals are already being checked. Check their status again.");
    return updated;
  }
  return {
    async prepare(context: Context & { request: AllocationRequest }) {
      authorize(context.session);
      const request = normalize(context.request);
      const batchId = `pbatch_${allocationHash([context.session.order_number, context.session.grant_id, context.session.participant_id, context.request.idempotency_key])}`;
      const hash = allocationHash(request);
      const existing = await read(context.session.order_number, batchId);
      if (existing) {
        const record = bound(existing, context.session);
        if (record.request_hash !== hash) fail("conflict", "This submission already has different quantities. Check the existing approval status.");
        return publicAllocation(record);
      }
      const order = await loadOrder(context);
      const selected = order.tasks.find((t) => t.task_id === request.entries[0]!.task_id);
      if (!selected?.order_line_id || !Number.isSafeInteger(selected.quantity) || selected.quantity! < 1) fail("stale", "The line changed. Refresh before assigning quantities.");
      const lineTasks = order.tasks.filter((t) => t.order_line_id === selected!.order_line_id && t.current_version?.current && !t.archived_at);
      if (lineTasks.length !== request.entries.length || request.entries.reduce((sum, e) => sum + e.quantity, 0) !== selected!.quantity) fail("stale", "Select every current creative and assign the full line quantity.");
      const entries: AllocationEntry[] = [];
      for (const e of request.entries) {
        const task = lineTasks.find((t) => t.task_id === e.task_id);
        if (!task || task.attachment_id !== e.attachment_id || task.version !== e.expected_task_version || task.current_version?.version_id !== e.expected_version_id || task.quantity !== selected!.quantity || task.decision_context || order.tasks.filter((t) => t.attachment_id === e.attachment_id).length !== 1) fail("stale", "A creative changed or is shared across lines. Refresh before approving.");
        await validateDecision(order, task!, context, request.note);
        await (deps.reopenAction ?? reopenConfirmedAction)(order, task!);
        entries.push({ ...e, feedback_fingerprint: task!.current_version!.feedback_fingerprint, filename: task!.current_version!.filename, state: "pending", resulting_line_number: null });
      }
      const timestamp = now().toISOString();
      const record: CustomerAllocation = { batch_id: batchId, request_hash: hash, order_number: order.order_number, customer_id: order.customer_id!, grant_id: context.session.grant_id, participant_id: context.session.participant_id!, source_order_line_id: selected!.order_line_id!, source_line_number: selected!.line_number, line_quantity: selected!.quantity!, note: request.note, entries, state: "ready", record_version: 1, created_at: timestamp, updated_at: timestamp };
      if (!await reserve(record, audit(record, context, "proof.decision_prepared"))) {
        const raced = await read(order.order_number, batchId);
        if (raced && raced.request_hash === hash) return publicAllocation(bound(raced, context.session));
        fail("conflict", "An approval already exists for these creatives. Check its status before submitting again.");
      }
      return publicAllocation(record);
    },
    async list(context: Context) {
      authorize(context.session);
      const records = await (deps.list ?? listCustomerAllocations)(context.session.order_number);
      return records.filter((r) => r.customer_id === context.session.capability!.proof_customer_id && r.grant_id === context.session.grant_id && r.participant_id === context.session.participant_id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map(publicAllocation);
    },
    async advance(context: Context & { batch_id: string }) {
      authorize(context.session);
      if (!/^pbatch_[a-f0-9]{64}$/.test(context.batch_id)) fail("invalid", "Invalid approval reference.");
      let record = bound(await read(context.session.order_number, context.batch_id), context.session);
      if (record.state === "completed" || record.state === "paused") return publicAllocation(record);
      // Every call performs an authoritative read. No response status (including
      // a successful empty response) is itself evidence of an approved creative.
      let order: ProofOrder;
      try { order = await loadOrder(context); } catch (error) {
        if (error instanceof ProofCustomerApprovalError) throw error;
        return publicAllocation(record); // Keep optimistic/checking state on outage.
      }
      const cancelled = record.entries.some((entry) => order.tasks.some((task) => task.attachment_id === entry.attachment_id && (task.state === "cancelled" || order.lines.some((line) => line.order_line_id === task.order_line_id && line.cancelled))));
      // Completion is a normal result of the last approval. Reconcile submitted
      // work on a complete order, but never start another action there.
      if (cancelled || !["active", "complete"].includes(order.health)) return publicAllocation(await save(record, { ...record, state: "paused" }, context, "proof.decision_observed"));
      const submitted = record.entries.find((e) => e.state === "submitted");
      if (submitted) {
        const matches = order.tasks.filter((t) => t.attachment_id === submitted.attachment_id && t.current_version?.current && !t.archived_at);
        const approved = matches.length === 1 && matches[0]!.state === "approved" && matches[0]!.current_version!.approval_status?.toUpperCase() === "APPROVED" && matches[0]!.current_version!.version_id === submitted.expected_version_id && matches[0]!.quantity === submitted.quantity;
        if (!approved) return publicAllocation(record);
        try {
          if (!await (deps.recordApproval ?? recordActionApproval)(order, matches[0]!, record.batch_id)) return publicAllocation(record);
        } catch { return publicAllocation(record); } // Retry evidence/readback only, never the Lift action.
        const entries = record.entries.map((e) => e === submitted ? { ...e, state: "confirmed" as const, resulting_line_number: matches[0]!.line_number } : e);
        record = await save(record, { ...record, entries, state: entries.every((e) => e.state === "confirmed") ? "completed" : "ready" }, context, "proof.decision_observed", submitted);
        // A separate request starts the next creative, revalidating permission.
        return publicAllocation(record);
      }
      if (order.health !== "active") return publicAllocation(await save(record, { ...record, state: "paused" }, context, "proof.decision_observed"));
      const remaining = record.entries.filter((e) => e.state === "pending");
      const next = remaining[0];
      if (!next) return publicAllocation(record);
      // Lift can split or renumber lines during allocation. Match immutable
      // attachment identities, but require remaining quantities and membership
      // still to agree before authorizing any next external action.
      const current = order.tasks.filter((t) => t.attachment_id === next.attachment_id && t.current_version?.current && !t.archived_at);
      const task = current.length === 1 ? current[0] : undefined;
      const rest = task ? order.tasks.filter((t) => t.order_line_id === task.order_line_id && t.current_version?.current && !t.archived_at && t.state !== "approved") : [];
      const splitConfirmed = record.entries.some((entry) => entry.state === "confirmed");
      const valid = task && rest.length === remaining.length && remaining.every((e) => rest.some((t) =>
        t.attachment_id === e.attachment_id && t.current_version?.version_id === e.expected_version_id
        && t.current_version.feedback_fingerprint === e.feedback_fingerprint && t.quantity === task.quantity
        && (splitConfirmed || (t.version === e.expected_task_version && t.order_line_id === record.source_order_line_id))
        && t.state === "pending" && t.actionable && !t.decision_context
      )) && remaining.reduce((sum, e) => sum + e.quantity, 0) === task.quantity && remaining.every((e) => order.tasks.filter((t) => t.attachment_id === e.attachment_id).length === 1);
      if (!valid) return publicAllocation(await save(record, { ...record, state: "paused" }, context, "proof.decision_observed"));
      await validateDecision(order, task!, context, record.note);
      const environment = targetEnvironment(await (deps.target ?? readProofActionTargetConfig)("lift-standard-graphics"));
      const credentials = assertCredentialBoundary(await (deps.credentials ?? readTargetEnvironmentProofingApiRuntimeCredentials)("lift-standard-graphics", "env-lift-prod"), environment.endpoint_url);
      const plan = buildLiftProofingRuntimePlan({ action: "APPROVE", company_id: "91", proofing_id: next.attachment_id, approve_quantity: next.quantity, comment: record.note, revised_art_url: null });
      const issued = Math.floor(now().getTime() / 1000);
      let headers;
      try { headers = buildLiftProofingRuntimeHeaders({ plan, client_id: credentials.client_id, client_secret: credentials.client_secret, issued_at_epoch: issued, expires_at_epoch: issued + 90 }); }
      finally { credentials.client_id = ""; credentials.client_secret = ""; }
      const entries = record.entries.map((e) => e === next ? { ...e, state: "submitted" as const } : e);
      // Atomic version claim plus audit precedes the one PUT. Process death,
      // duplicate calls and response loss all leave a readback-only state.
      record = await save(record, { ...record, entries, state: "checking" }, context, "proof.decision_submission_started", next);
      try { await (deps.send ?? sendLiftProofingRuntimeAction)({ base_url: credentials.base_url, plan, headers, timeout_ms: 12_000 }); } catch { /* Readback owns the outcome; never resend. */ }
      return publicAllocation(record);
    }
  };
}
export const customerAllocationService = createCustomerAllocationService();

import { createHash } from "node:crypto";
import type { ProofAccessSession, ProofAuditEvent } from "@pathfinder/proof-domain";
import { assertProofRevisionAssetReadyForLift } from "@pathfinder/proof-domain/proof-asset-lifecycle";
import { buildLiftProofingRuntimeHeaders, buildLiftProofingRuntimePlan, sendLiftProofingRuntimeAction } from "@pathfinder/lift-proof-adapter/proofing-action-runtime";
import { readTargetEnvironmentProofingApiRuntimeCredentials } from "../lift-proofing-credentials.js";
import { readProofActionTargetConfig } from "./action-target-store.js";
import { ProofCustomerApprovalError, assertCredentialBoundary, targetEnvironment } from "./customer-approval-service.js";
import { allocationHash } from "./customer-allocation-store.js";
import { reopenConfirmedAction } from "./action-reopening-store.js";
import { getProofAssetUploadRecord } from "./asset-upload-store.js";
import { assembleProofRevisionAssetReadiness } from "./revision-asset-resolver.js";
import { getProofAuditEventByIdentity } from "./decision-ledger-store.js";
import { prepareProofApprovalDecision } from "./decision-contract.js";
import { getProofFeedbackAcknowledgement, getProofParticipant } from "./store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { syncProofOrder } from "./service.js";
import { listRevisionSubmissions, readRevisionSubmission, reserveRevisionSubmission, replaceRevisionSubmission, type RevisionSubmission } from "./customer-revision-store.js";

export const customerRevisionSubmissionEnabled = () => process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_SUBMISSION === "true";
type Context = { session: ProofAccessSession; correlation_id: string };
export type RevisionRequest = { asset_id: string; task_id: string; attachment_id: string; expected_task_version: number; expected_version_id: string; idempotency_key: string; note?: string | null };
const fail = (code: "disabled" | "not_allowed" | "invalid" | "stale" | "conflict", message: string): never => { throw new ProofCustomerApprovalError(code, message); };
export function revisionUploadOwnerAuditId(assetId: string) {
  const hash = createHash("sha256");
  for (const part of [assetId, "initialized", "1"]) hash.update(part).update("\0");
  return `paudit_asset-${hash.digest("hex")}`;
}
export function publicRevisionSubmission(record: RevisionSubmission) {
  return { submission_id: record.submission_id, task_id: record.task_id, attachment_id: record.attachment_id, version_id: record.version_id, asset_id: record.asset_id, filename: record.filename, state: record.state, automatic_retry: false as const, lift_outcome_confirmed: false as const };
}
function audit(record: RevisionSubmission, context: Context): ProofAuditEvent {
  return {
    event_id: `paudit_revision-${allocationHash([record.submission_id, record.record_version])}`, occurred_at: record.updated_at,
    action: record.state === "submitted" ? "proof.decision_submission_started" : "proof.decision_observed", outcome: "succeeded",
    order_number: record.order_number, order_line_id: null, task_id: record.task_id, attachment_id: record.attachment_id,
    grant_id: record.grant_id, participant_id: record.participant_id, actor_type: "customer_session", actor_id: context.session.session_id, correlation_id: context.correlation_id,
    metadata: { source: "public_api", decision_outcome: record.state === "submitted" ? "submission_uncertain" : "reconciling", proof_asset_id: record.asset_id }
  };
}
export function createCustomerRevisionService(deps: {
  enabled?: typeof customerRevisionSubmissionEnabled; runtime?: typeof getProofRuntimeConfig;
  sync?: typeof syncProofOrder; asset?: typeof getProofAssetUploadRecord; ownerAudit?: typeof getProofAuditEventByIdentity;
  participant?: typeof getProofParticipant; acknowledgement?: typeof getProofFeedbackAcknowledgement;
  read?: typeof readRevisionSubmission; reserve?: typeof reserveRevisionSubmission; replace?: typeof replaceRevisionSubmission;
  list?: typeof listRevisionSubmissions;
  reopen?: typeof reopenConfirmedAction; target?: typeof readProofActionTargetConfig; credentials?: typeof readTargetEnvironmentProofingApiRuntimeCredentials;
  send?: typeof sendLiftProofingRuntimeAction; now?: () => Date;
} = {}) {
  const now = deps.now ?? (() => new Date()), read = deps.read ?? readRevisionSubmission;
  function authorize(session: ProofAccessSession) {
    const flags = (deps.runtime ?? getProofRuntimeConfig)().feature_flags;
    if (!(deps.enabled ?? customerRevisionSubmissionEnabled)() || !flags.public_read || !flags.revision_upload || !flags.approve) fail("disabled", "Revised artwork submission is not enabled.");
    if (session.scope !== "review" || session.capability?.access_mode !== "review" || !/^\d{1,20}$/.test(session.capability?.proof_customer_id ?? "") || !session.participant_id) fail("not_allowed", "Identify the reviewer with review access first.");
  }
  function bound(record: RevisionSubmission | null, session: ProofAccessSession): RevisionSubmission {
    if (!record || record.order_number !== session.order_number || record.customer_id !== session.capability?.proof_customer_id || record.grant_id !== session.grant_id || record.participant_id !== session.participant_id) fail("not_allowed", "This artwork submission is not available in this review.");
    return record!;
  }
  return {
    async list(context: Context & { task_id: string }) {
      authorize(context.session);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(context.task_id)) fail("invalid", "Invalid proof reference.");
      // Recovery remains possible after a proof changes, but receipts never
      // confer authority to act on the replacement proof or another review.
      return (await (deps.list ?? listRevisionSubmissions)(context.session.order_number))
        .filter(record => record.order_number === context.session.order_number
          && record.customer_id === context.session.capability!.proof_customer_id
          && record.grant_id === context.session.grant_id
          && record.participant_id === context.session.participant_id
          && record.task_id === context.task_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(publicRevisionSubmission);
    },
    async status(context: Context & { submission_id: string }) {
      authorize(context.session);
      if (!/^prevision_send_[a-f0-9]{64}$/.test(context.submission_id)) fail("invalid", "Invalid artwork submission reference.");
      return publicRevisionSubmission(bound(await read(context.session.order_number, context.submission_id), context.session));
    },
    async submit(context: Context & { request: RevisionRequest }) {
      authorize(context.session);
      const r = context.request;
      if (!r || !/^passet_[a-f0-9]{64}$/.test(r.asset_id ?? "") || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(r.idempotency_key ?? "") || typeof r.task_id !== "string" || typeof r.attachment_id !== "string" || typeof r.expected_version_id !== "string" || !Number.isSafeInteger(r.expected_task_version) || r.expected_task_version < 1 || (r.note != null && (typeof r.note !== "string" || r.note.length > 2000))) fail("invalid", "The artwork submission is invalid.");
      const note = r.note?.trim() || null;
      const requestHash = allocationHash([r.asset_id, r.task_id, r.attachment_id, r.expected_task_version, r.expected_version_id, note]);
      const submissionId = `prevision_send_${allocationHash([context.session.order_number, context.session.grant_id, context.session.participant_id, r.idempotency_key])}`;
      const previous = await read(context.session.order_number, submissionId);
      if (previous) {
        const record = bound(previous, context.session);
        if (record.request_hash !== requestHash) fail("conflict", "This submission already refers to different artwork.");
        return publicRevisionSubmission(record); // Never replay a transport attempt.
      }
      const { order } = await (deps.sync ?? syncProofOrder)(context.session.order_number, { allowed_customer_ids: [context.session.capability!.proof_customer_id], audit_context: { actor_type: "customer_session", actor_id: context.session.session_id, correlation_id: context.correlation_id, source: "public_api" } });
      const task = order.tasks.find(t => t.task_id === r.task_id);
      if (order.order_number !== context.session.order_number || order.customer_id !== context.session.capability!.proof_customer_id || order.health !== "active" || !task || task.decision_context || !task.order_line_id || order.lines.some(l => l.order_line_id === task.order_line_id && l.cancelled) || order.tasks.filter(t => t.order_line_id === task.order_line_id && t.current_version?.current && !t.archived_at).length !== 1 || order.tasks.filter(t => t.attachment_id === r.attachment_id && !t.archived_at).length !== 1) fail("stale", "This proof changed or needs a different revision workflow. Refresh before submitting.");
      // Reuse current-art/participant/feedback integrity checks; this is only
      // preflight validation, never an approval intent or approval ledger write.
      prepareProofApprovalDecision({ order, binding: { order_number: order.order_number, task_id: r.task_id, attachment_id: r.attachment_id, expected_task_version: r.expected_task_version, expected_version_id: r.expected_version_id }, participant: await (deps.participant ?? getProofParticipant)(context.session.grant_id, context.session.participant_id!), participant_id: context.session.participant_id, grant_id: context.session.grant_id, feedback_acknowledgement: await (deps.acknowledgement ?? getProofFeedbackAcknowledgement)(context.session.grant_id, context.session.participant_id!, task!.task_id), idempotency_key: r.idempotency_key, note });
      const asset = await (deps.asset ?? getProofAssetUploadRecord)(order.order_number, r.asset_id);
      if (!asset) fail("not_allowed", "This revised artwork is not available.");
      const owner = await (deps.ownerAudit ?? getProofAuditEventByIdentity)(order.order_number, asset!.initialized_at, revisionUploadOwnerAuditId(r.asset_id));
      if (!owner || owner.action !== "proof.asset_upload_initialized" || owner.actor_type !== "customer_session" || owner.grant_id !== context.session.grant_id || owner.participant_id !== context.session.participant_id || owner.order_number !== order.order_number || owner.task_id !== task!.task_id || owner.attachment_id !== r.attachment_id || owner.metadata.proof_asset_id !== r.asset_id) fail("not_allowed", "This upload belongs to another review. Upload your revised artwork in this review.");
      let ready;
      try {
        const value = assembleProofRevisionAssetReadiness(asset!);
        ready = assertProofRevisionAssetReadyForLift({ asset: value, binding: { asset_id: r.asset_id, order_number: order.order_number, task_id: task!.task_id, attachment_id: r.attachment_id, expected_proof_version_id: r.expected_version_id, expected_revision_id: asset!.revision_id, expected_source_object_version_id: asset!.source_object_version_id!, expected_outbound_object_version_id: asset!.outbound_object_version_id!, expected_delivery_url_sha256: asset!.delivery_url_sha256! }, now: now(), expected_delivery_host: "go.vornan.co" });
      } catch { fail("stale", "The revised artwork is not ready for submission. Check its file status and try again."); }
      const environment = targetEnvironment(await (deps.target ?? readProofActionTargetConfig)("lift-standard-graphics"));
      const credentials = assertCredentialBoundary(await (deps.credentials ?? readTargetEnvironmentProofingApiRuntimeCredentials)("lift-standard-graphics", "env-lift-prod"), environment.endpoint_url);
      const plan = buildLiftProofingRuntimePlan({ action: "REVISED_ART_WILL_BE_SENT", company_id: "91", proofing_id: r.attachment_id, comment: note, revised_art_url: ready!.delivery_url, approve_quantity: null });
      const issued = Math.floor(now().getTime() / 1000);
      let headers;
      try { headers = buildLiftProofingRuntimeHeaders({ plan, client_id: credentials.client_id, client_secret: credentials.client_secret, issued_at_epoch: issued, expires_at_epoch: issued + 90 }); }
      finally { credentials.client_id = ""; credentials.client_secret = ""; }
      await (deps.reopen ?? reopenConfirmedAction)(order, task!);
      const stamp = now().toISOString();
      const record: RevisionSubmission = { submission_id: submissionId, request_hash: requestHash, order_number: order.order_number, customer_id: order.customer_id!, grant_id: context.session.grant_id, participant_id: context.session.participant_id!, task_id: task!.task_id, attachment_id: r.attachment_id, version_id: r.expected_version_id, asset_id: r.asset_id, filename: asset!.original_filename, source_sha256: ready!.sha256, outbound_sha256: ready!.outbound_sha256, delivery_url_sha256: ready!.delivery_url_sha256, source_version_hash: allocationHash(ready!.source_object_version_id), outbound_version_hash: allocationHash(ready!.outbound_object_version_id), state: "submitted", record_version: 1, created_at: stamp, updated_at: stamp };
      if (!await (deps.reserve ?? reserveRevisionSubmission)(record, audit(record, context))) {
        const raced = await read(order.order_number, submissionId);
        if (raced && raced.request_hash === requestHash) return publicRevisionSubmission(bound(raced, context.session));
        fail("conflict", "A proof action is already in progress. Check its status before submitting again.");
      }
      let accepted = false;
      try { const result = await (deps.send ?? sendLiftProofingRuntimeAction)({ base_url: credentials.base_url, plan, headers, timeout_ms: 12000 }); accepted = result.status !== null && result.status >= 200 && result.status < 300; } catch { /* One shot, unknown outcome is not failure. */ }
      const next: RevisionSubmission = { ...record, state: accepted ? "accepted" : "checking", record_version: 2, updated_at: now().toISOString() };
      // A successful transport does not prove that Lift consumed the file. Do
      // not synthesize confirmed status from an unrelated/new attachment.
      try { if (await (deps.replace ?? replaceRevisionSubmission)(record, next, audit(next, context))) return publicRevisionSubmission(next); } catch { /* Stored submitted receipt remains recoverable. */ }
      return publicRevisionSubmission(record);
    }
  };
}
export const customerRevisionService = createCustomerRevisionService();

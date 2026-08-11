import { createHash } from "node:crypto";
import {
  recordProofTaskDecisionContext,
  type ProofAuditEvent,
  type ProofOrder,
  type ProofTask
} from "@pathfinder/proof-domain";
import {
  assertProofRevisionAssetReadyForLift,
  ProofAssetLifecycleError,
  type ProofRevisionAssetReadiness
} from "@pathfinder/proof-domain/proof-asset-lifecycle";
import {
  buildLiftProofingRuntimeHeaders,
  buildLiftProofingRuntimePlan,
  sendLiftProofingRuntimeAction,
  type LiftProofingAction,
  type LiftProofingRuntimeObservation,
  type LiftProofingRuntimePlan
} from "@pathfinder/lift-proof-adapter/proofing-action-runtime";
import {
  readTargetEnvironmentProofingApiRuntimeCredentials,
  type TargetProofingApiRuntimeCredentials
} from "../lift-proofing-credentials.js";
import {
  listTargets,
  resolveCustomerProofCapabilityForOrder,
  type ResolvedCustomerProofCapability,
  type TargetConfig
} from "../store.js";
import { syncProofOrder } from "./service.js";
import { persistProofOrder } from "./store.js";
import {
  getProofOperatorActionQaConfig,
  type ProofOperatorActionQaConfig
} from "./operator-action-config.js";
import {
  getProofOperatorActionRecord,
  reserveProofOperatorAction,
  transitionProofOperatorAction,
  type ProofOperatorActionRecord
} from "./operator-action-store.js";
import { resolveProofRevisionAssetReadiness } from "./revision-asset-resolver.js";

const TARGET_ID = "lift-standard-graphics";
const ENVIRONMENT_ID = "env-lift-prod";
const CUSTOMER_ID = "1249";
const COMPANY_ID = "91";
const ACTION_USER = "VORNAN_PROOF";
const RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export class ProofOperatorActionError extends Error {
  constructor(
    public readonly code:
      | "disabled"
      | "unauthenticated"
      | "not_allowed"
      | "invalid"
      | "stale"
      | "conflict"
      | "already_attempted",
    message: string
  ) {
    super(message);
    this.name = "ProofOperatorActionError";
  }
}

export interface ProofOperatorActionRequest {
  order_number: string;
  task_id: string;
  attachment_id: string;
  action: LiftProofingAction;
  idempotency_key: string;
  target_id?: string;
  environment_id?: string;
  comment?: string | null;
  revision_asset_id?: string | null;
  approval_mode?: "simple" | "quantity_allocation" | null;
  approve_quantity?: number | null;
  allocation_plan?: Array<{
    task_id: string;
    attachment_id: string;
    approve_quantity: number;
  }> | null;
}

export interface ProofOperatorActionDependencies {
  syncOrder?: typeof syncProofOrder;
  listTargetConfigs?: typeof listTargets;
  readCredentials?: typeof readTargetEnvironmentProofingApiRuntimeCredentials;
  reserve?: typeof reserveProofOperatorAction;
  getRecord?: typeof getProofOperatorActionRecord;
  transition?: typeof transitionProofOperatorAction;
  persistOrder?: typeof persistProofOrder;
  send?: typeof sendLiftProofingRuntimeAction;
  resolveRevisionAsset?: (
    assetId: string,
    orderNumber?: string
  ) => Promise<ProofRevisionAssetReadiness | null>;
  resolveCustomerCapability?: (
    orderNumber: string
  ) => Promise<ResolvedCustomerProofCapability>;
  runtimeConfig?: () => ProofOperatorActionQaConfig;
  now?: () => Date;
}

type ResolvedRevisionAsset = ProofRevisionAssetReadiness;

function sha256(...parts: Array<string | null>) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part ?? "<null>");
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value: unknown, maximum: number) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ProofOperatorActionError("invalid", "Proof action text is invalid.");
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new ProofOperatorActionError("invalid", "Proof action text is too long.");
  }
  return normalized || null;
}

function requireOperator(operatorUid: string | null | undefined) {
  if (!operatorUid || !/^[A-Za-z0-9_.:-]{1,180}$/.test(operatorUid)) {
    throw new ProofOperatorActionError(
      "unauthenticated",
      "An authenticated Pathfinder operator is required."
    );
  }
  return `operator_${sha256("vornan-proof-operator-v1", operatorUid)}`;
}

function requireGate(
  now: Date,
  gate: ProofOperatorActionQaConfig
) {
  const expiry = gate.activation_expires_at
    ? Date.parse(gate.activation_expires_at)
    : Number.NaN;
  if (!gate.enabled || !Number.isFinite(expiry) || expiry <= now.getTime()) {
    throw new ProofOperatorActionError(
      "disabled",
      "Supervised Proof action testing is disabled or its bounded window has expired."
    );
  }
  return gate;
}

async function advancedCustomerCapabilityFingerprint(
  request: ReturnType<typeof normalizedRequest>,
  resolve: (orderNumber: string) => Promise<ResolvedCustomerProofCapability>
) {
  if (request.approval_mode !== "quantity_allocation") return null;
  const capability = await resolve(request.order_number);
  if (
    capability.association_status !== "associated" ||
    !capability.pathfinder_customer_id ||
    capability.access_mode !== "review" ||
    capability.review_experience !== "advanced" ||
    !capability.policy_updated_at
  ) {
    throw new ProofOperatorActionError(
      "not_allowed",
      "Advanced Proof allocation is not enabled for the associated Pathfinder customer or order."
    );
  }
  return sha256(
    "vornan-proof-customer-capability-v1",
    capability.pathfinder_customer_id,
    capability.access_mode,
    capability.review_experience,
    capability.source,
    capability.policy_updated_at
  );
}

function normalizedRequest(input: ProofOperatorActionRequest) {
  const orderNumber = input.order_number?.trim().toUpperCase();
  if (
    !/^A\d{7,8}$/.test(orderNumber) ||
    typeof input.task_id !== "string" ||
    !input.task_id.trim() ||
    typeof input.attachment_id !== "string" ||
    !input.attachment_id.trim() ||
    !IDENTIFIER.test(input.idempotency_key ?? "") ||
    (input.target_id !== undefined && input.target_id !== TARGET_ID) ||
    (input.environment_id !== undefined && input.environment_id !== ENVIRONMENT_ID)
  ) {
    throw new ProofOperatorActionError("invalid", "Proof action request is invalid.");
  }
  const revisionAssetId = boundedText(input.revision_asset_id, 80);
  if (
    (input.action === "REVISED_ART_WILL_BE_SENT" &&
      !/^passet_[a-f0-9]{64}$/.test(revisionAssetId ?? "")) ||
    (input.action !== "REVISED_ART_WILL_BE_SENT" && revisionAssetId !== null)
  ) {
    throw new ProofOperatorActionError(
      "invalid",
      "Revised-art actions require one verified Pathfinder Proof asset."
    );
  }
  const approvalMode = input.action === "APPROVE"
    ? input.approval_mode ?? "simple"
    : null;
  if (
    (input.action === "APPROVE" &&
      approvalMode !== "simple" &&
      approvalMode !== "quantity_allocation") ||
    (input.action !== "APPROVE" &&
      (input.approval_mode != null ||
        input.approve_quantity != null ||
        input.allocation_plan != null))
  ) {
    throw new ProofOperatorActionError(
      "invalid",
      "Approval options are only valid for an approval action."
    );
  }
  let approveQuantity: number | null = null;
  let allocationPlan: Array<{
    task_id: string;
    attachment_id: string;
    approve_quantity: number;
  }> | null = null;
  if (approvalMode === "simple") {
    if (input.approve_quantity != null || input.allocation_plan != null) {
      throw new ProofOperatorActionError(
        "invalid",
        "Simple approval does not accept a quantity allocation."
      );
    }
  } else if (approvalMode === "quantity_allocation") {
    if (
      !Number.isSafeInteger(input.approve_quantity) ||
      (input.approve_quantity ?? 0) <= 0 ||
      !Array.isArray(input.allocation_plan) ||
      input.allocation_plan.length < 2 ||
      input.allocation_plan.length > 20
    ) {
      throw new ProofOperatorActionError(
        "invalid",
        "Advanced approval requires a complete positive whole-number allocation."
      );
    }
    const seenTasks = new Set<string>();
    const seenAttachments = new Set<string>();
    allocationPlan = input.allocation_plan.map((entry) => {
      if (
        !entry ||
        typeof entry.task_id !== "string" ||
        !entry.task_id.trim() ||
        typeof entry.attachment_id !== "string" ||
        !entry.attachment_id.trim() ||
        !Number.isSafeInteger(entry.approve_quantity) ||
        entry.approve_quantity <= 0 ||
        seenTasks.has(entry.task_id.trim()) ||
        seenAttachments.has(entry.attachment_id.trim())
      ) {
        throw new ProofOperatorActionError(
          "invalid",
          "Advanced approval allocation entries are invalid."
        );
      }
      seenTasks.add(entry.task_id.trim());
      seenAttachments.add(entry.attachment_id.trim());
      return {
        task_id: entry.task_id.trim(),
        attachment_id: entry.attachment_id.trim(),
        approve_quantity: entry.approve_quantity
      };
    }).sort((left, right) =>
      left.attachment_id.localeCompare(right.attachment_id)
    );
    approveQuantity = input.approve_quantity!;
    const selected = allocationPlan.find(
      (entry) =>
        entry.task_id === input.task_id.trim() &&
        entry.attachment_id === input.attachment_id.trim()
    );
    if (!selected || selected.approve_quantity !== approveQuantity) {
      throw new ProofOperatorActionError(
        "invalid",
        "The selected proof quantity must match the complete allocation."
      );
    }
  }
  return {
    order_number: orderNumber,
    task_id: input.task_id.trim(),
    attachment_id: input.attachment_id.trim(),
    action: input.action,
    idempotency_key: input.idempotency_key,
    comment: boundedText(input.comment, 2_000),
    revision_asset_id: revisionAssetId,
    approval_mode: approvalMode,
    approve_quantity: approveQuantity,
    allocation_plan: allocationPlan
  };
}

function currentTask(order: ProofOrder, input: ReturnType<typeof normalizedRequest>) {
  if (order.customer_id !== CUSTOMER_ID) {
    throw new ProofOperatorActionError("not_allowed", "Proof order is outside LTL Demo customer 1249.");
  }
  const task = order.tasks.find((candidate) => candidate.task_id === input.task_id);
  if (
    !task ||
    !task.actionable ||
    task.attachment_id !== input.attachment_id ||
    !task.current_version ||
    task.current_version.attachment_id !== input.attachment_id
  ) {
    throw new ProofOperatorActionError(
      "stale",
      "The selected Proof attachment is no longer the current actionable version."
    );
  }
  return task;
}

function executionScopeSha256(order: ProofOrder, task: ProofTask) {
  const currentProofs = (task.order_line_id
    ? order.tasks.filter(
        (candidate) =>
          candidate.order_line_id === task.order_line_id &&
          candidate.attachment_id &&
          candidate.current_version?.attachment_id === candidate.attachment_id
      )
    : [task]
  ).sort((left, right) =>
    (left.attachment_id ?? "").localeCompare(right.attachment_id ?? "")
  );
  return sha256(
    "vornan-proof-execution-scope-v1",
    order.order_number,
    task.order_line_id ?? task.task_id,
    JSON.stringify(currentProofs.map((proof) => ({
      task_id: proof.task_id,
      task_version: proof.version,
      attachment_id: proof.attachment_id,
      current_version_id: proof.current_version?.version_id ?? null,
      feedback_fingerprint: proof.current_version?.feedback_fingerprint ?? null,
      quantity: proof.quantity,
      state: proof.state
    })))
  );
}

function approvalContext(
  order: ProofOrder,
  request: ReturnType<typeof normalizedRequest>,
  task: ProofTask
) {
  if (request.action !== "APPROVE") {
    return {
      expected_line_quantity: null,
      allocation_plan_sha256: null
    };
  }
  if (!Number.isSafeInteger(task.quantity) || (task.quantity ?? 0) <= 0) {
    throw new ProofOperatorActionError(
      "stale",
      "The authoritative Lift line quantity is unavailable for approval."
    );
  }
  const lineQuantity = task.quantity!;
  const currentProofs = order.tasks
    .filter(
      (candidate) =>
        candidate.order_line_id === task.order_line_id &&
        candidate.actionable &&
        candidate.attachment_id &&
        candidate.current_version?.attachment_id === candidate.attachment_id
    )
    .sort((left, right) =>
      (left.attachment_id ?? "").localeCompare(right.attachment_id ?? "")
    );
  if (request.approval_mode === "simple") {
    if (currentProofs.length !== 1) {
      throw new ProofOperatorActionError(
        "invalid",
        "A line with multiple current proofs requires a complete Advanced allocation."
      );
    }
    return {
      expected_line_quantity: lineQuantity,
      allocation_plan_sha256: null
    };
  }
  if (!task.order_line_id || !request.allocation_plan) {
    throw new ProofOperatorActionError(
      "invalid",
      "Advanced approval requires a current Lift line and complete allocation."
    );
  }
  if (
    currentProofs.length < 2 ||
    currentProofs.some((candidate) => candidate.quantity !== lineQuantity) ||
    currentProofs.length !== request.allocation_plan.length
  ) {
    throw new ProofOperatorActionError(
      "stale",
      "Advanced approval requires multiple current proofs on one unchanged Lift line."
    );
  }
  for (let index = 0; index < currentProofs.length; index += 1) {
    const proof = currentProofs[index]!;
    const allocation = request.allocation_plan[index]!;
    if (
      proof.task_id !== allocation.task_id ||
      proof.attachment_id !== allocation.attachment_id
    ) {
      throw new ProofOperatorActionError(
        "stale",
        "The advanced approval allocation no longer matches the current proofs."
      );
    }
  }
  const allocated = request.allocation_plan.reduce(
    (total, entry) => total + entry.approve_quantity,
    0
  );
  if (allocated !== lineQuantity) {
    throw new ProofOperatorActionError(
      "invalid",
      "Advanced approval must allocate the full current line quantity with no remainder."
    );
  }
  return {
    expected_line_quantity: lineQuantity,
    allocation_plan_sha256: sha256(
      "vornan-proof-allocation-v1",
      task.order_line_id,
      String(lineQuantity),
      JSON.stringify(currentProofs.map((proof, index) => ({
        task_id: proof.task_id,
        task_version: proof.version,
        attachment_id: proof.attachment_id,
        current_version_id: proof.current_version!.version_id,
        feedback_fingerprint: proof.current_version!.feedback_fingerprint,
        approve_quantity: request.allocation_plan![index]!.approve_quantity
      })))
    )
  };
}

function targetEnvironment(targets: TargetConfig[]) {
  const target = targets.find(
    (candidate) =>
      candidate.target_id === TARGET_ID &&
      candidate.adapter === "lift-standard-graphics"
  );
  const environment = target?.environments.find(
    (candidate) =>
      candidate.environment_id === ENVIRONMENT_ID &&
      candidate.role === "PROD" &&
      candidate.status === "Active"
  );
  if (!target || !environment) {
    throw new ProofOperatorActionError(
      "not_allowed",
      "The supervised Proof action destination is not active."
    );
  }
  return environment;
}

function buildPlan(
  input: ReturnType<typeof normalizedRequest>,
  revisionAsset: ResolvedRevisionAsset | null
): LiftProofingRuntimePlan {
  try {
    return buildLiftProofingRuntimePlan({
      action: input.action,
      company_id: COMPANY_ID,
      proofing_id: input.attachment_id,
      comment: input.comment,
      revised_art_url: revisionAsset?.delivery_url ?? null,
      approve_quantity: input.approve_quantity
    });
  } catch (error) {
    throw new ProofOperatorActionError(
      "invalid",
      error instanceof Error ? error.message : "Proof action could not be prepared."
    );
  }
}

function recordHash(input: {
  request: ReturnType<typeof normalizedRequest>;
  task: ProofTask;
  plan: LiftProofingRuntimePlan;
  revisionAsset: ResolvedRevisionAsset | null;
  approval: ReturnType<typeof approvalContext>;
  executionScopeSha256: string;
  customerCapabilitySha256: string | null;
}) {
  return sha256(
    "vornan-proof-operator-action-v1",
    input.request.action,
    COMPANY_ID,
    input.request.order_number,
    input.request.task_id,
    input.request.attachment_id,
    String(input.task.version),
    input.task.current_version?.version_id ?? null,
    input.task.current_version?.feedback_fingerprint ?? null,
    TARGET_ID,
    ENVIRONMENT_ID,
    input.plan.canonical_body_sha256,
    input.executionScopeSha256,
    input.request.approval_mode,
    input.request.approve_quantity === null
      ? null
      : String(input.request.approve_quantity),
    input.approval.expected_line_quantity === null
      ? null
      : String(input.approval.expected_line_quantity),
    input.approval.allocation_plan_sha256,
    input.customerCapabilitySha256,
    input.revisionAsset?.asset_id ?? null,
    input.revisionAsset?.publication_id ?? null,
    input.revisionAsset?.revision_id ?? null,
    input.revisionAsset?.replaces_proof_version_id ?? null,
    input.revisionAsset?.source_object_version_id ?? null,
    input.revisionAsset?.outbound_object_version_id ?? null,
    input.revisionAsset?.sha256 ?? null,
    input.revisionAsset?.outbound_sha256 ?? null,
    input.revisionAsset?.delivery_url_sha256 ?? null,
    input.revisionAsset ? String(input.revisionAsset.lift_not_before_epoch) : null,
    input.revisionAsset?.retention_anchor_at ?? null,
    input.revisionAsset ? String(input.revisionAsset.retention_days) : null,
    input.revisionAsset
      ? String(input.revisionAsset.cleanup_eligible_at_epoch)
      : null
  );
}

async function readyRevisionAsset(input: {
  request: ReturnType<typeof normalizedRequest>;
  task: ProofTask;
  now: Date;
  resolve: (
    assetId: string,
    orderNumber?: string
  ) => Promise<ProofRevisionAssetReadiness | null>;
}) {
  if (input.request.action !== "REVISED_ART_WILL_BE_SENT") {
    return null;
  }
  const assetId = input.request.revision_asset_id!;
  const asset = await input.resolve(assetId, input.request.order_number);
  if (!asset) {
    throw new ProofOperatorActionError(
      "not_allowed",
      "The selected revised artwork is not a verified Pathfinder Proof upload."
    );
  }
  try {
    const expectedDeliveryUrlSha256 = sha256Text(asset.delivery_url);
    const ready = assertProofRevisionAssetReadyForLift({
      asset,
      binding: {
        order_number: input.request.order_number,
        task_id: input.task.task_id,
        attachment_id: input.request.attachment_id,
        expected_proof_version_id: input.task.current_version!.version_id,
        expected_revision_id: asset.revision_id,
        expected_source_object_version_id: asset.source_object_version_id,
        expected_outbound_object_version_id: asset.outbound_object_version_id,
        expected_delivery_url_sha256: expectedDeliveryUrlSha256,
        asset_id: assetId
      },
      now: input.now
    });
    return ready;
  } catch (error) {
    throw new ProofOperatorActionError(
      "not_allowed",
      error instanceof ProofAssetLifecycleError
        ? error.message
        : "The revised artwork is not ready for Lift."
    );
  }
}

function auditEvent(input: {
  record: ProofOperatorActionRecord;
  eventId: string;
  action: ProofAuditEvent["action"];
  actorId: string;
  correlationId: string;
  occurredAt: string;
  classification?: string | null;
}): ProofAuditEvent {
  return {
    event_id: input.eventId,
    occurred_at: input.occurredAt,
    action: input.action,
    outcome: "succeeded",
    order_number: input.record.order_number,
    task_id: input.record.task_id,
    order_line_id: input.record.order_line_id,
    attachment_id: input.record.attachment_id,
    grant_id: null,
    participant_id: null,
    actor_type: "operator",
    actor_id: input.actorId,
    correlation_id: input.correlationId,
    metadata: {
      source: "operator",
      operator_action_kind: input.record.action,
      decision_outcome: input.record.outcome,
      ...(input.classification
        ? { response_classification: input.classification }
        : {})
    }
  };
}

function sanitized(record: ProofOperatorActionRecord) {
  return {
    action_id: `poperator_${sha256(
      "vornan-proof-operator-public-id-v1",
      record.order_number,
      record.idempotency_key
    )}`,
    order_number: record.order_number,
    task_id: record.task_id,
    order_line_id: record.order_line_id,
    attachment_id: record.attachment_id,
    action: record.action,
    outcome: record.outcome,
    record_version: record.record_version,
    canonical_digest: record.canonical_body_hash,
    request_digest: record.request_body_sha256,
    attempt_id: record.attempt_id,
    response_classification: record.response_classification,
    automatic_retry: false as const
  };
}

function assertCredentialBoundary(
  credentials: TargetProofingApiRuntimeCredentials,
  environmentEndpointUrl: string
) {
  let environmentOrigin = "";
  let proofingOrigin = "";
  try {
    environmentOrigin = new URL(environmentEndpointUrl).origin;
    proofingOrigin = new URL(credentials.base_url).origin;
  } catch {
    // The shared target and credential validators normally prevent this.
  }
  if (
    credentials.company_id !== COMPANY_ID ||
    credentials.action_user_name !== ACTION_USER ||
    !environmentOrigin ||
    proofingOrigin !== environmentOrigin
  ) {
    throw new ProofOperatorActionError(
      "not_allowed",
      "Proofing API configuration does not match the locked production environment, company 91, and VORNAN_PROOF."
    );
  }
  return credentials;
}

export function createProofOperatorActionService(
  dependencies: ProofOperatorActionDependencies = {}
) {
  const syncOrder = dependencies.syncOrder ?? syncProofOrder;
  const listTargetConfigs = dependencies.listTargetConfigs ?? listTargets;
  const readCredentials =
    dependencies.readCredentials ??
    readTargetEnvironmentProofingApiRuntimeCredentials;
  const reserve = dependencies.reserve ?? reserveProofOperatorAction;
  const getRecord = dependencies.getRecord ?? getProofOperatorActionRecord;
  const transition = dependencies.transition ?? transitionProofOperatorAction;
  const persistOrder = dependencies.persistOrder ?? persistProofOrder;
  const send = dependencies.send ?? sendLiftProofingRuntimeAction;
  const resolveRevisionAsset =
    dependencies.resolveRevisionAsset ??
    ((assetId: string, orderNumber?: string) =>
      orderNumber
        ? resolveProofRevisionAssetReadiness(orderNumber, assetId)
        : Promise.resolve(null));
  const resolveCustomerCapability =
    dependencies.resolveCustomerCapability ?? resolveCustomerProofCapabilityForOrder;
  const runtimeConfig =
    dependencies.runtimeConfig ?? getProofOperatorActionQaConfig;
  const now = dependencies.now ?? (() => new Date());

  return {
    async prepare(input: {
      request: ProofOperatorActionRequest;
      operator_uid: string;
      correlation_id: string;
    }) {
      const currentTime = now();
      const actorId = requireOperator(input.operator_uid);
      const gate = requireGate(currentTime, runtimeConfig());
      const request = normalizedRequest(input.request);
      if (
        request.approval_mode === "quantity_allocation" &&
        !gate.advanced_quantity_allocation_enabled
      ) {
        throw new ProofOperatorActionError(
          "not_allowed",
          "Advanced Proof quantity allocation is not enabled for this QA window."
        );
      }
      const customerCapabilitySha256 = await advancedCustomerCapabilityFingerprint(
        request,
        resolveCustomerCapability
      );
      if (!gate.allowed_order_numbers.includes(request.order_number)) {
        throw new ProofOperatorActionError(
          "not_allowed",
          "Proof order is not in the bounded operator QA allowlist."
        );
      }
      targetEnvironment(await listTargetConfigs());
      const { order } = await syncOrder(request.order_number, {
        allowed_customer_ids: [CUSTOMER_ID],
        audit_context: {
          actor_type: "operator",
          actor_id: actorId,
          correlation_id: input.correlation_id,
          source: "operator"
        }
      });
      const task = currentTask(order, request);
      const executionScope = executionScopeSha256(order, task);
      const approval = approvalContext(order, request, task);
      const revisionAsset = await readyRevisionAsset({
        request,
        task,
        now: currentTime,
        resolve: resolveRevisionAsset
      });
      const plan = buildPlan(request, revisionAsset);
      const occurredAt = currentTime.toISOString();
      const canonicalHash = recordHash({
        request,
        task,
        plan,
        revisionAsset,
        approval,
        executionScopeSha256: executionScope,
        customerCapabilitySha256
      });
      const preparedAuditEventId = `paudit_operator-${sha256(
        "vornan-proof-operator-action-audit-v1",
        request.order_number,
        request.idempotency_key,
        canonicalHash
      )}`;
      const record: ProofOperatorActionRecord = {
        idempotency_key: request.idempotency_key,
        canonical_body_hash: canonicalHash,
        request_body_sha256: plan.canonical_body_sha256,
        action: request.action,
        order_number: request.order_number,
        task_id: task.task_id,
        order_line_id: task.order_line_id,
        attachment_id: request.attachment_id,
        expected_task_version: task.version,
        expected_version_id: task.current_version!.version_id,
        feedback_fingerprint: task.current_version!.feedback_fingerprint,
        execution_scope_sha256: executionScope,
        approval_mode: request.approval_mode,
        approve_quantity: request.approve_quantity,
        expected_line_quantity: approval.expected_line_quantity,
        allocation_plan_sha256: approval.allocation_plan_sha256,
        customer_capability_sha256: customerCapabilitySha256,
        target_id: TARGET_ID,
        environment_id: ENVIRONMENT_ID,
        note_sha256: request.comment ? sha256(request.comment) : null,
        revision_asset_id: revisionAsset?.asset_id ?? null,
        revision_publication_id: revisionAsset?.publication_id ?? null,
        revision_id: revisionAsset?.revision_id ?? null,
        revision_source_object_version_sha256: revisionAsset
          ? sha256Text(revisionAsset.source_object_version_id)
          : null,
        revision_outbound_object_version_sha256: revisionAsset
          ? sha256Text(revisionAsset.outbound_object_version_id)
          : null,
        revision_asset_sha256: revisionAsset?.sha256 ?? null,
        revision_outbound_sha256: revisionAsset?.outbound_sha256 ?? null,
        revision_delivery_url_sha256:
          revisionAsset?.delivery_url_sha256 ?? null,
        revision_lift_not_before_epoch:
          revisionAsset?.lift_not_before_epoch ?? null,
        revision_retention_anchor_at:
          revisionAsset?.retention_anchor_at ?? null,
        revision_retention_days: revisionAsset?.retention_days ?? null,
        revision_cleanup_eligible_at_epoch:
          revisionAsset?.cleanup_eligible_at_epoch ?? null,
        prepared_audit_event_id: preparedAuditEventId,
        outcome: "prepared",
        record_version: 1,
        created_at: occurredAt,
        updated_at: occurredAt,
        expires_at_epoch:
          Math.floor(currentTime.getTime() / 1_000) + RECORD_TTL_SECONDS,
        attempt_id: null,
        response_classification: null
      };
      const result = await reserve(
        record,
        auditEvent({
          record,
          eventId: preparedAuditEventId,
          action: "proof.operator_action_prepared",
          actorId,
          correlationId: input.correlation_id,
          occurredAt
        })
      );
      return {
        status: result.status,
        confirmation_phrase: `CONFIRM ${record.action} ${record.order_number} ${record.attachment_id}`,
        operator_action: sanitized(result.record)
      };
    },

    async execute(input: {
      request: ProofOperatorActionRequest;
      confirmation_phrase: string;
      operator_uid: string;
      correlation_id: string;
    }) {
      const currentTime = now();
      const actorId = requireOperator(input.operator_uid);
      const gate = requireGate(currentTime, runtimeConfig());
      const request = normalizedRequest(input.request);
      if (
        request.approval_mode === "quantity_allocation" &&
        !gate.advanced_quantity_allocation_enabled
      ) {
        throw new ProofOperatorActionError(
          "not_allowed",
          "Advanced Proof quantity allocation is not enabled for this QA window."
        );
      }
      const customerCapabilitySha256 = await advancedCustomerCapabilityFingerprint(
        request,
        resolveCustomerCapability
      );
      if (!gate.allowed_order_numbers.includes(request.order_number)) {
        throw new ProofOperatorActionError("not_allowed", "Proof order is not allowlisted.");
      }
      const expectedConfirmation = `CONFIRM ${request.action} ${request.order_number} ${request.attachment_id}`;
      if (input.confirmation_phrase !== expectedConfirmation) {
        throw new ProofOperatorActionError(
          "invalid",
          "The exact supervised Proof action confirmation phrase is required."
        );
      }
      const existing = await getRecord(
        request.order_number,
        request.idempotency_key
      );
      if (!existing) {
        throw new ProofOperatorActionError("invalid", "Prepare this Proof action before execution.");
      }
      if (existing.outcome !== "prepared") {
        throw new ProofOperatorActionError(
          "already_attempted",
          "This Proof action has already entered the no-retry execution boundary."
        );
      }
      const environment = targetEnvironment(await listTargetConfigs());
      const { order } = await syncOrder(request.order_number, {
        allowed_customer_ids: [CUSTOMER_ID],
        audit_context: {
          actor_type: "operator",
          actor_id: actorId,
          correlation_id: input.correlation_id,
          source: "operator"
        }
      });
      const task = currentTask(order, request);
      const executionScope = executionScopeSha256(order, task);
      const approval = approvalContext(order, request, task);
      const revisionAsset = await readyRevisionAsset({
        request,
        task,
        now: currentTime,
        resolve: resolveRevisionAsset
      });
      const plan = buildPlan(request, revisionAsset);
      if (
        existing.canonical_body_hash !==
          recordHash({
            request,
            task,
            plan,
            revisionAsset,
            approval,
            executionScopeSha256: executionScope,
            customerCapabilitySha256
          }) ||
        existing.request_body_sha256 !== plan.canonical_body_sha256 ||
        existing.expected_task_version !== task.version ||
        existing.expected_version_id !== task.current_version!.version_id ||
        existing.feedback_fingerprint !== task.current_version!.feedback_fingerprint ||
        existing.execution_scope_sha256 !== executionScope ||
        existing.approval_mode !== request.approval_mode ||
        existing.approve_quantity !== request.approve_quantity ||
        existing.expected_line_quantity !== approval.expected_line_quantity ||
        existing.allocation_plan_sha256 !== approval.allocation_plan_sha256 ||
        existing.customer_capability_sha256 !== customerCapabilitySha256 ||
        existing.revision_asset_id !== (revisionAsset?.asset_id ?? null) ||
        existing.revision_publication_id !==
          (revisionAsset?.publication_id ?? null) ||
        existing.revision_id !== (revisionAsset?.revision_id ?? null) ||
        existing.revision_source_object_version_sha256 !==
          (revisionAsset
            ? sha256Text(revisionAsset.source_object_version_id)
            : null) ||
        existing.revision_outbound_object_version_sha256 !==
          (revisionAsset
            ? sha256Text(revisionAsset.outbound_object_version_id)
            : null) ||
        existing.revision_asset_sha256 !== (revisionAsset?.sha256 ?? null) ||
        existing.revision_outbound_sha256 !==
          (revisionAsset?.outbound_sha256 ?? null) ||
        existing.revision_delivery_url_sha256 !==
          (revisionAsset?.delivery_url_sha256 ?? null) ||
        existing.revision_lift_not_before_epoch !==
          (revisionAsset?.lift_not_before_epoch ?? null) ||
        existing.revision_retention_anchor_at !==
          (revisionAsset?.retention_anchor_at ?? null) ||
        existing.revision_retention_days !==
          (revisionAsset?.retention_days ?? null) ||
        existing.revision_cleanup_eligible_at_epoch !==
          (revisionAsset?.cleanup_eligible_at_epoch ?? null)
      ) {
        throw new ProofOperatorActionError(
          "stale",
          "The prepared Proof action no longer matches the authoritative current proof."
        );
      }
      const credentials = assertCredentialBoundary(
        await readCredentials(TARGET_ID, ENVIRONMENT_ID),
        environment.endpoint_url
      );
      const issuedAt = Math.floor(currentTime.getTime() / 1_000);
      let headers: ReturnType<typeof buildLiftProofingRuntimeHeaders>;
      try {
        headers = buildLiftProofingRuntimeHeaders({
          plan,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          issued_at_epoch: issuedAt,
          expires_at_epoch: issuedAt + gate.jwt_ttl_seconds
        });
      } finally {
        credentials.client_secret = "";
        credentials.client_id = "";
      }
      const attemptId = `paction_${sha256(
        "vornan-proof-operator-attempt-v1",
        existing.canonical_body_hash,
        String(existing.record_version),
        plan.canonical_body_sha256
      )}`;
      const submissionAt = currentTime.toISOString();
      const uncertain: ProofOperatorActionRecord = {
        ...existing,
        outcome: "submission_uncertain",
        record_version: existing.record_version + 1,
        updated_at: submissionAt,
        attempt_id: attemptId
      };
      await transition(
        existing,
        uncertain,
        auditEvent({
          record: uncertain,
          eventId: `paudit_operator-${sha256(attemptId, "submission")}`,
          action: "proof.operator_action_submission_started",
          actorId,
          correlationId: input.correlation_id,
          occurredAt: submissionAt
        })
      );

      let observation: LiftProofingRuntimeObservation;
      try {
        observation = await send({
          base_url: credentials.base_url,
          plan,
          headers,
          timeout_ms: 15_000
        });
      } catch {
        observation = {
          status: null,
          transport_error: true,
          classification: {
            classification: "unexpected_or_unclassified",
            confirmed: false,
            retryable: false,
            reconciliation: "manual_review_required",
            reason: "response_status_invalid_or_missing"
          }
        };
      }

      let reconciledOrder: ProofOrder | null = null;
      let reconciliationFailure: string | null = null;
      try {
        reconciledOrder = (
          await syncOrder(request.order_number, {
            allowed_customer_ids: [CUSTOMER_ID],
            audit_context: {
              actor_type: "operator",
              actor_id: actorId,
              correlation_id: input.correlation_id,
              source: "operator"
            }
          })
        ).order;
      } catch (error) {
        reconciliationFailure =
          error instanceof Error ? error.name : "UnknownError";
      }
      const observedAt = now().toISOString();
      const reconciling: ProofOperatorActionRecord = {
        ...uncertain,
        outcome: "reconciling",
        record_version: uncertain.record_version + 1,
        updated_at: observedAt,
        response_classification: observation.classification.classification
      };
      await transition(
        uncertain,
        reconciling,
        auditEvent({
          record: reconciling,
          eventId: `paudit_operator-${sha256(attemptId, "observed")}`,
          action: "proof.operator_action_observed",
          actorId,
          correlationId: input.correlation_id,
          occurredAt: observedAt,
          classification: observation.classification.classification
        })
      );
      if (
        reconciledOrder &&
        observation.status !== null &&
        observation.status >= 200 &&
        observation.status < 300 &&
        request.action !== "APPROVE"
      ) {
        try {
          reconciledOrder = await persistOrder(recordProofTaskDecisionContext(
            reconciledOrder,
            {
              task_id: request.task_id,
              attachment_id: request.attachment_id,
              action: request.action,
              recorded_at: observedAt
            }
          ));
        } catch {
          // The Lift observation remains reconciling. A stale or replaced proof
          // must never be relabelled from a prior action.
        }
      }
      const authoritativeTask = reconciledOrder?.tasks.find(
        (candidate) => candidate.task_id === request.task_id
      );
      return {
        operator_action: sanitized(reconciling),
        observation: {
          status: observation.status,
          classification: observation.classification.classification,
          confirmed: false,
          automatic_retry: false
        },
        authoritative_reconciliation: {
          completed: Boolean(reconciledOrder),
          failure_class: reconciliationFailure,
          task_state: authoritativeTask?.state ?? null,
          task_version: authoritativeTask?.version ?? null,
          current_version_id:
            authoritativeTask?.current_version?.version_id ?? null,
          attachment_id: authoritativeTask?.attachment_id ?? null,
          requires_manual_review: true
        }
      };
    }
  };
}

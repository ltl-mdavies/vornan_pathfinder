import { createHash } from "node:crypto";
import {
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
import { listTargets, type TargetConfig } from "../store.js";
import { syncProofOrder } from "./service.js";
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
}

export interface ProofOperatorActionDependencies {
  syncOrder?: typeof syncProofOrder;
  listTargetConfigs?: typeof listTargets;
  readCredentials?: typeof readTargetEnvironmentProofingApiRuntimeCredentials;
  reserve?: typeof reserveProofOperatorAction;
  getRecord?: typeof getProofOperatorActionRecord;
  transition?: typeof transitionProofOperatorAction;
  send?: typeof sendLiftProofingRuntimeAction;
  resolveRevisionAsset?: (
    assetId: string
  ) => Promise<ProofRevisionAssetReadiness | null>;
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
  return {
    order_number: orderNumber,
    task_id: input.task_id.trim(),
    attachment_id: input.attachment_id.trim(),
    action: input.action,
    idempotency_key: input.idempotency_key,
    comment: boundedText(input.comment, 2_000),
    revision_asset_id: revisionAssetId
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
      revised_art_url: revisionAsset?.delivery_url ?? null
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
  resolve: (assetId: string) => Promise<ProofRevisionAssetReadiness | null>;
}) {
  if (input.request.action !== "REVISED_ART_WILL_BE_SENT") {
    return null;
  }
  const assetId = input.request.revision_asset_id!;
  const asset = await input.resolve(assetId);
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
  const send = dependencies.send ?? sendLiftProofingRuntimeAction;
  const resolveRevisionAsset =
    dependencies.resolveRevisionAsset ?? (async () => null);
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
      const revisionAsset = await readyRevisionAsset({
        request,
        task,
        now: currentTime,
        resolve: resolveRevisionAsset
      });
      const plan = buildPlan(request, revisionAsset);
      const occurredAt = currentTime.toISOString();
      const canonicalHash = recordHash({ request, task, plan, revisionAsset });
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
      const revisionAsset = await readyRevisionAsset({
        request,
        task,
        now: currentTime,
        resolve: resolveRevisionAsset
      });
      const plan = buildPlan(request, revisionAsset);
      if (
        existing.canonical_body_hash !==
          recordHash({ request, task, plan, revisionAsset }) ||
        existing.request_body_sha256 !== plan.canonical_body_sha256 ||
        existing.expected_task_version !== task.version ||
        existing.expected_version_id !== task.current_version!.version_id ||
        existing.feedback_fingerprint !== task.current_version!.feedback_fingerprint ||
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

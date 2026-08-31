import {
  buildLiftProofingRuntimeHeaders,
  buildLiftProofingRuntimePlan,
  sendLiftProofingRuntimeAction,
  type LiftProofingRuntimeObservation
} from "@pathfinder/lift-proof-adapter/proofing-action-runtime";
import {
  recordProofTaskDecisionContext,
  type ProofAccessSession,
  type ProofDecisionKind,
  type ProofOrder,
  type ProofTask
} from "@pathfinder/proof-domain";
import {
  readTargetEnvironmentProofingApiRuntimeCredentials,
  type TargetProofingApiRuntimeCredentials
} from "../lift-proofing-credentials.js";
import {
  readProofActionTargetConfig,
  type ProofActionTargetConfig
} from "./action-target-store.js";
import {
  prepareProofApprovalDecision,
  prepareProofChangeRequestDecision
} from "./decision-contract.js";
import { ProofDecisionLedgerError, proofDecisionLedger } from "./decision-ledger.js";
import { getProofRuntimeConfig, type ProofRuntimeConfig } from "./runtime-config.js";
import { syncProofOrder } from "./service.js";
import {
  getProofFeedbackAcknowledgement,
  getProofParticipant,
  persistProofOrder
} from "./store.js";
import { recordProofAuditEvent } from "./audit-service.js";

const TARGET_ID = "lift-standard-graphics";
const ENVIRONMENT_ID = "env-lift-prod";
const COMPANY_ID = "91";
const ACTION_USER = "VORNAN_PROOF";

export class ProofCustomerApprovalError extends Error {
  constructor(
    public readonly code:
      | "disabled"
      | "not_allowed"
      | "invalid"
      | "stale"
      | "conflict"
      | "already_attempted",
    message: string
  ) {
    super(message);
    this.name = "ProofCustomerApprovalError";
  }
}

export interface ProofCustomerApprovalRequest {
  task_id: string;
  attachment_id: string;
  expected_task_version: number;
  expected_version_id: string;
  idempotency_key: string;
  note?: string | null;
}

export interface ProofCustomerApprovalDependencies {
  runtimeConfig?: () => ProofRuntimeConfig;
  syncOrder?: typeof syncProofOrder;
  readTargetConfig?: typeof readProofActionTargetConfig;
  readCredentials?: typeof readTargetEnvironmentProofingApiRuntimeCredentials;
  reserve?: typeof proofDecisionLedger.reserve;
  transition?: typeof proofDecisionLedger.transition;
  getParticipant?: typeof getProofParticipant;
  getFeedbackAcknowledgement?: typeof getProofFeedbackAcknowledgement;
  send?: typeof sendLiftProofingRuntimeAction;
  audit?: typeof recordProofAuditEvent;
  persistOrder?: typeof persistProofOrder;
  now?: () => Date;
}

function targetEnvironment(target: ProofActionTargetConfig | null) {
  const environment = target?.environments.find(
    (candidate) => candidate.environment_id === ENVIRONMENT_ID && candidate.role === "PROD" && candidate.status === "Active"
  );
  if (!target || !environment) {
    throw new ProofCustomerApprovalError("not_allowed", "The Proof decision destination is not active.");
  }
  return environment;
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
    // Shared configuration validation normally prevents malformed URLs.
  }
  if (
    credentials.company_id !== COMPANY_ID ||
    credentials.action_user_name !== ACTION_USER ||
    !environmentOrigin ||
    proofingOrigin !== environmentOrigin
  ) {
    throw new ProofCustomerApprovalError(
      "not_allowed",
      "Proofing API configuration does not match the production environment."
    );
  }
  return credentials;
}

function currentSingleProof(order: ProofOrder, request: ProofCustomerApprovalRequest) {
  const task = order.tasks.find((candidate) => candidate.task_id === request.task_id);
  if (
    !task ||
    !task.actionable ||
    task.state !== "pending" ||
    task.archived_at ||
    task.attachment_id !== request.attachment_id ||
    task.version !== request.expected_task_version ||
    !task.current_version?.current ||
    task.current_version.version_id !== request.expected_version_id ||
    task.current_version.attachment_id !== request.attachment_id ||
    task.decision_context
  ) {
    throw new ProofCustomerApprovalError("stale", "The selected proof is no longer current and actionable.");
  }
  const lineProofs = order.tasks.filter(
    (candidate) =>
      candidate.order_line_id === task.order_line_id &&
      candidate.actionable &&
      candidate.state === "pending" &&
      candidate.current_version?.current &&
      candidate.attachment_id === candidate.current_version.attachment_id
  );
  if (!task.order_line_id || lineProofs.length !== 1 || lineProofs[0]?.task_id !== task.task_id) {
    throw new ProofCustomerApprovalError(
      "not_allowed",
      "Lines with multiple current proofs require the Advanced decision workflow."
    );
  }
  const sharedLines = new Set(
    order.tasks
      .filter((candidate) => candidate.attachment_id === task.attachment_id)
      .map((candidate) => candidate.order_line_id)
      .filter((line): line is string => Boolean(line))
  );
  if (sharedLines.size !== 1) {
    throw new ProofCustomerApprovalError(
      "not_allowed",
      "This proof is shared across multiple Lift lines and cannot use the single-line decision workflow."
    );
  }
  return task;
}

function approvalObserved(order: ProofOrder, task: ProofTask) {
  return [...order.tasks, ...order.archived_tasks].some(
    (candidate) =>
      candidate.order_line_id === task.order_line_id &&
      candidate.attachment_id === task.attachment_id &&
      candidate.state === "approved"
  );
}

export function createProofCustomerApprovalService(
  dependencies: ProofCustomerApprovalDependencies = {}
) {
  const runtimeConfig = dependencies.runtimeConfig ?? getProofRuntimeConfig;
  const syncOrder = dependencies.syncOrder ?? syncProofOrder;
  const readTargetConfig = dependencies.readTargetConfig ?? readProofActionTargetConfig;
  const readCredentials = dependencies.readCredentials ?? readTargetEnvironmentProofingApiRuntimeCredentials;
  const reserve = dependencies.reserve ?? proofDecisionLedger.reserve;
  const transition = dependencies.transition ?? proofDecisionLedger.transition;
  const getParticipant = dependencies.getParticipant ?? getProofParticipant;
  const getFeedbackAcknowledgement = dependencies.getFeedbackAcknowledgement ?? getProofFeedbackAcknowledgement;
  const send = dependencies.send ?? sendLiftProofingRuntimeAction;
  const audit = dependencies.audit ?? recordProofAuditEvent;
  const persistOrder = dependencies.persistOrder ?? persistProofOrder;
  const now = dependencies.now ?? (() => new Date());

  async function decide(input: {
      session: ProofAccessSession;
      request: ProofCustomerApprovalRequest;
      correlation_id: string;
    }, decision: ProofDecisionKind) {
      const config = runtimeConfig();
      if (!config.feature_flags.approve || !config.feature_flags.public_read) {
        throw new ProofCustomerApprovalError("disabled", "Customer Proof decisions are not enabled.");
      }
      if (
        input.session.scope !== "review" ||
        input.session.capability?.access_mode !== "review" ||
        !/^\d{1,20}$/.test(input.session.capability?.proof_customer_id ?? "") ||
        !input.session.participant_id
      ) {
        throw new ProofCustomerApprovalError("not_allowed", "Identify the reviewer in a review-enabled session first.");
      }
      const environment = targetEnvironment(await readTargetConfig(TARGET_ID));
      const auditContext = {
        actor_type: "customer_session" as const,
        actor_id: input.session.session_id,
        correlation_id: input.correlation_id,
        source: "public_api" as const
      };
      const { order } = await syncOrder(input.session.order_number, {
        allowed_customer_ids: [input.session.capability.proof_customer_id],
        audit_context: auditContext
      });
      const task = currentSingleProof(order, input.request);
      const participant = await getParticipant(input.session.grant_id, input.session.participant_id);
      const acknowledgement = await getFeedbackAcknowledgement(
        input.session.grant_id,
        input.session.participant_id,
        task.task_id
      );
      const prepareDecision = decision === "approve"
        ? prepareProofApprovalDecision
        : prepareProofChangeRequestDecision;
      const contract = prepareDecision({
        order,
        binding: {
          order_number: order.order_number,
          task_id: task.task_id,
          attachment_id: task.attachment_id!,
          expected_task_version: input.request.expected_task_version,
          expected_version_id: input.request.expected_version_id
        },
        participant,
        participant_id: input.session.participant_id,
        grant_id: input.session.grant_id,
        feedback_acknowledgement: acknowledgement,
        idempotency_key: input.request.idempotency_key,
        note: input.request.note
      });
      const reservation = await reserve(contract, {
        actor_id: input.session.session_id,
        order_line_id: task.order_line_id
      }, now());
      if (reservation.status === "conflict") {
        throw new ProofCustomerApprovalError("conflict", "This decision key was already used for a different decision.");
      }
      if (reservation.record.outcome !== "prepared") {
        return {
          status: "replay" as const,
          outcome: reservation.record.outcome,
          automatic_retry: false,
          authoritative_refresh_completed: false
        };
      }

      const plan = buildLiftProofingRuntimePlan({
        action: decision === "approve" ? "APPROVE" : "SEND_BACK_TO_ARTIST",
        company_id: COMPANY_ID,
        proofing_id: task.attachment_id!,
        comment: contract.intent.note,
        revised_art_url: null,
        approve_quantity: null
      });
      const credentials = assertCredentialBoundary(
        await readCredentials(TARGET_ID, ENVIRONMENT_ID),
        environment.endpoint_url
      );
      const issuedAt = Math.floor(now().getTime() / 1_000);
      let headers: ReturnType<typeof buildLiftProofingRuntimeHeaders>;
      try {
        headers = buildLiftProofingRuntimeHeaders({
          plan,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          issued_at_epoch: issuedAt,
          expires_at_epoch: issuedAt + 90
        });
      } finally {
        credentials.client_id = "";
        credentials.client_secret = "";
      }

      let uncertain;
      try {
        uncertain = await transition({
          order_number: order.order_number,
          idempotency_key: contract.idempotency_key,
          canonical_body_hash: contract.canonical_body_hash,
          expected_record_version: reservation.record.record_version,
          next_outcome: "submission_uncertain"
        }, now());
      } catch (error) {
        if (error instanceof ProofDecisionLedgerError && error.code === "concurrent_update") {
          throw new ProofCustomerApprovalError("already_attempted", "This decision already entered the no-retry boundary.");
        }
        throw error;
      }
      await audit({
        action: "proof.decision_submission_started",
        order_number: order.order_number,
        task_id: task.task_id,
        order_line_id: task.order_line_id,
        attachment_id: task.attachment_id,
        grant_id: input.session.grant_id,
        participant_id: input.session.participant_id,
        metadata: { decision_kind: decision, decision_outcome: "submission_uncertain" },
        context: auditContext,
        occurred_at: uncertain.updated_at
      });

      let observation: LiftProofingRuntimeObservation;
      try {
        observation = await send({ base_url: credentials.base_url, plan, headers, timeout_ms: 15_000 });
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

      let reconciled: ProofOrder | null = null;
      try {
        reconciled = (await syncOrder(order.order_number, {
          allowed_customer_ids: [input.session.capability.proof_customer_id],
          audit_context: auditContext
        })).order;
      } catch {
        // The durable state remains uncertain and must never be replayed automatically.
      }
      let confirmed = Boolean(reconciled && decision === "approve" && approvalObserved(reconciled, task));
      if (reconciled && decision === "send_back_to_artist") {
        const currentTask = reconciled.tasks.find((candidate) => candidate.task_id === task.task_id);
        if (!currentTask || currentTask.attachment_id !== task.attachment_id || currentTask.state !== "pending") {
          confirmed = true;
        }
      }
      // A Lift transport response is deliberately not a customer-visible final
      // state. Keep a short-lived local reconciliation marker only to prevent a
      // duplicate action while the next per-line ProofReport read catches up.
      if (reconciled && !confirmed) {
        try {
          reconciled = await persistOrder(recordProofTaskDecisionContext(reconciled, {
            task_id: task.task_id,
            attachment_id: task.attachment_id!,
            action: decision === "approve" ? "APPROVE" : "SEND_BACK_TO_ARTIST",
            recorded_at: now().toISOString(),
            source: "pathfinder_customer_decision"
          }));
        } catch {
          // If the fresh Lift state changed while recording the marker, leave
          // the result reconciling. A later ProofReport read remains decisive.
        }
      }
      const finalOutcome = confirmed ? "confirmed" : "reconciling";
      const finalRecord = await transition({
        order_number: order.order_number,
        idempotency_key: contract.idempotency_key,
        canonical_body_hash: contract.canonical_body_hash,
        expected_record_version: uncertain.record_version,
        next_outcome: finalOutcome
      }, now());
      await audit({
        action: "proof.decision_observed",
        order_number: order.order_number,
        task_id: task.task_id,
        order_line_id: task.order_line_id,
        attachment_id: task.attachment_id,
        grant_id: input.session.grant_id,
        participant_id: input.session.participant_id,
        metadata: {
          decision_kind: decision,
          decision_outcome: finalOutcome,
          response_classification: observation.classification.classification
        },
        context: auditContext,
        occurred_at: finalRecord.updated_at
      });
      return {
        status: reservation.status,
        outcome: finalOutcome,
        automatic_retry: false,
        authoritative_refresh_completed: Boolean(reconciled)
      };
  }

  return {
    approve(input: {
      session: ProofAccessSession;
      request: ProofCustomerApprovalRequest;
      correlation_id: string;
    }) {
      return decide(input, "approve");
    },
    requestChanges(input: {
      session: ProofAccessSession;
      request: ProofCustomerApprovalRequest;
      correlation_id: string;
    }) {
      return decide(input, "send_back_to_artist");
    }
  };
}

export const proofCustomerApprovalService = createProofCustomerApprovalService();

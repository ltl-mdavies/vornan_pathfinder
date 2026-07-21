import type { ProofOrder } from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { recordProofAuditEvent, type ProofAuditContext } from "./audit-service.js";
import { getProofOrder, persistProofOrder } from "./store.js";

export const PROOF_SYNTHETIC_QA_ORDER_NUMBER = "A00000000";
export const PROOF_SYNTHETIC_QA_MARKER = "SYNTHETIC QA — NOT A CUSTOMER";

const FIXTURE_ID = /^vpqa-[a-z0-9-]{8,48}$/;

export interface ProofSyntheticQaRequest {
  fixture_id: string;
  outcome: "success" | "failure";
}

export class ProofSyntheticQaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofSyntheticQaConfigurationError";
  }
}

export class ProofSyntheticQaFailure extends Error {
  constructor() {
    super("Controlled synthetic Proof QA failure.");
    this.name = "ProofSyntheticQaFailure";
  }
}

export function parseProofSyntheticQaRequest(payload: Record<string, unknown>) {
  if (!("qa_fixture" in payload)) return null;
  const candidate = payload.qa_fixture;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ProofSyntheticQaConfigurationError("Synthetic Proof QA payload is malformed.");
  }
  const fixture = candidate as Record<string, unknown>;
  if (
    Object.keys(fixture).length !== 2
    ||
    typeof fixture.fixture_id !== "string"
    || !FIXTURE_ID.test(fixture.fixture_id)
    || (fixture.outcome !== "success" && fixture.outcome !== "failure")
  ) {
    throw new ProofSyntheticQaConfigurationError("Synthetic Proof QA identity or outcome is invalid.");
  }
  return { fixture_id: fixture.fixture_id, outcome: fixture.outcome } satisfies ProofSyntheticQaRequest;
}

export function assertProofSyntheticQaEnabled(orderNumber: string) {
  const config = getProofRuntimeConfig();
  const blocked =
    process.env.PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA !== "true"
    || process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME !== "dev"
    || orderNumber !== PROOF_SYNTHETIC_QA_ORDER_NUMBER
    || config.feature_flags.public_read
    || config.feature_flags.grant_creation
    || config.feature_flags.proof_link_email
    || process.env.PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED === "true"
    || process.env.PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED === "true"
    || Boolean(process.env.PATHFINDER_PROOF_DOMAIN_NAME?.trim())
    || Boolean(process.env.PATHFINDER_PROOF_CERTIFICATE_ARN?.trim());
  if (blocked) {
    throw new ProofSyntheticQaConfigurationError(
      "Synthetic Proof QA is available only for the reserved order in the fully dark dev stack."
    );
  }
}

export function buildProofSyntheticQaOrder(fixtureId: string, now = new Date()): ProofOrder {
  if (!FIXTURE_ID.test(fixtureId)) {
    throw new ProofSyntheticQaConfigurationError("Synthetic Proof QA fixture ID is invalid.");
  }
  const timestamp = now.toISOString();
  const orderLineId = `qa-line-${fixtureId}`;
  const attachmentId = `qa-attachment-${fixtureId}`;
  const version = {
    version_id: `pversion-${fixtureId}`,
    attachment_id: attachmentId,
    created_at: timestamp,
    filename: "synthetic-proof.png",
    content_type: "image/png",
    preview_url: "/qa-fixtures/synthetic-proof.png",
    download_url: "/qa-fixtures/synthetic-proof.png",
    approval_status: "PENDING",
    approved_by: null,
    approved_at: null,
    comments: [{
      text: "Synthetic feedback used only for the purgeable dark QA lifecycle.",
      created_at: timestamp,
      attachment: null
    }],
    detailed_report: [{ name: "Synthetic boundary check", status: "PASS" }],
    feedback_fingerprint: `qa-feedback-${fixtureId}`,
    current: true,
    archived_at: null
  };
  return {
    order_number: PROOF_SYNTHETIC_QA_ORDER_NUMBER,
    order_title: `Vornan Proof synthetic lifecycle ${fixtureId}`,
    customer_name: PROOF_SYNTHETIC_QA_MARKER,
    order_status: "Synthetic review only",
    health: "active",
    version: 1,
    lines: [{
      order_line_id: orderLineId,
      line_number: "QA-1",
      step_number: 0,
      product_name: "Synthetic proof panel",
      quantity: 1,
      status: "SYNTHETIC",
      cancelled: false
    }],
    tasks: [{
      task_id: `ptask-${fixtureId}`,
      order_line_id: orderLineId,
      line_number: "QA-1",
      attachment_id: attachmentId,
      product_name: "Synthetic proof panel",
      quantity: 1,
      state: "pending",
      actionable: true,
      sibling_index: 1,
      sibling_count: 1,
      version: 1,
      current_version: version,
      versions: [version],
      created_at: timestamp,
      updated_at: timestamp,
      archived_at: null
    }],
    archived_tasks: [],
    warnings: [],
    last_sync_diagnostics: null,
    created_at: timestamp,
    updated_at: timestamp,
    last_synced_at: timestamp
  };
}

export async function processProofSyntheticQaRequest(input: {
  order_number: string;
  request: ProofSyntheticQaRequest;
  audit_context: ProofAuditContext;
  occurred_at?: string;
}) {
  assertProofSyntheticQaEnabled(input.order_number);
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (input.request.outcome === "failure") {
    await recordProofAuditEvent({
      action: "proof.sync_failed",
      outcome: "failed",
      order_number: input.order_number,
      metadata: { failure_class: "ProofSyntheticQaFailure" },
      context: input.audit_context,
      occurred_at: occurredAt
    });
    throw new ProofSyntheticQaFailure();
  }

  const existing = await getProofOrder(input.order_number);
  if (existing) {
    if (existing.customer_name !== PROOF_SYNTHETIC_QA_MARKER || !existing.order_title?.includes(input.request.fixture_id)) {
      throw new ProofSyntheticQaConfigurationError("Reserved synthetic Proof QA order is already occupied.");
    }
    return existing;
  }

  const order = buildProofSyntheticQaOrder(input.request.fixture_id, new Date(occurredAt));
  await persistProofOrder(order);
  await recordProofAuditEvent({
    action: "proof.sync_completed",
    order_number: order.order_number,
    metadata: {
      order_health: order.health,
      order_version: order.version,
      active_task_count: order.tasks.length,
      archived_task_count: 0
    },
    context: input.audit_context,
    occurred_at: occurredAt
  });
  await recordProofAuditEvent({
    action: "proof.review_ready",
    order_number: order.order_number,
    metadata: {
      order_health: order.health,
      order_version: order.version,
      review_state: "review_ready",
      pending_task_count: 1,
      regenerating_task_count: 0,
      waiting_task_count: 0,
      reviewed_task_count: 0,
      total_task_count: 1
    },
    context: input.audit_context,
    occurred_at: occurredAt
  });
  return order;
}

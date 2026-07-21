import { publicProofCounts, normalizeLiftOrderNumber } from "@pathfinder/proof-domain";
import { assertLiftProofWritesDisabled, getProofRuntimeConfig } from "./proof/runtime-config.js";
import { createProofGrant, listOrderProofGrants, revokeProofGrant } from "./proof/access-service.js";
import { syncProofOrder } from "./proof/service.js";
import { getProofGrantById, getProofOrder } from "./proof/store.js";
import { emitProofMetric } from "./proof/telemetry.js";

type ProofOperatorOperation = "sync_order" | "create_view_grant" | "list_grants" | "revoke_grant";

interface ProofOperatorEvent {
  operation?: unknown;
  order_number?: unknown;
  grant_id?: unknown;
  label?: unknown;
  expires_at?: unknown;
}

interface LambdaContext {
  awsRequestId?: string;
}

export interface ProofOperatorDependencies {
  syncOrder: typeof syncProofOrder;
  createGrant: typeof createProofGrant;
  listGrants: typeof listOrderProofGrants;
  revokeGrant: typeof revokeProofGrant;
  getGrant: typeof getProofGrantById;
  getOrder: typeof getProofOrder;
}

const defaultDependencies: ProofOperatorDependencies = {
  syncOrder: syncProofOrder,
  createGrant: createProofGrant,
  listGrants: listOrderProofGrants,
  revokeGrant: revokeProofGrant,
  getGrant: getProofGrantById,
  getOrder: getProofOrder
};

function operation(value: unknown): ProofOperatorOperation {
  if (["sync_order", "create_view_grant", "list_grants", "revoke_grant"].includes(String(value))) {
    return value as ProofOperatorOperation;
  }
  throw new Error("InvalidProofOperatorOperation");
}

function grantId(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!/^pgrant_[A-Za-z0-9-]{8,80}$/.test(candidate)) throw new Error("InvalidProofGrantId");
  return candidate;
}

function activeOperatorWindow() {
  const config = getProofRuntimeConfig();
  const deadline = config.access.read_only_activation_expires_at
    ? Date.parse(config.access.read_only_activation_expires_at)
    : Number.NaN;
  if (
    process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME !== "dev"
    || process.env.PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED !== "true"
    || config.access.grant_allowed_customer_ids.length === 0
    || !Number.isFinite(deadline)
    || deadline <= Date.now()
  ) {
    throw new Error("ProofOperatorWindowClosed");
  }
  return config.access.grant_allowed_customer_ids;
}

function cohortAllows(customerId: string | null | undefined) {
  return Boolean(customerId && getProofRuntimeConfig().access.grant_allowed_customer_ids.includes(customerId));
}

function orderSummary(order: NonNullable<Awaited<ReturnType<typeof getProofOrder>>>) {
  return {
    order_number: order.order_number,
    health: order.health,
    version: order.version,
    counts: publicProofCounts(order.tasks),
    last_synced_at: order.last_synced_at,
    cohort_verified: cohortAllows(order.customer_id)
  };
}

export function createProofOperatorHandler(dependencies: ProofOperatorDependencies = defaultDependencies) {
  return async (event: ProofOperatorEvent = {}, context: LambdaContext = {}) => {
    const startedAt = performance.now();
    const correlationId = context.awsRequestId ?? "proof-operator";
    let requestedOperation = "invalid_operator_request";
    let succeeded = false;
    try {
      assertLiftProofWritesDisabled();
      const requested = operation(event.operation);
      requestedOperation = requested;
      const auditContext = {
        actor_type: "operator" as const,
        actor_id: "iam-proof-operator",
        correlation_id: correlationId,
        source: "operator" as const
      };

      if (requested === "revoke_grant") {
        const existing = await dependencies.getGrant(grantId(event.grant_id));
        const order = existing ? await dependencies.getOrder(existing.order_number) : null;
        if (!existing || !order || !cohortAllows(order.customer_id)) throw new Error("ProofOperatorCohortDenied");
        const revoked = await dependencies.revokeGrant(existing.grant_id, new Date(), auditContext);
        succeeded = true;
        return { operation: requested, grant: revoked };
      }

      const allowedCustomerIds = activeOperatorWindow();
      const orderNumber = normalizeLiftOrderNumber(String(event.order_number ?? ""));
      if (requested === "list_grants") {
        const order = await dependencies.getOrder(orderNumber);
        if (!order || !cohortAllows(order.customer_id)) throw new Error("ProofOperatorCohortDenied");
        const grants = await dependencies.listGrants(orderNumber);
        succeeded = true;
        return { operation: requested, grants };
      }

      const synchronized = await dependencies.syncOrder(orderNumber, {
        allowed_customer_ids: allowedCustomerIds,
        audit_context: auditContext
      });
      if (requested === "sync_order") {
        succeeded = true;
        return { operation: requested, order: orderSummary(synchronized.order) };
      }
      const created = await dependencies.createGrant({
        order_number: orderNumber,
        label: typeof event.label === "string" ? event.label : null,
        expires_at: typeof event.expires_at === "string" ? event.expires_at : null,
        scope: "view",
        audit_context: auditContext
      });
      succeeded = true;
      return { operation: requested, order: orderSummary(synchronized.order), ...created };
    } catch (error) {
      emitProofMetric({
        service: "operator-admin",
        operation: requestedOperation,
        duration_ms: performance.now() - startedAt,
        server_error: true,
        denied: /Denied|Closed|Invalid/.test(error instanceof Error ? error.name + error.message : ""),
        correlation_id: correlationId,
        failure_class: error instanceof Error ? error.name : "UnknownError"
      });
      throw new Error(`Proof operator ${requestedOperation} failed.`);
    } finally {
      if (succeeded) {
        emitProofMetric({
          service: "operator-admin",
          operation: requestedOperation,
          duration_ms: performance.now() - startedAt,
          server_error: false,
          denied: false,
          correlation_id: correlationId
        });
      }
    }
  };
}

export const handler = createProofOperatorHandler();

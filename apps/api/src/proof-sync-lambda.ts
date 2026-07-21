import { normalizeLiftOrderNumber } from "@pathfinder/proof-domain";
import { syncProofOrder } from "./proof/service.js";
import { emitProofMetric } from "./proof/telemetry.js";
import { parseProofSyntheticQaRequest, processProofSyntheticQaRequest } from "./proof/qa-fixture.js";

interface QueueEvent {
  Records?: { body?: string; messageId?: string }[];
}

export async function handler(event: QueueEvent) {
  for (const record of event.Records ?? []) {
    const startedAt = performance.now();
    const correlationId = record.messageId ?? "unknown";
    try {
      const payload = JSON.parse(record.body ?? "{}") as { order_number?: unknown; qa_fixture?: unknown };
      if (typeof payload.order_number !== "string") {
        throw new Error("InvalidProofSyncMessage");
      }
      const orderNumber = normalizeLiftOrderNumber(payload.order_number);
      const auditContext = {
        actor_type: "system" as const,
        actor_id: "proof-sync-worker",
        correlation_id: correlationId,
        source: "sync_worker" as const
      };
      const syntheticQa = parseProofSyntheticQaRequest(payload as Record<string, unknown>);
      if (syntheticQa) {
        await processProofSyntheticQaRequest({ order_number: orderNumber, request: syntheticQa, audit_context: auditContext });
      } else {
        await syncProofOrder(orderNumber, { audit_context: auditContext });
      }
      emitProofMetric({
        service: "sync-worker",
        operation: "sync_order",
        duration_ms: performance.now() - startedAt,
        server_error: false,
        denied: false,
        correlation_id: correlationId
      });
    } catch (error) {
      emitProofMetric({
        service: "sync-worker",
        operation: "sync_order",
        duration_ms: performance.now() - startedAt,
        server_error: true,
        denied: false,
        correlation_id: correlationId,
        failure_class: error instanceof Error ? error.name : "UnknownError"
      });
      throw new Error(`Proof sync failed for correlation ${correlationId}.`);
    }
  }
  return { processed: event.Records?.length ?? 0 };
}

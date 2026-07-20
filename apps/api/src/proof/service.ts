import {
  readLiftProofOrder,
  type LiftProofFetch,
  type LiftProofReadDiagnostics
} from "@pathfinder/lift-proof-adapter";
import {
  normalizeLiftOrderNumber,
  normalizeProofOrder,
  proofReviewLifecycleState,
  proofReviewLifecycleTransitions,
  publicProofCounts,
  type ProofSyncDiagnosticsSummary
} from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { getProofOrder, persistProofOrder } from "./store.js";
import { recordProofAuditEvent, type ProofAuditContext } from "./audit-service.js";

export function summarizeProofSyncDiagnostics(
  diagnostics: LiftProofReadDiagnostics,
  completedAt: string,
  normalizationWarningCount: number
): ProofSyncDiagnosticsSummary {
  const succeeded = diagnostics.line_reads.filter((read) => read.ok).length;
  return {
    source: "lift_read",
    completed_at: completedAt,
    line_reads: {
      attempted: diagnostics.line_reads.length,
      succeeded,
      failed: diagnostics.line_reads.length - succeeded,
      proof_rows: diagnostics.line_reads.reduce((total, read) => total + read.row_count, 0)
    },
    fallback_read: {
      attempted: diagnostics.fallback_read.attempted,
      ok: diagnostics.fallback_read.ok,
      proof_rows: diagnostics.fallback_read.row_count
    },
    normalization_warning_count: normalizationWarningCount
  };
}

export async function syncProofOrder(
  rawOrderNumber: string,
  options: { fetcher?: LiftProofFetch; synced_at?: string; audit_context?: ProofAuditContext } = {}
) {
  const orderNumber = normalizeLiftOrderNumber(rawOrderNumber);
  try {
    const previous = await getProofOrder(orderNumber);
    const config = getProofRuntimeConfig();
    const snapshot = await readLiftProofOrder(orderNumber, {
      config: config.read,
      fetcher: options.fetcher,
      fetched_at: options.synced_at
    });
    const normalizedOrder = normalizeProofOrder({
      order_number: orderNumber,
      order_payload: snapshot.order_payload,
      proof_payloads: snapshot.proof_payloads,
      previous,
      synced_at: snapshot.fetched_at
    });
    const order = {
      ...normalizedOrder,
      last_sync_diagnostics: summarizeProofSyncDiagnostics(
        snapshot.diagnostics,
        snapshot.fetched_at,
        normalizedOrder.warnings.length
      )
    };
    const reviewTransitions = proofReviewLifecycleTransitions(previous, order);
    await persistProofOrder(order);
    await recordProofAuditEvent({
      action: "proof.sync_completed",
      order_number: order.order_number,
      metadata: {
        order_health: order.health,
        order_version: order.version,
        active_task_count: order.tasks.length,
        archived_task_count: order.archived_tasks.length
      },
      context: options.audit_context,
      occurred_at: snapshot.fetched_at
    });
    const counts = publicProofCounts(order.tasks);
    for (const action of reviewTransitions) {
      await recordProofAuditEvent({
        action,
        order_number: order.order_number,
        metadata: {
          order_health: order.health,
          order_version: order.version,
          review_state: proofReviewLifecycleState(order),
          pending_task_count: counts.pending,
          regenerating_task_count: counts.regenerating,
          waiting_task_count: counts.waiting,
          reviewed_task_count: counts.reviewed,
          total_task_count: counts.total
        },
        context: options.audit_context,
        occurred_at: snapshot.fetched_at
      });
    }
    return { order, diagnostics: order.last_sync_diagnostics };
  } catch (error) {
    await recordProofAuditEvent({
      action: "proof.sync_failed",
      outcome: "failed",
      order_number: orderNumber,
      metadata: { failure_class: error instanceof Error ? error.name : "UnknownError" },
      context: options.audit_context,
      occurred_at: options.synced_at
    }).catch(() => undefined);
    throw error;
  }
}

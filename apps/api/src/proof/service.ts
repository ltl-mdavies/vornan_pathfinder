import {
  readLiftProofOrder,
  type LiftProofFetch,
  type LiftProofReadDiagnostics
} from "@pathfinder/lift-proof-adapter";
import {
  normalizeLiftOrderNumber,
  normalizeProofOrder,
  liftOrderCustomerId,
  liftRows,
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

export class ProofSyncCohortDeniedError extends Error {
  constructor() {
    super("Proof synchronization is outside the configured read-only cohort.");
    this.name = "ProofSyncCohortDeniedError";
  }
}

export class ProofSyncIncompleteError extends Error {
  constructor() {
    super("Proof synchronization did not read every expected Lift order line.");
    this.name = "ProofSyncIncompleteError";
  }
}

export class ProofSyncUnstableError extends Error {
  constructor() {
    super("Proof synchronization observed a changing current-proof manifest.");
    this.name = "ProofSyncUnstableError";
  }
}

export class ProofSyncOrderMismatchError extends Error {
  constructor() {
    super("Lift returned a different order than the requested Proof order.");
    this.name = "ProofSyncOrderMismatchError";
  }
}

function assertCompleteProofRead(diagnostics: LiftProofReadDiagnostics) {
  if (diagnostics.line_reads.some((read) => !read.ok)) {
    throw new ProofSyncIncompleteError();
  }
}

function stableAssetIdentity(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function stableManifestValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return stableManifestValue(JSON.parse(trimmed));
      } catch {
        // Preserve malformed or ordinary text exactly so any change still fails closed.
      }
    }
    return /^https?:\/\//i.test(value) ? stableAssetIdentity(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(stableManifestValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableManifestValue(nested)])
    );
  }
  return value;
}

function assertRequestedLiftOrder(payload: unknown, expectedOrderNumber: string) {
  const header = liftRows(payload)[0];
  const rawOrderNumber = header?.ORDER_NUMBER ?? header?.order_number ?? header?.ORDER_REF ?? header?.order_ref;
  if (rawOrderNumber == null || normalizeLiftOrderNumber(String(rawOrderNumber)) !== expectedOrderNumber) {
    throw new ProofSyncOrderMismatchError();
  }
}

function currentProofManifest(order: ReturnType<typeof normalizeProofOrder>) {
  return JSON.stringify({
    customer_id: order.customer_id ?? null,
    lines: order.lines
      .map((line) => ({
        order_line_id: line.order_line_id,
        line_number: line.line_number,
        step_number: line.step_number,
        status: line.status,
        cancelled: line.cancelled
      }))
      .sort((left, right) => left.order_line_id.localeCompare(right.order_line_id)),
    tasks: order.tasks
      .map((task) => ({
        order_line_id: task.order_line_id,
        line_number: task.line_number,
        attachment_id: task.attachment_id,
        state: task.state,
        actionable: task.actionable,
        current_version: task.current_version
          ? {
              attachment_id: task.current_version.attachment_id,
              created_at: task.current_version.created_at,
              filename: task.current_version.filename,
              content_type: task.current_version.content_type ?? null,
              preview_asset: stableAssetIdentity(task.current_version.preview_url),
              download_asset: stableAssetIdentity(task.current_version.download_url),
              approval_status: task.current_version.approval_status,
              approved_by: task.current_version.approved_by,
              approved_at: task.current_version.approved_at,
              comments: stableManifestValue(task.current_version.comments),
              detailed_report: stableManifestValue(task.current_version.detailed_report),
              current: task.current_version.current,
              archived_at: task.current_version.archived_at
            }
          : null
      }))
      .sort((left, right) =>
        `${left.order_line_id ?? ""}:${left.attachment_id ?? ""}`
          .localeCompare(`${right.order_line_id ?? ""}:${right.attachment_id ?? ""}`)
      )
  });
}

export async function syncProofOrder(
  rawOrderNumber: string,
  options: {
    fetcher?: LiftProofFetch;
    synced_at?: string;
    audit_context?: ProofAuditContext;
    allowed_customer_ids?: string[];
  } = {}
) {
  const orderNumber = normalizeLiftOrderNumber(rawOrderNumber);
  try {
    const previous = await getProofOrder(orderNumber);
    const config = getProofRuntimeConfig();
    const readSnapshot = () => readLiftProofOrder(orderNumber, {
      config: config.read,
      fetcher: options.fetcher,
      fetched_at: options.synced_at,
      validateOrderPayload: (payload) => {
            assertRequestedLiftOrder(payload, orderNumber);
            if (!options.allowed_customer_ids) return;
            const customerId = liftOrderCustomerId(payload);
            if (!customerId || !options.allowed_customer_ids?.includes(customerId)) {
              throw new ProofSyncCohortDeniedError();
            }
          }
    });
    const firstSnapshot = await readSnapshot();
    assertCompleteProofRead(firstSnapshot.diagnostics);
    const firstNormalizedOrder = normalizeProofOrder({
      order_number: orderNumber,
      order_payload: firstSnapshot.order_payload,
      proof_payloads: firstSnapshot.proof_payloads,
      previous,
      synced_at: firstSnapshot.fetched_at
    });
    const snapshot = await readSnapshot();
    assertCompleteProofRead(snapshot.diagnostics);
    const normalizedOrder = normalizeProofOrder({
      order_number: orderNumber,
      order_payload: snapshot.order_payload,
      proof_payloads: snapshot.proof_payloads,
      previous,
      synced_at: snapshot.fetched_at
    });
    if (currentProofManifest(firstNormalizedOrder) !== currentProofManifest(normalizedOrder)) {
      throw new ProofSyncUnstableError();
    }
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

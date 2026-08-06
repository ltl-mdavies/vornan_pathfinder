import type { PublicOrderStatusSnapshot } from "./store.js";

export type PublicStatusRefreshState = "live" | "degraded";

export interface PublicStatusRefreshMetadata {
  status: PublicStatusRefreshState;
  checked_at: string;
  next_refresh_at: string;
  poll_after_seconds: number;
}

function previousLineByNumber(snapshot: PublicOrderStatusSnapshot | null) {
  return new Map((snapshot?.lines ?? []).map((line) => [line.line_number, line]));
}

/**
 * A transient Lift endpoint failure must not erase previously confirmed customer-safe data.
 * Successful portions of a refresh still advance independently.
 */
export function mergePublicStatusRefresh(
  previous: PublicOrderStatusSnapshot | null,
  fresh: PublicOrderStatusSnapshot,
  availability: {
    order?: boolean;
    proofs?: boolean;
    packages?: boolean;
  } = {}
): PublicOrderStatusSnapshot {
  if (!previous) {
    return fresh;
  }

  const orderFresh = availability.order ?? fresh.lookups.order?.ok === true;
  const proofsFresh = availability.proofs ?? fresh.lookups.proofs?.ok === true;
  const packagesFresh = availability.packages ?? fresh.lookups.packages?.ok === true;
  const anyFresh = orderFresh || proofsFresh || packagesFresh;
  const previousLines = previousLineByNumber(previous);

  const baseLines = orderFresh ? fresh.lines : previous.lines;
  const freshLines = new Map(fresh.lines.map((line) => [line.line_number, line]));
  const lines = baseLines.map((baseLine) => {
    const current = freshLines.get(baseLine.line_number);
    const prior = previousLines.get(baseLine.line_number);

    return {
      ...baseLine,
      proof_count: proofsFresh ? current?.proof_count ?? 0 : prior?.proof_count ?? 0,
      latest_proof_status: proofsFresh
        ? current?.latest_proof_status ?? null
        : prior?.latest_proof_status ?? null,
      proofs: proofsFresh ? current?.proofs ?? [] : prior?.proofs ?? [],
      package_count: packagesFresh ? current?.package_count ?? 0 : prior?.package_count ?? 0,
      latest_tracking_message: packagesFresh
        ? current?.latest_tracking_message ?? null
        : prior?.latest_tracking_message ?? null,
      packages: packagesFresh ? current?.packages ?? [] : prior?.packages ?? []
    };
  });

  return {
    ...fresh,
    header: orderFresh ? fresh.header : previous.header,
    live_order: orderFresh ? fresh.live_order : previous.live_order,
    order_status: orderFresh ? fresh.order_status : previous.order_status,
    proof_summary: proofsFresh ? fresh.proof_summary : previous.proof_summary,
    shipment_summary: packagesFresh ? fresh.shipment_summary : previous.shipment_summary,
    lines,
    lookups: {
      order: orderFresh ? fresh.lookups.order : previous.lookups.order,
      proofs: proofsFresh ? fresh.lookups.proofs : previous.lookups.proofs,
      packages: packagesFresh ? fresh.lookups.packages : previous.lookups.packages
    },
    refreshed_at: anyFresh ? fresh.refreshed_at : previous.refreshed_at
  };
}

export function summarizePublicStatusRefresh(
  results: Array<{ status: PublicStatusRefreshState; checked_at: string }>,
  pollAfterSeconds = 30
): PublicStatusRefreshMetadata {
  const checkedAt = results
    .map((result) => result.checked_at)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? new Date().toISOString();

  return {
    status: results.every((result) => result.status === "live") ? "live" : "degraded",
    checked_at: checkedAt,
    next_refresh_at: new Date(Date.parse(checkedAt) + pollAfterSeconds * 1_000).toISOString(),
    poll_after_seconds: pollAfterSeconds
  };
}

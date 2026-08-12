import type {
  OrderRollupDataSource,
  OrderRollupIssue,
  OrderRollupSourceReason,
  OrderRollupSourceStatus
} from "@pathfinder/order-rollup";
import type { PublicOrderStatusSnapshot } from "./store.js";

export type PublicStatusRefreshState = "live" | "degraded";

export interface PublicStatusRefreshMetadata {
  status: PublicStatusRefreshState;
  checked_at: string;
  next_refresh_at: string;
  poll_after_seconds: number;
}

export type PublicStatusSourceOutcome =
  | "success"
  | "timeout"
  | "non_2xx"
  | "rejected"
  | "not_configured";

const sourceReason: Record<PublicStatusSourceOutcome, OrderRollupSourceReason> = {
  success: "available",
  timeout: "timeout",
  non_2xx: "upstream_non_2xx",
  rejected: "request_failed",
  not_configured: "not_configured"
};

export function buildPublicStatusSourceStatus(args: {
  source: OrderRollupDataSource;
  outcome: PublicStatusSourceOutcome;
  checked_at: string;
  last_success_at?: string | null;
}): OrderRollupSourceStatus {
  const available = args.outcome === "success";
  const lastSuccessAt = available ? args.checked_at : args.last_success_at ?? null;
  const coreUnavailable = args.source === "order";
  return {
    source: args.source,
    availability: available
      ? "available"
      : lastSuccessAt
        ? "stale"
        : args.outcome === "not_configured"
          ? "not_configured"
          : "unavailable",
    reason_code: sourceReason[args.outcome],
    severity: available ? "info" : coreUnavailable ? "error" : "warning",
    impact: available ? "none" : coreUnavailable ? "core_unavailable" : "section_stale",
    checked_at: args.checked_at,
    last_success_at: lastSuccessAt
  };
}

export function customerSafeIssueForSource(status: OrderRollupSourceStatus): OrderRollupIssue | null {
  if (status.availability === "available") return null;
  const message = status.source === "order"
    ? "Current order status is temporarily unavailable. We’re showing the last confirmed update and will retry automatically."
    : status.source === "proofs"
      ? "Some proof details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically."
      : "Some shipment details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically.";
  return {
    source: status.source,
    severity: status.severity === "error" ? "error" : "warning",
    message,
    reason_code: status.reason_code,
    impact: status.impact,
    checked_at: status.checked_at,
    last_success_at: status.last_success_at
  };
}

export function customerSafeIssuesFromSourceStatus(
  statuses: PublicOrderStatusSnapshot["source_status"]
): OrderRollupIssue[] {
  return (["order", "proofs", "packages", "shipping"] as const)
    .map((source) => statuses?.[source])
    .filter((status): status is OrderRollupSourceStatus => status != null)
    .map(customerSafeIssueForSource)
    .filter((issue): issue is OrderRollupIssue => issue != null);
}

function previousLineByNumber(snapshot: PublicOrderStatusSnapshot | null) {
  return new Map((snapshot?.lines ?? []).map((line) => [line.line_number, line]));
}

type PublicStatusPackage = PublicOrderStatusSnapshot["lines"][number]["packages"][number];

function normalizedPackageValue(value: unknown) {
  return value == null ? "" : String(value).replace(/\s+/g, "").trim().toUpperCase();
}

function packageMatch(left: PublicStatusPackage, right: PublicStatusPackage) {
  const leftTracking = normalizedPackageValue(left.tracking_number);
  const rightTracking = normalizedPackageValue(right.tracking_number);
  if (leftTracking && rightTracking) return leftTracking === rightTracking;
  const leftBox = normalizedPackageValue(left.box_number);
  const rightBox = normalizedPackageValue(right.box_number);
  return Boolean(leftBox && rightBox && leftBox === rightBox);
}

function retainShippingEnrichment(base: PublicStatusPackage[], enrichment: PublicStatusPackage[]) {
  const matched = new Set<number>();
  const merged = base.map((pkg) => {
    const matchIndex = enrichment.findIndex((candidate, index) => !matched.has(index) && packageMatch(pkg, candidate));
    if (matchIndex < 0) return pkg;
    matched.add(matchIndex);
    const prior = enrichment[matchIndex];
    return {
      ...pkg,
      tracking_number: pkg.tracking_number ?? prior.tracking_number,
      ship_method: pkg.ship_method ?? prior.ship_method,
      tracker_message: pkg.tracker_message ?? prior.tracker_message,
      location_name: pkg.location_name ?? prior.location_name,
      destination: pkg.destination ?? prior.destination
    };
  });
  const retainedTracking = new Set(merged.map((pkg) => normalizedPackageValue(pkg.tracking_number)).filter(Boolean));
  enrichment.forEach((pkg, index) => {
    const tracking = normalizedPackageValue(pkg.tracking_number);
    if (!matched.has(index) && tracking && !retainedTracking.has(tracking)) {
      merged.push(pkg);
      retainedTracking.add(tracking);
    }
  });
  return merged;
}

function mergedSourceStatus(
  previous: PublicOrderStatusSnapshot | null,
  fresh: PublicOrderStatusSnapshot
) {
  const statuses: PublicOrderStatusSnapshot["source_status"] = {};
  for (const source of ["order", "proofs", "packages", "shipping"] as const) {
    const current = fresh.source_status?.[source];
    const prior = previous?.source_status?.[source];
    if (!current) {
      if (prior) statuses[source] = prior;
      continue;
    }
    const legacyLastSuccessAt = source === "order"
      ? previous?.lookups.order?.ok ? previous.lookups.order.fetched_at : null
      : source === "proofs"
        ? previous?.lookups.proofs?.ok ? previous.lookups.proofs.fetched_at : null
        : source === "packages"
          ? previous?.lookups.packages?.ok ? previous.lookups.packages.fetched_at : null
          : previous?.lookups.shipping?.ok
            ? previous.lookups.shipping.fetched_at
            : previous?.shipment_summary
              ? previous.refreshed_at
              : null;
    const lastSuccessAt = prior?.last_success_at ?? legacyLastSuccessAt;
    statuses[source] = current.availability === "available" || !lastSuccessAt
      ? current
      : {
          ...current,
          availability: "stale",
          last_success_at: lastSuccessAt
        };
  }
  return statuses;
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
    shipping?: boolean;
  } = {}
): PublicOrderStatusSnapshot {
  if (!previous) {
    return fresh;
  }

  const orderFresh = availability.order ?? fresh.lookups.order?.ok === true;
  const proofsFresh = availability.proofs ?? fresh.lookups.proofs?.ok === true;
  const packagesFresh = availability.packages ?? fresh.lookups.packages?.ok === true;
  const shippingFresh = availability.shipping ?? fresh.lookups.shipping?.ok === true;
  const anyFresh = orderFresh || proofsFresh || packagesFresh || shippingFresh;
  const previousLines = previousLineByNumber(previous);

  const baseLines = orderFresh ? fresh.lines : previous.lines;
  const freshLines = new Map(fresh.lines.map((line) => [line.line_number, line]));
  const lines = baseLines.map((baseLine) => {
    const current = freshLines.get(baseLine.line_number);
    const prior = previousLines.get(baseLine.line_number);

    const currentPackages = current?.packages ?? [];
    const priorPackages = prior?.packages ?? [];
    const packages = packagesFresh
      ? shippingFresh
        ? currentPackages
        : retainShippingEnrichment(currentPackages, priorPackages)
      : shippingFresh
        ? retainShippingEnrichment(priorPackages, currentPackages)
        : priorPackages;

    return {
      ...baseLine,
      proof_count: proofsFresh ? current?.proof_count ?? 0 : prior?.proof_count ?? 0,
      latest_proof_status: proofsFresh
        ? current?.latest_proof_status ?? null
        : prior?.latest_proof_status ?? null,
      proofs: proofsFresh ? current?.proofs ?? [] : prior?.proofs ?? [],
      package_count: packagesFresh ? current?.package_count ?? 0 : prior?.package_count ?? 0,
      latest_tracking_message: packagesFresh || shippingFresh
        ? current?.latest_tracking_message ?? prior?.latest_tracking_message ?? null
        : prior?.latest_tracking_message ?? null,
      packages
    };
  });

  const sourceStatus = mergedSourceStatus(previous, fresh);
  const shipmentSummaryFresh = packagesFresh && shippingFresh;

  return {
    ...fresh,
    header: orderFresh ? fresh.header : previous.header,
    live_order: orderFresh ? fresh.live_order : previous.live_order,
    order_status: orderFresh ? fresh.order_status : previous.order_status,
    proof_summary: proofsFresh ? fresh.proof_summary : previous.proof_summary,
    shipment_summary: shipmentSummaryFresh
      ? fresh.shipment_summary
      : previous.shipment_summary ?? fresh.shipment_summary,
    lines,
    lookups: {
      order: orderFresh ? fresh.lookups.order : previous.lookups.order,
      proofs: proofsFresh ? fresh.lookups.proofs : previous.lookups.proofs,
      packages: packagesFresh ? fresh.lookups.packages : previous.lookups.packages,
      shipping: shippingFresh ? fresh.lookups.shipping : previous.lookups.shipping
    },
    source_status: sourceStatus,
    issues: customerSafeIssuesFromSourceStatus(sourceStatus),
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

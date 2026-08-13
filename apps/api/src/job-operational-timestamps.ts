import type { ProcessingJobPreview } from "./store.js";

export type LiftCreationPrecision = "date" | "timestamp";
export type LiftCreationSource = "lift_header" | "pathfinder_submit_confirmation";

export interface LiftCreationProjection {
  value: string | null;
  precision: LiftCreationPrecision | null;
  source: LiftCreationSource | null;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validTimestamp(value?: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isDateOnlyLiftCreation(value?: string | null) {
  return Boolean(value && DATE_ONLY_PATTERN.test(value));
}

function hasManualCurrentOrderAssociation(job: ProcessingJobPreview) {
  return Boolean(
    job.target_order_number &&
      job.target_order_association_history?.some(
        (entry) => entry.source === "manual_verified" && entry.order_number === job.target_order_number
      )
  );
}

/**
 * Lift's order header currently supplies a calendar date for many orders. Use
 * Pathfinder's exact confirmation time only for orders Pathfinder submitted;
 * a manual association must never make its link time look like Lift creation.
 */
export function projectLiftCreation(
  job: ProcessingJobPreview,
  liftHeaderCreation?: string | null
): LiftCreationProjection {
  const headerValue = liftHeaderCreation?.trim() || null;
  const headerIsDateOnly = isDateOnlyLiftCreation(headerValue);
  const exactConfirmation = hasManualCurrentOrderAssociation(job) ? null : job.order_confirmed_at ?? null;

  if (headerValue && !headerIsDateOnly && validTimestamp(headerValue) !== null) {
    return { value: headerValue, precision: "timestamp", source: "lift_header" };
  }
  if (exactConfirmation && validTimestamp(exactConfirmation) !== null) {
    return {
      value: exactConfirmation,
      precision: "timestamp",
      source: "pathfinder_submit_confirmation"
    };
  }
  if (headerValue && headerIsDateOnly) {
    return { value: headerValue, precision: "date", source: "lift_header" };
  }
  return { value: null, precision: null, source: null };
}

function latestTimestamp(values: Array<string | null | undefined>) {
  let latestValue: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const timestamp = validTimestamp(value);
    if (timestamp !== null && timestamp > latestTime) {
      latestTime = timestamp;
      latestValue = value ?? null;
    }
  }
  return latestValue;
}

/**
 * A list-facing activity clock. It intentionally ignores scheduler discovery
 * sightings, status-check timestamps, and generic updates to stable jobs so a
 * no-op replay cannot reorder the operational queue.
 */
export function projectLastMeaningfulActivity(job: ProcessingJobPreview) {
  const stateResultTimestamp = ["Submitted", "Submit Failed", "Failed", "Cancelled", "Retry"].includes(job.state)
    ? job.updated_at
    : null;
  return latestTimestamp([
    job.created_at,
    job.order_confirmed_at,
    job.archived_at,
    stateResultTimestamp,
    ...(job.source_order_history ?? [])
      .filter((entry) => entry.action !== "source_change_assessed_no_impact")
      .map((entry) => entry.created_at),
    ...(job.source_order_review_dispositions ?? []).map((entry) => entry.created_at),
    ...(job.source_document_publications ?? []).map((entry) => entry.published_at),
    ...(job.recovery_audit ?? []).map((entry) => entry.created_at),
    ...(job.target_order_association_history ?? []).map((entry) => entry.linked_at),
    ...(job.wrike_status_writebacks ?? []).flatMap((entry) => [
      entry.prepared_at,
      entry.posted_at,
      entry.updated_at
    ])
  ]) ?? job.created_at;
}

export type LiftCreationPrecision = "date" | "timestamp";

export interface OperationalJobTimeFields {
  state: string;
  target_order_number?: string | null;
  target_order_created_at?: string | null;
  target_order_created_precision?: LiftCreationPrecision | null;
  last_activity_at?: string | null;
  created_at: string;
  updated_at: string;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function operationalTimestampMs(value?: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function displayLiftCreated(
  value?: string | null,
  precision?: LiftCreationPrecision | null,
  options: { locale?: string; timeZone?: string } = {}
) {
  if (!value) return null;
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (precision === "date" || dateOnly) {
    if (!dateOnly) return value;
    const calendarDate = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return calendarDate.toLocaleDateString(options.locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    });
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleString(options.locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  });
}

export function lastMeaningfulActivity(job: OperationalJobTimeFields) {
  return job.last_activity_at ?? job.updated_at;
}

export function compareOperationalJobTime(
  first: OperationalJobTimeFields,
  second: OperationalJobTimeFields,
  field: "created_at" | "last_activity_at" | "target_order_created_at",
  direction: "asc" | "desc"
) {
  const firstValue = field === "last_activity_at" ? lastMeaningfulActivity(first) : first[field];
  const secondValue = field === "last_activity_at" ? lastMeaningfulActivity(second) : second[field];
  const firstTime = operationalTimestampMs(firstValue);
  const secondTime = operationalTimestampMs(secondValue);
  const firstMissing = firstTime === Number.NEGATIVE_INFINITY;
  const secondMissing = secondTime === Number.NEGATIVE_INFINITY;
  if (firstMissing !== secondMissing) return firstMissing ? 1 : -1;
  if (firstMissing && secondMissing) return 0;
  return (firstTime - secondTime) * (direction === "asc" ? 1 : -1);
}

function needsImmediateTriage(job: OperationalJobTimeFields, nowMs: number) {
  if (["Submitted", "Needs Mapping", "Submit Failed", "Failed", "Cancelled", "Retry"].includes(job.state)) {
    return true;
  }
  return job.state === "Ready" && nowMs - operationalTimestampMs(job.created_at) >= 30 * 60 * 1000;
}

/** Issue rows lead; confirmed rows then follow newest trustworthy Lift creation. */
export function rankRecentOperationalJobs<T extends OperationalJobTimeFields>(
  jobs: T[],
  limit = 5,
  now = new Date()
) {
  const nowMs = now.getTime();
  return [...jobs]
    .sort((first, second) => {
      const firstTriage = needsImmediateTriage(first, nowMs);
      const secondTriage = needsImmediateTriage(second, nowMs);
      if (firstTriage !== secondTriage) return firstTriage ? -1 : 1;
      if (firstTriage && secondTriage) {
        return compareOperationalJobTime(first, second, "last_activity_at", "desc");
      }
      const firstConfirmed = Boolean(first.target_order_number);
      const secondConfirmed = Boolean(second.target_order_number);
      if (firstConfirmed !== secondConfirmed) return firstConfirmed ? -1 : 1;
      if (firstConfirmed && secondConfirmed) {
        const liftComparison = compareOperationalJobTime(first, second, "target_order_created_at", "desc");
        if (liftComparison !== 0) return liftComparison;
      }
      return compareOperationalJobTime(first, second, "created_at", "desc");
    })
    .slice(0, limit);
}

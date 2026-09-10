import { intakeWatchdog, type IntakeAttempt } from "./intake-assurance.js";

export class IntakeQueryError extends Error {}
export interface IntakePage { attempts: IntakeAttempt[]; next_cursor: string | null }
export function intakePageRequest(customerId: string, limit = 50, cursor?: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(customerId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new IntakeQueryError("Invalid intake query");
  }
  let after: string | null = null;
  if (cursor !== undefined) {
    try {
      if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (parsed.version !== 1 || parsed.customer_id !== customerId || !/^intake_[a-f0-9]{64}$/.test(parsed.after)) throw new Error();
      after = parsed.after;
    } catch { throw new IntakeQueryError("Invalid intake cursor"); }
  }
  return { customer_id: customerId, limit, after };
}
export function intakePageCursor(customerId: string, after: string) {
  return Buffer.from(JSON.stringify({ version: 1, customer_id: customerId, after })).toString("base64url");
}
export function projectIntakeException(attempt: IntakeAttempt, now: string) {
  const health = intakeWatchdog(attempt, now);
  return {
    attempt_id: attempt.attempt_id, provider: attempt.signal.provider, source_id: attempt.signal.source_id,
    state: attempt.state, owner: health.status_link_repair_required ? "internal" : attempt.owner,
    reason: attempt.reason ?? (health.status_link_repair_required ? "success_writeback_missing" : null),
    created_at: attempt.created_at, updated_at: attempt.updated_at, next_action_at: attempt.next_action_at,
    age_seconds: Math.max(0, Math.floor((Date.parse(now) - Date.parse(attempt.created_at)) / 1000)),
    overdue: health.overdue, status_link_repair_required: health.status_link_repair_required,
    job_id: attempt.job_id, confirmed_order_number: attempt.confirmed_order_number,
    needs_attention: !["confirmed", "withdrawn", "superseded"].includes(attempt.state) || health.status_link_repair_required
  };
}
/** Page counts deliberately describe only this page; they are not global totals. */
export function buildIntakeExceptionsPage(page: IntakePage, now: string) {
  if (!Number.isFinite(Date.parse(now))) throw new IntakeQueryError("Invalid intake query time");
  const rows = page.attempts.map((attempt) => projectIntakeException(attempt, now)).filter((row) => row.needs_attention);
  return { schema_version: 1, checked_at: now, rows, next_cursor: page.next_cursor,
    scanned_count: page.attempts.length, page_exception_count: rows.length,
    page_overdue_count: rows.filter((row) => row.overdue).length };
}

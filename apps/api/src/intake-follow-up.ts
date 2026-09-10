import { initialIntakeNotificationRecipient, intakeEffectKey, intakeFailures, intakeWatchdog, type IntakeAttempt, type IntakeFailure } from "./intake-assurance.js";
import type { TransactionalEmail } from "./email.js";
import type { IntakePage } from "./intake-exceptions.js";

const customerCorrections: Partial<Record<IntakeFailure, string>> = {
  missing_order_grid: "Please attach the completed order grid to this request so we can review your order.",
  invalid_order_grid: "Please check the order grid against the agreed template and attach a corrected copy.",
  ambiguous_order_grid: "Please identify which order grid is the final version for this request.",
  contract_mismatch: "Please check that the contract number on the request and order grid match, then correct the inconsistent value.",
  missing_required_data: "Please complete the required fields in the agreed order template and on the request, then provide the updated information.",
  unmapped_product: "One or more products could not be matched to the agreed product list. Please confirm the intended products for this order."
};
export function draftIntakeCustomerFeedback(attempt: IntakeAttempt) {
  if (attempt.owner !== "customer" || attempt.state !== "customer_action_required" || !attempt.reason ||
    intakeFailures[attempt.reason] !== "customer" || attempt.submit_attempt_id || attempt.confirmed_order_number) return null;
  const correction = customerCorrections[attempt.reason];
  if (!correction) return null;
  return { deduplication_key: intakeEffectKey(attempt, "source_feedback"),
    text: `Pathfinder needs more information to continue this intake request. ${correction}`, reason: attempt.reason };
}
const html = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function draftIntakeInternalNotification(attempt: IntakeAttempt, now: string): { deduplication_key: string; message: TransactionalEmail } | null {
  const health = intakeWatchdog(attempt, now);
  if (attempt.owner !== "internal" && !health.internal_action_required) return null;
  const text = ["Pathfinder intake requires internal review.", `Attempt: ${attempt.attempt_id}`,
    `Provider: ${attempt.signal.provider}`, `Source: ${attempt.signal.source_id}`, `State: ${attempt.state}`,
    `Reason: ${attempt.reason ?? (health.status_link_repair_required ? "success_writeback_missing" : "sla_overdue")}`,
    `Job: ${attempt.job_id ?? "not created"}`, `Confirmed order: ${attempt.confirmed_order_number ?? "not confirmed"}`,
    "Review the existing job, submit-attempt and source writeback ledgers. Do not resubmit an uncertain order."
  ].join("\n");
  return { deduplication_key: intakeEffectKey(attempt, "internal_notification"), message: {
    to: [initialIntakeNotificationRecipient], category: "system", subject: "Pathfinder intake requires review",
    text, html: `<p>${html(text).replaceAll("\n", "<br />")}</p>`
  } };
}
export type IntakeWatchdogAction = "review_success_writeback" | "reconcile_existing_submit" | "inspect_existing_evidence" | "review_customer_follow_up" | "review_internal_failure";
/** Bounded planning only: no clocks, timers, provider requests, retries or deliveries. */
export function planIntakeWatchdogPage(page: IntakePage, now: string) {
  if (page.attempts.length > 100 || !Number.isFinite(Date.parse(now))) throw new Error("Invalid watchdog page");
  const plans = page.attempts.flatMap((attempt) => {
    const health = intakeWatchdog(attempt, now);
    if (!health.overdue && !health.status_link_repair_required && attempt.owner !== "internal") return [];
    const action: IntakeWatchdogAction = health.status_link_repair_required ? "review_success_writeback" :
      attempt.submit_attempt_id ? "reconcile_existing_submit" : attempt.owner === "customer" ? "review_customer_follow_up" :
      attempt.owner === "internal" ? "review_internal_failure" : "inspect_existing_evidence";
    return [{ attempt_id: attempt.attempt_id, customer_id: attempt.signal.customer_id, revision: attempt.revision,
      next_action_at: attempt.next_action_at, overdue: health.overdue, action, deduplication_key: health.deduplication_key }];
  }).sort((left, right) => (left.next_action_at ?? "").localeCompare(right.next_action_at ?? "") || left.attempt_id.localeCompare(right.attempt_id));
  return { checked_at: now, plans, next_cursor: page.next_cursor, page_scanned_count: page.attempts.length,
    page_overdue_count: plans.filter((plan) => plan.overdue).length,
    page_writeback_review_count: plans.filter((plan) => plan.action === "review_success_writeback").length };
}

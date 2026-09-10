import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, intakeFailures, transitionIntake } from "../src/intake-assurance.js";
import { draftIntakeCustomerFeedback, draftIntakeInternalNotification, planIntakeWatchdogPage } from "../src/intake-follow-up.js";
const now = "2026-09-10T12:00:00Z";
const initial = () => createIntakeAttempt({ schema_version: 1, customer_id: "synthetic", provider: "wrike", connection_id: "connection", source_id: "<script>unsafe</script>", intent_key: "ready", intent_occurrence: "1", observed_at: "2026-09-10T10:00:00Z" }, "2026-09-10T11:00:00Z");
test("customer drafts cover only safe reasons and never include provider exceptions or post-submit instructions", () => {
  for (const [reason, owner] of Object.entries(intakeFailures)) {
    const attempt = transitionIntake(initial(), { event_id: reason, expected_revision: 0, occurred_at: initial().created_at,
      state: owner === "customer" ? "customer_action_required" : "internal_action_required", reason: reason as keyof typeof intakeFailures,
      next_action_at: "2026-09-10T11:00:00Z" });
    const draft = draftIntakeCustomerFeedback(attempt);
    assert.equal(Boolean(draft), owner === "customer");
    if (draft) {
      assert.ok(!draft.text.includes("script"));
      assert.equal(draftIntakeCustomerFeedback({ ...attempt, submit_attempt_id: "submit" }), null);
      assert.equal(draftIntakeCustomerFeedback({ ...attempt, confirmed_order_number: "ORDER" }), null);
      assert.deepEqual(draftIntakeCustomerFeedback(attempt), draft);
    }
  }
});
test("internal drafts use the existing SES message contract and fixed initial recipient; HTML is escaped", () => {
  assert.equal(draftIntakeInternalNotification(initial(), initial().created_at), null);
  const draft = draftIntakeInternalNotification(initial(), now)!;
  assert.deepEqual(draft.message.to, ["pathfinder@vornan.co"]);
  assert.equal(draft.message.category, "system");
  assert.ok(!draft.message.html.includes("<script>"));
  assert.match(draft.message.html, /&lt;script&gt;/);
  assert.match(draft.message.text, /Do not resubmit/);
});
test("watchdog plans are bounded, deterministic, page-scoped and never imply blind submission", () => {
  const received = initial();
  const submit = { ...received, attempt_id: "second", state: "reconciling" as const, submit_attempt_id: "submit" };
  const confirmed = { ...received, attempt_id: "third", state: "confirmed" as const, confirmed_order_number: "ORDER", next_action_at: null };
  const page = { attempts: [received, submit, confirmed], next_cursor: "more" };
  const first = planIntakeWatchdogPage(page, now);
  assert.deepEqual(planIntakeWatchdogPage(page, now), first);
  assert.deepEqual(new Set(first.plans.map((entry) => entry.action)), new Set(["inspect_existing_evidence", "reconcile_existing_submit", "review_success_writeback"]));
  assert.equal(first.next_cursor, "more");
  assert.equal(first.page_scanned_count, 3);
  assert.equal(first.page_overdue_count, 2);
  assert.throws(() => planIntakeWatchdogPage({ attempts: Array(101).fill(received), next_cursor: null }, now));
});

test("existing telemetry module emits page counts without intake identities, cursor contents or provider data", async () => {
  const { buildIntakeAssuranceWatchdogLog } = await import("../src/wrike-scheduled-telemetry.js");
  const plan = planIntakeWatchdogPage({ attempts: [initial()], next_cursor: "private-cursor" }, now);
  const payload = buildIntakeAssuranceWatchdogLog(plan, Date.parse(now));
  assert.equal(payload.intake_page_overdue, 1);
  assert.equal(payload.more_pages, true);
  assert.ok(!JSON.stringify(payload).includes("private-cursor"));
  assert.ok(!JSON.stringify(payload).includes("script"));
  assert.throws(() => buildIntakeAssuranceWatchdogLog({ ...plan, page_scanned_count: -1 }));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, type IntakeLedger } from "../src/intake-assurance.js";
import { captureWrikeIntakeIntents, projectWrikeAssuranceOutcome, wrikeIntakeIntentCandidates, type WrikeAssuranceScope } from "../src/wrike-intake-assurance.js";
import type { ProcessingJobPreview, SubmitAttempt } from "../src/store.js";
const now = "2026-09-10T10:00:00Z";
const deadline = "2026-09-10T11:00:00Z";
const scope: WrikeAssuranceScope = { customer_id: "synthetic", connection_id: "connection", import_method_id: "method", approved_status_label: "Fixture – Ready", configured_status_label: "Fixture – Ready", configured_status_id: "status" };
const discovery = () => ({ checked_at: now, order_candidates: [{ task_id: "task", custom_status_id: "status" }],
  pending_order_candidates: [
    { task_id: "missing-contract", custom_status_id: "status", identity_matches: true, reasons: [{ code: "contract_number" }] },
    { task_id: "other-status", custom_status_id: "other", identity_matches: true, reasons: [{ code: "trigger_status" }] },
    { task_id: "not-an-order", custom_status_id: "status", identity_matches: false, reasons: [{ code: "task_identity" }] }
  ], summary: { resolved_order_status_ids: ["status"] }
}) as Parameters<typeof wrikeIntakeIntentCandidates>[1];
const initial = () => createIntakeAttempt(wrikeIntakeIntentCandidates(scope, discovery())[1]!.signal, deadline);
const job = () => ({ customer_id: "synthetic", job_id: "job", import_method_id: "method", source_evidence: { provider: "wrike", task_id: "task", connection_id: "connection" },
  state: "Ready", target_order_number: null, lift_payload: { order: { ext_id: "EXACT" } }, wrike_status_writebacks: []
}) as unknown as ProcessingJobPreview;
const submit = () => ({ customer_id: "synthetic", job_id: "job", attempt_id: "submit", state: "Submission Uncertain", transport_mode: "live", external_submit_enabled: true,
  ext_id: "EXACT", company_id: "91", request_fingerprint: "fingerprint", response: { status: "error", lift_order_id: null }
}) as SubmitAttempt;
const project = (jobs = [job()], submits: SubmitAttempt[] = []) => projectWrikeAssuranceOutcome({ attempt: initial(), import_method_id: "method", jobs, submits });
test("exact verified status captures intent before prequalification without mentions or mutable timestamps in identity", () => {
  const result = wrikeIntakeIntentCandidates(scope, discovery());
  assert.deepEqual(result.map((entry) => entry.signal.source_id), ["missing-contract", "task"]);
  assert.equal(result[0]!.prequalification_reason, "pathfinder_failure");
  assert.equal(createIntakeAttempt(result[1]!.signal, deadline).attempt_id, createIntakeAttempt({ ...result[1]!.signal, observed_at: "2026-09-10T10:30:00Z" }, deadline).attempt_id);
  assert.throws(() => wrikeIntakeIntentCandidates({ ...scope, configured_status_label: "Fixture - Ready" }, discovery()));
  assert.throws(() => wrikeIntakeIntentCandidates({ ...scope, configured_status_id: "unverified" }, discovery()));
  const ambiguous = discovery(); ambiguous.summary.resolved_order_status_ids.push("another");
  assert.throws(() => wrikeIntakeIntentCandidates(scope, ambiguous));
});
test("capture stays dark, reserves rejected intents, preserves replay and fails closed before over-limit work", async () => {
  const stored = new Map<string, ReturnType<typeof initial>>();
  let reservations = 0;
  const ledger: IntakeLedger = {
    reserve: async (signal, next) => {
      reservations++;
      const attempt = createIntakeAttempt(signal, next);
      const existing = stored.get(attempt.attempt_id);
      if (existing) return { attempt: existing, created: false };
      stored.set(attempt.attempt_id, attempt); return { attempt, created: true };
    },
    get: async (_customer, id) => stored.get(id) ?? null,
    transition: async (_customer, id, event) => {
      const updated = transitionIntake(stored.get(id)!, event); stored.set(id, updated); return updated;
    }
  };
  const args = { enabled: false, scope, discovery: discovery(), ledger, next_action_at: deadline, max_candidates: 10 };
  assert.equal((await captureWrikeIntakeIntents(args)).status, "disabled");
  assert.equal(reservations, 0);
  await assert.rejects(captureWrikeIntakeIntents({ ...args, enabled: true, max_candidates: 1 }));
  assert.equal(reservations, 0);
  assert.equal((await captureWrikeIntakeIntents({ ...args, enabled: true })).created, 2);
  assert.equal((await captureWrikeIntakeIntents({ ...args, enabled: true })).replayed, 2);
  assert.equal([...stored.values()].find((entry) => entry.signal.source_id === "missing-contract")?.state, "internal_action_required");
  await assert.rejects(captureWrikeIntakeIntents({ ...args, enabled: true, ledger: { ...ledger, reserve: async () => { throw new Error("storage unavailable"); } } }), /storage unavailable/);
});
test("existing transport uncertainty and duplicate identities remain internally owned without resubmission", () => {
  assert.equal(project().state, "ready");
  assert.equal(project([{ ...job(), state: "Needs Mapping" }]).reason, "unmapped_product");
  assert.equal(project([{ ...job(), state: "Failed" }]).state, "internal_action_required");
  assert.equal(project([job()], [submit()]).state, "reconciling");
  assert.equal(project([job(), { ...job(), job_id: "second" }]).state, "manual_review");
  assert.equal(project([job()], [submit(), { ...submit(), attempt_id: "second" }]).state, "manual_review");
  assert.equal(project([job()], [{ ...submit(), ext_id: "WRONG" }]).state, "manual_review");
  assert.equal(project([job()], [{ ...submit(), transport_mode: "mock" }]).state, "manual_review");
  for (const category of ["duplicate_ext_id", "duplicate_order_name"] as const) {
    const failed = { ...submit(), state: "Failed" as const, response: { ...submit().response, error_translation: { category } as SubmitAttempt["response"]["error_translation"] } };
    assert.equal(project([job()], [failed]).reason, category);
  }
});
test("confirmation requires authoritative association and repair respects writeback uncertainty and suppression", () => {
  const order = "LTL123";
  const confirmedJob = { ...job(), target_order_number: order };
  const accepted = { ...submit(), state: "Submitted" as const, response: { status: "accepted" as const, lift_order_id: order } };
  assert.equal(project([confirmedJob], [submit()]).state, "manual_review");
  assert.equal(project([confirmedJob], [accepted]).repair, "existing_success_writeback");
  const writeback = { task_id: "task", connection_id: "connection", order_number: order, writeback_id: "writeback", state: "posted", comment_id: "comment", status_url_sha256: "hash", posted_at: now } as NonNullable<ProcessingJobPreview["wrike_status_writebacks"]>[number];
  assert.equal(project([{ ...confirmedJob, wrike_status_writebacks: [writeback] }], [accepted]).state, "confirmed");
  assert.equal(project([{ ...confirmedJob, wrike_status_writebacks: [{ ...writeback, state: "submission_uncertain" }] }], [accepted]).repair, "manual_review");
  assert.equal(project([{ ...confirmedJob, wrike_status_writebacks: [{ ...writeback, state: "posted", status_url_sha256: "" }] }], [accepted]).repair, "existing_success_writeback");
  const history = { source: "scheduled_uncertain_reconciliation", order_number: order, verification: { order_number: order, external_order_id: "EXACT", submit_attempt_id: "submit", request_fingerprint: "fingerprint", company_id: "91" } } as NonNullable<ProcessingJobPreview["target_order_association_history"]>[number];
  assert.equal(project([{ ...confirmedJob, target_order_association_history: [history] }], [submit()]).confirmed_order_number, order);
  assert.equal(project([{ ...confirmedJob, target_order_association_history: [{ ...history, automatic_wrike_status_writeback_suppressed: true }] }], [accepted]).repair, "manual_review");
  assert.equal(project([{ ...confirmedJob, target_order_association_history: [{ ...history, verification: { ...history.verification, company_id: "WRONG" } }] }], [submit()]).state, "manual_review");
});

test("Momentara dash aliases produce one durable intent key and never broaden status ID selection", () => {
  const hyphen = { ...scope, approved_status_label: "Sent to Print - LTL", configured_status_label: "Sent to Print - LTL" };
  const enDash = { ...scope, approved_status_label: "Sent to Print – LTL", configured_status_label: "Sent to Print – LTL" };
  const first = wrikeIntakeIntentCandidates(hyphen, discovery());
  const second = wrikeIntakeIntentCandidates(enDash, discovery());
  assert.deepEqual(second, first);
  assert.equal(first[0]!.signal.intent_key, "Sent to Print - LTL");
  assert.throws(() => wrikeIntakeIntentCandidates({ ...hyphen, configured_status_label: "Sent to Print — LTL" }, discovery()));
  assert.throws(() => wrikeIntakeIntentCandidates({ ...hyphen, configured_status_id: "other" }, discovery()));
});

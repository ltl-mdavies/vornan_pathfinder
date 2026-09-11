import assert from "node:assert/strict";
import test from "node:test";
import { createSharedWrikeCapture } from "../src/wrike-shared-capture.js";
import { createIntakeAttempt, transitionIntake, type IntakeAttempt, type IntakeLedger } from "../src/intake-assurance.js";
import { observeWrikeIntent, type WrikeIntentCursor } from "../src/wrike-intent-observation.js";
import { createWrikeAssuranceCycle, applyWrikeAssuranceObservation, wrapWrikeAssurancePreparation } from "../src/wrike-assurance-coordinator.js";
import type { WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";
import type { ProcessingJobPreview, SubmitAttempt } from "../src/store.js";
const scope = { customer_id: "synthetic", import_method_id: "method", connection_id: "connection", configured_status_id: "READY", configured_status_label: "Sent to Print – LTL", approved_status_label: "Sent to Print - LTL" };
const clock = (s: number) => `2026-09-10T12:00:0${s}Z`;
const discovery = (s: number, ready = true) => ({ checked_at: clock(s),
  order_candidates: ready ? [{ task_id: "TASK", custom_status_id: "READY", updated_at: clock(s), account_id: "ACCOUNT", root_folder_ids: ["ROOT"] }] : [],
  pending_order_candidates: ready ? [] : [{ task_id: "TASK", custom_status_id: "OTHER", updated_at: clock(s), account_id: "ACCOUNT", root_folder_ids: ["ROOT"], identity_matches: true, reasons: [{ code: "trigger_status" }] }],
  summary: { resolved_order_status_ids: ["READY"] } }) as unknown as WrikeScopedIntakeDiscoveryResult;
function fixture() {
  let cursor: WrikeIntentCursor | null = null;
  const attempts = new Map<string, IntakeAttempt>();
  const jobs: ProcessingJobPreview[] = []; const submits: SubmitAttempt[] = [];
  const ledger: IntakeLedger = { get: async (_customer, id) => attempts.get(id) ?? null,
    reserve: async (signal, deadline) => { const row = createIntakeAttempt(signal, deadline); const old = attempts.get(row.attempt_id); attempts.set(row.attempt_id, old ?? row); return { attempt: old ?? row, created: !old }; },
    transition: async (_customer, id, event) => { const next = transitionIntake(attempts.get(id)!, event); attempts.set(id, next); return next; } };
  const shared = createSharedWrikeCapture({ ledger, record: async (scope, observation) => cursor = observeWrikeIntent(cursor, scope, observation),
    snapshot: async () => ({ checked_at: clock(0), jobs, submits }), reserve: async (cursor, deadline, review) => {
      const { wrikeIntentSignal } = await import("../src/wrike-intent-observation.js");
      let row = (await ledger.reserve(wrikeIntentSignal(cursor)!, deadline)).attempt;
      if (review && row.state !== "manual_review") row = await ledger.transition(scope.customer_id, row.attempt_id, { event_id: "review", expected_revision: row.revision,
        occurred_at: cursor.observed_at, state: "manual_review", reason: "reconciliation_ambiguity", next_action_at: row.next_action_at });
      return row;
    } });
  const cycle = () => createWrikeAssuranceCycle({ config: { enabled: true, connection_id: scope.connection_id, snapshot_limit: 100, customer_id: scope.customer_id, import_method_id: scope.import_method_id, sla_seconds: 3600, max_candidates: 10 }, ledger, sharedCapture: shared });
  return { shared, ledger, attempts, jobs, submits, cycle, cursor: () => cursor };
}
test("manual and scheduled cycles share prospective entry, identity and deadline", async () => {
  for (const order of ["manual-first", "scheduled-first"]) {
    const f = fixture(); const manual = f.cycle(); const scheduled = f.cycle();
    await scheduled.capture(scope, discovery(0, false));
    const first = order === "manual-first" ? manual : scheduled; const second = first === manual ? scheduled : manual;
    await first.capture(scope, discovery(1)); await second.capture(scope, discovery(2));
    first.assertPreparationAllowed("TASK"); second.assertPreparationAllowed("TASK");
    assert.equal(f.attempts.size, 1); assert.equal(f.cursor()!.generation, 1);
    assert.equal([...f.attempts.values()][0]!.next_action_at, "2026-09-10T13:00:01.000Z");
  }
});
test("initial ready and task reuse stay in manual review and never prepare", async () => {
  for (const initialReady of [true, false]) {
    const f = fixture(); const cycle = f.cycle();
    if (!initialReady) {
      await cycle.capture(scope, discovery(0, false)); await cycle.capture(scope, discovery(1));
      await cycle.capture(scope, discovery(2, false));
    }
    await cycle.capture(scope, discovery(3));
    let calls = 0;
    await assert.rejects(wrapWrikeAssurancePreparation(cycle, async () => { calls++; })({ task_id: "TASK" }));
    assert.equal(calls, 0);
    const row = [...f.attempts.values()].at(-1)!;
    assert.equal(row.state, "manual_review");
    const unchanged = await applyWrikeAssuranceObservation({ ledger: f.ledger, attempt: row, now: clock(4), next_action_at: row.next_action_at!,
      outcome: { state: "ready", reason: null, job_id: "other-job", submit_attempt_id: null, confirmed_order_number: null, writeback_id: null, repair: "none" } });
    assert.equal(unchanged, row);
  }
});
test("legacy identity, sibling history, transport and writeback never authorize preparation", async () => {
  for (const variant of ["legacy", "job", "transport", "writeback", "association", "other-connection"]) {
    const f = fixture();
    await f.shared(scope, discovery(0, false), 3600, 10);
    if (variant === "legacy") await f.ledger.reserve({ schema_version: 1, customer_id: scope.customer_id, provider: "wrike", connection_id: scope.connection_id,
      source_id: "TASK", intent_key: scope.approved_status_label, intent_occurrence: "initial", observed_at: clock(0) }, "2026-09-10T13:00:00Z");
    else {
      f.jobs.push({ customer_id: scope.customer_id, import_method_id: scope.import_method_id, job_id: "job", source_evidence: { provider: "wrike", connection_id: variant === "other-connection" ? "old-connection" : scope.connection_id, task_id: "TASK" },
        wrike_status_writebacks: variant === "writeback" ? [{}] : [], target_order_association_history: variant === "association" ? [{}] : [] } as ProcessingJobPreview);
      if (variant === "transport") f.submits.push({ customer_id: scope.customer_id, job_id: "job" } as SubmitAttempt);
    }
    const [result] = await f.shared(scope, discovery(1), 3600, 10);
    assert.equal(result!.preparation_allowed, false, variant);
    assert.equal([...f.attempts.values()].at(-1)!.state, "manual_review");
  }
});
test("unqualified exits, duplicate tasks and incomplete timestamps cannot establish a baseline", async () => {
  const f = fixture(); const invalid = discovery(0, false);
  invalid.pending_order_candidates[0]!.reasons.push({ code: "print_vendor", message: "wrong vendor" });
  await f.shared(scope, invalid, 3600, 10); assert.equal(f.cursor(), null);
  const missing = discovery(1); missing.order_candidates[0]!.updated_at = null;
  await assert.rejects(f.shared(scope, missing, 3600, 10)); assert.equal(f.cursor(), null);
  const duplicate = discovery(1); duplicate.order_candidates.push(duplicate.order_candidates[0]!);
  await assert.rejects(f.shared(scope, duplicate, 3600, 10)); assert.equal(f.cursor(), null);
});

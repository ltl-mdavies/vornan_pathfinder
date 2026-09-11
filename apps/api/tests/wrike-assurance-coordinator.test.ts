import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, type IntakeAttempt, type IntakeLedger } from "../src/intake-assurance.js";
import { createWrikeAssuranceCycle, getWrikeAssuranceCaptureConfig, withWrikeAssuranceConnection, wrapWrikeAssurancePreparation } from "../src/wrike-assurance-coordinator.js";
import type { WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";
import type { ProcessingJobPreview, SubmitAttempt } from "../src/store.js";
const time = "2026-09-10T10:00:00Z";
const scope = { customer_id: "synthetic", import_method_id: "method", connection_id: "connection", configured_status_id: "status", configured_status_label: "Sent to Print – LTL" };
const environment = { PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: "connection", PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: "100", PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE: "true", PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: "synthetic", PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID: "method", PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: "3600", PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES: "10" };
const discovery = { checked_at: time, order_candidates: [{ task_id: "task", custom_status_id: "status" }], pending_order_candidates: [], summary: { resolved_order_status_ids: ["status"] } } as unknown as WrikeScopedIntakeDiscoveryResult;
const job = () => ({ customer_id: "synthetic", job_id: "job", import_method_id: "method", source_evidence: { provider: "wrike", task_id: "task", connection_id: "connection" }, state: "Ready", target_order_number: null, lift_payload: { order: { ext_id: "EXACT" } }, wrike_status_writebacks: [] }) as unknown as ProcessingJobPreview;
const submit = () => ({ customer_id: "synthetic", job_id: "job", attempt_id: "submit", state: "Submission Uncertain", transport_mode: "live", external_submit_enabled: true, ext_id: "EXACT", company_id: "91", request_fingerprint: "fingerprint", response: { status: "error", lift_order_id: null } }) as SubmitAttempt;
function fixture(enabled = true) {
  const records = new Map<string, IntakeAttempt>();
  const ledger: IntakeLedger = {
    get: async (_customer, id) => records.get(id) ?? null,
    reserve: async (signal, deadline) => {
      const fresh = createIntakeAttempt(signal, deadline); const previous = records.get(fresh.attempt_id);
      if (previous) return { attempt: previous, created: false };
      records.set(fresh.attempt_id, fresh); return { attempt: fresh, created: true };
    },
    transition: async (_customer, id, event) => {
      const next = transitionIntake(records.get(id)!, event); records.set(id, next); return next;
    }
  };
  let clock = new Date(time);
  const cycle = createWrikeAssuranceCycle({ config: getWrikeAssuranceCaptureConfig({ ...environment, PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE: String(enabled) }, scope), ledger, now: () => clock });
  return { records, ledger, cycle, current: () => [...records.values()][0]!, setClock: (value: string) => clock = new Date(value) };
}
test("capture requires a separate gate, exact scheduled scope and explicit bounded operating settings", () => {
  assert.equal(getWrikeAssuranceCaptureConfig({}, scope).enabled, false);
  assert.equal(getWrikeAssuranceCaptureConfig(environment, scope).enabled, true);
  for (const overrides of [
    { PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: "other" }, { PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID: "other" },
    { PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: undefined }, { PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: "0" },
    { PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES: "1001" },
    { PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: undefined }, { PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: " " },
    { PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: undefined }, { PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: "0" }, { PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: "10001" }
  ]) assert.throws(() => getWrikeAssuranceCaptureConfig({ ...environment, ...overrides }, scope));
});
test("preparation wrapper preserves the disabled callback and records failure before returning it to the scheduler", async () => {
  const failure = new Error("private parser detail");
  const prepare = async (_candidate: { task_id: string }) => { throw failure; };
  assert.equal(wrapWrikeAssurancePreparation(null, prepare), prepare);
  const f = fixture(); await f.cycle.capture(scope, discovery);
  await assert.rejects(wrapWrikeAssurancePreparation(f.cycle, prepare)({ task_id: "task" }), (error) => error === failure);
  assert.equal(f.current().state, "internal_action_required");
  assert.ok(!JSON.stringify(f.current()).includes("private parser detail"));
});
test("disabled cycle has zero ledger effects; failed reservation prevents proceeding beyond capture", async () => {
  const dark = fixture(false);
  await dark.cycle.capture(scope, discovery); await dark.cycle.preparationFailed("task"); await dark.cycle.observe({ jobs: [job()], submits: [] });
  assert.equal(dark.records.size, 0);
  const enabled = fixture();
  const broken = createWrikeAssuranceCycle({ config: getWrikeAssuranceCaptureConfig(environment, scope), ledger: { ...enabled.ledger, reserve: async () => { throw new Error("storage unavailable"); } } });
  await assert.rejects(broken.capture(scope, discovery), /storage unavailable/);
  assert.equal(enabled.records.size, 0);
});
test("a captured intent progresses from an existing job to uncertain transport and confirmed success without sending anything", async () => {
  const f = fixture();
  await f.cycle.capture(scope, discovery);
  assert.equal(f.current().state, "received");
  await f.cycle.observe({ jobs: [job()], submits: [] });
  assert.equal(f.current().state, "ready"); assert.equal(f.current().job_id, "job");
  const due = f.current().next_action_at;
  f.setClock("2026-09-10T12:00:00Z");
  await f.cycle.observe({ jobs: [job()], submits: [submit()] });
  assert.equal(f.current().state, "reconciling"); assert.equal(f.current().next_action_at, due);
  const confirmed = { ...job(), target_order_number: "LTL123" };
  const accepted = { ...submit(), state: "Submitted" as const, response: { status: "accepted" as const, lift_order_id: "LTL123" } };
  await f.cycle.observe({ jobs: [confirmed], submits: [accepted] });
  assert.equal(f.current().state, "internal_action_required");
  assert.equal(f.current().confirmed_order_number, "LTL123");
  assert.equal(f.current().reason, "success_writeback_missing");
  const revision = f.current().revision;
  f.setClock("2026-09-10T12:30:00Z");
  await f.cycle.observe({ jobs: [confirmed], submits: [accepted] });
  assert.equal(f.current().revision, revision);
  assert.equal(f.current().next_action_at, "2026-09-10T13:00:00.000Z");
  const posted = { task_id: "task", connection_id: "connection", order_number: "LTL123", writeback_id: "writeback", state: "posted", comment_id: "comment", status_url_sha256: "hash", posted_at: time } as NonNullable<ProcessingJobPreview["wrike_status_writebacks"]>[number];
  await f.cycle.observe({ jobs: [{ ...confirmed, wrike_status_writebacks: [posted] }], submits: [accepted] });
  assert.equal(f.current().state, "confirmed"); assert.equal(f.current().next_action_at, null);
});
test("late preparation failures stay visible and corrected source data can adopt the existing ready job", async () => {
  const f = fixture(); await f.cycle.capture(scope, discovery);
  f.setClock("2026-09-10T13:00:00Z"); await f.cycle.preparationFailed("task");
  assert.equal(f.current().state, "internal_action_required");
  assert.equal(f.current().next_action_at, "2026-09-10T11:00:00.000Z");
  await f.cycle.observe({ jobs: [], submits: [] }); assert.equal(f.current().state, "internal_action_required");
  await f.cycle.observe({ jobs: [{ ...job(), state: "Needs Mapping" }], submits: [] });
  assert.equal(f.current().state, "customer_action_required");
  assert.equal(f.current().reason, "unmapped_product");
  await f.cycle.observe({ jobs: [job()], submits: [] }); assert.equal(f.current().state, "ready");
});
test("ambiguous jobs and changed transport identities preserve references and require review", async () => {
  const f = fixture(); await f.cycle.capture(scope, discovery);
  await f.cycle.observe({ jobs: [job(), { ...job(), job_id: "other" }], submits: [] });
  assert.equal(f.current().state, "manual_review"); assert.equal(f.current().job_id, null);
  const g = fixture(); await g.cycle.capture(scope, discovery);
  await g.cycle.observe({ jobs: [job()], submits: [submit()] });
  await g.cycle.observe({ jobs: [job()], submits: [{ ...submit(), attempt_id: "other" }] });
  assert.equal(g.current().state, "manual_review"); assert.equal(g.current().submit_attempt_id, "submit");
});
test("a previously confirmed or terminal intent cannot silently regress or restart", async () => {
  const f = fixture(); await f.cycle.capture(scope, discovery);
  const current = f.current();
  await f.ledger.transition(scope.customer_id, current.attempt_id, { event_id: "withdraw", expected_revision: 0, occurred_at: time, state: "withdrawn", reason: null, next_action_at: null });
  await f.cycle.observe({ jobs: [job()], submits: [submit()] });
  assert.equal(f.current().state, "withdrawn");
});

test("manual and scheduled connection boundary rejects before discovery or capture effects", async () => {
  for (const entryPoint of ["manual", "scheduled"]) {
    const f = fixture(); let providerCalls = 0; let cursorCalls = 0;
    const config = getWrikeAssuranceCaptureConfig(environment, scope);
    const work = async () => { providerCalls++; cursorCalls++; await f.cycle.capture(scope, discovery); };
    await assert.rejects(async () => withWrikeAssuranceConnection(config, "changed-connection", work), /approved capture scope/, entryPoint);
    assert.equal(providerCalls, 0); assert.equal(cursorCalls, 0); assert.equal(f.records.size, 0);
    await assert.rejects(f.cycle.capture({ ...scope, connection_id: "changed-connection" }, discovery), /scope mismatch/);
    assert.equal(f.records.size, 0);
    await withWrikeAssuranceConnection(config, "connection", work);
    assert.equal(providerCalls, 1); assert.equal(f.records.size, 1);
  }
  assert.equal(withWrikeAssuranceConnection(null, "other", () => "existing path"), "existing path");
});

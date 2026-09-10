import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, type IntakeLedger } from "../src/intake-assurance.js";
import { repairIntakeStatusLink } from "../src/intake-status-repair.js";
import { getIntakeStatusRepairConfig } from "../src/intake-status-repair-runtime.js";
import type { ProcessingJobPreview, SubmitAttempt } from "../src/store.js";
const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
function fixture() {
  let attempt = createIntakeAttempt({ schema_version: 1, ...scope, source_id: "TASK123", intent_key: "Sent to Print - LTL", intent_occurrence: "initial", observed_at: "2026-09-10T10:00:00Z" }, "2026-09-10T11:00:00Z");
  const job = { customer_id: "synthetic", job_id: "job", import_method_id: "method", target_order_number: "ORDER1", source_evidence: { provider: "wrike", task_id: "TASK123", connection_id: "connection" }, lift_payload: { order: { ext_id: "EXACT" } }, wrike_status_writebacks: [] } as unknown as ProcessingJobPreview;
  const submit = { customer_id: "synthetic", job_id: "job", attempt_id: "submit", state: "Submitted", transport_mode: "live", external_submit_enabled: true, ext_id: "EXACT", response: { status: "accepted", lift_order_id: "ORDER1" } } as SubmitAttempt;
  const ledger: IntakeLedger = { get: async () => attempt, reserve: async () => { throw new Error("unexpected reserve"); }, transition: async (_customer, _id, event) => attempt = transitionIntake(attempt, event) };
  let writes = 0;
  const args: Parameters<typeof repairIntakeStatusLink>[0] = { enabled: true, scope, attempt_id: attempt.attempt_id, ledger, sla_seconds: 3600, now: () => new Date("2026-09-10T12:00:00Z"),
    snapshot: async () => ({ checked_at: "2026-09-10T12:00:00Z", jobs: [job], submits: [submit] }),
    writeBack: async target => { writes++; assert.equal(target.order_number, "ORDER1"); assert.equal(target.connection_id, "connection");
      job.wrike_status_writebacks = [{ task_id: "TASK123", connection_id: "connection", order_number: "ORDER1", state: "posted", writeback_id: "writeback", comment_id: "comment", posted_at: "2026-09-10T12:00:00Z", status_url_sha256: "hash" }] as ProcessingJobPreview["wrike_status_writebacks"];
      return { reused: false }; } };
  return { args, job, submit, writes: () => writes, attempt: () => attempt };
}
test("repair uses strict existing confirmation and writeback records, then updates the intake without a second transport", async () => {
  const f = fixture();
  assert.equal((await repairIntakeStatusLink({ ...f.args, enabled: false })).status, "disabled"); assert.equal(f.writes(), 0);
  assert.equal((await repairIntakeStatusLink(f.args)).status, "repaired"); assert.equal(f.writes(), 1);
  assert.equal(f.attempt().state, "confirmed"); assert.equal(f.attempt().writeback_id, "writeback");
  assert.equal((await repairIntakeStatusLink(f.args)).status, "blocked"); assert.equal(f.writes(), 1);
});
test("failed/prepared/uncertain writebacks, ambiguous confirmation and operator suppression never dispatch", async () => {
  for (const state of ["failed", "prepared", "submission_uncertain"] as const) {
    const f = fixture(); f.job.wrike_status_writebacks = [{ task_id: "TASK123", order_number: "ORDER1", state }] as ProcessingJobPreview["wrike_status_writebacks"];
    assert.equal((await repairIntakeStatusLink(f.args)).status, "blocked"); assert.equal(f.writes(), 0);
  }
  const f = fixture(); f.submit.ext_id = "OTHER";
  assert.equal((await repairIntakeStatusLink(f.args)).status, "blocked"); assert.equal(f.writes(), 0);
  const g = fixture(); g.job.target_order_association_history = [{ automatic_wrike_status_writeback_suppressed: true }] as ProcessingJobPreview["target_order_association_history"];
  assert.equal((await repairIntakeStatusLink(g.args)).status, "blocked"); assert.equal(g.writes(), 0);
});
test("repair cap and lease loss prevent transport; lost provider outcome leaves the existing ledger authoritative", async () => {
  const f = fixture();
  assert.equal((await repairIntakeStatusLink({ ...f.args, canRepair: () => false })).status, "deferred");
  await assert.rejects(repairIntakeStatusLink({ ...f.args, assertLease: () => { throw new Error("lease lost"); } }), /lease/);
  assert.equal(f.writes(), 0);
  await assert.rejects(repairIntakeStatusLink({ ...f.args, writeBack: async () => {
    f.job.wrike_status_writebacks = [{ task_id: "TASK123", order_number: "ORDER1", state: "submission_uncertain" }] as ProcessingJobPreview["wrike_status_writebacks"];
    throw new Error("provider outcome unknown");
  } }));
  assert.equal((await repairIntakeStatusLink(f.args)).status, "blocked"); assert.equal(f.writes(), 0);
});
test("repair gate cannot bypass existing scheduled writeback scope", () => {
  assert.equal(getIntakeStatusRepairConfig({}).sweep.enabled, false);
  const env = { PATHFINDER_ENABLE_INTAKE_STATUS_REPAIR: "true", PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: "synthetic", PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: "connection", PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID: "method", PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: "3600", PATHFINDER_INTAKE_SWEEP_PAGE_SIZE: "10", PATHFINDER_INTAKE_SWEEP_MAX_PAGES: "1", PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS: "30", PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: "100", PATHFINDER_INTAKE_STATUS_REPAIR_MAX: "1" };
  assert.throws(() => getIntakeStatusRepairConfig(env));
  assert.equal(getIntakeStatusRepairConfig({ ...env, PATHFINDER_ENABLE_WRIKE_SCHEDULED_STATUS_WRITEBACK: "true", PATHFINDER_WRIKE_SCHEDULED_CUSTOMER_ID: "synthetic", PATHFINDER_WRIKE_SCHEDULED_IMPORT_METHOD_ID: "method" }).sweep.enabled, true);
});

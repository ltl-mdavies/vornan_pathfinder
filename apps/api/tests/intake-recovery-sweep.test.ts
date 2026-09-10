import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, type IntakeLedger } from "../src/intake-assurance.js";
import { intakePageCursor, intakePageRequest } from "../src/intake-exceptions.js";
import { getIntakeSweepConfig, intakeSweepId, isIntakeRecoverySweepEvent, runIntakeRecoverySweep, type IntakeSweepCheckpoint, type IntakeSweepConfig } from "../src/intake-recovery-sweep.js";
const time = "2026-09-10T10:00:00.000Z";
const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
const config: IntakeSweepConfig = { enabled: true, scope, page_size: 1, max_pages: 1, lease_seconds: 30, snapshot_limit: 10, sla_seconds: 3600 };
function fixture() {
  const rows = ["a", "b", "c"].map(source_id => createIntakeAttempt({ schema_version: 1, ...scope, source_id, intent_key: "order", intent_occurrence: "initial", observed_at: time }, "2026-09-10T11:00:00Z")).sort((a,b) => a.attempt_id.localeCompare(b.attempt_id));
  let checkpoint: IntakeSweepCheckpoint | null = null;
  let clock = new Date(time); let fail = false; let calls = 0;
  const ledger: IntakeLedger = {
    reserve: async () => { throw new Error("Recovery must never reserve"); },
    get: async (_tenant, id) => rows.find(row => row.attempt_id === id) ?? null,
    transition: async (_tenant, id, event) => { const index = rows.findIndex(row => row.attempt_id === id); rows[index] = transitionIntake(rows[index]!, event); return rows[index]!; }
  };
  const args = { config, ledger, fencedLedger: () => ledger, now: () => clock, token: () => "worker",
    checkpoints: {
      acquire: async () => {
        if (checkpoint?.lease_token && checkpoint.lease_until > clock.getTime()) return null;
        checkpoint = { schema_version: 1 as const, sweep_id: intakeSweepId(scope), scope, cursor: null, pass_count: 0, last_completed_at: null, last_failure: null,
          ...checkpoint, revision: (checkpoint?.revision ?? 0) + 1, lease_token: "worker", lease_until: clock.getTime() + 30000, updated_at: clock.toISOString() };
        return checkpoint;
      },
      save: async (_previous: IntakeSweepCheckpoint, next: IntakeSweepCheckpoint) => { checkpoint = next; }
    },
    snapshot: async () => ({ checked_at: clock.toISOString() }),
    list: async (tenant: string, limit: number, cursor?: string) => {
      const { after } = intakePageRequest(tenant, limit, cursor);
      const remaining = rows.filter(row => !after || row.attempt_id > after);
      return { attempts: remaining.slice(0, limit), next_cursor: remaining.length > limit ? intakePageCursor(tenant, remaining[limit-1]!.attempt_id) : null };
    },
    observe: async (attempt: typeof rows[number], _snapshot: unknown, target: IntakeLedger, now: string) => {
      calls++;
      if (attempt.state === "received") await target.transition(scope.customer_id, attempt.attempt_id, { event_id: "prepare", expected_revision: attempt.revision,
        occurred_at: now, state: "preparing", reason: null, next_action_at: attempt.next_action_at });
      if (fail) throw new Error("after durable write");
    }
  };
  return { args, rows, checkpoint: () => checkpoint!, calls: () => calls, fail: (value: boolean) => fail = value, clock: (value: string) => clock = new Date(value) };
}
test("disabled sweep requires no configuration or IO; event discriminator is exact", async () => {
  assert.equal(getIntakeSweepConfig({}).enabled, false);
  assert.throws(() => getIntakeSweepConfig({ PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: "true" }));
  const f = fixture();
  const result = await runIntakeRecoverySweep({ ...f.args, config: getIntakeSweepConfig({}), snapshot: async () => { throw new Error("IO"); } });
  assert.equal(result.status, "disabled"); assert.equal(f.checkpoint(), null);
  assert.equal(isIntakeRecoverySweepEvent({ source: "pathfinder.intake", "detail-type": "Intake Assurance Sweep", detail: { automation: "observe_durable_outcomes" } }), true);
  assert.equal(isIntakeRecoverySweepEvent({ source: "pathfinder.intake", detail: { automation: "submit" } }), false);
});
test("bounded invocations persist the cursor, finish the pass, and preserve SLA age on replay", async () => {
  const f = fixture();
  assert.equal((await runIntakeRecoverySweep(f.args)).status, "partial");
  assert.ok(f.checkpoint().cursor); assert.equal(f.checkpoint().lease_token, null);
  assert.equal((await runIntakeRecoverySweep(f.args)).status, "partial");
  assert.equal((await runIntakeRecoverySweep(f.args)).status, "completed");
  assert.equal(f.checkpoint().pass_count, 1); assert.equal(f.checkpoint().cursor, null);
  const before = structuredClone(f.rows);
  f.clock("2026-09-10T12:00:00Z");
  await runIntakeRecoverySweep({ ...f.args, config: { ...config, max_pages: 3 } });
  assert.deepEqual(f.rows, before); assert.equal(f.checkpoint().pass_count, 2);
});
test("a crash after an observation leaves the page replayable without duplicate transitions", async () => {
  const f = fixture(); f.fail(true);
  await assert.rejects(runIntakeRecoverySweep(f.args), /after durable write/);
  assert.equal(f.checkpoint().cursor, null); assert.equal(f.checkpoint().last_failure, "observation_failed");
  assert.equal(f.rows[0]!.revision, 1);
  f.fail(false); await runIntakeRecoverySweep(f.args);
  assert.equal(f.rows[0]!.revision, 1); assert.ok(f.checkpoint().cursor);
});
test("overlapping worker is busy and an expired worker stops before observing", async () => {
  const f = fixture(); await f.args.checkpoints.acquire();
  assert.equal((await runIntakeRecoverySweep(f.args)).status, "busy"); assert.equal(f.calls(), 0);
  const g = fixture();
  await assert.rejects(runIntakeRecoverySweep({ ...g.args, snapshot: async () => { g.clock("2026-09-10T10:01:00Z"); return { checked_at: time }; } }), /lease/);
  assert.equal(g.calls(), 0);
});
test("filtered pages still advance; newer records wait for a fresh snapshot", async () => {
  const f = fixture();
  f.rows[0]!.updated_at = "2026-09-10T10:01:00Z";
  const result = await runIntakeRecoverySweep(f.args);
  assert.equal(result.skipped, 1); assert.equal(result.observed, 0); assert.ok(f.checkpoint().cursor);
  const g = fixture();
  const empty = await runIntakeRecoverySweep({ ...g.args, list: async () => ({ attempts: [], next_cursor: intakePageCursor(scope.customer_id, g.rows[0]!.attempt_id) }) });
  assert.equal(empty.status, "partial"); assert.ok(g.checkpoint().cursor);
});
test("snapshot failure and repeated cursor cannot advance recovery", async () => {
  const f = fixture();
  await assert.rejects(runIntakeRecoverySweep({ ...f.args, snapshot: async () => { throw new Error("overflow"); } }), /overflow/);
  assert.equal(f.checkpoint().cursor, null); assert.equal(f.calls(), 0);
  await runIntakeRecoverySweep(f.args);
  const cursor = f.checkpoint().cursor;
  await assert.rejects(runIntakeRecoverySweep({ ...f.args, list: async () => ({ attempts: [], next_cursor: cursor }) }), /Invalid intake recovery page/);
  assert.equal(f.checkpoint().cursor, cursor);
});

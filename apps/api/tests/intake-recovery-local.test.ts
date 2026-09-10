import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
test("persistent recovery resumes across processes, fences former owners and observes vanished sources without network", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-recovery-"));
  const storeUrl = new URL("../src/store.ts", import.meta.url).href;
  const runtimeUrl = new URL("../src/intake-recovery-runtime.ts", import.meta.url).href;
  const lambdaUrl = new URL("../src/lambda.ts", import.meta.url).href;
  const prelude = `
    const assert = (await import('node:assert/strict')).default;
    globalThis.fetch = async () => { throw new Error('Unexpected network access'); };
    const store = await import(${JSON.stringify(storeUrl)});
    const scope = { customer_id: 'synthetic', provider: 'wrike', connection_id: 'connection', import_method_id: 'method' };
    const signal = { schema_version: 1, ...scope, source_id: 'vanished-task', intent_key: 'Sent to Print - LTL', intent_occurrence: 'initial', observed_at: '2026-09-10T10:00:00Z' };
    const deadline = '2026-09-10T11:00:00Z';
    const fs = await import('node:fs/promises');
  `;
  const run = (script: string) => {
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", prelude + script], { encoding: "utf8", env: {
      ...process.env, PATHFINDER_RUNTIME: "lambda", PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_SECRETS_DRIVER: "local",
      PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json"), PATHFINDER_LOCAL_SECRETS_PATH: join(directory, "secrets.json"),
      PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: "false", PATHFINDER_WRIKE_SCHEDULED_INTAKE: "false||||false|false"
    } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    run(`
      const { handler } = await import(${JSON.stringify(lambdaUrl)});
      assert.equal((await handler({ source: 'pathfinder.intake', 'detail-type': 'Intake Assurance Sweep', detail: { automation: 'observe_durable_outcomes' } }, {})).status, 'disabled');
      await assert.rejects(fs.access(process.env.PATHFINDER_LOCAL_STORE_PATH));
      const { attempt } = await store.reserveIntakeAttempt(signal, deadline);
      const acquired = await Promise.all(['old', 'overlap'].map(token => store.acquireIntakeSweep(scope, token, signal.observed_at, 30)));
      assert.equal(acquired.filter(Boolean).length, 1);
      const old = acquired.find(Boolean);
      const cursor = (await import(${JSON.stringify(new URL("../src/intake-exceptions.ts", import.meta.url).href)})).intakePageCursor('synthetic', attempt.attempt_id);
      await store.saveIntakeSweep(old, { ...old, revision: old.revision + 1, cursor }, signal.observed_at);
      const next = await store.acquireIntakeSweep(scope, 'new', '2026-09-10T10:01:00Z', 30);
      assert.equal(next.cursor, cursor);
      await assert.rejects(store.saveIntakeSweep(old, { ...old, revision: old.revision + 1 }, '2026-09-10T10:01:00Z'), /lease/);
      const event = { event_id: 'prepare', expected_revision: 0, occurred_at: '2026-09-10T10:01:00Z', state: 'preparing', reason: null, next_action_at: deadline };
      await assert.rejects(store.transitionIntakeAttempt('synthetic', attempt.attempt_id, event, { scope, lease_token: old.lease_token, now: event.occurred_at }), /lease/);
      await store.transitionIntakeAttempt('synthetic', attempt.attempt_id, event, { scope, lease_token: 'new', now: event.occurred_at });
      assert.equal((await store.listIntakeAttemptsPage('synthetic')).attempts.length, 1);
    `);
    run(`
      const checkpoint = await store.getIntakeSweepCheckpoint(scope);
      assert.ok(checkpoint.cursor); assert.equal(checkpoint.lease_token, 'new');
      const data = JSON.parse(await fs.readFile(process.env.PATHFINDER_LOCAL_STORE_PATH, 'utf8'));
      data.jobs.push({ customer_id: 'synthetic', job_id: 'job', import_method_id: 'method', source_evidence: { provider: 'wrike', task_id: 'vanished-task', connection_id: 'connection' }, state: 'Ready', target_order_number: null, lift_payload: { order: { ext_id: 'EXACT' } }, wrike_status_writebacks: [] });
      await fs.writeFile(process.env.PATHFINDER_LOCAL_STORE_PATH, JSON.stringify(data));
      const { runConfiguredIntakeRecoverySweep } = await import(${JSON.stringify(runtimeUrl)});
      const env = { PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: 'true', PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: 'synthetic', PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: 'connection', PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID: 'method', PATHFINDER_INTAKE_SWEEP_PAGE_SIZE: '1', PATHFINDER_INTAKE_SWEEP_MAX_PAGES: '1', PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS: '30', PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: '100', PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: '3600' };
      assert.equal((await runConfiguredIntakeRecoverySweep(env)).status, 'completed');
      assert.equal((await runConfiguredIntakeRecoverySweep(env)).status, 'completed');
      const attempt = (await store.listIntakeAttemptsPage('synthetic')).attempts[0];
      assert.equal(attempt.state, 'ready'); assert.equal(attempt.job_id, 'job'); assert.equal(attempt.next_action_at, deadline);
      await runConfiguredIntakeRecoverySweep(env);
      assert.deepEqual((await store.listIntakeAttemptsPage('synthetic')).attempts[0], attempt);
    `);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

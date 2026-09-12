import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getIntakeNotificationConfig, isIntakeNotificationEvent } from "../src/intake-notification-runtime.js";
import { intakeSweepId } from "../src/intake-recovery-sweep.js";
test("notification gate is independent, bounded and uses a separate durable cursor", () => {
  assert.equal(getIntakeNotificationConfig({ PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: "true" }).sweep.enabled, false);
  assert.throws(() => getIntakeNotificationConfig({ PATHFINDER_ENABLE_INTAKE_INTERNAL_NOTIFICATIONS: "true" }));
  const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
  assert.notEqual(intakeSweepId(scope), intakeSweepId({ ...scope, purpose: "internal_notification" }));
  assert.equal(isIntakeNotificationEvent({ source: "pathfinder.intake", "detail-type": "Intake Assurance Notifications", detail: { automation: "notify_internal" } }), true);
  assert.equal(isIntakeNotificationEvent({ source: "pathfinder.intake", "detail-type": "Intake Assurance Sweep", detail: { automation: "notify_internal" } }), false);
});
test("Lambda rejects local persistence; local handler simulation persists bounded synthetic SES receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-notifications-"));
  try {
    const script = `
      const assert = (await import('node:assert/strict')).default;
      const fs = await import('node:fs/promises');
      let sends = 0;
      globalThis.fetch = async () => { throw new Error('Unexpected provider network request'); };
      const { SESv2Client } = await import('@aws-sdk/client-sesv2');
      SESv2Client.prototype.send = async function(command) {
        assert.equal(await this.config.maxAttempts(), 1);
        assert.deepEqual(command.input.Destination.ToAddresses, ['pathfinder@vornan.co']);
        sends++; return { MessageId: 'synthetic-' + sends };
      };
      const { handler } = await import(${JSON.stringify(new URL("../src/lambda.ts", import.meta.url).href)});
      const event = { source: 'pathfinder.intake', 'detail-type': 'Intake Assurance Notifications', detail: { automation: 'notify_internal', customer_id: 'ignored-foreign-tenant' } };
      assert.equal((await handler(event, {})).status, 'disabled');
      await assert.rejects(fs.access(process.env.PATHFINDER_LOCAL_STORE_PATH)); assert.equal(sends, 0);
      Object.assign(process.env, { PATHFINDER_ENABLE_INTAKE_INTERNAL_NOTIFICATIONS: 'true', PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: 'synthetic', PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: 'connection', PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID: 'method', PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: '3600', PATHFINDER_INTAKE_SWEEP_PAGE_SIZE: '10', PATHFINDER_INTAKE_SWEEP_MAX_PAGES: '1', PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS: '30', PATHFINDER_INTAKE_NOTIFICATION_MAX_SENDS: '1', PATHFINDER_STATUS_EMAIL_MODE: 'log' });
      await assert.rejects(handler(event, {}), /DynamoDB driver/); assert.equal(sends, 0);
      // Continue existing dispatch coverage as an explicit non-Lambda local simulation.
      process.env.PATHFINDER_RUNTIME = 'local'; delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      await assert.rejects(handler(event, {}), /SES mode/);
      await assert.rejects(fs.access(process.env.PATHFINDER_LOCAL_STORE_PATH));
      const store = await import(${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)});
      for (const source_id of ['first', 'second']) {
        const { attempt } = await store.reserveIntakeAttempt({ schema_version: 1, customer_id: 'synthetic', provider: 'wrike', connection_id: 'connection', source_id, intent_key: 'order', intent_occurrence: 'initial', observed_at: '2026-09-10T10:00:00Z' }, '2026-09-10T11:00:00Z');
        await store.transitionIntakeAttempt('synthetic', attempt.attempt_id, { event_id: 'failure', expected_revision: 0, occurred_at: '2026-09-10T10:00:00Z', state: 'internal_action_required', reason: 'pathfinder_failure', next_action_at: attempt.next_action_at });
      }
      process.env.PATHFINDER_STATUS_EMAIL_MODE = 'ses';
      const first = await handler(event, {}); assert.equal(first.sent, 1); assert.equal(first.deferred, 1); assert.equal(sends, 1);
      const second = await handler(event, {}); assert.equal(second.sent, 1); assert.equal(second.suppressed, 1); assert.equal(sends, 2);
      const third = await handler(event, {}); assert.equal(third.sent, 0); assert.equal(third.suppressed, 2); assert.equal(sends, 2);
      const scope = { customer_id: 'synthetic', provider: 'wrike', connection_id: 'connection', import_method_id: 'method' };
      assert.equal(await store.getIntakeSweepCheckpoint(scope), null);
      assert.equal((await store.getIntakeSweepCheckpoint({ ...scope, purpose: 'internal_notification' })).pass_count, 3);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env,
      PATHFINDER_RUNTIME: "lambda", PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_SECRETS_DRIVER: "local", PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json"),
      PATHFINDER_LOCAL_SECRETS_PATH: join(directory, "secrets.json"), PATHFINDER_ENABLE_INTAKE_INTERNAL_NOTIFICATIONS: "false", PATHFINDER_WRIKE_SCHEDULED_INTAKE: "false||||false|false" } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

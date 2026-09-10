import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWrikeIntakeFeedbackConfig } from "../src/wrike-intake-feedback-runtime.js";
test("feedback requires its own gate and explicit bounds", () => {
  assert.equal(getWrikeIntakeFeedbackConfig({ PATHFINDER_ENABLE_INTAKE_INTERNAL_NOTIFICATIONS: "true" }).sweep.enabled, false);
  assert.throws(() => getWrikeIntakeFeedbackConfig({ PATHFINDER_ENABLE_WRIKE_INTAKE_FEEDBACK: "true" }));
});
test("actual feedback Lambda stays dark and safely dispatches one synthetic Wrike correction with replay suppression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wrike-feedback-"));
  try {
    const script = `
      const assert = (await import('node:assert/strict')).default;
      const fs = await import('node:fs/promises');
      let requests = 0; let comments = 0;
      globalThis.fetch = async (input, init) => {
        requests++; assert.ok(init.signal);
        const url = String(input);
        if (url.includes('/api/v4/spaces')) return Response.json({ data: [] });
        if (url.endsWith('/api/v4/workflows')) return Response.json({ data: [{ id: 'WORKFLOW', customStatuses: [{ id: 'STATUS1', name: 'Sent to Print – LTL' }] }] });
        if (url.endsWith('/api/v4/tasks/TASK123')) return Response.json({ data: [{ id: 'TASK123', customStatusId: 'STATUS1' }] });
        if (url.endsWith('/api/v4/tasks/TASK123/comments')) {
          assert.equal(init.method, 'POST'); assert.match(String(init.body), /products/); comments++;
          return Response.json({ data: [{ id: 'COMMENT1' }] });
        }
        throw new Error('Unexpected request: ' + url);
      };
      const { handler } = await import(${JSON.stringify(new URL("../src/lambda.ts", import.meta.url).href)});
      const event = { source: 'pathfinder.intake', 'detail-type': 'Wrike Intake Feedback', detail: { automation: 'customer_correction', customer_id: 'ignored' } };
      assert.equal((await handler(event, {})).status, 'disabled'); assert.equal(requests, 0);
      await assert.rejects(fs.access(process.env.PATHFINDER_LOCAL_STORE_PATH));
      const store = await import(${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)});
      const { writeCustomerSourceConnectionSecrets } = await import(${JSON.stringify(new URL("../src/secrets-store.ts", import.meta.url).href)});
      const { attempt } = await store.reserveIntakeAttempt({ schema_version: 1, customer_id: 'synthetic', provider: 'wrike', connection_id: 'connection', source_id: 'TASK123', intent_key: 'Sent to Print - LTL', intent_occurrence: 'initial', observed_at: '2026-09-10T10:00:00Z' }, '2026-09-10T11:00:00Z');
      await store.transitionIntakeAttempt('synthetic', attempt.attempt_id, { event_id: 'mapping', expected_revision: 0, occurred_at: '2026-09-10T10:00:00Z', state: 'customer_action_required', reason: 'unmapped_product', job_id: 'job', next_action_at: attempt.next_action_at });
      const data = JSON.parse(await fs.readFile(process.env.PATHFINDER_LOCAL_STORE_PATH, 'utf8'));
      data.workspaces.synthetic = { customer: { lift_customer_id: 'synthetic', customer_name: 'Synthetic' }, source_connections: [{ connection_id: 'connection', name: 'Synthetic', provider: 'wrike', status: 'Active', environment: 'Live', auth_strategy: 'oauth2', created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z' }], import_methods: [{ import_method_id: 'method', source: 'Wrike', status: 'Active', source_config: { wrike: { connection_id: 'connection', trigger_status_id: 'STATUS1', trigger_status_label: 'Sent to Print - LTL' } } }] };
      data.jobs.push({ customer_id: 'synthetic', job_id: 'job', import_method_id: 'method', state: 'Needs Mapping', target_order_number: null, source_evidence: { provider: 'wrike', task_id: 'TASK123', connection_id: 'connection' } });
      await fs.writeFile(process.env.PATHFINDER_LOCAL_STORE_PATH, JSON.stringify(data));
      await writeCustomerSourceConnectionSecrets('synthetic', 'connection', { provider: 'wrike', wrike: { oauth: { client_id: 'synthetic', client_secret: 'synthetic', refresh_token: 'synthetic', access_token: 'synthetic', access_token_expires_at: new Date(Date.now() + 3600000).toISOString(), host: 'www.wrike.com', scope: 'wsReadWrite' } } });
      Object.assign(process.env, { PATHFINDER_ENABLE_WRIKE_INTAKE_FEEDBACK: 'true', PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: 'synthetic', PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID: 'connection', PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID: 'method', PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS: '3600', PATHFINDER_INTAKE_SWEEP_PAGE_SIZE: '10', PATHFINDER_INTAKE_SWEEP_MAX_PAGES: '1', PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS: '30', PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT: '100', PATHFINDER_INTAKE_FEEDBACK_MAX_COMMENTS: '1' });
      const first = await handler(event, {}); assert.equal(first.sent, 1); assert.equal(first.comments_attempted, 1); assert.equal(comments, 1);
      const second = await handler(event, {}); assert.equal(second.suppressed, 1); assert.equal(comments, 1); assert.equal(requests, 4);
      const receipts = await store.listIntakeDeliveriesPage('synthetic'); assert.equal(receipts.receipts[0].provider_message_id, 'COMMENT1');
      assert.equal((await store.getIntakeAttempt('synthetic', attempt.attempt_id)).next_action_at, attempt.next_action_at);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env,
      PATHFINDER_RUNTIME: "lambda", PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_SECRETS_DRIVER: "local", PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json"), PATHFINDER_LOCAL_SECRETS_PATH: join(directory, "secrets.json"),
      PATHFINDER_ENABLE_WRIKE_INTAKE_FEEDBACK: "false", PATHFINDER_WRIKE_SCHEDULED_INTAKE: "false||||false|false" } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

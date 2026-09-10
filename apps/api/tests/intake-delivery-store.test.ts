import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("local receipts survive restart, claim once and reject a changed intake revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-delivery-"));
  const prelude = `
    const assert = (await import('node:assert/strict')).default;
    const store = await import(${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)});
    const time = '2026-09-10T10:00:00Z';
    const { attempt: original } = await store.reserveIntakeAttempt({ schema_version: 1, customer_id: 'synthetic', provider: 'wrike', connection_id: 'connection', source_id: 'task', intent_key: 'order', intent_occurrence: 'initial', observed_at: time }, '2026-09-10T11:00:00Z');
    const ledger = store.intakeDeliveryLedger;
  `;
  const run = (script: string) => {
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", prelude + script], { encoding: "utf8", env: { ...process.env,
      PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_SECRETS_DRIVER: "local", PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json") } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    run(`
      const attempt = await store.transitionIntakeAttempt('synthetic', original.attempt_id, { event_id: 'failure', expected_revision: original.revision, occurred_at: time, state: 'customer_action_required', reason: 'unmapped_product', next_action_at: original.next_action_at });
      const candidates = await Promise.allSettled([ledger.prepare(attempt, 'source_feedback', time), ledger.prepare(attempt, 'source_feedback', time)]);
      assert.ok(candidates.some(row => row.status === 'fulfilled'));
      const receipt = await ledger.get('synthetic', attempt.attempt_id, 'source_feedback');
      const changed = await store.transitionIntakeAttempt('synthetic', attempt.attempt_id, { event_id: 'updated', expected_revision: attempt.revision, occurred_at: time, state: 'customer_action_required', reason: 'missing_required_data', next_action_at: attempt.next_action_at });
      await assert.rejects(ledger.claim(receipt, attempt, time), /changed/);
      const refreshed = await ledger.prepare(changed, 'source_feedback', time);
      const claims = await Promise.allSettled([ledger.claim(refreshed, changed, time), ledger.claim(refreshed, changed, time)]);
      assert.equal(claims.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal((await store.listIntakeAttemptsPage('synthetic')).attempts.length, 1);
    `);
    run(`
      const receipt = await ledger.get('synthetic', original.attempt_id, 'source_feedback');
      assert.equal(receipt.state, 'uncertain');
      await assert.rejects(ledger.claim(receipt, original, time));
      assert.equal((await ledger.prepare(original, 'source_feedback', time)).state, 'uncertain');
      const sent = await ledger.acknowledge(receipt, 'provider-id', time);
      assert.equal(sent.state, 'sent');
      assert.equal(await ledger.get('other', original.attempt_id, 'source_feedback'), null);
    `);
    run(`assert.equal((await ledger.get('synthetic', original.attempt_id, 'source_feedback')).provider_message_id, 'provider-id');`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

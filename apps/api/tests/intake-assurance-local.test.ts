import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("local ledger survives a process restart, serializes reservations, and preserves unrelated fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-ledger-"));
  const path = join(directory, "store.json");
  const moduleUrl = new URL("../src/store.ts", import.meta.url).href;
  const prelude = `
    const { reserveIntakeAttempt, getIntakeAttempt, transitionIntakeAttempt } = await import(${JSON.stringify(moduleUrl)});
    const signal = { schema_version: 1, customer_id: 'synthetic', provider: 'email', connection_id: 'mailbox', source_id: 'message-id', intent_key: 'order', intent_occurrence: '1', observed_at: '2026-09-10T10:00:00Z' };
    const deadline = '2026-09-10T11:00:00Z';
  `;
  const run = (script: string) => {
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", prelude + script], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_SECRETS_DRIVER: "local", PATHFINDER_LOCAL_STORE_PATH: path }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    run(`const rows = await Promise.all(Array.from({length: 5}, () => reserveIntakeAttempt(signal, deadline)));
      if (rows.filter(x => x.created).length !== 1) throw new Error('duplicate reservation');
      await transitionIntakeAttempt(signal.customer_id, rows[0].attempt.attempt_id, { event_id: 'prepare', expected_revision: 0, occurred_at: signal.observed_at, state: 'preparing', reason: null, next_action_at: deadline });`);
    const before = JSON.parse(await readFile(path, "utf8"));
    run(`const replay = await reserveIntakeAttempt(signal, deadline);
      if (replay.created || replay.attempt.state !== 'preparing') throw new Error('lost durable record');
      if (await getIntakeAttempt('another-customer', replay.attempt.attempt_id)) throw new Error('tenant leak');`);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), before);
    run(`const fs = await import('node:fs/promises');
      const data = JSON.parse(await fs.readFile(process.env.PATHFINDER_LOCAL_STORE_PATH, 'utf8'));
      data.intake_attempts[0].revision = -1;
      const bytes = JSON.stringify(data);
      await fs.writeFile(process.env.PATHFINDER_LOCAL_STORE_PATH, bytes);
      let rejected = false;
      try { await reserveIntakeAttempt(signal, deadline); } catch (error) { rejected = String(error).includes('Invalid persisted'); }
      if (!rejected) throw new Error('corrupt reservation was accepted');
      if (await fs.readFile(process.env.PATHFINDER_LOCAL_STORE_PATH, 'utf8') !== bytes) throw new Error('corrupt data was overwritten');`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

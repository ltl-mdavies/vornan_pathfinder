import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("local observation survives restart, serializes racing entries and rejects corrupt state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wrike-observation-"));
  const path = join(directory, "store.json");
  const prelude = `const { recordWrikeIntentObservation, getWrikeIntentCursor, reserveWrikeCursorAttempt, getIntakeAttempt } = await import(${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)});
    const scope = { customer_id: 'synthetic', connection_id: 'connection', import_method_id: 'method', task_id: 'TASK', trigger_status_id: 'READY' };
    const observation = (second, status = 'READY') => ({ task_id: 'TASK', custom_status_id: status, source_updated_at: '2026-09-10T10:00:0'+second+'Z', observed_at: '2026-09-10T10:01:0'+second+'Z', scope_verified: true, identity_matches: true });
    const assert = (await import('node:assert/strict')).default;`;
  const run = (script: string) => {
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", prelude + script], {
      encoding: "utf8", env: { ...process.env, PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_LOCAL_STORE_PATH: path }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    run(`const rows = await Promise.all(Array.from({length:8}, () => recordWrikeIntentObservation(scope, observation(0))));
      assert.ok(rows.every(row => row.generation === 1 && row.revision === 1));
      await recordWrikeIntentObservation(scope, observation(1, 'OTHER'));`);
    run(`const rows = await Promise.all(Array.from({length:8}, () => recordWrikeIntentObservation(scope, observation(2))));
      assert.ok(rows.every(row => row.generation === 2 && row.revision === 3));`);
    const data = JSON.parse(await readFile(path, "utf8"));
    const cursor = Object.values(data.wrike_intent_cursors)[0] as { attempt_id: string; generation: number };
    assert.equal(data.intake_attempts?.length ?? 0, 0);
    run(`assert.equal((await getWrikeIntentCursor(scope)).attempt_id, ${JSON.stringify(cursor.attempt_id)});
      assert.equal((await recordWrikeIntentObservation(scope, observation(2))).generation, 2);`);
    run(`const cursor = await getWrikeIntentCursor(scope);
      const attempt = await reserveWrikeCursorAttempt(cursor, '2026-09-10T11:01:02Z', false);
      assert.equal(attempt.state, 'manual_review');
      assert.deepEqual(await reserveWrikeCursorAttempt(cursor, '2026-09-10T11:01:02Z', false), attempt);
      await recordWrikeIntentObservation(scope, observation(3, 'OTHER'));
      await assert.rejects(reserveWrikeCursorAttempt(cursor, '2026-09-10T11:01:02Z', false));
      assert.equal((await getIntakeAttempt('synthetic', cursor.attempt_id)).state, 'manual_review');`);
    cursor.generation = -1;
    const corrupted = JSON.stringify(data);
    await writeFile(path, corrupted);
    run(`await assert.rejects(getWrikeIntentCursor(scope)); await assert.rejects(recordWrikeIntentObservation(scope, observation(3)));`);
    assert.equal(await readFile(path, "utf8"), corrupted);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

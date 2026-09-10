import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
test("the actual disabled scheduler does not activate capture or provider access from the assurance flag alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-assurance-scheduler-"));
  try {
    const serverUrl = new URL("../src/server.ts", import.meta.url).href;
    const storeUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import('node:assert/strict')).default;
      let networkCalls = 0;
      globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected provider request'); };
      const { runConfiguredWrikeScheduledIntake } = await import(${JSON.stringify(serverUrl)});
      const { readStore } = await import(${JSON.stringify(storeUrl)});
      const result = await runConfiguredWrikeScheduledIntake();
      assert.equal(result.status, 'disabled');
      assert.equal(networkCalls, 0);
      assert.equal((await readStore()).intake_attempts?.length ?? 0, 0);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PATHFINDER_RUNTIME: "lambda", PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_SECRETS_DRIVER: "local",
        PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json"), PATHFINDER_LOCAL_SECRETS_PATH: join(directory, "secrets.json"),
        PATHFINDER_WRIKE_SCHEDULED_INTAKE: "false||||false|false", PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE: "true",
        PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID: "", PATHFINDER_ENABLE_LIFT_SUBMIT: "false" }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

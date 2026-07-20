import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const storeModuleUrl = new URL("../src/proof/store.ts", import.meta.url).href;

function proofStoreEnvironment(storePath: string) {
  return {
    ...process.env,
    PATHFINDER_PROOF_LOCAL_STORE_PATH: storePath,
    PATHFINDER_PROOF_STORAGE_DRIVER: "local"
  };
}

function session(index: number) {
  return {
    session_id: `psession-${index}`,
    session_hash: `session-hash-${index}`,
    grant_id: "pgrant-durability",
    order_number: "A0221132",
    scope: "view",
    csrf_hash: `csrf-hash-${index}`,
    participant_id: null,
    created_at: "2026-07-20T12:00:00.000Z",
    expires_at: "2026-07-20T12:30:00.000Z",
    expires_at_epoch: 1_774_267_400,
    last_seen_at: "2026-07-20T12:00:00.000Z",
    ended_at: null
  };
}

test("a malformed local Proof store fails closed without replacing QA lifecycle data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-proof-store-durability-"));
  const storePath = join(directory, "proof.json");
  const malformedStore = '{"orders":{"A0221132":';
  await writeFile(storePath, malformedStore, "utf8");

  try {
    const script = `
      const { persistProofSession } = await import(${JSON.stringify(storeModuleUrl)});
      const candidate = ${JSON.stringify(session(1))};
      try {
        await persistProofSession(candidate);
        process.exitCode = 2;
      } catch (error) {
        if (!String(error).includes("the existing file was preserved")) {
          process.exitCode = 3;
        }
      }
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: proofStoreEnvironment(storePath),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(storePath, "utf8"), malformedStore);
    assert.deepEqual(await readdir(directory), ["proof.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an invalid local Proof collection shape is preserved instead of normalized to empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-proof-store-shape-"));
  const storePath = join(directory, "proof.json");
  const invalidStore = '{"orders":[]}';
  await writeFile(storePath, invalidStore, "utf8");

  try {
    const script = `
      const { persistProofSession } = await import(${JSON.stringify(storeModuleUrl)});
      try {
        await persistProofSession(${JSON.stringify(session(1))});
        process.exitCode = 2;
      } catch (error) {
        if (!String(error).includes("the existing file was preserved")) {
          process.exitCode = 3;
        }
      }
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: proofStoreEnvironment(storePath),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(storePath, "utf8"), invalidStore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent local Proof mutations are serialized and leave no partial store files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-proof-store-concurrency-"));
  const storePath = join(directory, "proof.json");

  try {
    const sessions = Array.from({ length: 25 }, (_, index) => session(index + 1));
    const script = `
      const { persistProofSession } = await import(${JSON.stringify(storeModuleUrl)});
      const sessions = ${JSON.stringify(sessions)};
      await Promise.all(sessions.map((candidate) => persistProofSession(candidate)));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: proofStoreEnvironment(storePath),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const stored = JSON.parse(await readFile(storePath, "utf8")) as {
      sessions: Record<string, unknown>;
    };
    assert.equal(Object.keys(stored.sessions).length, sessions.length);
    assert.deepEqual(await readdir(directory), ["proof.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

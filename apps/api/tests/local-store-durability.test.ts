import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("a malformed local store fails closed without replacing operator data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-store-durability-"));
  const storePath = join(directory, "pathfinder.json");
  const malformedStore = '{"version":1,"jobs":[';
  await writeFile(storePath, malformedStore, "utf8");

  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const { readStore } = await import(${JSON.stringify(storeModuleUrl)});
      try {
        await readStore();
        process.exitCode = 2;
      } catch (error) {
        if (!String(error).includes("the existing file was preserved")) {
          process.exitCode = 3;
        }
      }
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_LOCAL_STORE_PATH: storePath,
        PATHFINDER_STORAGE_DRIVER: "local"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(storePath, "utf8"), malformedStore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("keeps Wrike discovery preview dark when the server gate is not enabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-wrike-discovery-gate-"));
  try {
    const serverModuleUrl = new URL("../src/server.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const request = (await import("supertest")).default;
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Wrike must not be contacted while discovery is gated.");
      };
      const { app } = await import(${JSON.stringify(serverModuleUrl)});
      const response = await request(app)
        .post("/api/customers/284619/import-methods/manual-xlsx/wrike/discovery-preview")
        .expect(423);
      assert.match(response.body.error, /disabled at the API boundary/i);
      assert.equal(fetchCalls, 0);
      const evidence = await request(app)
        .post("/api/customers/284619/import-methods/manual-xlsx/wrike/workbook-evidence")
        .expect(423);
      assert.match(evidence.body.error, /disabled at the API boundary/i);
      assert.equal(fetchCalls, 0);
      const preview = await request(app)
        .post("/api/customers/284619/import-methods/manual-xlsx/wrike/workbook-evidence/wrike_workbook_deadbeef/preview")
        .send({ extension: "xlsx" })
        .expect(423);
      assert.match(preview.body.error, /disabled at the API boundary/i);
      assert.equal(fetchCalls, 0);
      const legacy = await request(app).get("/api/wrike/connection").expect(410);
      assert.match(legacy.body.error, /per customer/i);
      const catalog = await request(app).get("/api/source-connector-definitions").expect(200);
      const wrike = catalog.body.definitions.find((definition) => definition.provider === "wrike");
      assert.equal(wrike.availability, "Available");
      assert.equal(wrike.capabilities.writes, false);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_RUNTIME: "lambda",
        PATHFINDER_STORAGE_DRIVER: "local",
        PATHFINDER_SECRETS_DRIVER: "local",
        PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json"),
        PATHFINDER_LOCAL_SECRETS_PATH: join(directory, "secrets.json"),
        PATHFINDER_REQUIRE_AUTH: "false",
        PATHFINDER_ENABLE_LIFT_SUBMIT: "false",
        PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST: "false",
        PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW: "false",
        PATHFINDER_ENABLE_WRIKE_WORKBOOK_EVIDENCE: "false",
        PATHFINDER_ENABLE_WRIKE_EVIDENCE_PREVIEW: "false"
      },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

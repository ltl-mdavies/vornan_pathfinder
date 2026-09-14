import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolveWorkspaceTables, workspaceTableBindings, type WorkspaceTableKey } from "../src/workspace-table-namespace.js";
const keys = Object.keys(workspaceTableBindings) as WorkspaceTableKey[];
const expected = Object.fromEntries(keys.map(k => [k, `Fixture-${workspaceTableBindings[k][1]}-prod`]));
const legacy = Object.fromEntries(keys.map(k => [workspaceTableBindings[k][0], expected[k]]));
const compact = { PATHFINDER_TABLE_NAMESPACE: "1|Fixture|prod" };
test("legacy, compact, and matching dual configurations preserve exact eight table identities", () => {
  for (const env of [legacy, compact, { ...legacy, ...compact }]) {
    const before = structuredClone(env);
    assert.deepEqual(resolveWorkspaceTables(env, keys), expected);
    assert.deepEqual(env, before);
  }
  assert.deepEqual(resolveWorkspaceTables({ PATHFINDER_JOBS_TABLE: "external.jobs" }, ["jobs"]), { jobs: "external.jobs" });
});
test("namespace and any supplied legacy conflict fail closed, even outside the requested subset", () => {
  for (const value of ["", "0|Fixture|prod", "1||prod", "1|Fixture|", "1|Fixture|Prod", "1|Fixture|prod|extra", "1|Fixture/x|prod", `1|${"x".repeat(255)}|prod`, "1|Fixture|prod\n"]) assert.throws(() => resolveWorkspaceTables({ PATHFINDER_TABLE_NAMESPACE: value }, ["jobs"]));
  for (const value of ["other-table", "", " bad "]) assert.throws(() => resolveWorkspaceTables({ ...compact, PATHFINDER_CUSTOMERS_TABLE: value }, ["jobs"]));
  assert.throws(() => resolveWorkspaceTables({ PATHFINDER_JOBS_TABLE: "external.jobs" }, ["jobs", "submit_attempts"]));
  assert.throws(() => resolveWorkspaceTables(compact, ["targets" as WorkspaceTableKey]));
});
test("derived table-name length is bounded for every fixed suffix", () => {
  const suffixLength = Math.max(...keys.map(k => workspaceTableBindings[k][1].length));
  assert.doesNotThrow(() => resolveWorkspaceTables({ PATHFINDER_TABLE_NAMESPACE: `1|${"x".repeat(255-suffixLength-3)}|p` }, keys));
  assert.throws(() => resolveWorkspaceTables({ PATHFINDER_TABLE_NAMESPACE: `1|${"x".repeat(256-suffixLength-3)}|p` }, ["jobs"]));
});
test("all eight legacy bindings are read only through the resolver, with Targets separate", () => {
  const root = new URL("../src/", import.meta.url);
  function walk(dir: URL): URL[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(new URL(e.name+"/",dir)) : e.name.endsWith(".ts") ? [new URL(e.name,dir)] : []); }
  for (const file of walk(root).filter(f => !f.pathname.endsWith("/workspace-table-namespace.ts"))) {
    const source = readFileSync(file,"utf8");
    for (const [binding] of Object.values(workspaceTableBindings)) assert.ok(!source.includes(binding), `Direct binding outside resolver: ${file.pathname}`);
  }
  assert.ok(readFileSync(new URL("store.ts",root),"utf8").includes('requireEnv("PATHFINDER_TARGETS_TABLE")'));
  assert.ok(readFileSync(new URL("proof/action-target-store.ts",root),"utf8").includes("process.env.PATHFINDER_TARGETS_TABLE"));
});

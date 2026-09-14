import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTemplate, evaluateTemplate, environmentBytes } from "../../../scripts/intake-storage-template.mjs";
import { legacyWorkspaceBindings, withoutWorkspacePacking } from "../../../scripts/tests/fixtures/workspace-table-packing.mjs";
import { resolveWorkspaceTables, workspaceTableBindings, type WorkspaceTableKey } from "../src/workspace-table-namespace.js";
const template = parseTemplate(readFileSync(new URL("../../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const vars = (t: any) => t.Resources.PathfinderApiFunction.Properties.Environment.Variables;

test("actual packed template resolves all eight existing table names and restores exactly", () => {
  for (const [prefix, stage] of [["Pathfinder", "prod"], ["Team-42", "qa-2"], ["p".repeat(230), "dev"]]) {
    const params = { DataTablePrefix: prefix, EnvironmentName: stage, IntakeAssuranceStorageEnabled: "true" };
    const packed = evaluateTemplate(template, params);
    const legacy = evaluateTemplate(withoutWorkspacePacking(template), params);
    const environment = vars(packed);
    assert.equal(environment.PATHFINDER_TABLE_NAMESPACE, `1|${prefix}|${stage}`);
    const keys = Object.keys(workspaceTableBindings) as WorkspaceTableKey[];
    const resolved = resolveWorkspaceTables(environment, keys);
    for (const key of keys) {
      const [binding] = workspaceTableBindings[key];
      assert.ok(!(binding in environment));
      assert.equal(resolved[key], vars(legacy)[binding]);
      assert.equal(resolved[key], packed.Resources[legacyWorkspaceBindings[binding]].Properties.TableName);
    }
    // Restoring the old bindings must leave the entire evaluated stack identical:
    // code, worker, IAM, physical table definitions, scheduler, and other settings.
    const restored = structuredClone(packed);
    delete vars(restored).PATHFINDER_TABLE_NAMESPACE;
    for (const binding of Object.keys(legacyWorkspaceBindings)) vars(restored)[binding] = vars(legacy)[binding];
    assert.deepEqual(restored, legacy);
    assert.equal(Object.keys(vars(legacy)).length - Object.keys(environment).length, 7);
    if (prefix === "Pathfinder") {
      const strings = (e: any) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, String(v)]));
      assert.equal(environmentBytes(strings(vars(legacy))) - environmentBytes(strings(environment)), 455);
    }
    assert.ok(environment.PATHFINDER_TARGETS_TABLE);
    assert.equal(environment.PATHFINDER_ENABLE_INTAKE_SHADOW, undefined);
    assert.deepEqual(resolveWorkspaceTables(vars(restored), keys), resolved);
  }
});

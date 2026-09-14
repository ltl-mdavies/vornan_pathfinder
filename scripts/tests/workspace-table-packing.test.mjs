import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseTemplate } from "../intake-storage-template.mjs";
import { legacyWorkspaceBindings, withoutWorkspacePacking } from "./fixtures/workspace-table-packing.mjs";
const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
test("packing changes only eight legacy bindings to one namespace in the validated runtime template", () => {
  const env = template.Resources.PathfinderApiFunction.Properties.Environment.Variables;
  assert.deepEqual(env.PATHFINDER_TABLE_NAMESPACE, { Sub: "1|${DataTablePrefix}|${EnvironmentName}" });
  for (const key of Object.keys(legacyWorkspaceBindings)) assert.ok(!(key in env));
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/workspace-table-packing-baseline.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(canonical(withoutWorkspacePacking(template)))).digest("hex"), baseline.sha256, baseline.source_commit);
});

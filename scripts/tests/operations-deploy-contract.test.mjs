import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTemplate, evaluateTemplate } from "../intake-storage-template.mjs";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("operations activation changes only the primary API environment and defaults off", () => {
  const template = parseTemplate(read("infra/aws/api-cloudformation.yaml"));
  assert.equal(template.Parameters.OperationsWorkspaceEnabled.Default, "false");
  assert.deepEqual(template.Parameters.OperationsWorkspaceEnabled.AllowedValues, ["true", "false"]);
  assert.throws(() => evaluateTemplate(template, { OperationsWorkspaceEnabled: "true", RequireFirebaseAuth: "false" }, { rules: ["OperationsWorkspaceRequiresAuth"] }), /Rule failed/);
  const off = evaluateTemplate(template);
  const on = evaluateTemplate(template, { OperationsWorkspaceEnabled: "true" });
  const env = on.Resources.PathfinderApiFunction.Properties.Environment.Variables;
  assert.equal(env.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE, "true");
  delete env.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE;
  assert.deepEqual(on, off, "No IAM, tables, schedules, worker, public Proof, intake or unrelated environment changes");
});
test("Admin build opts in through a separate default-false repository variable", () => {
  assert.match(read(".github/workflows/deploy-admin-web.yml"), /VITE_ENABLE_OPERATIONS_WORKSPACE: \$\{\{ vars.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE_UI \|\| 'false' \}\}/);
  assert.match(read("scripts/deploy-admin-web.sh"), /VITE_ENABLE_OPERATIONS_WORKSPACE="\$\{VITE_ENABLE_OPERATIONS_WORKSPACE:-false\}"/);
});

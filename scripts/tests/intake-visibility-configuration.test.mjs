import { withoutShadow } from "./fixtures/intake-shadow-config.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseTemplate, evaluateTemplate } from "../intake-storage-template.mjs";
import { checkCandidateEnvironment } from "../intake-environment-preflight.mjs";
import { captureParameters, captureVariables as vars } from "./fixtures/intake-capture-config.mjs";
import { recoveryParameters } from "./fixtures/intake-recovery-config.mjs";
import { visibilityParameters, visibilityKeys, visibilityValidation } from "./fixtures/intake-visibility-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const evaluate = (values = {}) => evaluateTemplate(template, values, visibilityValidation);

test("visibility defaults off and adds only its two bindings across all eight modes", () => {
  assert.equal(template.Parameters.IntakeAssuranceVisibilityEnabled.Default, "false");
  assert.deepEqual(template.Parameters.IntakeAssuranceVisibilityEnabled.AllowedValues, ["true", "false"]);
  for (const capture of ["false", "true"]) for (const recovery of ["false", "true"]) for (const visibility of ["false", "true"]) {
    const parameters = { ...captureParameters, ...recoveryParameters, ...visibilityParameters, IntakeAssuranceCaptureEnabled: capture, IntakeAssuranceRecoveryEnabled: recovery, IntakeAssuranceVisibilityEnabled: visibility };
    const result = evaluate(parameters);
    for (const key of visibilityKeys) assert.equal(key in vars(result), visibility === "true");
    if (visibility === "true") assert.equal(vars(result).PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS, "synthetic");
    for (const key of visibilityKeys) delete vars(result)[key];
    assert.deepEqual(result, evaluate({ ...parameters, IntakeAssuranceVisibilityEnabled: "false" }));
  }
  const only = vars(evaluate(visibilityParameters));
  assert.ok(!("PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID" in only));
  assert.ok(!("PATHFINDER_INTAKE_CAPTURE_LIMITS" in only));
  assert.ok(!("PATHFINDER_INTAKE_RECOVERY_LIMITS" in only));
});

test("visibility requires explicit safe customer, authentication, storage and DynamoDB", () => {
  for (const change of [{ IntakeAssuranceCustomerId: "" }, { IntakeAssuranceStorageEnabled: "false" }, { StorageDriver: "local" }, { RequireFirebaseAuth: "false" }]) assert.throws(() => evaluate({ ...visibilityParameters, ...change }), /Rule failed/);
  for (const value of ["one,two", " id", "id\n", "id/other", "a".repeat(257)]) assert.throws(() => evaluate({ ...visibilityParameters, IntakeAssuranceCustomerId: value }), /Invalid parameter/);
  for (const value of ["TRUE", "1", ""]) assert.throws(() => evaluate({ ...visibilityParameters, IntakeAssuranceVisibilityEnabled: value }), /Invalid parameter/);
  const bypass = vars(evaluateTemplate(template, { ...visibilityParameters, IntakeAssuranceStorageEnabled: "false" }));
  for (const key of visibilityKeys) assert.ok(!(key in bypass));
});

test("visibility changes only its parameter, rule, condition and environment bindings", () => {
  const prior = withoutShadow(template);
  delete prior.Parameters.IntakeAssuranceVisibilityEnabled;
  delete prior.Rules.IntakeVisibilityRequiresAuthenticatedStorage;
  delete prior.Conditions.IntakeAssuranceVisibilityActive;
  for (const key of visibilityKeys) delete vars(prior)[key];
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/intake-storage-baseline.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(canonical(prior))).digest("hex"), baseline.sha256, baseline.source_commit);
});

test("complete visibility environments fit for fixture values and reject long-scope overflow", () => {
  const check = parameters => checkCandidateEnvironment(Object.fromEntries(Object.entries(vars(evaluate(parameters))).map(([key,value])=>[key,String(value)])));
  for (const params of [visibilityParameters, { ...captureParameters, ...visibilityParameters }, { ...recoveryParameters, ...visibilityParameters }, { ...captureParameters, ...recoveryParameters, ...visibilityParameters }]) assert.ok(check(params).remaining_bytes > 0);
  assert.throws(() => check({ ...captureParameters, ...recoveryParameters, ...visibilityParameters, IntakeAssuranceCustomerId: "a".repeat(256), IntakeAssuranceConnectionId: "b".repeat(256), IntakeAssuranceImportMethodId: "c".repeat(256) }), /exceeds/);
});

test("admin build paths default visibility false and customer empty, without changing review gates", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/deploy-admin-web.yml", import.meta.url), "utf8");
  const script = readFileSync(new URL("../deploy-admin-web.sh", import.meta.url), "utf8");
  assert.match(workflow, /VITE_ENABLE_INTAKE_EXCEPTIONS: \$\{\{ vars\.PATHFINDER_ENABLE_INTAKE_EXCEPTIONS_UI \|\| 'false' \}\}/);
  assert.match(workflow, /VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID: \$\{\{ vars\.PATHFINDER_INTAKE_EXCEPTIONS_UI_CUSTOMER_ID \|\| '' \}\}/);
  assert.ok(script.includes('VITE_ENABLE_INTAKE_EXCEPTIONS="${VITE_ENABLE_INTAKE_EXCEPTIONS:-false}"'));
  assert.ok(script.includes('VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID="${VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID:-}"'));
  assert.doesNotMatch(workflow + script, /VITE_ENABLE_INTAKE_DELIVERY_REVIEW/);
});

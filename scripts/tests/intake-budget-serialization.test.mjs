import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTemplate, evaluateTemplate, environmentBytes } from "../intake-storage-template.mjs";
import { captureParameters, captureVariables as vars } from "./fixtures/intake-capture-config.mjs";
import { recoveryParameters, recoveryValidation } from "./fixtures/intake-recovery-config.mjs";
import { budgetGroups, legacyFixtureVariables } from "./fixtures/intake-budget-serialization.mjs";
const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
test("four modes emit only active compact budgets and reduce the complete environment", () => {
  const bytes = env => environmentBytes(Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])));
  for (const capture of [false, true]) for (const recovery of [false, true]) for (const longIds of [false, true]) {
    const parameters = { ...captureParameters, ...recoveryParameters, IntakeAssuranceCaptureEnabled: String(capture), IntakeAssuranceRecoveryEnabled: String(recovery), ...(longIds ? { IntakeAssuranceCustomerId: "a".repeat(256), IntakeAssuranceImportMethodId: "b".repeat(256), IntakeAssuranceConnectionId: "c".repeat(256) } : {}) };
    const env = vars(evaluateTemplate(template, parameters, recoveryValidation));
    assert.equal(env[budgetGroups.capture.compact], capture ? "1|10|100|10000" : undefined);
    assert.equal(env[budgetGroups.recovery.compact], recovery ? "1|10|2|60" : undefined);
    for (const group of Object.values(budgetGroups)) for (const field of group.fields) assert.ok(!(field in env));
    const saved = bytes(legacyFixtureVariables(env)) - bytes(env);
    assert.equal(saved, (capture ? 88 : 0) + (recovery ? 66 : 0));
  }
});

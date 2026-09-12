import assert from "node:assert/strict";
import test from "node:test";
import { resolveIntakeBudgetEnvironment } from "../src/intake-compact-budgets.js";
import { getWrikeAssuranceCaptureConfig } from "../src/wrike-assurance-coordinator.js";
import { getIntakeSweepConfig } from "../src/intake-recovery-sweep.js";
import { parseTemplate, evaluateTemplate } from "../../../scripts/intake-storage-template.mjs";
import { readFileSync } from "node:fs";
import { captureParameters, captureVariables } from "../../../scripts/tests/fixtures/intake-capture-config.mjs";
import { recoveryParameters, recoveryValidation } from "../../../scripts/tests/fixtures/intake-recovery-config.mjs";
import { budgetGroups, legacyFixtureVariables } from "../../../scripts/tests/fixtures/intake-budget-serialization.mjs";
const template = parseTemplate(readFileSync(new URL("../../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const env = Object.fromEntries(Object.entries(captureVariables(evaluateTemplate(template, { ...captureParameters, ...recoveryParameters }, recoveryValidation))).map(([key, value]) => [key, String(value)]));
const scope = { customer_id: "synthetic", import_method_id: "method" };
const parsers = { capture: (input: NodeJS.ProcessEnv) => getWrikeAssuranceCaptureConfig(input, scope), recovery: getIntakeSweepConfig };

test("compact, legacy and complete matching mixed budgets produce identical runtime settings without mutation", () => {
  const legacy = legacyFixtureVariables(env);
  for (const kind of ["capture", "recovery"] as const) {
    const before = { ...env };
    assert.deepEqual(parsers[kind](env), parsers[kind](legacy));
    assert.deepEqual(parsers[kind]({ ...env, ...legacy }), parsers[kind](legacy));
    assert.deepEqual(env, before);
    for (const field of budgetGroups[kind].fields) {
      assert.throws(() => parsers[kind]({ ...env, [field]: legacy[field] }), /Invalid or conflicting/);
      assert.throws(() => parsers[kind]({ ...env, ...legacy, [field]: "999999" }), /Invalid or conflicting/);
      const missing = { ...legacy }; delete missing[field];
      assert.throws(() => parsers[kind](missing));
    }
  }
});

test("compact grammar fails closed on malformed versions, field counts, lexical values and bounds with sanitized errors", () => {
  for (const kind of ["capture", "recovery"] as const) {
    const key = budgetGroups[kind].compact;
    const valid = env[key]!.split("|");
    const invalid = ["", "secret-canary", "2|1|1|60", "1|1|1", "1|1|1|60|extra", "1||1|60", "1|1|1|60\n", "x".repeat(100)];
    for (let index = 1; index <= 3; index++) for (const value of ["0", "-1", "1.5", "1e2", "01", " 1", "NaN", "Infinity", "999999"]) {
      const parts = [...valid]; parts[index] = value; invalid.push(parts.join("|"));
    }
    for (const value of invalid) assert.throws(() => parsers[kind]({ ...env, [key]: value }), error => {
      assert.equal((error as Error).message, `Invalid or conflicting intake ${kind} budget configuration`); return true;
    });
    const ranges = kind === "capture" ? [[1, 1000], [1, 256], [1, 120000]] : [[1, 100], [1, 10], [30, 900]];
    ranges.forEach(([min, max], index) => { for (const value of [min, max]) { const parts = [...valid]; parts[index + 1] = String(value); assert.doesNotThrow(() => parsers[kind]({ ...env, [key]: parts.join("|") })); } });
  }
});

test("inactive and unrelated compact budgets cannot enable or disrupt a capability", () => {
  assert.equal(getWrikeAssuranceCaptureConfig({ PATHFINDER_INTAKE_CAPTURE_LIMITS: "broken", PATHFINDER_INTAKE_RECOVERY_LIMITS: "broken" }, scope).enabled, false);
  assert.equal(getIntakeSweepConfig({ PATHFINDER_INTAKE_CAPTURE_LIMITS: "broken", PATHFINDER_INTAKE_RECOVERY_LIMITS: "broken" }).enabled, false);
  assert.deepEqual(parsers.capture({ ...env, PATHFINDER_INTAKE_RECOVERY_LIMITS: "broken" }), parsers.capture(env));
  assert.deepEqual(parsers.recovery({ ...env, PATHFINDER_INTAKE_CAPTURE_LIMITS: "broken" }), parsers.recovery(env));
  assert.equal(resolveIntakeBudgetEnvironment({}, "capture").PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES, undefined);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTemplate, evaluateTemplate, environmentBytes } from "../intake-storage-template.mjs";
import { captureParameters, captureFields, captureRanges, captureValidation, captureVariables as vars } from "./fixtures/intake-capture-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const evaluate = (overrides = {}) => evaluateTemplate(template, overrides, captureValidation);
const gate = "PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE";
const keys = [gate, ...Object.values(captureFields)];

test("capture is independently default-off and omits all configuration even with stored values", () => {
  assert.equal(template.Parameters.IntakeAssuranceCaptureEnabled.Default, "false");
  assert.deepEqual(template.Parameters.IntakeAssuranceCaptureEnabled.AllowedValues, ["true", "false"]);
  for (const name of Object.keys(captureFields)) assert.equal(template.Parameters[name].Default, "");
  for (const storage of ["false", "true"]) {
    const result = evaluate({ ...captureParameters, IntakeAssuranceCaptureEnabled: "false", IntakeAssuranceStorageEnabled: storage });
    for (const key of keys) assert.ok(!(key in vars(result)), key);
    assert.deepEqual(result, evaluate({ IntakeAssuranceStorageEnabled: storage }));
  }
  assert.throws(() => evaluate({ ...captureParameters, IntakeAssuranceStorageEnabled: "false" }), /Rule failed/);
  assert.throws(() => evaluate({ ...captureParameters, StorageDriver: "local" }), /DynamoDB persistence driver/);
  // The resource condition also omits capture env even if rule evaluation is bypassed.
  const bypass = evaluateTemplate(template, { ...captureParameters, IntakeAssuranceStorageEnabled: "false" });
  for (const key of keys) assert.ok(!(key in vars(bypass)));
});

test("enabled capture adds exactly its runtime bindings without changing existing resources", () => {
  const result = evaluate(captureParameters);
  assert.equal(vars(result)[gate], "true");
  for (const [name, env] of Object.entries(captureFields)) assert.equal(vars(result)[env], captureParameters[name]);
  for (const key of keys) delete vars(result)[key];
  assert.deepEqual(result, evaluate({ IntakeAssuranceStorageEnabled: "true" }));
});

test("capture rejects every missing field, unsafe scope and out-of-range budget", () => {
  for (const name of Object.keys(captureFields)) {
    assert.throws(() => evaluate({ ...captureParameters, [name]: "" }), /Rule failed/, name);
    const missing = { ...captureParameters }; delete missing[name];
    assert.throws(() => evaluate(missing), /Rule failed/, name);
  }
  for (const name of ["IntakeAssuranceCustomerId", "IntakeAssuranceImportMethodId", "IntakeAssuranceConnectionId"]) {
    for (const value of [" ", " customer", "customer/other", "a".repeat(257), "id\n"]) assert.throws(() => evaluate({ ...captureParameters, [name]: value }), /Invalid parameter/, name);
  }
  for (const [name, [min, max]] of Object.entries(captureRanges)) {
    for (const value of [String(min - 1), String(max + 1), "1.5", "-1", "NaN", "Infinity", "1e2", "01", " 100", "100\n"]) {
      assert.throws(() => evaluate({ ...captureParameters, [name]: value }), /Invalid parameter/, `${name}=${value}`);
    }
    for (const value of [min, max]) assert.doesNotThrow(() => evaluate({ ...captureParameters, [name]: String(value) }));
    // Exhaustively check the integer range regex, including decimal boundaries.
    const pattern = new RegExp(template.Parameters[name].AllowedPattern);
    for (let value = 0; value <= max + 1; value++) assert.equal(pattern.test(String(value)), value >= min && value <= max, `${name}=${value}`);
  }
  for (const flag of ["TRUE", "1", ""]) assert.throws(() => evaluate({ ...captureParameters, IntakeAssuranceCaptureEnabled: flag }), /Invalid parameter/);
});

test("capture and active scheduled intake must have the same customer and method", () => {
  const scheduled = { ...captureParameters, WrikeScheduledIntakeEnabled: "true", WrikeScheduledIntakeCustomerId: "synthetic", WrikeScheduledIntakeImportMethodId: "method" };
  assert.doesNotThrow(() => evaluate(scheduled));
  for (const name of ["WrikeScheduledIntakeCustomerId", "WrikeScheduledIntakeImportMethodId"]) assert.throws(() => evaluate({ ...scheduled, [name]: "different" }), /IntakeCaptureMatchesScheduledScope/);
});

test("capture fixture fits the Lambda environment limit with an explicit byte delta", () => {
  const strings = (env) => Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
  const before = environmentBytes(strings(vars(evaluate({ IntakeAssuranceStorageEnabled: "true" }))));
  const after = environmentBytes(strings(vars(evaluate(captureParameters))));
  const additions = Object.fromEntries(keys.map((key) => [key, String(vars(evaluate(captureParameters))[key])]));
  assert.equal(after - before, environmentBytes(additions));
  assert.ok(after <= 4096, `Fixture env uses ${after} bytes`);
});

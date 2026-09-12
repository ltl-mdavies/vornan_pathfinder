import { legacyFixtureVariables } from "../../../scripts/tests/fixtures/intake-budget-serialization.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getWrikeAssuranceCaptureConfig } from "../src/wrike-assurance-coordinator.js";
import { parseTemplate, evaluateTemplate } from "../../../scripts/intake-storage-template.mjs";
import { captureParameters, captureFields, captureRanges, captureValidation, captureVariables } from "../../../scripts/tests/fixtures/intake-capture-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const compactEnvironment = Object.fromEntries(Object.entries(captureVariables(evaluateTemplate(template, captureParameters, captureValidation))).map(([key, value]) => [key, String(value)]));
const environment = legacyFixtureVariables(compactEnvironment);
const scope = { customer_id: "synthetic", import_method_id: "method" };

test("actual template environment satisfies the runtime capture contract", () => {
  assert.equal(environment.PATHFINDER_STORAGE_DRIVER, "dynamodb");
  assert.ok(environment.PATHFINDER_INTAKE_ATTEMPTS_TABLE);
  const config = getWrikeAssuranceCaptureConfig(compactEnvironment, scope);
  assert.deepEqual(config, { enabled: true, ...scope, connection_id: "connection", snapshot_limit: 100, sla_seconds: 3600, max_candidates: 10, discovery_limits: { max_requests: 100, max_elapsed_ms: 10000 } });
  for (const storage of ["false", "true"]) {
    const env = captureVariables(evaluateTemplate(template, { IntakeAssuranceStorageEnabled: storage }, captureValidation));
    assert.equal(getWrikeAssuranceCaptureConfig(env, scope).enabled, false);
  }
});

test("Lambda capture rejects ephemeral storage or missing table bindings independently of template rules", () => {
  assert.throws(() => evaluateTemplate(template, { ...captureParameters, StorageDriver: "local" }, captureValidation), /DynamoDB persistence driver/);
  const bypass = captureVariables(evaluateTemplate(template, { ...captureParameters, StorageDriver: "local" }));
  assert.throws(() => getWrikeAssuranceCaptureConfig(bypass, scope), /DynamoDB driver/);
  for (const runtime of [{ PATHFINDER_RUNTIME: "lambda" }, { PATHFINDER_RUNTIME: undefined, AWS_LAMBDA_FUNCTION_NAME: "synthetic-lambda" }]) {
    for (const driver of [undefined, "local", "invalid"]) assert.throws(() => getWrikeAssuranceCaptureConfig({ ...environment, ...runtime, PATHFINDER_STORAGE_DRIVER: driver }, scope), /DynamoDB driver/);
    for (const table of [undefined, "", " ", " table\n"]) assert.throws(() => getWrikeAssuranceCaptureConfig({ ...environment, ...runtime, PATHFINDER_INTAKE_ATTEMPTS_TABLE: table }, scope), /table binding/);
    assert.equal(getWrikeAssuranceCaptureConfig({ ...environment, ...runtime, PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE: "false", PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_INTAKE_ATTEMPTS_TABLE: undefined }, scope).enabled, false);
  }
  assert.equal(getWrikeAssuranceCaptureConfig({ ...environment, PATHFINDER_RUNTIME: undefined, AWS_LAMBDA_FUNCTION_NAME: undefined, PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_INTAKE_ATTEMPTS_TABLE: undefined }, scope).enabled, true);
});

test("runtime independently rejects missing or unsafe capture scope and invalid numeric bounds", () => {
  for (const field of Object.values(captureFields) as string[]) {
    const missing = { ...environment }; delete missing[field];
    assert.throws(() => getWrikeAssuranceCaptureConfig(missing, scope), undefined, field);
  }
  for (const [parameter, bounds] of Object.entries(captureRanges)) {
    const [min, max] = bounds as number[];
    const field = captureFields[parameter];
    for (const value of [String(min - 1), String(max + 1), "1.5", "NaN", "Infinity"]) assert.throws(() => getWrikeAssuranceCaptureConfig({ ...environment, [field]: value }, scope));
    for (const value of [min, max]) assert.doesNotThrow(() => getWrikeAssuranceCaptureConfig({ ...environment, [field]: String(value) }, scope));
  }
  for (const field of ["PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID", "PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID", "PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID"]) {
    for (const value of [" ", " customer", "customer/other", "a".repeat(257), "id\n"]) {
      // Match supplied customer/method too, so this proves identifier validation rather than just scope equality.
      const env = { ...environment, [field]: value };
      const matched = { customer_id: env.PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID, import_method_id: env.PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID };
      assert.throws(() => getWrikeAssuranceCaptureConfig(env, matched));
    }
  }
  assert.throws(() => getWrikeAssuranceCaptureConfig(environment, { ...scope, customer_id: "different" }));
  assert.throws(() => getWrikeAssuranceCaptureConfig(environment, { ...scope, import_method_id: "different" }));
});

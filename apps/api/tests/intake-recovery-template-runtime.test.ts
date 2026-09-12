import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getIntakeSweepConfig } from "../src/intake-recovery-sweep.js";
import { getWrikeAssuranceCaptureConfig } from "../src/wrike-assurance-coordinator.js";
import { getIntakeNotificationConfig } from "../src/intake-notification-runtime.js";
import { getWrikeIntakeFeedbackConfig } from "../src/wrike-intake-feedback-runtime.js";
import { getIntakeStatusRepairConfig } from "../src/intake-status-repair-runtime.js";
import { parseTemplate, evaluateTemplate } from "../../../scripts/intake-storage-template.mjs";
import { captureParameters, captureVariables } from "../../../scripts/tests/fixtures/intake-capture-config.mjs";
import { recoveryParameters, recoveryFields, sharedFields, recoveryRanges, recoveryValidation } from "../../../scripts/tests/fixtures/intake-recovery-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const emitted = (parameters: Record<string, string>) => Object.fromEntries(Object.entries(captureVariables(evaluateTemplate(template, parameters, recoveryValidation))).map(([key, value]) => [key, String(value)]));
const environment = emitted(recoveryParameters);

test("disabled adjacent capabilities require no persistence or scope even when recovery is enabled", () => {
  const env = { PATHFINDER_RUNTIME: "lambda", PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: "true", PATHFINDER_STORAGE_DRIVER: "local" };
  for (const parse of [getIntakeNotificationConfig, getWrikeIntakeFeedbackConfig, getIntakeStatusRepairConfig]) assert.equal(parse(env).sweep.enabled, false);
});

test("all four emitted configurations reach the actual capture and recovery runtime parsers", () => {
  for (const capture of ["false", "true"]) for (const recovery of ["false", "true"]) {
    const env = emitted({ ...captureParameters, ...recoveryParameters, IntakeAssuranceCaptureEnabled: capture, IntakeAssuranceRecoveryEnabled: recovery });
    assert.equal(getIntakeSweepConfig(env).enabled, recovery === "true");
    assert.equal(getWrikeAssuranceCaptureConfig(env, { customer_id: "synthetic", import_method_id: "method" }).enabled, capture === "true");
  }
  assert.deepEqual(getIntakeSweepConfig(environment), { enabled: true, scope: { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" }, page_size: 10, max_pages: 2, lease_seconds: 60, snapshot_limit: 100, sla_seconds: 3600 });
});

test("enabled recovery independently rejects missing scope, invalid bounds, and ephemeral Lambda persistence", () => {
  for (const field of Object.values({ ...sharedFields, ...recoveryFields }) as string[]) {
    const missing = { ...environment }; delete missing[field];
    assert.throws(() => getIntakeSweepConfig(missing));
  }
  for (const [name, bounds] of Object.entries(recoveryRanges)) {
    const [min, max] = bounds as number[];
    for (const value of [min - 1, max + 1, 1.5, NaN, Infinity]) assert.throws(() => getIntakeSweepConfig({ ...environment, [recoveryFields[name]]: String(value) }));
    for (const value of [min, max]) assert.doesNotThrow(() => getIntakeSweepConfig({ ...environment, [recoveryFields[name]]: String(value) }));
  }
  for (const field of ["PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID", "PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID", "PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID"]) {
    for (const value of ["id\n", " ", "bad/scope", "a".repeat(257)]) assert.throws(() => getIntakeSweepConfig({ ...environment, [field]: value }));
  }
  for (const marker of [{ PATHFINDER_RUNTIME: "lambda" }, { PATHFINDER_RUNTIME: undefined, AWS_LAMBDA_FUNCTION_NAME: "synthetic" }]) {
    for (const driver of [undefined, "local", "invalid"]) assert.throws(() => getIntakeSweepConfig({ ...environment, ...marker, PATHFINDER_STORAGE_DRIVER: driver }), /DynamoDB driver/);
    for (const table of [undefined, "", " ", " table\n"]) assert.throws(() => getIntakeSweepConfig({ ...environment, ...marker, PATHFINDER_INTAKE_ATTEMPTS_TABLE: table }), /table binding/);
    assert.equal(getIntakeSweepConfig({ ...environment, ...marker, PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP: "false", PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_INTAKE_ATTEMPTS_TABLE: undefined }).enabled, false);
  }
  const bypass = captureVariables(evaluateTemplate(template, { ...recoveryParameters, StorageDriver: "local" }));
  assert.throws(() => getIntakeSweepConfig(bypass), /DynamoDB driver/);
  assert.equal(getIntakeSweepConfig({ ...environment, PATHFINDER_RUNTIME: undefined, AWS_LAMBDA_FUNCTION_NAME: undefined, PATHFINDER_STORAGE_DRIVER: "local", PATHFINDER_INTAKE_ATTEMPTS_TABLE: undefined }).enabled, true);
});

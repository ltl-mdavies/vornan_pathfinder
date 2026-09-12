import { budgetGroups } from "./fixtures/intake-budget-serialization.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTemplate, evaluateTemplate } from "../intake-storage-template.mjs";
import { checkCandidateEnvironment } from "../intake-environment-preflight.mjs";
import { captureParameters, captureFields, captureVariables as vars } from "./fixtures/intake-capture-config.mjs";
import { recoveryParameters, recoveryFields, sharedFields, recoveryRanges, recoveryRules, recoveryValidation } from "./fixtures/intake-recovery-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const evaluate = (values = {}) => evaluateTemplate(template, values, recoveryValidation);
const gate = "PATHFINDER_ENABLE_INTAKE_ASSURANCE_SWEEP";
const keys = [gate, budgetGroups.recovery.compact];
const captureOnly = ["PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE", budgetGroups.capture.compact];

test("recovery defaults false; four combinations emit exactly the necessary shared and independent settings", () => {
  assert.equal(template.Parameters.IntakeAssuranceRecoveryEnabled.Default, "false");
  assert.deepEqual(template.Parameters.IntakeAssuranceRecoveryEnabled.AllowedValues, ["true", "false"]);
  for (const name of Object.keys(recoveryFields)) assert.equal(template.Parameters[name].Default, "");
  for (const capture of ["false", "true"]) for (const recovery of ["false", "true"]) {
    const result = evaluate({ ...captureParameters, ...recoveryParameters, IntakeAssuranceCaptureEnabled: capture, IntakeAssuranceRecoveryEnabled: recovery });
    for (const key of keys) assert.equal(key in vars(result), recovery === "true", key);
    for (const key of captureOnly) assert.equal(key in vars(result), capture === "true", key);
    for (const key of Object.values(sharedFields)) assert.equal(key in vars(result), capture === "true" || recovery === "true", key);
    const normalized = structuredClone(result);
    for (const key of [...keys, ...captureOnly, ...Object.values(sharedFields)]) delete vars(normalized)[key];
    assert.deepEqual(normalized, evaluate({ IntakeAssuranceStorageEnabled: "true" }));
  }
  assert.deepEqual(evaluate({ ...recoveryParameters, IntakeAssuranceStorageEnabled: "false", IntakeAssuranceRecoveryEnabled: "false" }), evaluate());
});

test("recovery requires storage, DynamoDB, all explicit shared settings and strict bounded controls", () => {
  for (const change of [{ IntakeAssuranceStorageEnabled: "false" }, { StorageDriver: "local" }]) assert.throws(() => evaluate({ ...recoveryParameters, ...change }), /Rule failed/);
  for (const name of [...Object.keys(sharedFields), ...Object.keys(recoveryFields)]) {
    const missing = { ...recoveryParameters }; delete missing[name];
    assert.throws(() => evaluate(missing), /Rule failed/);
    assert.throws(() => evaluate({ ...recoveryParameters, [name]: "" }), /Rule failed/);
  }
  for (const [name, [min, max]] of Object.entries(recoveryRanges)) {
    for (const value of [String(min - 1), String(max + 1), "1.5", "1e2", "01", "NaN", "Infinity", "-1", " 30", "30\n"]) assert.throws(() => evaluate({ ...recoveryParameters, [name]: value }), /Invalid parameter/);
    for (const value of [min, max]) assert.doesNotThrow(() => evaluate({ ...recoveryParameters, [name]: String(value) }));
    const pattern = new RegExp(template.Parameters[name].AllowedPattern);
    for (let value = 0; value <= max + 1; value++) assert.equal(pattern.test(String(value)), value >= min && value <= max);
  }
  for (const name of ["IntakeAssuranceCustomerId", "IntakeAssuranceImportMethodId", "IntakeAssuranceConnectionId"]) for (const value of [" ", "id\n", "wrong/scope", "a".repeat(257)]) assert.throws(() => evaluate({ ...recoveryParameters, [name]: value }), /Invalid parameter/);
  for (const flag of ["TRUE", "1", ""]) assert.throws(() => evaluate({ ...recoveryParameters, IntakeAssuranceRecoveryEnabled: flag }), /Invalid parameter/);
  const bypass = evaluateTemplate(template, { ...recoveryParameters, IntakeAssuranceStorageEnabled: "false" });
  for (const key of [...keys, ...Object.values(sharedFields)]) assert.ok(!(key in vars(bypass)));
});

test("enabled scheduled intake must match recovery scope without requiring capture", () => {
  const values = { ...recoveryParameters, WrikeScheduledIntakeEnabled: "true", WrikeScheduledIntakeCustomerId: "synthetic", WrikeScheduledIntakeImportMethodId: "method" };
  assert.doesNotThrow(() => evaluate(values));
  for (const name of ["WrikeScheduledIntakeCustomerId", "WrikeScheduledIntakeImportMethodId"]) assert.throws(() => evaluate({ ...values, [name]: "other" }), /IntakeRecoveryMatchesScheduledScope/);
});

test("complete combined fixture fits 4KB; long actual scope can exceed it and is rejected", () => {
  const check = (values) => checkCandidateEnvironment(Object.fromEntries(Object.entries(vars(evaluate(values))).map(([key, value]) => [key, String(value)])));
  for (const values of [{}, recoveryParameters, captureParameters, { ...captureParameters, ...recoveryParameters }]) assert.ok(check(values).bytes <= 4096);
  assert.throws(() => check({ ...captureParameters, ...recoveryParameters, IntakeAssuranceCustomerId: "a".repeat(256), IntakeAssuranceImportMethodId: "b".repeat(256), IntakeAssuranceConnectionId: "c".repeat(256) }), /exceeds/);
});

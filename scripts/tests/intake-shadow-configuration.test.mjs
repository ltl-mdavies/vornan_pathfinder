import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseTemplate, evaluateTemplate } from "../intake-storage-template.mjs";
import { checkCandidateEnvironment } from "../intake-environment-preflight.mjs";
import { captureVariables as vars } from "./fixtures/intake-capture-config.mjs";
import { shadowKeys, withoutShadow } from "./fixtures/intake-shadow-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const prior = withoutShadow(template);
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const evaluate = (params = {}) => evaluateTemplate(template, params, { validateParameters: true, rules: Object.keys(template.Rules) });
const params = { WrikeLiftDocumentDeliveryBucketName: "vornan-pathfinder-wrike-delivery-synthetic", WrikeLiftDocumentDeliveryBaseUrl: "https://go.vornan.co", WrikeWorkbookEvidenceEnabled: "true", WrikeEvidencePreviewEnabled: "true", WrikeLiftDocumentPublicationEnabled: "true", IntakeShadowEnabled: "true", IntakeAssuranceStorageEnabled: "true", WrikeScheduledIntakeEnabled: "true", IntakeAssuranceCustomerId: "synthetic", IntakeAssuranceImportMethodId: "method", IntakeAssuranceConnectionId: "connection", IntakeAssuranceSlaSeconds: "3600", IntakeShadowStatusId: "status", IntakeShadowMaxCandidates: "10", IntakeShadowMaxElapsedMs: "500", WrikeScheduledIntakeCustomerId: "synthetic", WrikeScheduledIntakeImportMethodId: "method" };

test("shadow adds only four parameters, one rule, one condition and three bindings", () => {
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/intake-shadow-baseline.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(canonical(prior))).digest("hex"), baseline.sha256, baseline.source_commit);
  for (const storage of ["false", "true"]) assert.deepEqual(evaluate({ IntakeAssuranceStorageEnabled: storage }), evaluateTemplate(prior, { IntakeAssuranceStorageEnabled: storage }));
});
test("enabled shadow adds only compact bindings to the ordinary scheduled environment", () => {
  const on = evaluate(params);
  assert.equal(vars(on).PATHFINDER_ENABLE_INTAKE_SHADOW, "true");
  assert.equal(vars(on).PATHFINDER_INTAKE_SHADOW_SCOPE, "1|synthetic|method|connection|status");
  assert.equal(vars(on).PATHFINDER_INTAKE_SHADOW_LIMITS, "1|10|3600|500");
  assert.ok(!("PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID" in vars(on)));
  assert.ok(checkCandidateEnvironment(Object.fromEntries(Object.entries(vars(on)).map(([k,v]) => [k,String(v)]))).remaining_bytes > 0);
  for (const key of shadowKeys) delete vars(on)[key];
  assert.deepEqual(on, evaluate({ ...params, IntakeShadowEnabled: "false" }));
});
test("shadow rejects incomplete, mismatched and incompatible activation", () => {
  for (const key of ["IntakeAssuranceCustomerId", "IntakeAssuranceImportMethodId", "IntakeAssuranceConnectionId", "IntakeAssuranceSlaSeconds", "IntakeShadowStatusId", "IntakeShadowMaxCandidates", "IntakeShadowMaxElapsedMs"]) assert.throws(() => evaluate({ ...params, [key]: "" }), /Rule failed/);
  for (const change of [{ IntakeAssuranceStorageEnabled: "false" }, { StorageDriver: "local" }, { WrikeScheduledIntakeEnabled: "false" }, { IntakeAssuranceCaptureEnabled: "true" }, { IntakeAssuranceRecoveryEnabled: "true" }, { IntakeAssuranceVisibilityEnabled: "true" }, { WrikeScheduledIntakeCustomerId: "other" }, { WrikeScheduledIntakeImportMethodId: "other" }]) assert.throws(() => evaluate({ ...params, ...change }), /Rule failed/);
});
test("shadow bounds accept endpoints and reject malformed values", () => {
  for (const [key, lo, hi] of [["IntakeShadowMaxCandidates",1,25], ["IntakeShadowMaxElapsedMs",50,1000], ["IntakeAssuranceSlaSeconds",60,604800]]) {
    for (const value of [lo,hi]) evaluate({ ...params, [key]: String(value) });
    for (const value of [String(lo-1),String(hi+1),"01","1e2"," 100","100\n"]) assert.throws(() => evaluate({ ...params, [key]: value }), /Invalid parameter/);
  }
  for (const value of ["a|b", "status ", "a".repeat(257)]) assert.throws(() => evaluate({ ...params, IntakeShadowStatusId: value }), /Invalid parameter/);
  assert.throws(() => checkCandidateEnvironment(Object.fromEntries(Object.entries(vars(evaluate({ ...params, IntakeAssuranceCustomerId: "a".repeat(128), WrikeScheduledIntakeCustomerId: "a".repeat(128), IntakeAssuranceConnectionId: "b".repeat(256), IntakeShadowStatusId: "c".repeat(256) }))).map(([k,v])=>[k,String(v)]))), /exceeds/);
});

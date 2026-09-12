import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateIntakeDeploymentEvidence, evidenceDigest } from "../intake-deployment-preflight.mjs";
import { syntheticEvidence, sealEvidence } from "./fixtures/intake-deployment-evidence.mjs";
const reject = (mutate, pattern = /preflight failed/) => { const bundle = syntheticEvidence(); mutate(bundle); assert.throws(() => validateIntakeDeploymentEvidence(sealEvidence(bundle)), pattern); };

test("complete supplied evidence preserves NoEcho and restores changed parameters without claiming authorization", () => {
  const result = validateIntakeDeploymentEvidence(syntheticEvidence());
  assert.equal(result.status, "supplied_evidence_checks_passed");
  assert.equal(result.deployment_authorized, false);
  assert.deepEqual(result.parameters, { current_count: 3, candidate_count: 4, preserved_count: 2, intended_change_count: 2, noecho_preserved_count: 1 });
  assert.ok(result.remaining_checks.includes("evidence_provenance_and_freshness"));
  assert.doesNotMatch(JSON.stringify(result), /Code|Secret|Mode|SAFE|PRIVATE_CANARY|secret-canary|old-artifact|\*\*\*\*/);
});

test("every parameter manifest must be complete, unique, known and explicit", () => {
  for (const field of ["current_parameters", "candidate_parameters", "rollback_parameters"]) {
    reject(b => b[field].pop(), /INCOMPLETE_PARAMETER/);
    reject(b => b[field].push(structuredClone(b[field][0])), /DUPLICATE_PARAMETER/);
    reject(b => b[field].push({ ParameterKey: "Unknown", ParameterValue: "private" }), /UNKNOWN_PARAMETER/);
  }
  reject(b => { b.current_parameters[0] = { ParameterKey: "Code", UsePreviousValue: true }; }, /INVALID_CURRENT/);
  for (const field of ["candidate_parameters", "rollback_parameters"]) {
    reject(b => { b[field][1].UsePreviousValue = false; }, /INVALID_PARAMETER_MANIFEST/);
    reject(b => { b[field][1].ParameterValue = "****"; }, /INVALID_PARAMETER_MANIFEST/);
    reject(b => { b[field][1] = { ParameterKey: "Secret", ParameterValue: "****" }; }, /MUST_USE_PREVIOUS/);
  }
  reject(b => { b.candidate_parameters[2] = { ParameterKey: "Mode", ParameterValue: "default-must-not-win" }; }, /MUST_USE_PREVIOUS/);
  reject(b => { delete b.intended_parameter_changes.IntakeEnabled; }, /EXPLICIT_INTENT/);
  reject(b => { b.candidate_parameters[3] = { ParameterKey: "IntakeEnabled", UsePreviousValue: true }; }, /INTENT_MISMATCH/);
});

test("declared changes must match and rollback must restore original rather than candidate values", () => {
  reject(b => { b.candidate_parameters[0].ParameterValue = "unexpected"; }, /INTENT_MISMATCH/);
  reject(b => { b.rollback_parameters[0] = { ParameterKey: "Code", UsePreviousValue: true }; }, /RESTORE_ORIGINAL/);
  reject(b => { b.rollback_parameters[0].ParameterValue = "new-artifact"; }, /RESTORE_ORIGINAL/);
  reject(b => { b.rollback_parameters[2] = { ParameterKey: "Mode", ParameterValue: "retained-mode" }; }, /UNCHANGED_MUST_USE_PREVIOUS/);
  reject(b => { b.intended_parameter_changes.Secret = "new-secret"; }, /NOECHO_CHANGE/);
  reject(b => { b.intended_parameter_changes.Unknown = "value"; }, /INVALID_PARAMETER_INTENT/);
  reject(b => { b.intended_parameter_changes.Mode = "retained-mode"; }, /REDUNDANT_PARAMETER/);
  reject(b => { b.current_parameters[0].ParameterValue = "****"; b.rollback_parameters[0].ParameterValue = "****"; }, /VALUE_UNAVAILABLE/);
  reject(b => { b.candidate_template.Parameters.Secret.NoEcho = false; }, /SEMANTICS_CHANGED/);
  reject(b => { b.candidate_template.Parameters.Code.Type = "Number"; }, /SEMANTICS_CHANGED/);
  reject(b => { delete b.candidate_template.Parameters.Mode; }, /REMOVAL_UNSUPPORTED/);
});

test("complete environment delta and exact rollback equality are checked in both directions", () => {
  for (const field of ["candidate_environment", "rollback_environment"]) {
    reject(b => { b[field].EXTRA = "secret-canary"; }, /ENVIRONMENT/);
    reject(b => { delete b[field].PRIVATE_CANARY; }, /ENVIRONMENT/);
    reject(b => { b[field].PRIVATE_CANARY = "changed"; }, /ENVIRONMENT/);
  }
  reject(b => { b.intended_environment_changes.SAFE = "other"; }, /INTENT_MISMATCH/);
  reject(b => { b.intended_environment_changes.UNKNOWN = null; }, /REDUNDANT_ENVIRONMENT/);
  const removed = syntheticEvidence(); delete removed.candidate_environment.PRIVATE_CANARY; removed.intended_environment_changes.PRIVATE_CANARY = null;
  assert.equal(validateIntakeDeploymentEvidence(sealEvidence(removed)).deployment_authorized, false);
  for (const field of ["current_environment", "candidate_environment", "rollback_environment"]) {
    reject(b => { b[field].SAFE = "x".repeat(4096); }, /LIMIT_EXCEEDED/);
    reject(b => { b[field].SAFE = 4; }, /INVALID_ENVIRONMENT/);
    reject(b => { b[field].SAFE = "${Token[123]}"; }, /UNRESOLVED/);
    reject(b => { b[field] = []; }, /INVALID_ENVIRONMENT/);
  }
});

test("each evidence document is bound to a lowercase canonical digest; unsupported interpretation fails closed", () => {
  const original = syntheticEvidence();
  for (const field of Object.keys(original.evidence_sha256)) {
    const bundle = structuredClone(original); bundle.evidence_sha256[field] = "0".repeat(64);
    assert.throws(() => validateIntakeDeploymentEvidence(bundle), /DIGEST_MISMATCH/);
  }
  const stale = syntheticEvidence(); stale.current_environment.SAFE = "stale";
  assert.throws(() => validateIntakeDeploymentEvidence(stale), /DIGEST_MISMATCH/);
  const missing = syntheticEvidence(); delete missing.evidence_sha256.deployed_template;
  assert.throws(() => validateIntakeDeploymentEvidence(missing), /INCOMPLETE_EVIDENCE_DIGESTS/);
  assert.equal(evidenceDigest({ b: 2, a: 1 }), evidenceDigest({ a: 1, b: 2 }));
  reject(b => { b.deployed_template.Transform = "Macro"; }, /TRANSFORM_UNSUPPORTED/);
  reject(b => { b.deployed_template.Parameters.Code.Type = "AWS::SSM::Parameter::Value<String>"; }, /INVALID_PARAMETER_DEFINITION/);
  reject(b => { b.current_parameters[0].ParameterValue = "{{resolve:ssm:path}}"; }, /UNRESOLVED_PARAMETER/);
  reject(b => { b.intended_parameter_changes.Code = "${unresolved}"; }, /INVALID_PARAMETER_INTENT/);
});

test("CLI rejects malformed and duplicate-key JSON and never prints supplied contents or paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "intake-preflight-"));
  const path = join(directory, "secret-canary.json");
  const invoke = content => { writeFileSync(path, content); return spawnSync(process.execPath, [new URL("../intake-deployment-preflight.mjs", import.meta.url).pathname, path], { encoding: "utf8" }); };
  const valid = JSON.stringify(syntheticEvidence());
  try {
    for (const [content, status] of [[valid, 0], ['{"secret-canary":invalid}', 1], [valid.replace('"schema_version":1', '"schema_version":1,"schema_version":1'), 1], [valid.replace('"SAFE":"before"', '"SAFE":"before","SAFE":"after"'), 1]]) {
      const result = invoke(content);
      assert.equal(result.status, status);
      assert.doesNotMatch(result.stdout + result.stderr, /secret-canary|PRIVATE_CANARY|old-artifact|new-artifact|\*\*\*\*|ParameterKey/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

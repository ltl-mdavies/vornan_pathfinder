import { evidenceDigest } from "../../intake-deployment-preflight.mjs";
export function sealEvidence(bundle) {
  bundle.evidence_sha256 = Object.fromEntries(Object.entries(bundle).filter(([key]) => !["schema_version", "evidence_sha256"].includes(key)).map(([key, value]) => [key, evidenceDigest(value)]));
  return bundle;
}
export function syntheticEvidence() {
  const deployed = { Parameters: { Code: { Type: "String" }, Secret: { Type: "String", NoEcho: true }, Mode: { Type: "String", Default: "default-must-not-win" } }, Resources: {} };
  return sealEvidence({
    schema_version: 1,
    deployed_template: deployed,
    candidate_template: { ...structuredClone(deployed), Parameters: { ...structuredClone(deployed.Parameters), IntakeEnabled: { Type: "String", Default: "false" } } },
    current_parameters: [{ ParameterKey: "Code", ParameterValue: "old-artifact" }, { ParameterKey: "Secret", ParameterValue: "****" }, { ParameterKey: "Mode", ParameterValue: "retained-mode" }],
    candidate_parameters: [{ ParameterKey: "Code", ParameterValue: "new-artifact" }, { ParameterKey: "Secret", UsePreviousValue: true }, { ParameterKey: "Mode", UsePreviousValue: true }, { ParameterKey: "IntakeEnabled", ParameterValue: "false" }],
    rollback_parameters: [{ ParameterKey: "Code", ParameterValue: "old-artifact" }, { ParameterKey: "Secret", UsePreviousValue: true }, { ParameterKey: "Mode", UsePreviousValue: true }],
    intended_parameter_changes: { Code: "new-artifact", IntakeEnabled: "false" },
    current_environment: { SAFE: "before", PRIVATE_CANARY: "secret-canary" },
    candidate_environment: { SAFE: "after", PRIVATE_CANARY: "secret-canary", INTAKE_STATE: "false" },
    rollback_environment: { SAFE: "before", PRIVATE_CANARY: "secret-canary" },
    intended_environment_changes: { SAFE: "after", INTAKE_STATE: "false" }
  });
}

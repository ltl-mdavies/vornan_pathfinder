import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateProofCustomerBoundaryStack } from "../proof-customer-boundary-contract.mjs";

function stack(overrides = {}) {
  const parameters = {
    EnvironmentName: "dev",
    PublicReadEnabled: "true",
    ReadOnlyQaConfirmed: "true",
    ReadOnlyActivationExpiresAt: "2099-07-28T21:49:50.000Z",
    ProductionPublicReadApproved: "false",
    SyntheticQaEnabled: "false",
    ProofDomainName: "",
    CertificateArn: "",
    ManagedWebAclEnabled: "true",
    ProofWebAclArn: "",
    ...(overrides.parameters ?? {})
  };
  const outputs = {
    ProofCoreTableName: "Pathfinder-ProofCore-dev",
    ProofAuditTableName: "Pathfinder-ProofAudit-dev",
    ProofPublicApiEndpoint: "https://example.execute-api.us-east-1.amazonaws.com",
    ProofWebDistributionDomainName: "example.cloudfront.net",
    ...(overrides.outputs ?? {})
  };
  return {
    StackStatus: overrides.StackStatus ?? "UPDATE_COMPLETE",
    Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }))
  };
}

test("accepts only the isolated dev public-read QA window", () => {
  const result = evaluateProofCustomerBoundaryStack(stack());
  assert.equal(result.status, "ready_for_approved_boundary_qa");
  assert.equal(result.ready, true);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.mutation_authorized, false);
});

test("blocks production approval, a custom alias, and missing WAF protection", () => {
  const result = evaluateProofCustomerBoundaryStack(stack({ parameters: {
    ProductionPublicReadApproved: "true",
    ProofDomainName: "proof.vornan.co",
    CertificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/example",
    ManagedWebAclEnabled: "false"
  } }));
  assert.equal(result.ready, false);
  assert.deepEqual(result.unmet_gates, [
    "production_public_read_unapproved",
    "custom_domain_absent",
    "waf_configured"
  ]);
});

test("blocks a dark stack because the harness must never claim a deployed lifecycle pass", () => {
  const result = evaluateProofCustomerBoundaryStack(stack({ parameters: {
    PublicReadEnabled: "false",
    ReadOnlyQaConfirmed: "false"
  } }));
  assert.equal(result.ready, false);
  assert.equal(result.gates.public_read_window_enabled, false);
  assert.equal(result.gates.isolated_read_qa_recorded, false);
});

test("blocks a public boundary without the automatic activation deadline", () => {
  const result = evaluateProofCustomerBoundaryStack(stack({ parameters: {
    ReadOnlyActivationExpiresAt: ""
  } }));
  assert.equal(result.ready, false);
  assert.equal(result.gates.activation_deadline_active, false);
});

test("requires every isolated table and endpoint output", () => {
  const result = evaluateProofCustomerBoundaryStack(stack({ outputs: { ProofAuditTableName: "" } }));
  assert.equal(result.ready, false);
  assert.equal(result.output_gates.ProofAuditTableName, false);
  assert.ok(result.unmet_gates.includes("required_outputs_available"));
});

test("the runner is synthetic-only, approval-gated, email-free, and revokes in finally", () => {
  const source = readFileSync(new URL("../proof-customer-boundary-qa.ts", import.meta.url), "utf8");
  assert.match(source, /VORNAN_PROOF_CUSTOMER_BOUNDARY_QA/);
  assert.match(source, /stackName !== "vornan-proof-dev"/);
  assert.match(source, /PROOF_SYNTHETIC_QA_ORDER_NUMBER/);
  assert.match(source, /PATHFINDER_PROOF_ENABLE_LINK_EMAIL = "false"/);
  assert.match(source, /PATHFINDER_PROOF_ENABLE_LIFT_WRITES = "false"/);
  assert.match(source, /Direct Proof API bypass/);
  assert.match(source, /Missing-CSRF reviewer denial/);
  assert.match(source, /SameSite=Lax/);
  assert.match(source, /HttpOnly/);
  assert.match(source, /finally \{/);
  assert.match(source, /revokeProofGrant\(grantId\)/);
  assert.doesNotMatch(source, /method:\s*"PUT"/);
});

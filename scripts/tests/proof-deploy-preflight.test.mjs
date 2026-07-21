import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProofDeployment } from "../proof-deploy-preflight.mjs";

const qaEnvironment = {
  PATHFINDER_PROOF_ENVIRONMENT_NAME: "qa",
  PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "qa",
  PATHFINDER_PROOF_LIFT_ORDER_READ_URL: "https://qa-lift.example.invalid/ords/91/AS360Orders/N?offset=0",
  PATHFINDER_PROOF_LIFT_REPORT_READ_URL: "https://qa-lift.example.invalid/ords/91/AS360ProofReport/N?offset=0",
  PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "false",
  PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: "2099-07-28T21:49:50.000Z",
  PATHFINDER_PROOF_EDGE_SHARED_SECRET: "x".repeat(32)
};

test("accepts an isolated default-off QA deployment", () => {
  const result = validateProofDeployment(qaEnvironment);
  assert.equal(result.environment_name, "qa");
  assert.equal(result.public_read_enabled, false);
  assert.equal(result.automatic_refresh_max_inactive_days, 14);
  assert.equal(result.lift_writes_enabled, false);
  assert.equal(result.synthetic_qa_enabled, false);
});

test("allows the synthetic fixture only in a fully dark dev deployment", () => {
  const dev = {
    ...qaEnvironment,
    PATHFINDER_PROOF_ENVIRONMENT_NAME: "dev",
    PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "dev",
    PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA: "true"
  };
  assert.equal(validateProofDeployment(dev).synthetic_qa_enabled, true);
  for (const unsafe of [
    { PATHFINDER_PROOF_ENVIRONMENT_NAME: "qa", PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "qa" },
    { PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true", PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true" },
    { PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true" },
    { PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED: "true" },
    { PATHFINDER_PROOF_ENABLE_LINK_EMAIL: "true" },
    {
      PATHFINDER_PROOF_DOMAIN_NAME: "proof-dev.vornan.co",
      PATHFINDER_PROOF_CERTIFICATE_ARN:
        "arn:aws:acm:us-east-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }
  ]) {
    assert.throws(() => validateProofDeployment({ ...dev, ...unsafe }), /fully dark dev stack/);
  }
});

test("keeps synthetic QA disabled in normal workflow deploys and isolated to the sync worker", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/deploy-proof.yml", import.meta.url), "utf8");
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  assert.match(workflow, /SyntheticQaEnabled="false"/);
  assert.match(template, /SyntheticQaMustRemainDarkDev:/);
  assert.match(template, /PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA: !Ref SyntheticQaEnabled/);
  const publicFunction = template.slice(template.indexOf("  ProofPublicFunction:"), template.indexOf("  ProofSyncFunction:"));
  assert.doesNotMatch(publicFunction, /PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA/);
});

test("requires a bounded activation deadline and customer cohort in deployment contracts", () => {
  const proofTemplate = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  const apiTemplate = readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8");
  const proofWorkflow = readFileSync(new URL("../../.github/workflows/deploy-proof.yml", import.meta.url), "utf8");
  const apiWorkflow = readFileSync(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
  assert.match(proofTemplate, /ReadOnlyActivationExpiresAt:/);
  assert.match(proofTemplate, /PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: !Ref ReadOnlyActivationExpiresAt/);
  assert.match(apiTemplate, /ProofGrantCreationRequiresBoundedCohort:/);
  assert.match(apiTemplate, /PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: !Ref ProofGrantAllowedCustomerIds/);
  assert.match(apiTemplate, /PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: !Ref ProofReadOnlyActivationExpiresAt/);
  assert.match(proofWorkflow, /ReadOnlyActivationExpiresAt="\$\{READ_ONLY_ACTIVATION_EXPIRES_AT\}"/);
  assert.match(apiWorkflow, /ProofGrantAllowedCustomerIds=/);
  assert.match(apiWorkflow, /ProofReadOnlyActivationExpiresAt=/);
});

test("bounds the automatic stale-read refresh window", () => {
  assert.equal(validateProofDeployment({
    ...qaEnvironment,
    PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS: "30"
  }).automatic_refresh_max_inactive_days, 30);
  for (const value of ["0", "14.5", "366", "invalid"]) {
    assert.throws(
      () => validateProofDeployment({ ...qaEnvironment, PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS: value }),
      /AUTO_REFRESH_MAX_INACTIVE_DAYS/
    );
  }
});

test("rejects a QA deployment that silently uses the production Lift read host", () => {
  assert.throws(
    () => validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_LIFT_ORDER_READ_URL:
        "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N?offset=0"
    }),
    /ACKNOWLEDGE_PRODUCTION_READS/
  );
});

test("requires the read-only QA, edge, and WAF gates before public exposure", () => {
  assert.throws(
    () => validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
      PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
      PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: "",
      PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true"
    }),
    /READ_ONLY_ACTIVATION_EXPIRES_AT/
  );
  assert.throws(
    () => validateProofDeployment({ ...qaEnvironment, PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true" }),
    /READ_ONLY_QA_CONFIRMED/
  );
  assert.throws(
    () => validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
      PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
      PATHFINDER_PROOF_EDGE_SHARED_SECRET: ""
    }),
    /EDGE_SHARED_SECRET/
  );
  assert.throws(
    () => validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
      PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
      PATHFINDER_PROOF_EDGE_SHARED_SECRET: "x".repeat(32)
    }),
    /WAF/
  );
});

test("rejects every attempted Lift write capability", () => {
  for (const flag of [
    "PATHFINDER_PROOF_ENABLE_APPROVE",
    "PATHFINDER_PROOF_ENABLE_REVISION",
    "PATHFINDER_PROOF_ENABLE_UNDO",
    "PATHFINDER_PROOF_ENABLE_LIFT_WRITES"
  ]) {
    assert.throws(() => validateProofDeployment({ ...qaEnvironment, [flag]: "true" }), new RegExp(flag));
  }
});

test("requires an explicit second production exposure approval", () => {
  const production = {
    ...qaEnvironment,
    PATHFINDER_PROOF_ENVIRONMENT_NAME: "prod",
    PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "prod",
    PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
    PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
    PATHFINDER_PROOF_EDGE_SHARED_SECRET: "x".repeat(32),
    PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true"
  };
  assert.throws(() => validateProofDeployment(production), /PRODUCTION_PUBLIC_READ_APPROVED/);
  assert.equal(
    validateProofDeployment({ ...production, PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED: "true" }).public_read_enabled,
    true
  );
});

test("requires the Proof alias and us-east-1 certificate to be supplied together", () => {
  assert.throws(
    () => validateProofDeployment({ ...qaEnvironment, PATHFINDER_PROOF_DOMAIN_NAME: "proof-qa.vornan.co" }),
    /must be supplied together/
  );
  assert.throws(
    () => validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_DOMAIN_NAME: "proof-qa.vornan.co",
      PATHFINDER_PROOF_CERTIFICATE_ARN: "arn:aws:acm:us-west-2:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }),
    /us-east-1/
  );

  const result = validateProofDeployment({
    ...qaEnvironment,
    PATHFINDER_PROOF_DOMAIN_NAME: "proof-qa.vornan.co",
    PATHFINDER_PROOF_CERTIFICATE_ARN: "arn:aws:acm:us-east-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  });
  assert.equal(result.proof_alias_configured, true);
  assert.equal(result.proof_domain, "proof-qa.vornan.co");
});

test("reserves proof.vornan.co as the canonical production alias", () => {
  assert.throws(
    () => validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_ENVIRONMENT_NAME: "prod",
      PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "prod",
      PATHFINDER_PROOF_DOMAIN_NAME: "proof-prod.vornan.co",
      PATHFINDER_PROOF_CERTIFICATE_ARN: "arn:aws:acm:us-east-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }),
    /proof\.vornan\.co/
  );
});

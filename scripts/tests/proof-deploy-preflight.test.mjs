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
  PATHFINDER_PROOF_EDGE_SHARED_SECRET: "x".repeat(32),
  PATHFINDER_PROOF_CUSTOMER_WORKSPACES_TABLE: "Pathfinder-CustomerWorkspaces-prod",
  PATHFINDER_PROOF_CUSTOMER_WORKSPACES_TABLE_ARN:
    "arn:aws:dynamodb:us-east-1:744016783602:table/Pathfinder-CustomerWorkspaces-prod"
};

test("accepts an isolated default-off QA deployment", () => {
  const result = validateProofDeployment(qaEnvironment);
  assert.equal(result.environment_name, "qa");
  assert.equal(result.public_read_enabled, false);
  assert.equal(result.automatic_refresh_max_inactive_days, 14);
  assert.equal(result.lift_writes_enabled, false);
  assert.equal(result.synthetic_qa_enabled, false);
  assert.equal(result.operator_grant_creation_enabled, false);
  assert.equal(result.operator_cohort_size, 0);
  assert.equal(result.shared_access_enabled, false);
});

test("keeps delegated Proof sharing default-off and requires a customer session boundary", () => {
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  assert.match(template, /SharedAccessEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /SharedAccessRequiresPublicSession:[\s\S]*?!Ref PublicReadEnabled[\s\S]*?!Ref LtlDemoQaSessionReadEnabled/
  );
  assert.throws(
    () => validateProofDeployment({ ...qaEnvironment, PATHFINDER_PROOF_ENABLE_SHARED_ACCESS: "true" }),
    /requires an enabled customer Proof session boundary/
  );
  assert.equal(
    validateProofDeployment({
      ...qaEnvironment,
      PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
      PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
      PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true",
      PATHFINDER_PROOF_ENABLE_SHARED_ACCESS: "true"
    }).shared_access_enabled,
    true
  );
});

test("accepts only a bounded IAM operator window on the dark dev stack", () => {
  const devWindow = {
    ...qaEnvironment,
    PATHFINDER_PROOF_ENVIRONMENT_NAME: "dev",
    PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "dev",
    PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
    PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
    PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true",
    PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED: "true",
    PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: "1249",
    PATHFINDER_PROOF_PUBLIC_BASE_URL: "https://dpib8f02ljvrd.cloudfront.net"
  };
  const result = validateProofDeployment(devWindow);
  assert.equal(result.operator_grant_creation_enabled, true);
  assert.equal(result.operator_cohort_size, 1);
  assert.equal(result.operator_public_base_url, "https://dpib8f02ljvrd.cloudfront.net");

  for (const unsafe of [
    { PATHFINDER_PROOF_ENVIRONMENT_NAME: "qa", PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "qa" },
    { PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "false" },
    { PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "false" },
    { PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED: "true" },
    { PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA: "true" },
    { PATHFINDER_PROOF_ENABLE_LINK_EMAIL: "true" },
    { PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: "" },
    { PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: "1249, 91" },
    { PATHFINDER_PROOF_PUBLIC_BASE_URL: "https://proof.invalid" },
    { PATHFINDER_PROOF_PUBLIC_BASE_URL: "https://proof.vornan.co" },
    {
      PATHFINDER_PROOF_DOMAIN_NAME: "proof-dev.vornan.co",
      PATHFINDER_PROOF_CERTIFICATE_ARN:
        "arn:aws:acm:us-east-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }
  ]) {
    assert.throws(() => validateProofDeployment({ ...devWindow, ...unsafe }));
  }
});

test("requires exact target, transaction, and secret bindings before customer approval", () => {
  const approvalWindow = {
    ...qaEnvironment,
    PATHFINDER_PROOF_ENVIRONMENT_NAME: "dev",
    PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "dev",
    PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
    PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
    PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true",
    PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED: "false",
    PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: "1249",
    PATHFINDER_PROOF_DOMAIN_NAME: "proof.vornan.co",
    PATHFINDER_PROOF_CERTIFICATE_ARN:
      "arn:aws:acm:us-east-1:744016783602:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS: "true",
    PATHFINDER_PROOF_TARGETS_TABLE: "Pathfinder-Targets-prod",
    PATHFINDER_PROOF_TARGETS_TABLE_ARN:
      "arn:aws:dynamodb:us-east-1:744016783602:table/Pathfinder-Targets-prod",
    PATHFINDER_PROOFING_API_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:744016783602:secret:/vornan/pathfinder/targets/lift-standard-graphics-AbCdEf",
    PATHFINDER_SECRET_PREFIX: "/vornan/pathfinder/"
  };
  assert.equal(validateProofDeployment(approvalWindow).customer_approval_enabled, true);
  assert.equal(validateProofDeployment(approvalWindow).operator_grant_creation_enabled, false);
  for (const missing of [
    "PATHFINDER_PROOF_TARGETS_TABLE",
    "PATHFINDER_PROOF_TARGETS_TABLE_ARN",
    "PATHFINDER_PROOFING_API_SECRET_ARN",
    "PATHFINDER_SECRET_PREFIX"
  ]) {
    assert.throws(() => validateProofDeployment({ ...approvalWindow, [missing]: "" }), new RegExp(missing));
  }
  assert.throws(
    () => validateProofDeployment({
      ...approvalWindow,
      PATHFINDER_PROOF_TARGETS_TABLE_ARN:
        "arn:aws:dynamodb:us-east-1:744016783602:table/Some-Other-Table"
    }),
    /target table exactly/
  );
  assert.equal(validateProofDeployment({
    ...approvalWindow,
    PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: ""
  }).customer_approval_enabled, true);
});

test("keeps isolated customer approval default-off and least-privileged", () => {
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  assert.match(template, /CustomerApprovalEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /CustomerApprovalRequiresExactRuntimeBindings:/);
  assert.doesNotMatch(
    template,
    /CustomerApprovalRequiresExactRuntimeBindings:[\s\S]*?Customer approval requires the bounded review-grant window/
  );
  assert.match(
    template,
    /CustomerRuntimeActive[\s\S]*?Action: dynamodb:GetItem[\s\S]*?Resource: !Ref PathfinderTargetsTableArn/
  );
  assert.match(
    template,
    /CustomerRuntimeActive[\s\S]*?Action: dynamodb:GetItem[\s\S]*?Resource: !GetAtt ProofAuditTable.Arn/
  );
  assert.match(
    template,
    /CustomerRuntimeActive[\s\S]*?Action: dynamodb:TransactWriteItems[\s\S]*?!GetAtt ProofCoreTable.Arn[\s\S]*?!GetAtt ProofAuditTable.Arn/
  );
  assert.match(
    template,
    /CustomerRuntimeActive[\s\S]*?Action: secretsmanager:GetSecretValue[\s\S]*?Resource: !Ref ProofingApiSecretArn/
  );
  const publicRole = template.slice(
    template.indexOf("  ProofPublicLambdaRole:"),
    template.indexOf("  ProofSyncLambdaRole:")
  );
  assert.doesNotMatch(publicRole, /dynamodb:Scan/);
  assert.equal((publicRole.match(/PathfinderTargetsTableArn/g) ?? []).length, 1);
  assert.match(publicRole, /Action: dynamodb:GetItem\n\s+Resource: !Ref PathfinderTargetsTableArn/);
  assert.match(publicRole, /CustomerRuntimeActive[\s\S]*?Action: dynamodb:GetItem\n\s+Resource: !GetAtt ProofAuditTable.Arn/);
  assert.match(publicRole, /ignore_checks:\n\s+- W3037/);
  assert.doesNotMatch(publicRole, /secretsmanager:\*|Resource: "\*"/);
});

test("requires exact private asset bindings before customer revised-art upload", () => {
  const revisionWindow = {
    ...qaEnvironment,
    PATHFINDER_PROOF_ENVIRONMENT_NAME: "dev",
    PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "dev",
    PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
    PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
    PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true",
    PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: "1249",
    PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_UPLOADS: "true",
    PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD: "true",
    PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS: "A0226753",
    PATHFINDER_PROOF_ASSET_UPLOAD_EXPIRES_AT: "2099-07-28T21:49:50.000Z",
    PATHFINDER_PROOF_ASSET_BUCKET: "vornan-pathfinder-proof-assets-dev-744016783602",
    PATHFINDER_PROOF_ASSET_BUCKET_ARN: "arn:aws:s3:::vornan-pathfinder-proof-assets-dev-744016783602",
    PATHFINDER_PROOF_TARGETS_TABLE: "Pathfinder-Targets-prod",
    PATHFINDER_PROOF_TARGETS_TABLE_ARN:
      "arn:aws:dynamodb:us-east-1:744016783602:table/Pathfinder-Targets-prod",
    PATHFINDER_PROOFING_API_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:744016783602:secret:/vornan/pathfinder/targets/lift-standard-graphics-AbCdEf",
    PATHFINDER_SECRET_PREFIX: "/vornan/pathfinder/"
  };
  const result = validateProofDeployment(revisionWindow);
  assert.equal(result.customer_revision_upload_enabled, true);
  assert.equal(result.proof_asset_upload_enabled, true);
  assert.equal(result.customer_approval_enabled, false);

  for (const unsafe of [
    { PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD: "false" },
    { PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_UPLOADS: "false" },
    { PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "false" },
    { PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS: "" },
    { PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS: "A0226753, A0227641" },
    { PATHFINDER_PROOF_ASSET_UPLOAD_EXPIRES_AT: "2099-07-28T21:49:51.000Z" },
    { PATHFINDER_PROOF_ASSET_BUCKET: "some-other-bucket" },
    { PATHFINDER_PROOF_ASSET_BUCKET_ARN: "arn:aws:s3:::some-other-bucket" }
  ]) {
    assert.throws(() => validateProofDeployment({ ...revisionWindow, ...unsafe }));
  }
});

test("keeps customer revised-art upload default-off and exact-bucket scoped", () => {
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  assert.match(template, /CustomerRevisionUploadEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofAssetUploadEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /CustomerRevisionUploadRequiresExactRuntimeBindings:/);
  assert.match(
    template,
    /PATHFINDER_PROOF_CUSTOMER_REVIEW_SCOPE:[\s\S]*?!Ref PublicReadEnabled[\s\S]*?!Ref CustomerApprovalEnabled[\s\S]*?!Ref CustomerRevisionUploadEnabled/
  );
  const publicRole = template.slice(
    template.indexOf("  ProofPublicLambdaRole:"),
    template.indexOf("  ProofSyncLambdaRole:")
  );
  assert.match(
    publicRole,
    /CustomerRevisionUploadActive[\s\S]*?- s3:GetObject[\s\S]*?- s3:GetObjectTagging[\s\S]*?- s3:GetObjectVersionTagging[\s\S]*?- s3:PutObject[\s\S]*?- s3:PutObjectTagging[\s\S]*?ProofAssetBucketArn, "\/orders\/\*"/
  );
  assert.doesNotMatch(publicRole, /s3:DeleteObject|s3:\*|arn:aws:s3:::\*/);
});

test("allows browser uploads only to the exact private asset bucket during the bounded revision window", () => {
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  const webHeaders = template.slice(
    template.indexOf("  ProofWebResponseHeadersPolicy:"),
    template.indexOf("  ProofApiResponseHeadersPolicy:")
  );
  assert.match(
    webHeaders,
    /ContentSecurityPolicy: !If\s+- CustomerRevisionUploadActive\s+- !Sub "default-src 'self'; connect-src 'self' https:\/\/\$\{ProofAssetBucketName\}\.s3\.\$\{AWS::Region\}\.amazonaws\.com;/
  );
  assert.match(
    webHeaders,
    /- "default-src 'self'; connect-src 'self'; font-src 'self';/
  );
  assert.doesNotMatch(webHeaders, /connect-src 'self' https:\s*;/);
  assert.doesNotMatch(webHeaders, /connect-src 'self' \*;/);
});

test("allows framing only for the session-bound Detailed Report viewer route", () => {
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  const viewerHeaders = template.slice(
    template.indexOf("  ProofDetailedReportViewerResponseHeadersPolicy:"),
    template.indexOf("  ProofSpaRewriteFunction:")
  );
  assert.match(viewerHeaders, /frame-ancestors 'self'/);
  assert.doesNotMatch(viewerHeaders, /FrameOptions:/);
  const behaviors = template.slice(
    template.indexOf("        CacheBehaviors:"),
    template.indexOf("        ViewerCertificate:")
  );
  assert.match(
    behaviors,
    /PathPattern: "\/api\/public\/proof\/detailed-reports\/\*\/view"[\s\S]*?ResponseHeadersPolicyId: !Ref ProofDetailedReportViewerResponseHeadersPolicy[\s\S]*?PathPattern: "\/api\/public\/proof\/\*"/
  );
});

test("accepts only the bounded allowlisted LTL Demo QA profile", () => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const profile = {
    ...qaEnvironment,
    PATHFINDER_PROOF_ENVIRONMENT_NAME: "dev",
    PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "dev",
    PATHFINDER_PROOF_LTL_DEMO_QA_ENABLED: "true",
    PATHFINDER_PROOF_LTL_DEMO_QA_ALLOWED_ORDERS: "A0226753,A0227641",
    PATHFINDER_PROOF_LTL_DEMO_QA_EXPIRES_AT: expiresAt,
    PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED: "true",
    PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED: "true",
    PATHFINDER_PROOF_TARGETS_TABLE: "Pathfinder-Targets-prod",
    PATHFINDER_PROOF_TARGETS_TABLE_ARN:
      "arn:aws:dynamodb:us-east-1:744016783602:table/Pathfinder-Targets-prod",
    PATHFINDER_PROOFING_API_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:744016783602:secret:/vornan/pathfinder/targets/lift-standard-graphics-AbCdEf",
    PATHFINDER_SECRET_PREFIX: "/vornan/pathfinder/",
    PATHFINDER_PROOF_ASSET_BUCKET:
      "vornan-pathfinder-proof-assets-dev-744016783602",
    PATHFINDER_PROOF_ASSET_BUCKET_ARN:
      "arn:aws:s3:::vornan-pathfinder-proof-assets-dev-744016783602"
  };
  const result = validateProofDeployment(profile);
  assert.equal(result.ltl_demo_qa_enabled, true);
  assert.equal(result.ltl_demo_qa_customer_id, "1249");
  assert.deepEqual(result.ltl_demo_qa_allowed_orders, ["A0226753", "A0227641"]);
  assert.equal(result.ltl_demo_qa_session_ttl_minutes, 720);
  assert.equal(result.customer_approval_enabled, true);
  assert.equal(result.customer_revision_upload_enabled, true);
  assert.equal(result.proof_asset_upload_enabled, true);
  assert.equal(result.lift_writes_enabled, false);

  for (const unsafe of [
    { PATHFINDER_PROOF_LTL_DEMO_QA_ALLOWED_ORDERS: "" },
    { PATHFINDER_PROOF_LTL_DEMO_QA_EXPIRES_AT: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString() },
    { PATHFINDER_PROOF_ENVIRONMENT_NAME: "qa", PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT: "qa" },
    { PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true" },
    { PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS: "true" },
    { PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD: "true" },
    { PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED: "true" },
    { PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED: "true" }
  ]) {
    assert.throws(() => validateProofDeployment({ ...profile, ...unsafe }));
  }
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

test("retains and deletion-protects both durable Proof tables", () => {
  const template = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  const resources = [
    template.slice(template.indexOf("  ProofCoreTable:"), template.indexOf("  ProofAuditTable:")),
    template.slice(template.indexOf("  ProofAuditTable:"), template.indexOf("  ProofSyncDeadLetterQueue:"))
  ];
  for (const resource of resources) {
    assert.match(resource, /DeletionPolicy: Retain/);
    assert.match(resource, /UpdateReplacePolicy: Retain/);
    assert.match(resource, /DeletionProtectionEnabled: true/);
    assert.match(resource, /PointInTimeRecoveryEnabled: true/);
  }
});

test("requires bounded activation and durable customer policy bindings in deployment contracts", () => {
  const proofTemplate = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  const apiTemplate = readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8");
  const proofWorkflow = readFileSync(new URL("../../.github/workflows/deploy-proof.yml", import.meta.url), "utf8");
  const apiWorkflow = readFileSync(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
  assert.match(proofTemplate, /ReadOnlyActivationExpiresAt:/);
  assert.match(proofTemplate, /PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: !Ref ReadOnlyActivationExpiresAt/);
  assert.match(proofTemplate, /OperatorGrantCreationRequiresIsolatedDevWindow:/);
  assert.match(proofTemplate, /PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: !Ref GrantAllowedCustomerIds/);
  assert.match(apiTemplate, /ProofGrantCreationRequiresBoundedWindow:/);
  assert.match(apiTemplate, /PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS: !Ref ProofGrantAllowedCustomerIds/);
  assert.match(apiTemplate, /PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: !Ref ProofReadOnlyActivationExpiresAt/);
  assert.match(proofWorkflow, /ReadOnlyActivationExpiresAt="\$\{READ_ONLY_ACTIVATION_EXPIRES_AT\}"/);
  assert.match(proofWorkflow, /OperatorGrantCreationEnabled="\$\{OPERATOR_GRANT_CREATION_ENABLED\}"/);
  assert.match(proofWorkflow, /GrantAllowedCustomerIds="\$\{GRANT_ALLOWED_CUSTOMER_IDS\}"/);
  assert.match(proofTemplate, /PathfinderCustomerWorkspacesTableName:/);
  assert.match(proofTemplate, /Resource: !Ref PathfinderCustomerWorkspacesTableArn/);
  assert.match(proofWorkflow, /PathfinderCustomerWorkspacesTableName="\$\{PATHFINDER_CUSTOMER_WORKSPACES_TABLE\}"/);
  assert.match(apiWorkflow, /ProofGrantAllowedCustomerIds=/);
  assert.match(apiWorkflow, /ProofReadOnlyActivationExpiresAt=/);
});

test("packages an IAM-only operator without a public invocation surface", () => {
  const proofTemplate = readFileSync(new URL("../../infra/aws/proof-cloudformation.yaml", import.meta.url), "utf8");
  const buildScript = readFileSync(new URL("../build-proof-public-lambda.mjs", import.meta.url), "utf8");
  assert.match(buildScript, /operator-lambda\.mjs/);
  assert.match(buildScript, /apps\/api\/src\/proof-operator-lambda\.ts/);
  assert.match(proofTemplate, /Handler: operator-lambda\.handler/);
  assert.match(proofTemplate, /PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED: !Ref OperatorGrantCreationEnabled/);
  assert.match(proofTemplate, /PATHFINDER_PROOF_ENABLE_LINK_EMAIL: "false"/);
  assert.match(proofTemplate, /"Service", "operator-admin"/);
  assert.doesNotMatch(proofTemplate, /IntegrationUri: !GetAtt ProofOperatorFunction\.Arn/);
  assert.doesNotMatch(
    proofTemplate,
    /FunctionName: !Ref ProofOperatorFunction\n\s+Principal: apigateway\.amazonaws\.com/
  );
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateProofAssetDeployment } from "../proof-asset-deploy-preflight.mjs";

const template = readFileSync(
  new URL("../../infra/aws/proof-assets-cloudformation.yaml", import.meta.url),
  "utf8"
);
const deployScript = readFileSync(new URL("../deploy-proof-assets-stack.sh", import.meta.url), "utf8");
const deployScriptPath = fileURLToPath(new URL("../deploy-proof-assets-stack.sh", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function runDeployScriptWithStackLookup({ awsOutput, awsStatus, npmStatus = 23 }) {
  const fakeBin = mkdtempSync(join(tmpdir(), "proof-asset-deploy-test-"));
  const npmMarker = join(fakeBin, "npm-called");
  try {
    const awsPath = join(fakeBin, "aws");
    const npmPath = join(fakeBin, "npm");
    writeFileSync(awsPath, `#!/bin/sh\nprintf '%s\\n' "${awsOutput}" >&2\nexit ${awsStatus}\n`);
    writeFileSync(npmPath, `#!/bin/sh\ntouch "${npmMarker}"\nexit ${npmStatus}\n`);
    chmodSync(awsPath, 0o700);
    chmodSync(npmPath, 0o700);

    const result = spawnSync("bash", [deployScriptPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        AWS_ACCOUNT_ID: "744016783602",
        PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME: "dev"
      }
    });
    return { result, npmCalled: existsSync(npmMarker) };
  } finally {
    rmSync(fakeBin, { force: true, recursive: true });
  }
}

test("accepts only the default-dark Proof asset foundation", () => {
  const result = validateProofAssetDeployment({
    PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME: "dev",
    AWS_ACCOUNT_ID: "744016783602"
  });
  assert.deepEqual(result, {
    environment_name: "dev",
    stack_name: "vornan-proof-assets-dev",
    bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602",
    wrike_delivery_bucket_name: "vornan-pathfinder-wrike-delivery-dev-744016783602",
    retained_source_cleanup_eligibility_days: 90,
    outbound_copy_days: 14,
    proof_packet_days: 30,
    unfinalized_upload_days: 7,
    incomplete_multipart_days: 1,
    alias_configured: false,
    upload_capability_enabled: false,
    signed_delivery_enabled: false,
    lift_publication_enabled: false,
    external_repository_ingest_enabled: false,
    wrike_document_delivery_enabled: false,
    guardduty_malware_protection_enabled: false,
    guardduty_protected_prefix: null,
    guardduty_result_tagging_enabled: false
  });
});

test("keeps GuardDuty malware protection default-dark and exact-prefix scoped", () => {
  const enabledResult = validateProofAssetDeployment({
    PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME: "dev",
    AWS_ACCOUNT_ID: "744016783602",
    PATHFINDER_PROOF_ASSET_MALWARE_PROTECTION_ENABLED: "true"
  });
  assert.equal(enabledResult.guardduty_malware_protection_enabled, true);
  assert.equal(enabledResult.guardduty_protected_prefix, "orders/");
  assert.equal(enabledResult.guardduty_result_tagging_enabled, true);

  assert.match(template, /ProofAssetMalwareProtectionEnabled:\n\s+Type: String\n\s+Default: "false"/);
  assert.match(template, /MalwareProtectionDevOnly:[\s\S]*Ref: ProofAssetMalwareProtectionEnabled[\s\S]*Ref: EnvironmentName[\s\S]*- dev/);
  assert.match(template, /Type: AWS::GuardDuty::MalwareProtectionPlan/);
  assert.match(template, /Condition: GuardDutyMalwareProtectionActive/);
  assert.match(template, /ObjectPrefixes:\n\s+- orders\//);
  assert.match(template, /Tagging:\n\s+Status: ENABLED/);
  assert.match(template, /ProofAssetMalwareProtectionEnabled:\n\s+Value: !If \[GuardDutyMalwareProtectionActive, "true", "false"\]/);
  assert.match(template, /GuardDutyMalwareProtectionPlanStatus:[\s\S]*DISABLED/);
  assert.match(template, /GuardDutyMalwareProtectionRoleArn:/);
  assert.match(template, /Resource: !Sub \$\{ProofAssetBucket\.Arn\}\/orders\/\*/);
  assert.doesNotMatch(template, /Resource: !Sub \$\{WrikeDocumentDeliveryBucket\.Arn\}\/orders\/\*/);
  assert.throws(() => validateProofAssetDeployment({
    PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME: "prod",
    AWS_ACCOUNT_ID: "744016783602",
    PATHFINDER_PROOF_ASSET_MALWARE_PROTECTION_ENABLED: "true"
  }), /only in dev/);
});

test("grants the GuardDuty service role only the documented exact-bucket boundary", () => {
  assert.match(template, /Service: malware-protection-plan\.guardduty\.amazonaws\.com/);
  for (const action of [
    "events:PutRule",
    "events:DeleteRule",
    "events:PutTargets",
    "events:RemoveTargets",
    "events:DescribeRule",
    "events:ListTargetsByRule",
    "s3:PutObjectTagging",
    "s3:GetObjectTagging",
    "s3:PutObjectVersionTagging",
    "s3:GetObjectVersionTagging",
    "s3:PutBucketNotification",
    "s3:GetBucketNotification",
    "s3:PutObject",
    "s3:ListBucket",
    "s3:GetObject",
    "s3:GetObjectVersion"
  ]) {
    assert.match(template, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(template, /DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3\*/);
  assert.match(template, /events:ManagedBy: malware-protection-plan\.guardduty\.amazonaws\.com/);
  assert.match(template, /malware-protection-resource-validation-object/);
  assert.match(
    template,
    /Sid: AllowCheckBucketOwnership\n\s+Effect: Allow\n\s+Action: s3:ListBucket\n\s+Resource: !GetAtt ProofAssetBucket\.Arn\n\s+- Sid: AllowMalwareScan/
  );
  assert.doesNotMatch(template, /kms:Decrypt|kms:GenerateDataKey|s3:DeleteObject/);
  assert.equal((template.match(/Type: AWS::IAM::Role/g) ?? []).length, 1);
});

test("rejects DNS, certificate, and every capability flag", () => {
  for (const unsafe of [
    { PATHFINDER_PROOF_ASSET_DOMAIN_NAME: "go.vornan.co" },
    {
      PATHFINDER_PROOF_ASSET_CERTIFICATE_ARN:
        "arn:aws:acm:us-east-1:744016783602:certificate/bee3ed71-24fa-436a-bacc-ad27f7069b0f"
    },
    { PATHFINDER_PROOF_ASSET_ENABLE_UPLOADS: "true" },
    { PATHFINDER_PROOF_ASSET_ENABLE_PUBLIC_DELIVERY: "true" },
    { PATHFINDER_PROOF_ASSET_ENABLE_SIGNED_URLS: "true" },
    { PATHFINDER_PROOF_ASSET_ENABLE_LIFT_PUBLICATION: "true" },
    { PATHFINDER_PROOF_ASSET_ENABLE_EXTERNAL_INGEST: "true" },
    { PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION: "true" }
  ]) {
    assert.throws(() => validateProofAssetDeployment({
      PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME: "dev",
      AWS_ACCOUNT_ID: "744016783602",
      ...unsafe
    }));
  }
});

test("pins the lifecycle windows without unconditional retained-source deletion", () => {
  for (const unsafe of [
    { PATHFINDER_PROOF_ASSET_RETAINED_SOURCE_DAYS: "59" },
    { PATHFINDER_PROOF_ASSET_RETAINED_SOURCE_DAYS: "91" },
    { PATHFINDER_PROOF_ASSET_OUTBOUND_DAYS: "15" },
    { PATHFINDER_PROOF_ASSET_PACKET_DAYS: "29" },
    { PATHFINDER_PROOF_ASSET_UNFINALIZED_DAYS: "6" },
    { PATHFINDER_PROOF_ASSET_UNFINALIZED_DAYS: "8" },
    { PATHFINDER_PROOF_ASSET_INCOMPLETE_MULTIPART_DAYS: "2" }
  ]) {
    assert.throws(() => validateProofAssetDeployment({
      PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME: "dev",
      AWS_ACCOUNT_ID: "744016783602",
      ...unsafe
    }));
  }
  assert.match(template, /Value: lift-outbound[\s\S]*ExpirationInDays: !Ref OutboundCopyDays/);
  assert.match(template, /Value: proof-packet[\s\S]*ExpirationInDays: !Ref ProofPacketDays/);
  assert.doesNotMatch(template, /Value: retained-source/);
});

test("provisions a retained private encrypted versioned object-lock bucket", () => {
  assert.match(template, /DeletionPolicy: Retain/);
  assert.match(template, /UpdateReplacePolicy: Retain/);
  assert.match(template, /SSEAlgorithm: AES256/);
  assert.match(template, /VersioningConfiguration:\n\s+Status: Enabled/);
  assert.match(template, /ObjectLockEnabled: true/);
  assert.match(template, /ObjectOwnership: BucketOwnerEnforced/);
  for (const property of ["BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"]) {
    assert.match(template, new RegExp(`${property}: true`));
  }
  assert.match(
    template,
    /CorsConfiguration:[\s\S]*?AllowedMethods:\n\s+- POST[\s\S]*?https:\/\/pathfinder\.vornan\.co[\s\S]*?x-amz-version-id[\s\S]*?x-amz-checksum-sha256[\s\S]*?MaxAge: 600/
  );
  assert.doesNotMatch(template, /AllowedMethods:[\s\S]{0,100}- (PUT|DELETE)/);
});

test("keeps Wrike Lift delivery in a separate retained private 14-day bucket", () => {
  assert.match(template, /WrikeDocumentDeliveryBucket:\n\s+Type: AWS::S3::Bucket/);
  assert.match(template, /Value: wrike-lift-delivery-only/);
  assert.match(template, /Id: ExpireWrikeLiftDocuments[\s\S]*Prefix: d\/[\s\S]*ExpirationInDays: !Ref OutboundCopyDays/);
  assert.doesNotMatch(template, /Prefix: manifests\//);
  assert.match(template, /PathPattern: d\/\*/);
  assert.match(template, /WrikeDocumentDeliveryEnabled:\n\s+Value: !If \[WrikeDocumentDeliveryActive, "true", "false"\]/);
  assert.match(
    template,
    /Once\n\s+an immutable URL has been issued, keep this enabled until every issued\n\s+document has expired or been explicitly retired/
  );
});

test("keeps delivery fail-closed and grants only the exact distribution read access", () => {
  assert.match(template, /Type: AWS::CloudFront::OriginAccessControl/);
  assert.match(template, /SigningBehavior: always/);
  assert.match(template, /CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad/);
  assert.match(template, /statusCode: 404/);
  assert.match(template, /EventType: viewer-request/);
  assert.match(template, /Sid: AllowExactCloudFrontDistributionRead/);
  assert.match(template, /Action:\n\s+- s3:GetObject/);
  assert.match(
    template,
    /AWS:SourceArn: !Sub arn:\$\{AWS::Partition\}:cloudfront::\$\{AWS::AccountId\}:distribution\/\$\{ProofAssetDistribution\}/
  );
  assert.doesNotMatch(template, /s3:DeleteObject|AWS::Route53|AWS::Lambda|AWS::ApiGateway/);
});

test("the deployment script forces DNS and certificate parameters empty and verifies 404", () => {
  assert.match(deployScript, /existing_live_boundary="\$\{stack_lookup_result\}"/);
  assert.match(
    deployScript,
    /OutputKey=='WrikeDocumentDeliveryEnabled' \|\| OutputKey=='ProofAssetAliasConfigured' \|\| OutputKey=='ProofAssetMalwareProtectionEnabled'/
  );
  assert.match(deployScript, /Refusing to apply the dark-foundation deploy over active asset-stack capabilities/);
  assert.match(deployScript, /AssetDomainName=""/);
  assert.match(deployScript, /CertificateArn=""/);
  assert.match(deployScript, /WrikeDocumentDeliveryEnabled="false"/);
  assert.match(deployScript, /PATHFINDER_PROOF_ASSET_MALWARE_PROTECTION_ENABLED="false"/);
  assert.match(deployScript, /ProofAssetMalwareProtectionEnabled="false"/);
  assert.match(deployScript, /--capabilities CAPABILITY_IAM/);
  assert.match(deployScript, /a\/pre-activation-check/);
  assert.match(deployScript, /"\$\{status\}" != "404"/);
  assert.doesNotMatch(deployScript, /describe-stacks[\s\S]{0,500}\|\| true/);
  assert.doesNotMatch(deployScript, /aws route53|curl[^\n]*lifterp|proof\.vornan\.co|go\.vornan\.co/i);
});

test("the deployment script fails closed when the active-boundary lookup fails", () => {
  const { result, npmCalled } = runDeployScriptWithStackLookup({
    awsOutput: "AccessDenied: not authorized to describe this stack",
    awsStatus: 17
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to inspect the existing Proof asset stack; refusing the dark-foundation deploy/);
  assert.equal(npmCalled, false);
});

test("the deployment script treats only an explicitly missing stack as dark", () => {
  const { result, npmCalled } = runDeployScriptWithStackLookup({
    awsOutput: "ValidationError: Stack with id vornan-proof-assets-dev does not exist",
    awsStatus: 255
  });

  assert.equal(result.status, 23);
  assert.equal(npmCalled, true);
});

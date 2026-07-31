import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProofAssetDeployment } from "../proof-asset-deploy-preflight.mjs";

const template = readFileSync(
  new URL("../../infra/aws/proof-assets-cloudformation.yaml", import.meta.url),
  "utf8"
);
const deployScript = readFileSync(new URL("../deploy-proof-assets-stack.sh", import.meta.url), "utf8");

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
    wrike_document_delivery_enabled: false
  });
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
});

test("keeps Wrike Lift delivery in a separate retained private 14-day bucket", () => {
  assert.match(template, /WrikeDocumentDeliveryBucket:\n\s+Type: AWS::S3::Bucket/);
  assert.match(template, /Value: wrike-lift-delivery-only/);
  assert.match(template, /Id: ExpireWrikeLiftDocuments[\s\S]*Prefix: d\/[\s\S]*ExpirationInDays: !Ref OutboundCopyDays/);
  assert.doesNotMatch(template, /Prefix: manifests\//);
  assert.match(template, /PathPattern: d\/\*/);
  assert.match(template, /WrikeDocumentDeliveryEnabled:\n\s+Value: !If \[WrikeDocumentDeliveryActive, "true", "false"\]/);
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
  assert.doesNotMatch(template, /s3:PutObject|s3:DeleteObject|AWS::Route53|AWS::Lambda|AWS::ApiGateway|AWS::IAM::Role/);
});

test("the deployment script forces DNS and certificate parameters empty and verifies 404", () => {
  assert.match(deployScript, /AssetDomainName=""/);
  assert.match(deployScript, /CertificateArn=""/);
  assert.match(deployScript, /WrikeDocumentDeliveryEnabled="false"/);
  assert.match(deployScript, /a\/pre-activation-check/);
  assert.match(deployScript, /"\$\{status\}" != "404"/);
  assert.doesNotMatch(deployScript, /aws route53|curl[^\n]*lifterp|proof\.vornan\.co|go\.vornan\.co/i);
});

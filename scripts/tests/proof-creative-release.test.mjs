import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("creative approval activation is explicit and default-off in every deployment entrypoint", () => {
  const template = source("infra/aws/proof-cloudformation.yaml");
  assert.match(template, /CustomerAllocationEnabled:\s+Type: String\s+Default: "false"/);
  assert.match(template, /PATHFINDER_PROOF_ENABLE_CUSTOMER_ALLOCATIONS: !Ref CustomerAllocationEnabled/);
  assert.match(source("scripts/deploy-proof-stack.sh"), /CustomerAllocationEnabled="\$\{PATHFINDER_PROOF_ENABLE_CUSTOMER_ALLOCATIONS:-false\}"/);
  assert.match(source(".github/workflows/deploy-proof.yml"), /customer_allocation_enabled:[\s\S]*?default: "false"/);
  assert.match(source("apps/api/src/proof/customer-quantity-service.ts"), /review_experience !== "advanced"/);
});
test("larger creative payloads stay bounded to the new route and preserve the existing public JSON limit", () => {
  const server = source("apps/api/src/proof/public-server.ts");
  assert.match(server, /app.use\("\/api\/public\/proof\/approval-batches", express.json\(\{ limit: "16kb"/);
  assert.match(server, /app.use\(express.json\(\{ limit: "4kb"/);
});
test("allocation scope is empty by default and enforced in both API and advertised capability", () => {
  const template = source("infra/aws/proof-cloudformation.yaml");
  assert.match(template, /CustomerAllocationScope:\s+Type: String\s+Default: ""/);
  assert.match(template, /PATHFINDER_PROOF_CUSTOMER_ALLOCATION_SCOPE: !Ref CustomerAllocationScope/);
  assert.match(source("apps/api/src/proof/public-router.ts"), /customerAllocationScopeAllowed\(session\)/);
  assert.match(source("apps/api/src/proof/customer-quantity-service.ts"), /deps.scopeAllowed \?\? customerAllocationScopeAllowed/);
});
test("public release preserves worker artifacts and previous frontend assets", () => {
  const template = source("infra/aws/proof-cloudformation.yaml");
  const publicFunction = template.split("  ProofPublicFunction:")[1].split("  ProofSyncFunction:")[0];
  assert.match(publicFunction, /S3Key: !If \[HasPublicFunctionCodeOverride, !Ref PublicFunctionCodeS3Key, !Ref PublicLambdaCodeS3Key\]/);
  for (const name of ["ProofSyncFunction", "ProofOperatorFunction"]) {
    const section = template.split(`  ${name}:`)[1].split(/\n  [A-Za-z]+:/)[0];
    assert.match(section, /S3Key: !Ref PublicLambdaCodeS3Key/);
    assert.doesNotMatch(section, /PublicFunctionCodeS3Key/);
  }
  for (const path of ["scripts/deploy-proof-web.sh", ".github/workflows/deploy-proof.yml"]) assert.doesNotMatch(source(path), /--delete/);
  for (const path of ["scripts/deploy-proof-stack.sh", ".github/workflows/deploy-proof.yml"]) {
    assert.match(source(path), /PublicFunctionCodeS3Key=/);
    assert.match(source(path), /PublicLambdaCodeS3Key="\$\{worker_artifact_key\}"/);
  }
});

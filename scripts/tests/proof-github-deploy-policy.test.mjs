import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policyPath = new URL(
  "../../infra/aws/github-actions-proof-deploy-policy.json",
  import.meta.url,
);

test("allows the encrypted Proof bucket lifecycle without granting global S3 access", () => {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const bucketStatement = policy.Statement.find(
    (statement) => statement.Sid === "PublishProofArtifactsAndWeb",
  );

  assert.ok(bucketStatement);
  assert.equal(bucketStatement.Action.includes("s3:GetEncryptionConfiguration"), true);
  assert.equal(bucketStatement.Action.includes("s3:PutEncryptionConfiguration"), true);
  assert.equal(bucketStatement.Action.includes("s3:DeleteBucketPolicy"), true);
  assert.equal(bucketStatement.Action.includes("s3:*"), false);
  assert.deepEqual(bucketStatement.Resource, [
    "arn:aws:s3:::vornan-pathfinder-artifacts",
    "arn:aws:s3:::vornan-pathfinder-proof-*",
  ]);
});

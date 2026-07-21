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

test("covers the CloudFormation handlers used by the Proof stack without global service wildcards", () => {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const actionsByStatement = new Map(
    policy.Statement.map((statement) => [statement.Sid, statement.Action]),
  );
  const requiredActions = new Map([
    [
      "ManageProofComputeAndData",
      [
        "lambda:PutFunctionConcurrency",
        "lambda:TagResource",
        "lambda:UntagResource",
        "dynamodb:UntagResource",
        "sqs:GetQueueUrl",
      ],
    ],
    [
      "ManageProofObservability",
      [
        "cloudwatch:GetDashboard",
        "cloudwatch:TagResource",
        "cloudwatch:UntagResource",
        "logs:DeleteRetentionPolicy",
        "logs:UntagResource",
      ],
    ],
    [
      "ManageProofRoles",
      [
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy",
      ],
    ],
    [
      "ManageProofEdge",
      [
        "apigateway:TagResource",
        "apigateway:UntagResource",
        "cloudfront:UntagResource",
        "wafv2:UntagResource",
      ],
    ],
  ]);

  for (const [statementSid, required] of requiredActions) {
    const actual = actionsByStatement.get(statementSid);
    assert.ok(actual, `Missing ${statementSid}`);
    for (const action of required) {
      assert.equal(actual.includes(action), true, `${statementSid} must include ${action}`);
    }
  }

  const forbiddenGlobalActions = [
    "apigateway:*",
    "cloudfront:*",
    "cloudwatch:*",
    "dynamodb:*",
    "iam:*",
    "lambda:*",
    "logs:*",
    "sqs:*",
    "wafv2:*",
  ];
  const allActions = policy.Statement.flatMap((statement) => statement.Action);
  for (const action of forbiddenGlobalActions) {
    assert.equal(allActions.includes(action), false, `Policy must not grant ${action}`);
  }
});

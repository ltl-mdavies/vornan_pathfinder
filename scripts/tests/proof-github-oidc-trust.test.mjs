import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const trustPolicyPath = new URL(
  "../../infra/aws/github-actions-deploy-role-trust.json",
  import.meta.url,
);

test("trusts main and the protected Proof dev environment, but not Proof production", () => {
  const policy = JSON.parse(readFileSync(trustPolicyPath, "utf8"));
  const subject = policy.Statement?.[0]?.Condition?.StringEquals?.[
    "token.actions.githubusercontent.com:sub"
  ];

  assert.deepEqual(subject, [
    "repo:ltl-mdavies/vornan_pathfinder:ref:refs/heads/main",
    "repo:ltl-mdavies/vornan_pathfinder:environment:dev",
  ]);
  assert.equal(subject.includes("repo:ltl-mdavies/vornan_pathfinder:environment:prod"), false);
});

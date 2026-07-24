import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [template, workflow, deployPolicy] = await Promise.all([
  readFile(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"),
  readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8"),
  readFile(new URL("../../infra/aws/github-actions-api-deploy-policy.json", import.meta.url), "utf8")
]);

test("API stack persists every Lift submit runtime boundary", () => {
  assert.match(template, /ExternalLiftSubmitEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /LiftTransportMode:[\s\S]*?Default: dry_run/);
  assert.match(template, /AllowLiveCustomerSubmit:[\s\S]*?Default: "false"/);
  assert.match(template, /PATHFINDER_ENABLE_LIFT_SUBMIT: !Ref ExternalLiftSubmitEnabled/);
  assert.match(template, /PATHFINDER_LIFT_TRANSPORT_MODE: !Ref LiftTransportMode/);
  assert.match(template, /PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT: !Ref AllowLiveCustomerSubmit/);
});

test("production workflow enables only the certified sandbox-profile Lift lane by default", () => {
  assert.match(workflow, /enable_lift_submit:[\s\S]*?default: "true"/);
  assert.match(workflow, /lift_transport_mode:[\s\S]*?default: live/);
  assert.match(workflow, /allow_live_customer_submit:[\s\S]*?default: "false"/);
  assert.match(workflow, /ExternalLiftSubmitEnabled="\$\{\{ inputs\.enable_lift_submit \}\}"/);
  assert.match(workflow, /LiftTransportMode="\$\{\{ inputs\.lift_transport_mode \}\}"/);
  assert.match(workflow, /AllowLiveCustomerSubmit="\$\{\{ inputs\.allow_live_customer_submit \}\}"/);
});

test("Wrike workbook evidence remains disabled by default and uses a retained private bucket", () => {
  assert.match(template, /WrikeWorkbookEvidenceEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeEvidencePreviewEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_WORKBOOK_EVIDENCE: !Ref WrikeWorkbookEvidenceEnabled/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_EVIDENCE_PREVIEW: !Ref WrikeEvidencePreviewEnabled/
  );
  assert.match(template, /PathfinderSourceEvidenceBucket:[\s\S]*?DeletionPolicy: Retain/);
  assert.match(template, /PathfinderSourceEvidenceBucket:[\s\S]*?UpdateReplacePolicy: Retain/);
  assert.match(
    template,
    /BucketName: !Sub "vornan-pathfinder-source-evidence-\$\{EnvironmentName\}-\$\{AWS::AccountId\}"/
  );
  assert.match(template, /PathfinderSourceEvidenceBucket:[\s\S]*?BucketEncryption:/);
  assert.match(template, /PathfinderSourceEvidenceBucket:[\s\S]*?VersioningConfiguration:[\s\S]*?Status: Enabled/);
  assert.match(template, /PathfinderSourceEvidenceBucket:[\s\S]*?BlockPublicAcls: true/);
  assert.match(template, /Action:[\s\S]*?- s3:GetObject[\s\S]*?- s3:PutObject/);
  assert.doesNotMatch(template, /s3:DeleteObject/);
  assert.match(
    workflow,
    /WrikeWorkbookEvidenceEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_WORKBOOK_EVIDENCE \|\| 'false' \}\}"/
  );
  assert.match(
    workflow,
    /WrikeEvidencePreviewEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_EVIDENCE_PREVIEW \|\| 'false' \}\}"/
  );
  const parsedPolicy = JSON.parse(deployPolicy);
  const evidenceStatement = parsedPolicy.Statement.find(
    (statement) => statement.Sid === "ManagePathfinderSourceEvidenceBucket"
  );
  assert.deepEqual(evidenceStatement.Resource, "arn:aws:s3:::vornan-pathfinder-source-evidence-prod-744016783602");
  assert.equal(evidenceStatement.Action.includes("s3:CreateBucket"), true);
  assert.equal(evidenceStatement.Action.includes("s3:PutBucket*"), true);
  assert.equal(evidenceStatement.Action.includes("s3:PutObject"), false);
  assert.equal(evidenceStatement.Action.includes("s3:DeleteObject"), false);
});

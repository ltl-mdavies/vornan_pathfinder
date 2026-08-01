import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [template, workflow, deployScript, deployPolicy] = await Promise.all([
  readFile(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"),
  readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8"),
  readFile(new URL("../deploy-api-lambda.sh", import.meta.url), "utf8"),
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

test("Wrike custom-field metadata discovery has an independent fail-closed gate", () => {
  assert.match(template, /WrikeCustomFieldDiscoveryEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_CUSTOM_FIELD_DISCOVERY: !Ref WrikeCustomFieldDiscoveryEnabled/
  );
  assert.match(
    workflow,
    /WrikeCustomFieldDiscoveryEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_CUSTOM_FIELD_DISCOVERY \|\| 'false' \}\}"/
  );
});

test("Wrike workbook evidence remains disabled by default and uses a retained private bucket", () => {
  assert.match(template, /WrikeWorkbookEvidenceEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeEvidencePreviewEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeManualIntakeEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeOrderRehearsalEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeOrderRehearsalCustomerId:[\s\S]*?Default: ""/);
  assert.match(template, /WrikeOrderRehearsalImportMethodId:[\s\S]*?Default: ""/);
  assert.match(template, /WrikeOrderRehearsalTaskId:[\s\S]*?Default: ""/);
  assert.match(template, /WrikeOrderRehearsalExpiresAt:[\s\S]*?Default: ""/);
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_WORKBOOK_EVIDENCE: !Ref WrikeWorkbookEvidenceEnabled/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_EVIDENCE_PREVIEW: !Ref WrikeEvidencePreviewEnabled/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_MANUAL_INTAKE: !Ref WrikeManualIntakeEnabled/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL: !Ref WrikeOrderRehearsalEnabled/
  );
  assert.match(
    template,
    /PATHFINDER_WRIKE_ORDER_REHEARSAL_SCOPE: !Join[\s\S]*?- "\|"[\s\S]*?!Ref WrikeOrderRehearsalCustomerId[\s\S]*?!Ref WrikeOrderRehearsalImportMethodId[\s\S]*?!Ref WrikeOrderRehearsalTaskId[\s\S]*?!Ref WrikeOrderRehearsalExpiresAt/
  );
  assert.doesNotMatch(
    template,
    /PATHFINDER_WRIKE_ORDER_REHEARSAL_(?:CUSTOMER_ID|IMPORT_METHOD_ID|TASK_ID|EXPIRES_AT):/
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
  assert.match(
    workflow,
    /WrikeManualIntakeEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_MANUAL_INTAKE \|\| 'false' \}\}"/
  );
  assert.match(
    workflow,
    /WrikeOrderRehearsalEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL \|\| 'false' \}\}"/
  );
  assert.match(
    workflow,
    /WrikeOrderRehearsalCustomerId="\$\{\{ vars\.PATHFINDER_WRIKE_ORDER_REHEARSAL_CUSTOMER_ID \|\| '' \}\}"/
  );
  assert.match(
    workflow,
    /WrikeOrderRehearsalImportMethodId="\$\{\{ vars\.PATHFINDER_WRIKE_ORDER_REHEARSAL_IMPORT_METHOD_ID \|\| '' \}\}"/
  );
  assert.match(
    workflow,
    /WrikeOrderRehearsalTaskId="\$\{\{ vars\.PATHFINDER_WRIKE_ORDER_REHEARSAL_TASK_ID \|\| '' \}\}"/
  );
  assert.match(
    workflow,
    /WrikeOrderRehearsalExpiresAt="\$\{\{ vars\.PATHFINDER_WRIKE_ORDER_REHEARSAL_EXPIRES_AT \|\| '' \}\}"/
  );
  assert.match(
    deployScript,
    /WrikeOrderRehearsalEnabled="\$\{PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL:-false\}"/
  );
  assert.match(
    deployScript,
    /WrikeOrderRehearsalCustomerId="\$\{PATHFINDER_WRIKE_ORDER_REHEARSAL_CUSTOMER_ID:-\}"/
  );
  assert.match(
    deployScript,
    /WrikeOrderRehearsalImportMethodId="\$\{PATHFINDER_WRIKE_ORDER_REHEARSAL_IMPORT_METHOD_ID:-\}"/
  );
  assert.match(
    deployScript,
    /WrikeOrderRehearsalTaskId="\$\{PATHFINDER_WRIKE_ORDER_REHEARSAL_TASK_ID:-\}"/
  );
  assert.match(
    deployScript,
    /WrikeOrderRehearsalExpiresAt="\$\{PATHFINDER_WRIKE_ORDER_REHEARSAL_EXPIRES_AT:-\}"/
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

test("Wrike Lift document publication is independently dark and scoped to its dedicated bucket", () => {
  assert.match(template, /WrikeLiftDocumentPublicationEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeLiftDocumentDeliveryBucketName:[\s\S]*?Default: ""/);
  assert.match(template, /WrikeLiftDocumentDeliveryBaseUrl:[\s\S]*?Default: ""/);
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION: !Ref WrikeLiftDocumentPublicationEnabled/
  );
  assert.match(
    template,
    /arn:\$\{AWS::Partition\}:s3:::\$\{WrikeLiftDocumentDeliveryBucketName\}\/d\/\*/
  );
  assert.match(template, /\$\{PathfinderSourceEvidenceBucket\.Arn\}\/wrike\/\*/);
  assert.match(
    workflow,
    /WrikeLiftDocumentPublicationEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION \|\| 'false' \}\}"/
  );
  assert.doesNotMatch(template, /WrikeLiftDocumentDeliveryBucketName[\s\S]{0,400}s3:DeleteObject/);
});

test("operator-only Proof action QA remains independently dark and narrowly scoped by default", () => {
  assert.match(template, /ProofOperatorActionQaEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofOperatorActionAllowedOrders:[\s\S]*?Default: ""/);
  assert.match(
    template,
    /ProofOperatorActionExpiresAt:[\s\S]*?Default: ""[\s\S]*?AllowedPattern: "\^\$\|\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T\[0-9\]\{2\}:\[0-9\]\{2\}:\[0-9\]\{2\}\(\\\\\.\[0-9\]\{3\}\)\?Z\$"/
  );
  assert.match(
    template,
    /ProofOperatorActionRequiresDurableIsolation:\n\s+RuleCondition: !Equals \[!Ref ProofOperatorActionQaEnabled, "true"\][\s\S]*?!Ref ProofCoreTableName[\s\S]*?!Ref ProofCoreTableArn[\s\S]*?!Ref ProofAuditTableName[\s\S]*?!Ref ProofAuditTableArn/
  );
  assert.match(
    template,
    /ProofOperatorActionRequiresDurableIsolation:[\s\S]*?!Ref ProofOperatorActionAllowedOrders[\s\S]*?!Ref ProofOperatorActionExpiresAt/
  );
  assert.match(
    template,
    /ProofOperatorActionRequiresDurableIsolation:[\s\S]*?!Equals \[!Ref ProofGrantCreationEnabled, "false"\][\s\S]*?!Equals \[!Ref ProofLinkEmailEnabled, "false"\]/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA: !Ref ProofOperatorActionQaEnabled/
  );
  assert.match(
    template,
    /PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS: !Ref ProofOperatorActionAllowedOrders/
  );
  assert.match(
    template,
    /PATHFINDER_PROOF_OPERATOR_ACTION_EXPIRES_AT: !Ref ProofOperatorActionExpiresAt/
  );
  assert.match(
    workflow,
    /ProofOperatorActionQaEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA \|\| 'false' \}\}"/
  );
  assert.match(
    template,
    /HasProofTables: !And[\s\S]*?!Condition HasProofCoreTable[\s\S]*?!Condition HasProofAuditTable/
  );
  const transactionActions = template.match(/dynamodb:TransactWriteItems/g) ?? [];
  assert.equal(transactionActions.length, 2);
  assert.match(
    template,
    /- !If\n\s+- HasProofTables\n\s+- Effect: Allow\n\s+Action:\n\s+- dynamodb:TransactWriteItems\n\s+Resource:\n\s+- !Ref ProofCoreTableArn\n\s+- !Ref ProofAuditTableArn\n\s+- !Ref "AWS::NoValue"/
  );
  assert.match(
    template,
    /- Effect: Allow\n\s+Action:\n\s+- dynamodb:TransactWriteItems\n\s+Resource:\n\s+- !GetAtt PathfinderCustomerWorkspacesTable\.Arn\n\s+- !GetAtt PathfinderProductMappingsTable\.Arn/
  );
  assert.match(
    template,
    /- dynamodb:PutItem[\s\S]*?- !If \[HasProofCoreTable, !Ref ProofCoreTableArn/
  );
  assert.match(
    template,
    /HasProofAuditTable[\s\S]*?- dynamodb:PutItem[\s\S]*?Resource: !Ref ProofAuditTableArn/
  );
  assert.match(template, /PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "false"/);
  assert.doesNotMatch(template, /PATHFINDER_PROOF_ENABLE_(APPROVE|REVISION|UNDO): "true"/);
});

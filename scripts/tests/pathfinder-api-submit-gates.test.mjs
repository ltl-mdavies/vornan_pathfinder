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

test("API deployment packages oversized CloudFormation templates through the retained artifact bucket", () => {
  assert.match(
    workflow,
    /--template-file infra\/aws\/api-cloudformation\.yaml[\s\S]*--s3-bucket "\$\{\{ vars\.PATHFINDER_API_ARTIFACT_BUCKET \}\}"/
  );
});

test("API deploy policy manages only the exact main and Proof scan-worker Lambda boundaries", () => {
  const parsedPolicy = JSON.parse(deployPolicy);
  const lambdaStatement = parsedPolicy.Statement.find(
    (statement) => statement.Sid === "ManagePathfinderApiLambda"
  );
  const roleStatement = parsedPolicy.Statement.find(
    (statement) => statement.Sid === "ManagePathfinderApiRole"
  );

  assert.deepEqual(lambdaStatement.Resource, [
    "arn:aws:lambda:us-east-1:744016783602:function:vornan-pathfinder-api-prod",
    "arn:aws:lambda:us-east-1:744016783602:function:vornan-pathfinder-api-prod-proof-asset-scan"
  ]);
  assert.deepEqual(roleStatement.Resource, [
    "arn:aws:iam::744016783602:role/vornan-pathfinder-api-prod-role",
    "arn:aws:iam::744016783602:role/vornan-pathfinder-api-prod-proof-asset-scan-role"
  ]);
  assert.equal(roleStatement.Action.includes("iam:GetRole"), true);
  assert.equal(roleStatement.Action.includes("iam:PassRole"), true);
  assert.equal(lambdaStatement.Resource.some((resource) => resource.includes("*")), false);
  assert.equal(roleStatement.Resource.some((resource) => resource.includes("*")), false);
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

test("Wrike status writeback requires one exact task and bounded expiry", () => {
  assert.match(template, /WrikeStatusWritebackEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeStatusWritebackTaskId:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(template, /WrikeStatusWritebackExpiresAt:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(
    template,
    /WrikeStatusWritebackRequiresBoundedTask:[\s\S]*?RuleCondition:[\s\S]*?WrikeStatusWritebackEnabled[\s\S]*?WrikeStatusWritebackTaskId[\s\S]*?WrikeStatusWritebackExpiresAt/
  );
  assert.match(template, /PATHFINDER_ENABLE_WRIKE_STATUS_WRITEBACK: !Ref WrikeStatusWritebackEnabled/);
  assert.match(
    template,
    /PATHFINDER_WRIKE_STATUS_WRITEBACK_SCOPE: !Join[\s\S]*?WrikeStatusWritebackTaskId[\s\S]*?WrikeStatusWritebackExpiresAt/
  );
  assert.match(
    workflow,
    /WrikeStatusWritebackEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_STATUS_WRITEBACK \|\| 'false' \}\}"/
  );
  assert.match(
    deployScript,
    /WrikeStatusWritebackEnabled="\$\{PATHFINDER_ENABLE_WRIKE_STATUS_WRITEBACK:-false\}"/
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
  assert.equal(transactionActions.length, 3);
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

test("operator revised-art upload stays independently dark and exact-bucket scoped", () => {
  assert.match(template, /ProofAssetUploadEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofAssetUploadAllowedOrders:[\s\S]*?Default: ""/);
  assert.match(
    template,
    /ProofAssetUploadExpiresAt:[\s\S]*?Default: ""[\s\S]*?AllowedPattern: "\^\$\|\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T/
  );
  assert.match(
    template,
    /ProofAssetUploadRequiresDurableIsolation:\n\s+RuleCondition: !Equals \[!Ref ProofAssetUploadEnabled, "true"\][\s\S]*?!Ref ProofCoreTableName[\s\S]*?!Ref ProofAuditTableArn[\s\S]*?!Ref ProofAssetBucketName[\s\S]*?!Ref ProofAssetBucketArn[\s\S]*?!Ref ProofAssetUploadAllowedOrders[\s\S]*?!Ref ProofAssetUploadExpiresAt/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD: !If \[ProofAssetUploadActive, "true", !Ref "AWS::NoValue"\][\s\S]*?PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS: !If \[ProofAssetUploadActive, !Ref ProofAssetUploadAllowedOrders, !Ref "AWS::NoValue"\][\s\S]*?PATHFINDER_PROOF_ASSET_UPLOAD_EXPIRES_AT: !If \[ProofAssetUploadActive, !Ref ProofAssetUploadExpiresAt, !Ref "AWS::NoValue"\][\s\S]*?PATHFINDER_PROOF_ASSET_BUCKET: !If \[ProofAssetUploadActive, !Ref ProofAssetBucketName, !Ref "AWS::NoValue"\]/
  );
  assert.match(
    template,
    /ProofAssetUploadActive: !And[\s\S]*?!Condition HasProofAssetBucket[\s\S]*?!Ref ProofAssetUploadEnabled, "true"[\s\S]*?- ProofAssetUploadActive[\s\S]*?s3:GetObject[\s\S]*?s3:GetObjectTagging[\s\S]*?s3:PutObject[\s\S]*?s3:PutObjectTagging[\s\S]*?\$\{ProofAssetBucketArn\}\/orders\/\*/
  );
  assert.doesNotMatch(
    template,
    /ProofAssetBucketArn[\s\S]{0,500}s3:(DeleteObject|ListBucket)/
  );
  assert.match(
    workflow,
    /ProofAssetUploadEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD \|\| 'false' \}\}"/
  );
});

test("Proof asset scan processing is dark, sanitized, queued, and least-privilege", () => {
  assert.match(template, /ProofAssetScanWorkerEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofAssetScanWorkerAllowedObjectKey:[\s\S]*?Default: ""/);
  assert.match(
    template,
    /ProofAssetScanWorkerAllowedObjectKey:[\s\S]*?orders\/A\[0-9\]\{7,8\}[\s\S]*?prevision_\[a-f0-9\]\{64\}[\s\S]*?\/source\/passet_\[a-f0-9\]\{64\}[\s\S]*?A-Za-z0-9\._\(\) -/
  );
  assert.match(template, /ProofAssetScanWorkerExpiresAt:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(
    template,
    /ProofAssetScanWorkerRequiresDurableIsolation:[\s\S]*?!Ref ProofCoreTableName[\s\S]*?!Ref ProofAuditTableArn[\s\S]*?!Ref ProofAssetBucketName[\s\S]*?!Ref ProofAssetBucketArn[\s\S]*?!Ref ProofAssetScanWorkerAllowedObjectKey[\s\S]*?!Ref ProofAssetScanWorkerExpiresAt/
  );
  assert.match(template, /ProofAssetScanWorkerDeadLetterQueue:[\s\S]*?SqsManagedSseEnabled: true/);
  assert.match(
    template,
    /ProofAssetScanWorkerQueue:[\s\S]*?VisibilityTimeout: 180[\s\S]*?maxReceiveCount: 3/
  );
  assert.match(
    template,
    /ProofAssetScanEventRule:[\s\S]*?GuardDuty Malware Protection Object Scan Result[\s\S]*?bucketName:[\s\S]*?!Ref ProofAssetBucketName[\s\S]*?objectKey:[\s\S]*?!Ref ProofAssetScanWorkerAllowedObjectKey/
  );
  assert.match(
    template,
    /InputPathsMap:[\s\S]*?scanResultStatus[\s\S]*?InputTemplate:[\s\S]*?"observation"/
  );
  assert.doesNotMatch(
    template,
    /InputPathsMap:[\s\S]{0,1000}(threats|statusReasons)/
  );
  assert.match(
    template,
    /ProofAssetScanWorkerEventSource:[\s\S]*?Condition: ProofAssetScanWorkerActive[\s\S]*?ReportBatchItemFailures/
  );
  const role = template.slice(
    template.indexOf("  ProofAssetScanWorkerRole:"),
    template.indexOf("  ProofAssetScanWorkerFunction:")
  );
  assert.match(role, /dynamodb:GetItem/);
  assert.match(role, /dynamodb:TransactWriteItems/);
  assert.match(role, /s3:GetObjectVersionTagging/);
  assert.match(role, /s3:PutObjectVersionTagging/);
  assert.match(role, /\$\{ProofAssetBucketArn\}\/orders\/\*/);
  assert.doesNotMatch(
    role,
    /s3:(GetObject\s*$|GetObjectTagging|PutObject\s*$|PutObjectTagging|CopyObject|DeleteObject|ListBucket)|secretsmanager|cloudfront|execute-api|lambda:InvokeFunction/m
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_PROOF_ASSET_SCAN_WORKER: !If[\s\S]*?- ProofAssetScanWorkerActive[\s\S]*?- "true"[\s\S]*?- "false"/
  );
  assert.match(
    template,
    /PATHFINDER_PROOF_ASSET_SCAN_WORKER_ALLOWED_OBJECT_KEY: !If[\s\S]*?!Ref ProofAssetScanWorkerAllowedObjectKey[\s\S]*?PATHFINDER_PROOF_ASSET_SCAN_WORKER_EXPIRES_AT: !If[\s\S]*?!Ref ProofAssetScanWorkerExpiresAt/
  );
  assert.match(
    workflow,
    /ProofAssetScanWorkerEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_PROOF_ASSET_SCAN_WORKER \|\| 'false' \}\}"/
  );
  assert.match(workflow, /ProofAssetScanWorkerAllowedObjectKey="\$\{\{ vars\.PATHFINDER_PROOF_ASSET_SCAN_WORKER_ALLOWED_OBJECT_KEY \|\| '' \}\}"/);
  assert.match(workflow, /ProofAssetScanWorkerExpiresAt="\$\{\{ vars\.PATHFINDER_PROOF_ASSET_SCAN_WORKER_EXPIRES_AT \|\| '' \}\}"/);
  assert.match(
    deployScript,
    /ProofAssetScanWorkerEnabled="\$\{PATHFINDER_ENABLE_PROOF_ASSET_SCAN_WORKER:-false\}"/
  );
  assert.match(deployScript, /ProofAssetScanWorkerAllowedObjectKey="\$\{PATHFINDER_PROOF_ASSET_SCAN_WORKER_ALLOWED_OBJECT_KEY:-\}"/);
  assert.match(deployScript, /ProofAssetScanWorkerExpiresAt="\$\{PATHFINDER_PROOF_ASSET_SCAN_WORKER_EXPIRES_AT:-\}"/);
  assert.match(template, /PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "false"/);
});

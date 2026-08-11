import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [template, workflow, deployScript, deployPolicy, server, scheduledIntake] = await Promise.all([
  readFile(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"),
  readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8"),
  readFile(new URL("../deploy-api-lambda.sh", import.meta.url), "utf8"),
  readFile(new URL("../../infra/aws/github-actions-api-deploy-policy.json", import.meta.url), "utf8"),
  readFile(new URL("../../apps/api/src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../apps/api/src/wrike-scheduled-intake.ts", import.meta.url), "utf8")
]);

test("API stack persists every Lift submit runtime boundary", () => {
  assert.match(template, /ExternalLiftSubmitEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /LiftTransportMode:[\s\S]*?Default: dry_run/);
  assert.match(template, /AllowLiveCustomerSubmit:[\s\S]*?Default: "false"/);
  assert.match(template, /PATHFINDER_ENABLE_LIFT_SUBMIT: !Ref ExternalLiftSubmitEnabled/);
  assert.match(template, /PATHFINDER_LIFT_TRANSPORT_MODE: !Ref LiftTransportMode/);
  assert.match(template, /PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT: !Ref AllowLiveCustomerSubmit/);
});

test("production workflow keeps live-customer submission explicit and persistent", () => {
  assert.match(workflow, /enable_lift_submit:[\s\S]*?default: "true"/);
  assert.match(workflow, /lift_transport_mode:[\s\S]*?default: live/);
  assert.match(workflow, /allow_live_customer_submit:[\s\S]*?default: "false"/);
  assert.match(workflow, /ExternalLiftSubmitEnabled="\$\{\{ inputs\.enable_lift_submit \}\}"/);
  assert.match(workflow, /LiftTransportMode="\$\{\{ inputs\.lift_transport_mode \}\}"/);
  assert.match(workflow, /AllowLiveCustomerSubmit="\$\{\{ vars\.PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT \|\| inputs\.allow_live_customer_submit \}\}"/);
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
  const alarmStatement = parsedPolicy.Statement.find(
    (statement) => statement.Sid === "ManagePathfinderApiAlarms"
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
  assert.deepEqual(alarmStatement.Action, [
    "cloudwatch:DeleteAlarms",
    "cloudwatch:ListTagsForResource",
    "cloudwatch:PutMetricAlarm",
    "cloudwatch:TagResource",
    "cloudwatch:UntagResource"
  ]);
  assert.equal(
    alarmStatement.Resource,
    "arn:aws:cloudwatch:us-east-1:744016783602:alarm:vornan-pathfinder-api-prod-*"
  );
});

test("Wrike custom-field metadata discovery has an independent fail-closed gate", () => {
  assert.match(template, /WrikeCustomFieldDiscoveryEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /WrikeCustomFieldDiscoveryActive: !Equals \[!Ref WrikeCustomFieldDiscoveryEnabled, "true"\][\s\S]*?PATHFINDER_ENABLE_WRIKE_CUSTOM_FIELD_DISCOVERY: !If \[WrikeCustomFieldDiscoveryActive, "true", !Ref "AWS::NoValue"\]/
  );
  assert.match(
    workflow,
    /WrikeCustomFieldDiscoveryEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_CUSTOM_FIELD_DISCOVERY \|\| 'false' \}\}"/
  );
});

test("inactive optional gates are omitted from the constrained Lambda environment", () => {
  for (const [condition, parameter, variable] of [
    ["PublicStatusReturnLinkActive", "PublicStatusReturnLink", "PATHFINDER_PUBLIC_STATUS_RETURN_LINK"],
    ["PublicStatusDebugReturnLinkActive", "PublicStatusEmailDebugReturnLink", "PATHFINDER_STATUS_EMAIL_DEBUG_RETURN_LINK"],
    ["PublicIntakeEmailVerificationActive", "PublicIntakeEmailVerificationEnabled", "PATHFINDER_PUBLIC_INTAKE_EMAIL_VERIFICATION_ENABLED"],
    ["WrikeDiscoveryPreviewActive", "WrikeDiscoveryPreviewEnabled", "PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW"],
    ["WrikeManualIntakeActive", "WrikeManualIntakeEnabled", "PATHFINDER_ENABLE_WRIKE_MANUAL_INTAKE"],
    ["WrikeOrderRehearsalActive", "WrikeOrderRehearsalEnabled", "PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL"]
  ]) {
    assert.match(template, new RegExp(`${condition}: !Equals \\[!Ref ${parameter}, "true"\\]`));
    assert.match(
      template,
      new RegExp(`${variable}: !If \\[${condition}, "true", !Ref "AWS::NoValue"\\]`)
    );
  }
});

test("Wrike status writeback requires one exact task and bounded expiry", () => {
  assert.match(template, /WrikeStatusWritebackEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeStatusWritebackTaskId:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(template, /WrikeStatusWritebackExpiresAt:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(
    template,
    /WrikeStatusWritebackRequiresBoundedTask:[\s\S]*?RuleCondition:[\s\S]*?WrikeStatusWritebackEnabled[\s\S]*?WrikeStatusWritebackTaskId[\s\S]*?WrikeStatusWritebackExpiresAt/
  );
  assert.doesNotMatch(template, /PATHFINDER_ENABLE_WRIKE_STATUS_WRITEBACK:/);
  assert.match(
    template,
    /PATHFINDER_WRIKE_WB: !Join[\s\S]*?WrikeStatusWritebackEnabled[\s\S]*?WrikeStatusWritebackTaskId[\s\S]*?WrikeStatusWritebackExpiresAt/
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

test("scheduled Wrike automation is default-off, independently gated, and exactly scoped", () => {
  assert.match(template, /WrikeScheduledIntakeEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeScheduledIntakeCustomerId:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(template, /WrikeScheduledIntakeImportMethodId:[\s\S]*?Default: ""[\s\S]*?AllowedPattern:/);
  assert.match(template, /WrikeScheduledIntakeMaxCandidates:[\s\S]*?Default: 25[\s\S]*?MaxValue: 25/);
  assert.match(template, /WrikeScheduledStatusWritebackEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /WrikeScheduledLiftSubmitEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /WrikeScheduledIntakeRequiresPreparedEvidence:[\s\S]*?WrikeScheduledIntakeCustomerId[\s\S]*?WrikeScheduledIntakeImportMethodId[\s\S]*?WrikeWorkbookEvidenceEnabled[\s\S]*?WrikeEvidencePreviewEnabled[\s\S]*?WrikeLiftDocumentPublicationEnabled/
  );
  assert.match(
    template,
    /WrikeScheduledIntakeRule:[\s\S]*?Condition: WrikeScheduledIntakeActive[\s\S]*?Name: !Sub "\$\{LambdaFunctionName\}-\$\{EnvironmentName\}-wrike-scheduled-intake"[\s\S]*?ScheduleExpression: rate\(15 minutes\)[\s\S]*?discover_prepare_submit_writeback[\s\S]*?MaximumEventAgeInSeconds: 300[\s\S]*?MaximumRetryAttempts: 0/
  );
  assert.match(
    template,
    /WrikeScheduledIntakeAsyncPolicy:[\s\S]*?Condition: WrikeScheduledIntakeActive[\s\S]*?Type: AWS::Lambda::EventInvokeConfig[\s\S]*?FunctionName: !Ref PathfinderApiFunction[\s\S]*?Qualifier: \$LATEST[\s\S]*?MaximumEventAgeInSeconds: 300[\s\S]*?MaximumRetryAttempts: 0/
  );
  assert.match(
    template,
    /WrikeScheduledIntakeInvokePermission:[\s\S]*?Principal: events\.amazonaws\.com[\s\S]*?SourceArn: !GetAtt WrikeScheduledIntakeRule\.Arn/
  );
  assert.match(
    template,
    /PATHFINDER_WRIKE_SCHEDULED_INTAKE: !Join[\s\S]*?WrikeScheduledIntakeEnabled[\s\S]*?WrikeScheduledIntakeCustomerId[\s\S]*?WrikeScheduledIntakeImportMethodId[\s\S]*?WrikeScheduledIntakeMaxCandidates/
  );
  assert.match(
    template,
    /WrikeScheduledStatusWritebackRequiresScheduler:[\s\S]*?WrikeScheduledStatusWritebackEnabled[\s\S]*?WrikeScheduledIntakeEnabled/
  );
  assert.match(
    template,
    /WrikeScheduledLiftSubmitRequiresLiveBoundary:[\s\S]*?WrikeScheduledLiftSubmitEnabled[\s\S]*?WrikeScheduledIntakeEnabled[\s\S]*?ExternalLiftSubmitEnabled[\s\S]*?LiftTransportMode[\s\S]*?AllowLiveCustomerSubmit/
  );
  assert.match(
    workflow,
    /WrikeScheduledIntakeEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_SCHEDULED_INTAKE \|\| 'false' \}\}"/
  );
  assert.match(
    deployScript,
    /WrikeScheduledIntakeEnabled="\$\{PATHFINDER_ENABLE_WRIKE_SCHEDULED_INTAKE:-false\}"/
  );
  assert.match(
    workflow,
    /WrikeScheduledStatusWritebackEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_SCHEDULED_STATUS_WRITEBACK \|\| 'false' \}\}"/
  );
  assert.match(
    deployScript,
    /WrikeScheduledStatusWritebackEnabled="\$\{PATHFINDER_ENABLE_WRIKE_SCHEDULED_STATUS_WRITEBACK:-false\}"/
  );
  assert.match(
    workflow,
    /WrikeScheduledLiftSubmitEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_WRIKE_SCHEDULED_LIFT_SUBMIT \|\| 'false' \}\}"/
  );
  assert.match(
    deployScript,
    /WrikeScheduledLiftSubmitEnabled="\$\{PATHFINDER_ENABLE_WRIKE_SCHEDULED_LIFT_SUBMIT:-false\}"/
  );
  assert.match(
    server,
    /source task can acquire a newer preview job[\s\S]*?findWrikeSourceTaskSiblingJobs\([\s\S]*?listSubmitAttemptsForJob\(customer, sibling\.job_id\)[\s\S]*?!\["Blocked", "Gate Locked"\]\.includes\(attempt\.state\)/
  );
  assert.match(
    scheduledIntake,
    /findWrikeSourceTaskSiblingJobs[\s\S]*?candidate\.customer_id === args\.current\.customer_id[\s\S]*?candidate\.import_method_id === args\.current\.import_method_id[\s\S]*?candidate\.source_evidence\?\.provider === "wrike"[\s\S]*?candidate\.source_evidence\.task_id\?\.trim\(\) === taskId/
  );
  const parsedPolicy = JSON.parse(deployPolicy);
  const scheduleStatement = parsedPolicy.Statement.find(
    (statement) => statement.Sid === "ManagePathfinderWrikeSchedule"
  );
  assert.deepEqual(scheduleStatement, {
    Sid: "ManagePathfinderWrikeSchedule",
    Effect: "Allow",
    Action: [
      "events:DeleteRule",
      "events:DescribeRule",
      "events:ListTargetsByRule",
      "events:PutRule",
      "events:PutTargets",
      "events:RemoveTargets"
    ],
    Resource:
      "arn:aws:events:us-east-1:744016783602:rule/vornan-pathfinder-api-prod-wrike-scheduled-intake"
  });
});

test("production Pathfinder tables are deletion-protected and retained", () => {
  const protectedTables = [
    "PathfinderCustomersTable",
    "PathfinderCustomerWorkspacesTable",
    "PathfinderTargetsTable",
    "PathfinderImportMethodsTable",
    "PathfinderOutputRoutesTable",
    "PathfinderProductMappingsTable",
    "PathfinderJobsTable",
    "PathfinderOrderIdsTable",
    "PathfinderSubmitAttemptsTable",
    "PathfinderLiftProductCacheTable",
    "PathfinderOrderStatusTokensTable",
    "PathfinderOrderStatusSnapshotsTable",
    "PathfinderCanonicalRegistryTable"
  ];

  for (const logicalId of protectedTables) {
    assert.match(
      template,
      new RegExp(
        `${logicalId}:\\n    Type: AWS::DynamoDB::Table\\n    DeletionPolicy: Retain\\n    UpdateReplacePolicy: Retain\\n    Properties:\\n      DeletionProtectionEnabled: true`
      ),
      `${logicalId} must remain protected from deletion and replacement`
    );
  }

  assert.equal(
    (template.match(/DeletionProtectionEnabled: true/g) ?? []).length,
    protectedTables.length
  );
});

test("operational alarms observe failures without changing submit behavior", () => {
  assert.match(
    template,
    /PathfinderApiErrorsAlarm:[\s\S]*?Type: AWS::CloudWatch::Alarm[\s\S]*?AlarmName: !Sub "\$\{LambdaFunctionName\}-\$\{EnvironmentName\}-errors"[\s\S]*?Namespace: AWS\/Lambda[\s\S]*?MetricName: Errors[\s\S]*?FunctionName[\s\S]*?!Ref PathfinderApiFunction[\s\S]*?Threshold: 0[\s\S]*?ComparisonOperator: GreaterThanThreshold[\s\S]*?TreatMissingData: notBreaching/
  );
  assert.match(
    template,
    /PathfinderApiThrottlesAlarm:[\s\S]*?Type: AWS::CloudWatch::Alarm[\s\S]*?AlarmName: !Sub "\$\{LambdaFunctionName\}-\$\{EnvironmentName\}-throttles"[\s\S]*?Namespace: AWS\/Lambda[\s\S]*?MetricName: Throttles[\s\S]*?FunctionName[\s\S]*?!Ref PathfinderApiFunction[\s\S]*?Threshold: 0[\s\S]*?ComparisonOperator: GreaterThanThreshold[\s\S]*?TreatMissingData: notBreaching/
  );
  assert.match(
    template,
    /WrikeScheduledIntakeFailedInvocationsAlarm:[\s\S]*?Condition: WrikeScheduledIntakeActive[\s\S]*?Type: AWS::CloudWatch::Alarm[\s\S]*?AlarmName: !Sub "\$\{LambdaFunctionName\}-\$\{EnvironmentName\}-wrike-scheduled-failed-invocations"[\s\S]*?Namespace: AWS\/Events[\s\S]*?MetricName: FailedInvocations[\s\S]*?RuleName[\s\S]*?!Ref WrikeScheduledIntakeRule[\s\S]*?TreatMissingData: notBreaching/
  );
  assert.match(
    template,
    /WrikeScheduledCandidateFailuresAlarm:[\s\S]*?Condition: WrikeScheduledIntakeActive[\s\S]*?Type: AWS::CloudWatch::Alarm[\s\S]*?AlarmName: !Sub "\$\{LambdaFunctionName\}-\$\{EnvironmentName\}-wrike-scheduled-candidate-failures"[\s\S]*?Namespace: Pathfinder\/WrikeScheduledIntake[\s\S]*?MetricName: candidate_failures[\s\S]*?Statistic: Sum[\s\S]*?Threshold: 0[\s\S]*?ComparisonOperator: GreaterThanThreshold[\s\S]*?TreatMissingData: notBreaching/
  );

  const alarmBlocks = template.match(/\n  (?:PathfinderApiErrorsAlarm|PathfinderApiThrottlesAlarm|WrikeScheduledIntakeFailedInvocationsAlarm|WrikeScheduledCandidateFailuresAlarm):[\s\S]*?(?=\n  [A-Z][A-Za-z0-9]+:|\nOutputs:)/g) ?? [];
  assert.equal(alarmBlocks.length, 4);
  assert.equal(alarmBlocks.some((block) => /AlarmActions|OKActions|InsufficientDataActions/.test(block)), false);
  assert.match(
    template,
    /WrikeScheduledIntakeRule:[\s\S]*?ScheduleExpression: rate\(15 minutes\)[\s\S]*?MaximumRetryAttempts: 0/
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
    /PATHFINDER_ENABLE_WRIKE_MANUAL_INTAKE: !If \[WrikeManualIntakeActive, "true", !Ref "AWS::NoValue"\]/
  );
  assert.match(
    template,
    /PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL: !If \[WrikeOrderRehearsalActive, "true", !Ref "AWS::NoValue"\]/
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
  assert.match(template, /ProofAdvancedReviewEnabled:[\s\S]*?Default: "false"/);
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
    /PATHFINDER_PROOF_OPERATOR_ACTION_SCOPE: !Join[\s\S]*?- "\|"[\s\S]*?!Ref ProofOperatorActionQaEnabled[\s\S]*?!Ref ProofOperatorActionAllowedOrders[\s\S]*?!Ref ProofOperatorActionExpiresAt[\s\S]*?!Ref ProofAdvancedReviewEnabled/
  );
  assert.doesNotMatch(template, /PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA:/);
  assert.doesNotMatch(template, /PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS:/);
  assert.doesNotMatch(template, /PATHFINDER_PROOF_OPERATOR_ACTION_EXPIRES_AT:/);
  assert.doesNotMatch(template, /PATHFINDER_ENABLE_PROOF_ADVANCED_REVIEW:/);
  assert.match(
    template,
    /ProofAdvancedReviewRequiresOperatorQa:\n\s+RuleCondition: !Equals \[!Ref ProofAdvancedReviewEnabled, "true"\][\s\S]*?!Equals \[!Ref ProofOperatorActionQaEnabled, "true"\]/
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
  assert.match(template, /ProofPublicReadEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofCustomerApprovalEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofCustomerRevisionUploadEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /ProofCustomerRevisionUploadRequiresReviewBoundary:\n\s+RuleCondition: !Equals \[!Ref ProofCustomerRevisionUploadEnabled, "true"\][\s\S]*?!Equals \[!Ref ProofPublicReadEnabled, "true"\][\s\S]*?!Equals \[!Ref ProofAssetUploadEnabled, "true"\][\s\S]*?!Ref ProofCoreTableName[\s\S]*?!Ref ProofCoreTableArn[\s\S]*?!Ref ProofAuditTableName[\s\S]*?!Ref ProofAuditTableArn[\s\S]*?!Ref ProofGrantAllowedCustomerIds[\s\S]*?!Ref ProofReadOnlyActivationExpiresAt/
  );
  assert.match(
    template,
    /PATHFINDER_PROOF_CUSTOMER_REVIEW_SCOPE: !Join[\s\S]*?- "\|"[\s\S]*?!Ref ProofPublicReadEnabled[\s\S]*?!Ref ProofCustomerApprovalEnabled[\s\S]*?!Ref ProofCustomerRevisionUploadEnabled/
  );
  assert.match(
    workflow,
    /ProofCustomerRevisionUploadEnabled="\$\{\{ vars\.PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_UPLOADS \|\| 'false' \}\}"/
  );
  assert.match(
    deployScript,
    /ProofCustomerRevisionUploadEnabled="\$\{PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_UPLOADS:-false\}"/
  );
  assert.doesNotMatch(template, /PATHFINDER_PROOF_ENABLE_(APPROVE|REVISION|UNDO): "true"/);
});

test("customer Proof approval is default-dark and requires the complete review boundary", () => {
  assert.match(template, /ProofPublicReadEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofCustomerApprovalEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /ProofCustomerApprovalRequiresReviewBoundary:\n\s+RuleCondition: !Equals \[!Ref ProofCustomerApprovalEnabled, "true"\][\s\S]*?!Equals \[!Ref ProofPublicReadEnabled, "true"\][\s\S]*?!Equals \[!Ref ProofGrantCreationEnabled, "true"\][\s\S]*?!Ref ProofCoreTableName[\s\S]*?!Ref ProofCoreTableArn[\s\S]*?!Ref ProofAuditTableName[\s\S]*?!Ref ProofAuditTableArn[\s\S]*?!Ref ProofGrantAllowedCustomerIds[\s\S]*?!Ref ProofReadOnlyActivationExpiresAt/
  );
  assert.match(
    template,
    /PATHFINDER_PROOF_CUSTOMER_REVIEW_SCOPE: !Join[\s\S]*?- "\|"[\s\S]*?!Ref ProofPublicReadEnabled[\s\S]*?!Ref ProofCustomerApprovalEnabled/
  );
  assert.doesNotMatch(template, /PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS:/);
  assert.match(
    workflow,
    /ProofPublicReadEnabled="\$\{\{ vars\.PATHFINDER_PROOF_ENABLE_PUBLIC_READ \|\| 'false' \}\}"/
  );
  assert.match(
    workflow,
    /ProofCustomerApprovalEnabled="\$\{\{ vars\.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS \|\| 'false' \}\}"/
  );
  assert.match(
    deployScript,
    /ProofCustomerApprovalEnabled="\$\{PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS:-false\}"/
  );
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
    /PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD: !If \[ProofAssetUploadActive, "true", !Ref "AWS::NoValue"\][\s\S]*?PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS: !If \[ProofAssetUploadActive, !Ref ProofAssetUploadAllowedOrders, !Ref "AWS::NoValue"\][\s\S]*?PATHFINDER_PROOF_ASSET_UPLOAD_EXPIRES_AT: !If \[ProofAssetUploadActive, !Ref ProofAssetUploadExpiresAt, !Ref "AWS::NoValue"\][\s\S]*?PATHFINDER_PROOF_ASSET_BUCKET: !If[\s\S]*?ProofAssetPublicationActive[\s\S]*?!Ref ProofAssetBucketName[\s\S]*?!If \[ProofAssetUploadActive, !Ref ProofAssetBucketName, !Ref "AWS::NoValue"\]/
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

test("Proof publication stays independently dark and direct-delivery scoped", () => {
  assert.match(template, /ProofAssetPublicationEnabled:[\s\S]*?Default: "false"/);
  assert.match(
    template,
    /ProofAssetPublicationRequiresDurableIsolation:[\s\S]*?!Ref ProofAssetPublicationAllowedOrders[\s\S]*?!Ref ProofAssetPublicationExpiresAt[\s\S]*?https:\/\/go\.vornan\.co/
  );
  assert.match(
    template,
    /ProofAssetPublicationActive:[\s\S]*?!Condition HasProofAssetBucket[\s\S]*?!Condition HasProofTables[\s\S]*?!Ref ProofAssetPublicationEnabled, "true"/
  );
  assert.match(
    template,
    /ProofAssetPublicationActive[\s\S]*?s3:GetObjectVersion[\s\S]*?s3:PutObject[\s\S]*?s3:PutObjectTagging[\s\S]*?ProofAssetBucketArn\}\/a\/\*/
  );
  assert.match(
    workflow,
    /ProofAssetPublicationEnabled="\$\{\{ vars\.PATHFINDER_ENABLE_PROOF_ASSET_PUBLICATION \|\| 'false' \}\}"/
  );
});

test("the unified LTL Demo QA profile is allowlisted and does not compose with mutation gates", () => {
  assert.match(template, /ProofLtlDemoQaEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofLtlDemoQaAllowedOrders:[\s\S]*?AllowedPattern:/);
  assert.match(
    template,
    /ProofLtlDemoQaRequiresIsolatedBoundary:[\s\S]*?!Ref ProofLtlDemoQaAllowedOrders[\s\S]*?!Ref ProofLtlDemoQaExpiresAt[\s\S]*?!Ref ProofAssetPublicationEnabled, "false"[\s\S]*?!Ref ProofAssetScanWorkerEnabled, "false"[\s\S]*?!Ref ProofOperatorActionQaEnabled, "false"/
  );
  assert.match(
    template,
    /PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE: !Join[\s\S]*?!Ref ProofLtlDemoQaEnabled[\s\S]*?!Ref ProofLtlDemoQaAllowedOrders/
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
  assert.match(template, /ProofPublicReadEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /ProofCustomerApprovalEnabled:[\s\S]*?Default: "false"/);
});

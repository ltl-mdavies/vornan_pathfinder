import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACTIVATION_RESOURCE_CHANGES,
  SCAN_WORKER_QA,
  validateActiveSnapshot,
  validateClosureSnapshot,
  validatePreflightSnapshot,
  validateReviewSnapshot
} from "../proof-asset-scan-worker-activation-qa.mjs";

const NOW = Date.parse("2026-08-02T16:00:00.000Z");
const EXPIRY = "2026-08-02T18:00:00.000Z";
const OBJECT_KEY =
  `orders/A0226753/tasks/task-qa-01/revisions/prevision_${"a".repeat(64)}` +
  `/source/passet_${"b".repeat(64)}/Revised Art (QA).pdf`;
const ROLE_ARN =
  "arn:aws:iam::744016783602:role/vornan-proof-assets-dev-guardduty-malware-protection";
const QUEUE_ARN =
  "arn:aws:sqs:us-east-1:744016783602:vornan-pathfinder-api-prod-proof-asset-scan";
const RULE_ARN =
  "arn:aws:events:us-east-1:744016783602:rule/vornan-pathfinder-api-prod-ProofAssetScanEventRule-1";
const STACK_ID =
  "arn:aws:cloudformation:us-east-1:744016783602:stack/vornan-pathfinder-api-prod/stack-id";
const RESOURCE_TYPES = {
  ProofAssetScanDeadLetterAlarm: "AWS::CloudWatch::Alarm",
  ProofAssetScanEventQueuePolicy: "AWS::SQS::QueuePolicy",
  ProofAssetScanEventRule: "AWS::Events::Rule",
  ProofAssetScanWorkerEventSource: "AWS::Lambda::EventSourceMapping"
};

const DARK_PARAMETERS = {
  WrikeConnectionTestEnabled: "false",
  WrikeCustomFieldDiscoveryEnabled: "false",
  WrikeDiscoveryPreviewEnabled: "false",
  WrikeWorkbookEvidenceEnabled: "false",
  WrikeEvidencePreviewEnabled: "false",
  WrikeManualIntakeEnabled: "false",
  WrikeOrderRehearsalEnabled: "false",
  WrikeLiftDocumentPublicationEnabled: "false",
  ProofAssetUploadEnabled: "false",
  ProofOperatorActionQaEnabled: "false",
  ProofGrantCreationEnabled: "false",
  ProofLinkEmailEnabled: "false",
  AllowLiveCustomerSubmit: "false",
  ExternalLiftSubmitEnabled: "true",
  LiftTransportMode: "live"
};

function parameterList(extra = {}) {
  return Object.entries({
    ...DARK_PARAMETERS,
    EnvironmentName: "prod",
    ProofCoreTableName: "Pathfinder-ProofCore-dev",
    ProofAuditTableName: "Pathfinder-ProofAudit-dev",
    ProofAssetBucketName: SCAN_WORKER_QA.bucket_name,
    ...extra
  }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
}

function assetStack() {
  return {
    Stacks: [
      {
        StackName: SCAN_WORKER_QA.asset_stack,
        StackStatus: "UPDATE_COMPLETE",
        Outputs: [
          { OutputKey: "ProofAssetMalwareProtectionEnabled", OutputValue: "true" },
          {
            OutputKey: "GuardDutyMalwareProtectionPlanId",
            OutputValue: SCAN_WORKER_QA.guardduty_plan_id
          },
          { OutputKey: "GuardDutyMalwareProtectionPlanStatus", OutputValue: "ACTIVE" },
          { OutputKey: "GuardDutyMalwareProtectionRoleArn", OutputValue: ROLE_ARN }
        ]
      }
    ]
  };
}

function plan() {
  return {
    Status: "ACTIVE",
    StatusReasons: [],
    Role: ROLE_ARN,
    ProtectedResource: {
      S3Bucket: {
        BucketName: SCAN_WORKER_QA.bucket_name,
        ObjectPrefixes: ["orders/"]
      }
    },
    Actions: { Tagging: { Status: "ENABLED" } }
  };
}

function queue(policy = undefined) {
  return {
    Attributes: {
      ApproximateNumberOfMessages: "0",
      ApproximateNumberOfMessagesNotVisible: "0",
      ApproximateNumberOfMessagesDelayed: "0",
      QueueArn: QUEUE_ARN,
      ...(policy ? { Policy: JSON.stringify(policy) } : {})
    }
  };
}

function worker(enabled) {
  return {
    FunctionName: SCAN_WORKER_QA.worker_function,
    FunctionArn: `arn:aws:lambda:us-east-1:744016783602:function:${SCAN_WORKER_QA.worker_function}`,
    State: "Active",
    LastUpdateStatus: "Successful",
    Environment: {
      Variables: {
        NODE_OPTIONS: "--enable-source-maps",
        PATHFINDER_PROOF_ENVIRONMENT_NAME: "prod",
        PATHFINDER_PROOF_STORAGE_DRIVER: "dynamodb",
        PATHFINDER_PROOF_CORE_TABLE: "Pathfinder-ProofCore-dev",
        PATHFINDER_PROOF_AUDIT_TABLE: "Pathfinder-ProofAudit-dev",
        PATHFINDER_PROOF_ASSET_BUCKET: SCAN_WORKER_QA.bucket_name,
        PATHFINDER_PROOF_ASSET_SCAN_ACCOUNT_ID: SCAN_WORKER_QA.account_id,
        PATHFINDER_PROOF_ASSET_SCAN_REGION: SCAN_WORKER_QA.region,
        PATHFINDER_ENABLE_PROOF_ASSET_SCAN_WORKER: String(enabled),
        PATHFINDER_PROOF_ASSET_SCAN_WORKER_ALLOWED_OBJECT_KEY: enabled ? OBJECT_KEY : "",
        PATHFINDER_PROOF_ASSET_SCAN_WORKER_EXPIRES_AT: enabled ? EXPIRY : ""
      }
    }
  };
}

function common(enabled = false) {
  return {
    identity: {
      Account: SCAN_WORKER_QA.account_id,
      Arn: SCAN_WORKER_QA.identity_arn
    },
    asset_stack: assetStack(),
    api_stack: {
      Stacks: [
        {
          StackName: SCAN_WORKER_QA.api_stack,
          StackId: STACK_ID,
          StackStatus: "UPDATE_COMPLETE",
          Parameters: parameterList({
            ProofAssetScanWorkerEnabled: String(enabled),
            ProofAssetScanWorkerAllowedObjectKey: enabled ? OBJECT_KEY : "",
            ProofAssetScanWorkerExpiresAt: enabled ? EXPIRY : ""
          })
        }
      ]
    },
    api_resources: {
      StackResources: [
        {
          LogicalResourceId: "ProofAssetScanWorkerFunction",
          PhysicalResourceId: SCAN_WORKER_QA.worker_function,
          ResourceStatus: "UPDATE_COMPLETE"
        }
      ]
    },
    plan: plan(),
    worker: worker(enabled),
    worker_mappings: { EventSourceMappings: [] },
    pathfinder_rules: { Rules: [] },
    worker_queue: queue(),
    worker_dlq: queue()
  };
}

function exactQueuePolicy() {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowExactGuardDutyScanRule",
        Effect: "Allow",
        Principal: { Service: "events.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: QUEUE_ARN,
        Condition: {
          ArnEquals: { "aws:SourceArn": RULE_ARN },
          StringEquals: { "aws:SourceAccount": SCAN_WORKER_QA.account_id }
        }
      }
    ]
  };
}

function inputTransformer() {
  return {
    InputPathsMap: {
      account: "$.account",
      bucket: "$.detail.s3ObjectDetails.bucketName",
      eventId: "$.id",
      key: "$.detail.s3ObjectDetails.objectKey",
      occurredAt: "$.time",
      region: "$.region",
      result: "$.detail.scanResultDetails.scanResultStatus",
      schemaVersion: "$.detail.schemaVersion",
      versionId: "$.detail.s3ObjectDetails.versionId"
    },
    InputTemplate:
      '{"account":<account>,"region":<region>,"observation":{"schema_version":<schemaVersion>,"event_id":<eventId>,"occurred_at":<occurredAt>,"bucket_name":<bucket>,"object_key":<key>,"object_version_id":<versionId>,"scan_result":<result>}}'
  };
}

function context(properties) {
  return JSON.stringify({ properties });
}

function addAfterContext(logicalId) {
  const values = {
    ProofAssetScanEventRule: {
      Description: "Sanitizes exact GuardDuty Proof asset scan results before queueing.",
      EventPattern: {
        source: ["aws.guardduty"],
        "detail-type": ["GuardDuty Malware Protection Object Scan Result"],
        account: [SCAN_WORKER_QA.account_id],
        region: [SCAN_WORKER_QA.region],
        detail: {
          schemaVersion: ["1.0"],
          resourceType: ["S3_OBJECT"],
          s3ObjectDetails: {
            bucketName: [SCAN_WORKER_QA.bucket_name],
            objectKey: [OBJECT_KEY]
          }
        }
      },
      State: "ENABLED",
      Targets: [{ Arn: QUEUE_ARN, Id: "ProofAssetScanQueue", InputTransformer: inputTransformer() }]
    },
    ProofAssetScanEventQueuePolicy: {
      Queues: [SCAN_WORKER_QA.worker_queue_url],
      PolicyDocument: exactQueuePolicy()
    },
    ProofAssetScanWorkerEventSource: {
      BatchSize: "10",
      Enabled: "true",
      EventSourceArn: QUEUE_ARN,
      FunctionName: SCAN_WORKER_QA.worker_function,
      FunctionResponseTypes: ["ReportBatchItemFailures"]
    },
    ProofAssetScanDeadLetterAlarm: {
      AlarmDescription: "Proof asset scan observations reached the dead-letter queue.",
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Dimensions: [
        { Name: "QueueName", Value: "vornan-pathfinder-api-prod-proof-asset-scan-dlq" }
      ],
      Statistic: "Maximum",
      Period: "60",
      EvaluationPeriods: "1",
      Threshold: "0",
      ComparisonOperator: "GreaterThanThreshold",
      TreatMissingData: "notBreaching"
    }
  };
  return context(values[logicalId]);
}

function activeSnapshot() {
  const snapshot = common(true);
  snapshot.api_resources.StackResources.push(
    ...ACTIVATION_RESOURCE_CHANGES.Add.map((LogicalResourceId) => ({
      LogicalResourceId,
      PhysicalResourceId:
        LogicalResourceId === "ProofAssetScanEventRule"
          ? "vornan-pathfinder-api-prod-ProofAssetScanEventRule-1"
          : `${LogicalResourceId}-physical`,
      ResourceStatus: "CREATE_COMPLETE"
    }))
  );
  snapshot.worker_queue = queue(exactQueuePolicy());
  snapshot.worker_mappings = {
    EventSourceMappings: [
      {
        State: "Enabled",
        FunctionArn: snapshot.worker.FunctionArn,
        EventSourceArn: QUEUE_ARN,
        BatchSize: 10,
        FunctionResponseTypes: ["ReportBatchItemFailures"]
      }
    ]
  };
  snapshot.rule = {
    Name: "vornan-pathfinder-api-prod-ProofAssetScanEventRule-1",
    Arn: RULE_ARN,
    State: "ENABLED",
    EventPattern: JSON.stringify({
      source: ["aws.guardduty"],
      "detail-type": ["GuardDuty Malware Protection Object Scan Result"],
      account: [SCAN_WORKER_QA.account_id],
      region: [SCAN_WORKER_QA.region],
      detail: {
        schemaVersion: ["1.0"],
        resourceType: ["S3_OBJECT"],
        s3ObjectDetails: {
          bucketName: [SCAN_WORKER_QA.bucket_name],
          objectKey: [OBJECT_KEY]
        }
      }
    })
  };
  snapshot.rule_targets = {
    Targets: [
      {
        Id: "ProofAssetScanQueue",
        Arn: QUEUE_ARN,
        InputTransformer: inputTransformer()
      }
    ]
  };
  return snapshot;
}

function changeSet() {
  return {
    Status: "CREATE_COMPLETE",
    ExecutionStatus: "AVAILABLE",
    ChangeSetType: "UPDATE",
    StackName: SCAN_WORKER_QA.api_stack,
    StackId: STACK_ID,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    NotificationARNs: [],
    IncludeNestedStacks: false,
    Parameters: parameterList({
      ProofAssetScanWorkerEnabled: "true",
      ProofAssetScanWorkerAllowedObjectKey: OBJECT_KEY,
      ProofAssetScanWorkerExpiresAt: EXPIRY
    }),
    Changes: [
      ...ACTIVATION_RESOURCE_CHANGES.Add.map((LogicalResourceId) => ({
        ResourceChange: {
          Action: "Add",
          LogicalResourceId,
          ResourceType: RESOURCE_TYPES[LogicalResourceId],
          Replacement: "False",
          AfterContext: addAfterContext(LogicalResourceId)
        }
      })),
      {
        ResourceChange: {
          Action: "Modify",
          LogicalResourceId: "ProofAssetScanWorkerFunction",
          ResourceType: "AWS::Lambda::Function",
          Replacement: "False",
          Scope: ["Properties"],
          Details: [
            {
              Target: { Attribute: "Properties", Name: "Environment" },
              Evaluation: "Static",
              ChangeSource: "DirectModification"
            }
          ],
          BeforeContext: context({
            FunctionName: SCAN_WORKER_QA.worker_function,
            Runtime: "nodejs22.x",
            Environment: worker(false).Environment
          }),
          AfterContext: context({
            FunctionName: SCAN_WORKER_QA.worker_function,
            Runtime: "nodejs22.x",
            Environment: worker(true).Environment
          })
        }
      }
    ]
  };
}

test("preflight and closure prove the exact dark, empty, non-customer posture", () => {
  for (const validate of [validatePreflightSnapshot, validateClosureSnapshot]) {
    const result = validate(common());
    assert.equal(result.worker_enabled, false);
    assert.equal(result.approved_object_key_sha256, null);
    assert.equal(result.queue.visible, 0);
    assert.equal(result.dead_letter_queue.visible, 0);
    assert.equal(result.customer_capabilities_enabled, false);
    assert.equal(result.lift_called, false);
    assert.equal(result.mutation_performed, false);
  }
});

test("preflight fails closed on identity, plan, gate, resource, and queue drift", () => {
  const cases = [
    (value) => (value.identity.Account = "000000000000"),
    (value) => (value.plan.Status = "WARNING"),
    (value) =>
      (value.api_stack.Stacks[0].Parameters.find(
        (parameter) => parameter.ParameterKey === "ProofAssetUploadEnabled"
      ).ParameterValue = "true"),
    (value) => value.api_resources.StackResources.push({ LogicalResourceId: "ProofAssetScanEventRule" }),
    (value) => (value.worker_queue.Attributes.ApproximateNumberOfMessages = "1")
  ];
  for (const mutate of cases) {
    const snapshot = structuredClone(common());
    mutate(snapshot);
    assert.throws(() => validatePreflightSnapshot(snapshot));
  }
});

test("review accepts only four conditional Adds and the worker Modify for one bounded key", () => {
  const result = validateReviewSnapshot(
    { current: common(), change_set: changeSet() },
    { object_key: OBJECT_KEY, expires_at: EXPIRY },
    NOW
  );
  assert.equal(result.status, "review_verified");
  assert.equal(result.change_count, 5);
  assert.equal(result.add_count, 4);
  assert.equal(result.modify_count, 1);
  assert.equal(result.change_set_execution_authorized, false);
  assert.match(result.approved_object_key_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(OBJECT_KEY), false);
});

test("review rejects invalid bounds and any extra, missing, or replacement change", () => {
  const invalidKey = changeSet();
  assert.throws(() =>
    validateReviewSnapshot(
      { current: common(), change_set: invalidKey },
      { object_key: "orders/customer-file.pdf", expires_at: EXPIRY },
      NOW
    )
  );

  const tooLong = changeSet();
  assert.throws(() =>
    validateReviewSnapshot(
      { current: common(), change_set: tooLong },
      { object_key: OBJECT_KEY, expires_at: "2026-08-02T21:00:00.000Z" },
      NOW
    )
  );

  for (const mutate of [
    (value) => value.Changes.pop(),
    (value) =>
      value.Changes.push({
        ResourceChange: { Action: "Modify", LogicalResourceId: "PathfinderApiFunction" }
      }),
    (value) => (value.Changes.at(-1).ResourceChange.Replacement = "True"),
    (value) => (value.StackId = `${STACK_ID}-different`),
    (value) => (value.Capabilities = ["CAPABILITY_AUTO_EXPAND"]),
    (value) => (value.Changes[0].ResourceChange.ResourceType = "AWS::IAM::Role"),
    (value) => (value.Changes.at(-1).ResourceChange.Details[0].Target.Name = "Code"),
    (value) => {
      const properties = JSON.parse(value.Changes[2].ResourceChange.AfterContext);
      properties.properties.EventPattern.detail.s3ObjectDetails.objectKey = ["orders/other.pdf"];
      value.Changes[2].ResourceChange.AfterContext = JSON.stringify(properties);
    },
    (value) => {
      const workerAfter = JSON.parse(value.Changes.at(-1).ResourceChange.AfterContext);
      workerAfter.properties.Runtime = "python3.13";
      value.Changes.at(-1).ResourceChange.AfterContext = JSON.stringify(workerAfter);
    }
  ]) {
    const value = changeSet();
    mutate(value);
    assert.throws(() =>
      validateReviewSnapshot(
        { current: common(), change_set: value },
        { object_key: OBJECT_KEY, expires_at: EXPIRY },
        NOW
      )
    );
  }
});

test("active verifies exact Lambda, rule, queue policy, mapping, and empty queues", () => {
  const result = validateActiveSnapshot(
    activeSnapshot(),
    { object_key: OBJECT_KEY, expires_at: EXPIRY },
    NOW
  );
  assert.equal(result.status, "active_verified");
  assert.equal(result.worker_enabled, true);
  assert.equal(result.event_source_mapping_count, 1);
  assert.equal(result.pathfinder_rule_count, 1);
  assert.equal(result.queue.visible, 0);
  assert.equal(result.lift_called, false);
});

test("active rejects cross-key, policy, mapping, queue, and expiry drift", () => {
  const cases = [
    (value) => {
      const pattern = JSON.parse(value.rule.EventPattern);
      pattern.detail.s3ObjectDetails.objectKey = [OBJECT_KEY.replace("A0226753", "A0226754")];
      value.rule.EventPattern = JSON.stringify(pattern);
    },
    (value) => {
      const policy = JSON.parse(value.worker_queue.Attributes.Policy);
      policy.Statement[0].Condition.StringEquals["aws:SourceAccount"] = "000000000000";
      value.worker_queue.Attributes.Policy = JSON.stringify(policy);
    },
    (value) => (value.worker_mappings.EventSourceMappings[0].State = "Disabled"),
    (value) => (value.worker_dlq.Attributes.ApproximateNumberOfMessages = "1"),
    (value) => (value.worker.Environment.Variables.UNRELATED = "unexpected"),
    (value) =>
      (value.rule_targets.Targets[0].InputTransformer.InputPathsMap.key = "$.detail.otherKey"),
    (value) =>
      (value.worker.Environment.Variables.PATHFINDER_PROOF_ASSET_SCAN_WORKER_EXPIRES_AT =
        "2026-08-02T17:59:59.000Z")
  ];
  for (const mutate of cases) {
    const snapshot = structuredClone(activeSnapshot());
    mutate(snapshot);
    assert.throws(() =>
      validateActiveSnapshot(snapshot, { object_key: OBJECT_KEY, expires_at: EXPIRY }, NOW)
    );
  }
});

test("bounded results never expose the object key or hostile identifying extras", () => {
  const marker = "customer@example.test?token=secret";
  const snapshot = activeSnapshot();
  snapshot.raw_event = marker;
  snapshot.worker.raw_provider_metadata = marker;
  const serialized = JSON.stringify(
    validateActiveSnapshot(snapshot, { object_key: OBJECT_KEY, expires_at: EXPIRY }, NOW)
  );
  assert.equal(serialized.includes(OBJECT_KEY), false);
  assert.equal(serialized.includes(marker), false);
  assert.equal(serialized.includes("raw_event"), false);
  assert.equal(serialized.includes("UNRELATED_SECRET"), false);
});

test("source contains only read-only AWS orchestration and no runtime capability primitive", () => {
  const source = readFileSync(
    new URL("../proof-asset-scan-worker-activation-qa.mjs", import.meta.url),
    "utf8"
  );
  for (const prohibited of [
    "create-change-set",
    "execute-change-set",
    "update-stack",
    "put-object",
    "delete-object",
    "put-item",
    "transact-write-items",
    "secretsmanager",
    "Authorization",
    "fetch(",
    "lifterp.com",
    "wrike.com"
  ]) {
    assert.equal(source.includes(prohibited), false, `unexpected capability marker: ${prohibited}`);
  }
});

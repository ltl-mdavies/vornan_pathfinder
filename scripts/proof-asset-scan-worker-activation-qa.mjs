import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const SCAN_WORKER_QA = Object.freeze({
  account_id: "744016783602",
  identity_arn: "arn:aws:iam::744016783602:user/ltl_mdavies",
  region: "us-east-1",
  api_stack: "vornan-pathfinder-api-prod",
  asset_stack: "vornan-proof-assets-dev",
  bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602",
  guardduty_plan_id: "3ccfe1b59ab0f6ed9760",
  worker_function: "vornan-pathfinder-api-prod-proof-asset-scan",
  worker_queue_url:
    "https://sqs.us-east-1.amazonaws.com/744016783602/vornan-pathfinder-api-prod-proof-asset-scan",
  worker_dlq_url:
    "https://sqs.us-east-1.amazonaws.com/744016783602/vornan-pathfinder-api-prod-proof-asset-scan-dlq",
  maximum_window_ms: 4 * 60 * 60 * 1_000
});

export const ACTIVATION_RESOURCE_CHANGES = Object.freeze({
  Add: Object.freeze([
    "ProofAssetScanDeadLetterAlarm",
    "ProofAssetScanEventQueuePolicy",
    "ProofAssetScanEventRule",
    "ProofAssetScanWorkerEventSource"
  ]),
  Modify: Object.freeze(["ProofAssetScanWorkerFunction"])
});
const ACTIVATION_RESOURCE_TYPES = new Map([
  ["ProofAssetScanDeadLetterAlarm", "AWS::CloudWatch::Alarm"],
  ["ProofAssetScanEventQueuePolicy", "AWS::SQS::QueuePolicy"],
  ["ProofAssetScanEventRule", "AWS::Events::Rule"],
  ["ProofAssetScanWorkerEventSource", "AWS::Lambda::EventSourceMapping"],
  ["ProofAssetScanWorkerFunction", "AWS::Lambda::Function"]
]);
const WORKER_QUEUE_ARN =
  "arn:aws:sqs:us-east-1:744016783602:vornan-pathfinder-api-prod-proof-asset-scan";
const WORKER_DLQ_NAME = "vornan-pathfinder-api-prod-proof-asset-scan-dlq";
const CONTEXT_SCHEMA_KEYS = new Map(
  [
    "Action",
    "AlarmDescription",
    "Arn",
    "ArnEquals",
    "BatchSize",
    "ComparisonOperator",
    "Condition",
    "Description",
    "Dimensions",
    "Effect",
    "Enabled",
    "Environment",
    "EvaluationPeriods",
    "EventPattern",
    "EventSourceArn",
    "FunctionName",
    "FunctionResponseTypes",
    "Id",
    "InputPathsMap",
    "InputTemplate",
    "InputTransformer",
    "MetricName",
    "Name",
    "Namespace",
    "Period",
    "PolicyDocument",
    "Principal",
    "Queues",
    "Resource",
    "Runtime",
    "Service",
    "Sid",
    "State",
    "Statement",
    "Statistic",
    "StringEquals",
    "Targets",
    "Threshold",
    "TreatMissingData",
    "Value",
    "Variables",
    "Version"
  ].map((key) => [key.toLowerCase(), `${key.charAt(0).toLowerCase()}${key.slice(1)}`])
);
const CONTEXT_BOOLEAN_KEYS = new Set(["enabled"]);
const CONTEXT_NUMBER_KEYS = new Set([
  "batchSize",
  "evaluationPeriods",
  "period",
  "threshold"
]);

const EXACT_OBJECT_KEY =
  /^orders\/A[0-9]{7,8}\/tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,255}\/revisions\/prevision_[a-f0-9]{64}\/source\/passet_[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._() -]{0,239}$/;
const EXACT_UTC =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const DARK_PARAMETERS = new Map([
  ["WrikeConnectionTestEnabled", "false"],
  ["WrikeCustomFieldDiscoveryEnabled", "false"],
  ["WrikeDiscoveryPreviewEnabled", "false"],
  ["WrikeWorkbookEvidenceEnabled", "false"],
  ["WrikeEvidencePreviewEnabled", "false"],
  ["WrikeManualIntakeEnabled", "false"],
  ["WrikeOrderRehearsalEnabled", "false"],
  ["WrikeLiftDocumentPublicationEnabled", "false"],
  ["ProofAssetUploadEnabled", "false"],
  ["ProofOperatorActionQaEnabled", "false"],
  ["ProofGrantCreationEnabled", "false"],
  ["ProofLinkEmailEnabled", "false"],
  ["AllowLiveCustomerSubmit", "false"],
  ["ExternalLiftSubmitEnabled", "true"],
  ["LiftTransportMode", "live"]
]);
const CONDITIONAL_LOGICAL_IDS = new Set([
  ...ACTIVATION_RESOURCE_CHANGES.Add,
  ...ACTIVATION_RESOURCE_CHANGES.Modify
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])])
    );
  }
  return value;
}

function mapParameters(value) {
  return new Map(
    array(value?.Parameters).map((parameter) => [parameter.ParameterKey, parameter.ParameterValue])
  );
}

function mapResources(value) {
  if (value?.NextToken) {
    throw new Error("The API stack resource inventory is incomplete.");
  }
  return new Map(
    array(value?.StackResourceSummaries ?? value?.StackResources).map((resource) => [
      resource.LogicalResourceId,
      resource
    ])
  );
}

function requireIdentity(identity) {
  if (
    identity?.Account !== SCAN_WORKER_QA.account_id ||
    identity?.Arn !== SCAN_WORKER_QA.identity_arn
  ) {
    throw new Error("The AWS caller is outside the exact Proof scan-worker QA boundary.");
  }
}

function requireSettledStack(stackResult, name) {
  const stack = stackResult?.Stacks?.[0];
  if (stack?.StackName !== name || stack?.StackStatus !== "UPDATE_COMPLETE") {
    throw new Error(`The exact ${name} stack is not settled at UPDATE_COMPLETE.`);
  }
  return stack;
}

function requireDarkParameters(parameters) {
  for (const [name, expected] of DARK_PARAMETERS) {
    if (parameters.get(name) !== expected) {
      throw new Error(`Parameter ${name} must remain ${JSON.stringify(expected)}.`);
    }
  }
}

function validateExpectedBoundary(expected, now) {
  if (!EXACT_OBJECT_KEY.test(expected?.object_key ?? "")) {
    throw new Error("One exact canonical Proof source-object key is required.");
  }
  if (!EXACT_UTC.test(expected?.expires_at ?? "")) {
    throw new Error("A strict UTC scan-worker expiry is required.");
  }
  const expiry = Date.parse(expected.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + SCAN_WORKER_QA.maximum_window_ms) {
    throw new Error("The scan-worker expiry must be future and no more than four hours away.");
  }
  return { object_key: expected.object_key, expires_at: new Date(expiry).toISOString() };
}

function queueCounts(value) {
  const attributes = value?.Attributes ?? {};
  const counts = {
    visible: Number(attributes.ApproximateNumberOfMessages),
    in_flight: Number(attributes.ApproximateNumberOfMessagesNotVisible),
    delayed: Number(attributes.ApproximateNumberOfMessagesDelayed)
  };
  if (Object.values(counts).some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error("A scan-worker queue returned invalid bounded message counts.");
  }
  return counts;
}

function requireEmptyQueue(value, name) {
  const counts = queueCounts(value);
  if (counts.visible !== 0 || counts.in_flight !== 0 || counts.delayed !== 0) {
    throw new Error(`${name} must be empty.`);
  }
  return counts;
}

function exactWorkerEnvironment(enabled, expected, parameters) {
  return {
    NODE_OPTIONS: "--enable-source-maps",
    PATHFINDER_PROOF_ENVIRONMENT_NAME: parameters.get("EnvironmentName"),
    PATHFINDER_PROOF_STORAGE_DRIVER: "dynamodb",
    PATHFINDER_PROOF_CORE_TABLE: parameters.get("ProofCoreTableName"),
    PATHFINDER_PROOF_AUDIT_TABLE: parameters.get("ProofAuditTableName"),
    PATHFINDER_PROOF_ASSET_BUCKET: parameters.get("ProofAssetBucketName"),
    PATHFINDER_PROOF_ASSET_SCAN_ACCOUNT_ID: SCAN_WORKER_QA.account_id,
    PATHFINDER_PROOF_ASSET_SCAN_REGION: SCAN_WORKER_QA.region,
    PATHFINDER_ENABLE_PROOF_ASSET_SCAN_WORKER: String(enabled),
    PATHFINDER_PROOF_ASSET_SCAN_WORKER_ALLOWED_OBJECT_KEY: enabled ? expected.object_key : "",
    PATHFINDER_PROOF_ASSET_SCAN_WORKER_EXPIRES_AT: enabled ? expected.expires_at : ""
  };
}

function requireWorker(value, enabled, expected, parameters) {
  const environment = value?.Environment?.Variables ?? {};
  const exactEnvironment = exactWorkerEnvironment(enabled, expected, parameters);
  if (
    value?.FunctionName !== SCAN_WORKER_QA.worker_function ||
    value?.State !== "Active" ||
    value?.LastUpdateStatus !== "Successful" ||
    JSON.stringify(canonicalJson(environment)) !== JSON.stringify(canonicalJson(exactEnvironment))
  ) {
    throw new Error("The scan-worker Lambda does not match the exact requested posture.");
  }
}

function requireGuardDuty(snapshot) {
  const assetStack = requireSettledStack(snapshot.asset_stack, SCAN_WORKER_QA.asset_stack);
  const outputs = new Map(
    array(assetStack.Outputs).map((output) => [output.OutputKey, output.OutputValue])
  );
  if (
    outputs.get("ProofAssetMalwareProtectionEnabled") !== "true" ||
    outputs.get("GuardDutyMalwareProtectionPlanId") !== SCAN_WORKER_QA.guardduty_plan_id ||
    outputs.get("GuardDutyMalwareProtectionPlanStatus") !== "ACTIVE" ||
    snapshot.plan?.Status !== "ACTIVE" ||
    array(snapshot.plan?.StatusReasons).length !== 0 ||
    snapshot.plan?.ProtectedResource?.S3Bucket?.BucketName !== SCAN_WORKER_QA.bucket_name ||
    JSON.stringify(snapshot.plan?.ProtectedResource?.S3Bucket?.ObjectPrefixes) !==
      JSON.stringify(["orders/"]) ||
    snapshot.plan?.Actions?.Tagging?.Status !== "ENABLED" ||
    snapshot.plan?.Role !== outputs.get("GuardDutyMalwareProtectionRoleArn")
  ) {
    throw new Error("The exact Proof GuardDuty plan is not active and healthy.");
  }
}

function requireNoActivationResources(resources, mappings, rules) {
  for (const logicalId of ACTIVATION_RESOURCE_CHANGES.Add) {
    if (resources.has(logicalId)) {
      throw new Error(`Conditional resource ${logicalId} must be absent while dark.`);
    }
  }
  if (array(mappings?.EventSourceMappings).length !== 0 || array(rules?.Rules).length !== 0) {
    throw new Error("The dark scan worker must have no event-source mapping or Pathfinder rule.");
  }
}

function sanitized(mode, enabled, expected, queue, dlq, extra = {}) {
  return {
    schema_version: 1,
    mode,
    status: `${mode}_verified`,
    worker_enabled: enabled,
    approved_object_key_sha256: expected ? sha256(expected.object_key) : null,
    expires_at: expected?.expires_at ?? null,
    queue,
    dead_letter_queue: dlq,
    customer_capabilities_enabled: false,
    upload_enabled: false,
    publication_enabled: false,
    wrike_write_enabled: false,
    live_customer_submit_enabled: false,
    lift_called: false,
    mutation_performed: false,
    ...extra
  };
}

function validateDarkSnapshot(snapshot, mode) {
  requireIdentity(snapshot.identity);
  requireGuardDuty(snapshot);
  const apiStack = requireSettledStack(snapshot.api_stack, SCAN_WORKER_QA.api_stack);
  const parameters = mapParameters(apiStack);
  requireDarkParameters(parameters);
  if (
    parameters.get("ProofAssetScanWorkerEnabled") !== "false" ||
    parameters.get("ProofAssetScanWorkerAllowedObjectKey") !== "" ||
    parameters.get("ProofAssetScanWorkerExpiresAt") !== ""
  ) {
    throw new Error("The scan-worker gate and exact-object bounds must be fully dark.");
  }
  requireWorker(snapshot.worker, false, null, parameters);
  requireNoActivationResources(
    mapResources(snapshot.api_resources),
    snapshot.worker_mappings,
    snapshot.pathfinder_rules
  );
  const queue = requireEmptyQueue(snapshot.worker_queue, "The scan-worker queue");
  const dlq = requireEmptyQueue(snapshot.worker_dlq, "The scan-worker dead-letter queue");
  return sanitized(mode, false, null, queue, dlq, {
    event_source_mapping_count: 0,
    pathfinder_rule_count: 0
  });
}

export function validatePreflightSnapshot(snapshot) {
  return validateDarkSnapshot(snapshot, "preflight");
}

export function validateClosureSnapshot(snapshot) {
  return validateDarkSnapshot(snapshot, "closure");
}

function changeSummary(changeSet) {
  if (changeSet?.NextToken) {
    throw new Error("The activation change-set inventory is incomplete.");
  }
  const summary = new Map();
  for (const entry of array(changeSet?.Changes)) {
    const change = entry?.ResourceChange;
    if (!change?.LogicalResourceId || !change?.Action) {
      throw new Error("The activation change set contains an unreadable resource change.");
    }
    if (summary.has(change.LogicalResourceId)) {
      throw new Error("The activation change set contains a duplicate logical resource change.");
    }
    summary.set(change.LogicalResourceId, change);
  }
  return summary;
}

function parseContext(encoded, label) {
  let context;
  try {
    context = JSON.parse(encoded ?? "");
  } catch {
    throw new Error(`${label} is not valid encoded JSON.`);
  }
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    JSON.stringify(Object.keys(context).map((key) => key.toLowerCase()).sort()) !==
      JSON.stringify(["properties"]) ||
    !(context.Properties ?? context.properties) ||
    typeof (context.Properties ?? context.properties) !== "object" ||
    Array.isArray(context.Properties ?? context.properties)
  ) {
    throw new Error(`${label} must contain one exact Properties object.`);
  }
  return normalizeContextKeys(context.Properties ?? context.properties);
}

function normalizeContextKeys(value) {
  if (Array.isArray(value)) return value.map(normalizeContextKeys);
  if (!value || typeof value !== "object") return value;
  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = CONTEXT_SCHEMA_KEYS.get(key.toLowerCase()) ?? key;
    if (normalizedKey in normalized) {
      throw new Error("A resource property context contains ambiguous key casing.");
    }
    if (CONTEXT_BOOLEAN_KEYS.has(normalizedKey) && [true, false, "true", "false"].includes(child)) {
      normalized[normalizedKey] = String(child).toLowerCase();
    } else if (
      CONTEXT_NUMBER_KEYS.has(normalizedKey) &&
      (typeof child === "number" || (typeof child === "string" && /^-?[0-9]+$/.test(child)))
    ) {
      normalized[normalizedKey] = String(child);
    } else {
      normalized[normalizedKey] = normalizeContextKeys(child);
    }
  }
  return normalized;
}

function exactInputTransformer() {
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

function exactEventPattern(expected) {
  return {
    source: ["aws.guardduty"],
    "detail-type": ["GuardDuty Malware Protection Object Scan Result"],
    account: [SCAN_WORKER_QA.account_id],
    region: [SCAN_WORKER_QA.region],
    detail: {
      schemaVersion: ["1.0"],
      resourceType: ["S3_OBJECT"],
      s3ObjectDetails: {
        bucketName: [SCAN_WORKER_QA.bucket_name],
        objectKey: [expected.object_key]
      }
    }
  };
}

function exactQueuePolicy(ruleArn) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowExactGuardDutyScanRule",
        Effect: "Allow",
        Principal: { Service: "events.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: WORKER_QUEUE_ARN,
        Condition: {
          ArnEquals: { "aws:SourceArn": ruleArn },
          StringEquals: { "aws:SourceAccount": SCAN_WORKER_QA.account_id }
        }
      }
    ]
  };
}

function exactAddProperties(logicalId, expected, physicalIds) {
  const ruleArn = `arn:aws:events:${SCAN_WORKER_QA.region}:${SCAN_WORKER_QA.account_id}:rule/${physicalIds.rule_name}`;
  const values = {
    ProofAssetScanEventRule: {
      Description: "Sanitizes exact GuardDuty Proof asset scan results before queueing.",
      EventPattern: exactEventPattern(expected),
      State: "ENABLED",
      Targets: [
        {
          Arn: WORKER_QUEUE_ARN,
          Id: "ProofAssetScanQueue",
          InputTransformer: exactInputTransformer()
        }
      ]
    },
    ProofAssetScanEventQueuePolicy: {
      Queues: [SCAN_WORKER_QA.worker_queue_url],
      PolicyDocument: exactQueuePolicy(ruleArn)
    },
    ProofAssetScanWorkerEventSource: {
      BatchSize: 10,
      Enabled: true,
      EventSourceArn: WORKER_QUEUE_ARN,
      FunctionName: SCAN_WORKER_QA.worker_function,
      FunctionResponseTypes: ["ReportBatchItemFailures"]
    },
    ProofAssetScanDeadLetterAlarm: {
      AlarmDescription: "Proof asset scan observations reached the dead-letter queue.",
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Dimensions: [{ Name: "QueueName", Value: WORKER_DLQ_NAME }],
      Statistic: "Maximum",
      Period: 60,
      EvaluationPeriods: 1,
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      TreatMissingData: "notBreaching"
    }
  };
  return values[logicalId];
}

function requireExactPropertyContexts(changes, expected, parameters) {
  const contexts = new Map(
    ACTIVATION_RESOURCE_CHANGES.Add.map((logicalId) => [
      logicalId,
      parseContext(changes.get(logicalId)?.AfterContext, `${logicalId} AfterContext`)
    ])
  );
  const ruleArn =
    contexts.get("ProofAssetScanEventQueuePolicy")?.policyDocument?.statement?.[0]?.condition
      ?.arnEquals?.["aws:SourceArn"];
  const ruleArnPattern = new RegExp(
    `^arn:aws:events:${SCAN_WORKER_QA.region}:${SCAN_WORKER_QA.account_id}:rule/` +
      "vornan-pathfinder-api-prod-ProofAssetScanEventRule-[A-Za-z0-9]+$"
  );
  if (!ruleArnPattern.test(ruleArn ?? "")) {
    throw new Error("The queue-policy AfterContext lacks the exact bounded Pathfinder rule ARN.");
  }
  const physicalIds = { rule_name: ruleArn.slice(ruleArn.lastIndexOf("/") + 1) };
  for (const logicalId of ACTIVATION_RESOURCE_CHANGES.Add) {
    const properties = contexts.get(logicalId);
    const expectedProperties = normalizeContextKeys(
      exactAddProperties(logicalId, expected, physicalIds)
    );
    if (
      JSON.stringify(canonicalJson(properties)) !==
      JSON.stringify(canonicalJson(expectedProperties))
    ) {
      throw new Error(`${logicalId} AfterContext does not match the exact activation contract.`);
    }
  }

  const workerChange = changes.get("ProofAssetScanWorkerFunction");
  const before = parseContext(workerChange?.BeforeContext, "The worker BeforeContext");
  const after = parseContext(workerChange?.AfterContext, "The worker AfterContext");
  const expectedEnvironment = exactWorkerEnvironment(true, expected, parameters);
  if (
    JSON.stringify(canonicalJson(after.environment?.variables)) !==
    JSON.stringify(canonicalJson(expectedEnvironment))
  ) {
    throw new Error("The worker AfterContext has an unexpected environment.");
  }
  const beforeWithoutEnvironment = structuredClone(before);
  const afterWithoutEnvironment = structuredClone(after);
  delete beforeWithoutEnvironment.environment;
  delete afterWithoutEnvironment.environment;
  if (
    JSON.stringify(canonicalJson(beforeWithoutEnvironment)) !==
    JSON.stringify(canonicalJson(afterWithoutEnvironment))
  ) {
    throw new Error("The worker AfterContext changes properties outside its environment.");
  }
}

export function validateReviewSnapshot(snapshot, expectedInput, now = Date.now()) {
  const expected = validateExpectedBoundary(expectedInput, now);
  validateDarkSnapshot(snapshot.current, "preflight");
  const changeSet = snapshot.change_set;
  if (
    changeSet?.Status !== "CREATE_COMPLETE" ||
    changeSet?.ExecutionStatus !== "AVAILABLE" ||
    changeSet?.ChangeSetType !== "UPDATE" ||
    changeSet?.StackName !== SCAN_WORKER_QA.api_stack ||
    changeSet?.StackId !== snapshot.current.api_stack.Stacks[0].StackId ||
    JSON.stringify(array(changeSet?.Capabilities)) !== JSON.stringify(["CAPABILITY_NAMED_IAM"]) ||
    array(changeSet?.NotificationARNs).length !== 0 ||
    changeSet?.IncludeNestedStacks === true
  ) {
    throw new Error("The supplied scan-worker change set is not an available API stack update.");
  }
  const parameters = mapParameters(changeSet);
  requireDarkParameters(parameters);
  if (
    parameters.get("ProofAssetScanWorkerEnabled") !== "true" ||
    parameters.get("ProofAssetScanWorkerAllowedObjectKey") !== expected.object_key ||
    parameters.get("ProofAssetScanWorkerExpiresAt") !== expected.expires_at
  ) {
    throw new Error("The change set does not contain the exact bounded scan-worker activation.");
  }
  const changes = changeSummary(changeSet);
  if (changes.size !== CONDITIONAL_LOGICAL_IDS.size) {
    throw new Error("The activation change set must contain exactly four Adds and one Modify.");
  }
  for (const [action, logicalIds] of Object.entries(ACTIVATION_RESOURCE_CHANGES)) {
    for (const logicalId of logicalIds) {
      const change = changes.get(logicalId);
      if (
        change?.Action !== action ||
        change?.ResourceType !== ACTIVATION_RESOURCE_TYPES.get(logicalId) ||
        (action === "Modify" && change.Replacement !== "False") ||
        (action === "Add" && change.Replacement && change.Replacement !== "False")
      ) {
        throw new Error(`Change ${logicalId} must be the exact reviewed ${action} operation.`);
      }
      if (action === "Modify") {
        const details = array(change.Details);
        if (
          JSON.stringify(change.Scope) !== JSON.stringify(["Properties"]) ||
          details.length === 0 ||
          details.some(
            (detail) =>
              detail?.Target?.Attribute !== "Properties" || detail?.Target?.Name !== "Environment"
          )
        ) {
          throw new Error("The worker modification must be limited to its environment properties.");
        }
      }
    }
  }
  requireExactPropertyContexts(changes, expected, parameters);
  return sanitized("review", false, expected, { visible: 0, in_flight: 0, delayed: 0 },
    { visible: 0, in_flight: 0, delayed: 0 }, {
      change_count: changes.size,
      add_count: ACTIVATION_RESOURCE_CHANGES.Add.length,
      modify_count: ACTIVATION_RESOURCE_CHANGES.Modify.length,
      change_set_execution_authorized: false
    });
}

function requireEventRule(snapshot, expected, resources) {
  const ruleResource = resources.get("ProofAssetScanEventRule");
  if (
    !ruleResource?.PhysicalResourceId ||
    snapshot.rule?.Name !== ruleResource.PhysicalResourceId ||
    snapshot.rule?.State !== "ENABLED"
  ) {
    throw new Error("The exact Pathfinder scan EventBridge rule is not enabled.");
  }
  const pattern = JSON.parse(snapshot.rule.EventPattern ?? "{}");
  const exactPattern = exactEventPattern(expected);
  if (JSON.stringify(canonicalJson(pattern)) !== JSON.stringify(canonicalJson(exactPattern))) {
    throw new Error("The EventBridge rule is not bound to the exact GuardDuty object.");
  }
  const queueArn = snapshot.worker_queue?.Attributes?.QueueArn;
  const inputTransformer = exactInputTransformer();
  const target = snapshot.rule_targets?.Targets?.[0];
  if (
    array(snapshot.rule_targets?.Targets).length !== 1 ||
    JSON.stringify(Object.keys(target ?? {}).sort()) !==
      JSON.stringify(["Arn", "Id", "InputTransformer"]) ||
    target.Id !== "ProofAssetScanQueue" ||
    target.Arn !== queueArn ||
    JSON.stringify(canonicalJson(target.InputTransformer?.InputPathsMap)) !==
      JSON.stringify(canonicalJson(inputTransformer.InputPathsMap)) ||
    String(target.InputTransformer?.InputTemplate ?? "").replace(/\s/g, "") !==
      inputTransformer.InputTemplate
  ) {
    throw new Error("The scan rule target is not the exact worker queue.");
  }
  const policy = JSON.parse(snapshot.worker_queue?.Attributes?.Policy ?? "{}");
  if (
    JSON.stringify(canonicalJson(policy)) !==
    JSON.stringify(canonicalJson(exactQueuePolicy(snapshot.rule.Arn)))
  ) {
    throw new Error("The worker queue policy is not restricted to the exact rule and account.");
  }
}

export function validateActiveSnapshot(snapshot, expectedInput, now = Date.now()) {
  const expected = validateExpectedBoundary(expectedInput, now);
  requireIdentity(snapshot.identity);
  requireGuardDuty(snapshot);
  const apiStack = requireSettledStack(snapshot.api_stack, SCAN_WORKER_QA.api_stack);
  const parameters = mapParameters(apiStack);
  requireDarkParameters(parameters);
  if (
    parameters.get("ProofAssetScanWorkerEnabled") !== "true" ||
    parameters.get("ProofAssetScanWorkerAllowedObjectKey") !== expected.object_key ||
    parameters.get("ProofAssetScanWorkerExpiresAt") !== expected.expires_at
  ) {
    throw new Error("The deployed API stack does not match the exact activation boundary.");
  }
  requireWorker(snapshot.worker, true, expected, parameters);
  const resources = mapResources(snapshot.api_resources);
  for (const logicalId of ACTIVATION_RESOURCE_CHANGES.Add) {
    if (resources.get(logicalId)?.ResourceStatus !== "CREATE_COMPLETE") {
      throw new Error(`Conditional resource ${logicalId} is not CREATE_COMPLETE.`);
    }
  }
  requireEventRule(snapshot, expected, resources);
  const queueArn = snapshot.worker_queue?.Attributes?.QueueArn;
  const mappings = array(snapshot.worker_mappings?.EventSourceMappings);
  if (
    mappings.length !== 1 ||
    mappings[0].State !== "Enabled" ||
    mappings[0].FunctionArn !== snapshot.worker?.FunctionArn ||
    mappings[0].EventSourceArn !== queueArn ||
    mappings[0].BatchSize !== 10 ||
    JSON.stringify(mappings[0].FunctionResponseTypes) !==
      JSON.stringify(["ReportBatchItemFailures"])
  ) {
    throw new Error("The scan worker must have exactly one healthy exact-queue event mapping.");
  }
  const queue = requireEmptyQueue(snapshot.worker_queue, "The scan-worker queue at activation");
  const dlq = requireEmptyQueue(snapshot.worker_dlq, "The scan-worker dead-letter queue at activation");
  return sanitized("active", true, expected, queue, dlq, {
    event_source_mapping_count: 1,
    pathfinder_rule_count: 1
  });
}

function awsJson(args) {
  const result = spawnSync("aws", [...args, "--region", SCAN_WORKER_QA.region, "--output", "json"], {
    encoding: "utf8",
    env: { ...process.env, AWS_MAX_ATTEMPTS: "1", AWS_RETRY_MODE: "standard" }
  });
  if (result.status !== 0) {
    throw new Error(`AWS read failed for ${args[0]} ${args[1] ?? ""}.`);
  }
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : {};
}

function stack(name) {
  return awsJson(["cloudformation", "describe-stacks", "--stack-name", name]);
}

function resources(name) {
  return awsJson(["cloudformation", "list-stack-resources", "--stack-name", name]);
}

function queue(url, includePolicy = false) {
  return awsJson([
    "sqs",
    "get-queue-attributes",
    "--queue-url",
    url,
    "--attribute-names",
    "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible",
    "ApproximateNumberOfMessagesDelayed",
    "QueueArn",
    ...(includePolicy ? ["Policy"] : [])
  ]);
}

function pathfinderRules() {
  return awsJson(["events", "list-rules", "--name-prefix", "vornan-pathfinder-api-prod-ProofAssetScan"]);
}

function collectCommon() {
  return {
    identity: awsJson(["sts", "get-caller-identity"]),
    asset_stack: stack(SCAN_WORKER_QA.asset_stack),
    api_stack: stack(SCAN_WORKER_QA.api_stack),
    api_resources: resources(SCAN_WORKER_QA.api_stack),
    plan: awsJson([
      "guardduty",
      "get-malware-protection-plan",
      "--malware-protection-plan-id",
      SCAN_WORKER_QA.guardduty_plan_id
    ]),
    worker: awsJson([
      "lambda",
      "get-function-configuration",
      "--function-name",
      SCAN_WORKER_QA.worker_function
    ]),
    worker_mappings: awsJson([
      "lambda",
      "list-event-source-mappings",
      "--function-name",
      SCAN_WORKER_QA.worker_function
    ]),
    pathfinder_rules: pathfinderRules(),
    worker_queue: queue(SCAN_WORKER_QA.worker_queue_url),
    worker_dlq: queue(SCAN_WORKER_QA.worker_dlq_url)
  };
}

export function collectDarkSnapshot() {
  return collectCommon();
}

export function collectReviewSnapshot(changeSetArn) {
  return {
    current: collectDarkSnapshot(),
    change_set: awsJson([
      "cloudformation",
      "describe-change-set",
      "--change-set-name",
      changeSetArn,
      "--include-property-values"
    ])
  };
}

export function collectActiveSnapshot() {
  const snapshot = collectCommon();
  const resourceMap = mapResources(snapshot.api_resources);
  const ruleName = resourceMap.get("ProofAssetScanEventRule")?.PhysicalResourceId;
  if (!ruleName) throw new Error("The active stack is missing the Pathfinder scan rule.");
  snapshot.rule = awsJson(["events", "describe-rule", "--name", ruleName]);
  snapshot.rule_targets = awsJson(["events", "list-targets-by-rule", "--rule", ruleName]);
  snapshot.worker_queue = queue(SCAN_WORKER_QA.worker_queue_url, true);
  return snapshot;
}

function expectedFromEnvironment(env) {
  return {
    object_key: env.PATHFINDER_PROOF_SCAN_WORKER_ALLOWED_OBJECT_KEY?.trim() ?? "",
    expires_at: env.PATHFINDER_PROOF_SCAN_WORKER_EXPIRES_AT?.trim() ?? ""
  };
}

export function evaluateMode(mode, options = {}) {
  const now = options.now ?? Date.now();
  const env = options.env ?? process.env;
  if (mode === "preflight") {
    return validatePreflightSnapshot(options.snapshot ?? collectDarkSnapshot());
  }
  if (mode === "closure") {
    return validateClosureSnapshot(options.snapshot ?? collectDarkSnapshot());
  }
  if (mode === "review") {
    const changeSetArn = env.PATHFINDER_PROOF_SCAN_WORKER_CHANGE_SET_ARN?.trim();
    if (!changeSetArn) throw new Error("The exact activation change-set ARN is required.");
    return validateReviewSnapshot(
      options.snapshot ?? collectReviewSnapshot(changeSetArn),
      expectedFromEnvironment(env),
      now
    );
  }
  if (mode === "active") {
    return validateActiveSnapshot(
      options.snapshot ?? collectActiveSnapshot(),
      expectedFromEnvironment(env),
      now
    );
  }
  throw new Error("Mode must be preflight, review, active, or closure.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = evaluateMode(process.argv[2] ?? "");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Proof scan-worker activation QA failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  }
}

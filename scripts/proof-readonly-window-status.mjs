import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EXPECTED_ALARM_SUFFIXES = Object.freeze([
  "public-server-errors",
  "operator-server-errors",
  "public-denial-spike",
  "waf-block-spike",
  "cached-read-p95",
  "token-exchange-p95",
  "sync-failures",
  "sync-p95",
  "sync-lag",
  "sync-dlq"
]);

const REQUIRED_OUTPUTS = Object.freeze([
  "ProofCoreTableName",
  "ProofAuditTableName",
  "ProofOperatorFunctionName",
  "ProofPublicApiEndpoint",
  "ProofWebDistributionDomainName",
  "ProofSyncQueueUrl",
  "ProofSyncDeadLetterQueueUrl",
  "ProofOperationalDashboardName"
]);

function entries(items, keyName, valueName) {
  return Object.fromEntries((items ?? []).map((item) => [item[keyName], item[valueName]]));
}

function queueDepth(attributes = {}) {
  return [
    "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible",
    "ApproximateNumberOfMessagesDelayed"
  ].reduce((total, name) => total + (Number(attributes[name]) || 0), 0);
}

function values(value, pattern) {
  return [...new Set((value ?? "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => pattern.test(candidate)))];
}

function proofWindowMode(parameters) {
  const publicReadEnabled = parameters.PublicReadEnabled === "true";
  const operatorGrantCreationEnabled = parameters.OperatorGrantCreationEnabled === "true";
  const productionPublicReadApproved = parameters.ProductionPublicReadApproved === "true";
  const ltlDemoQaEnabled = parameters.LtlDemoQaEnabled === "true";
  const noCustomDomain = !parameters.ProofDomainName && !parameters.CertificateArn;
  const canonicalProtectedDomain =
    parameters.ProofDomainName === "proof.vornan.co" && Boolean(parameters.CertificateArn);

  if (
    ltlDemoQaEnabled &&
    !publicReadEnabled &&
    !operatorGrantCreationEnabled &&
    !productionPublicReadApproved &&
    (noCustomDomain || canonicalProtectedDomain)
  ) {
    return "ltl_demo_qa";
  }
  if (
    publicReadEnabled &&
    operatorGrantCreationEnabled &&
    !productionPublicReadApproved &&
    noCustomDomain
  ) {
    return "isolated_operator_window";
  }
  if (
    publicReadEnabled &&
    !operatorGrantCreationEnabled &&
    productionPublicReadApproved &&
    canonicalProtectedDomain
  ) {
    return "protected_public_read";
  }
  return "unrecognized";
}

function parseStoredData(item) {
  const value = item?.data?.S;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeProofAccess(items = [], now = new Date()) {
  const nowMs = now.getTime();
  const counts = {
    grants_total: 0,
    grants_active: 0,
    sessions_total: 0,
    sessions_active: 0,
    malformed_records: 0
  };
  for (const item of items) {
    const data = parseStoredData(item);
    if (!data) {
      counts.malformed_records += 1;
      continue;
    }
    if (typeof data.session_hash === "string") {
      counts.sessions_total += 1;
      if (
        !data.ended_at
        && Number.isFinite(Date.parse(data.expires_at))
        && Date.parse(data.expires_at) > nowMs
      ) {
        counts.sessions_active += 1;
      }
      continue;
    }
    if (typeof data.grant_id === "string") {
      counts.grants_total += 1;
      if (
        data.status === "active"
        && !data.revoked_at
        && Number.isFinite(Date.parse(data.expires_at))
        && Date.parse(data.expires_at) > nowMs
      ) {
        counts.grants_active += 1;
      }
      continue;
    }
    counts.malformed_records += 1;
  }
  return counts;
}

export function evaluateProofReadOnlyWindowStatus(input = {}, now = new Date()) {
  const stack = input.stack ?? {};
  const parameters = entries(stack.Parameters, "ParameterKey", "ParameterValue");
  const outputs = entries(stack.Outputs, "OutputKey", "OutputValue");
  const windowMode = proofWindowMode(parameters);
  const ltlDemoQaActive = windowMode === "ltl_demo_qa";
  const expiry = ltlDemoQaActive
    ? parameters.LtlDemoQaExpiresAt ?? ""
    : parameters.ReadOnlyActivationExpiresAt ?? "";
  const expiryMs = Date.parse(expiry);
  const cohort = ltlDemoQaActive
    ? ["1249"]
    : values(parameters.GrantAllowedCustomerIds, /^\d{1,20}$/);
  const allowedOrders = values(parameters.LtlDemoQaAllowedOrders, /^A\d{7,8}$/);
  const expectedAlarmNames = EXPECTED_ALARM_SUFFIXES.map(
    (suffix) => `vornan-proof-dev-${suffix}`
  );
  const alarmStates = Object.fromEntries(
    (input.alarms ?? []).map((alarm) => [alarm.AlarmName, alarm.StateValue])
  );
  const missingAlarms = expectedAlarmNames.filter((name) => !alarmStates[name]);
  const nonOkAlarms = expectedAlarmNames.filter(
    (name) => alarmStates[name] && alarmStates[name] !== "OK"
  );
  const outputGates = Object.fromEntries(REQUIRED_OUTPUTS.map((name) => [name, Boolean(outputs[name])]));
  const access = summarizeProofAccess(input.access_items, now);
  const mainQueueDepth = queueDepth(input.queue_attributes);
  const deadLetterQueueDepth = queueDepth(input.dlq_attributes);
  const gates = {
    stack_complete: /^(CREATE|UPDATE)_COMPLETE$/.test(stack.StackStatus ?? ""),
    environment_is_dev: parameters.EnvironmentName === "dev",
    lift_environment_is_dev: parameters.LiftReadEnvironment === "dev",
    production_reads_acknowledged: parameters.ProductionLiftReadsAcknowledged === "true",
    recognized_window_mode: windowMode !== "unrecognized",
    public_read_window_enabled:
      parameters.PublicReadEnabled === "true" || ltlDemoQaActive,
    read_only_qa_recorded: parameters.ReadOnlyQaConfirmed === "true",
    operator_boundary_valid:
      windowMode === "isolated_operator_window"
        ? parameters.OperatorGrantCreationEnabled === "true"
        : parameters.OperatorGrantCreationEnabled === "false",
    activation_deadline_active: Number.isFinite(expiryMs) && expiryMs > now.getTime(),
    approved_cohort_configured: cohort.length > 0,
    ltl_demo_order_allowlist_configured: !ltlDemoQaActive || allowedOrders.length > 0,
    production_public_read_boundary_valid:
      windowMode === "protected_public_read"
        ? parameters.ProductionPublicReadApproved === "true"
        : parameters.ProductionPublicReadApproved === "false",
    synthetic_worker_disabled: parameters.SyntheticQaEnabled === "false",
    domain_boundary_valid:
      windowMode === "protected_public_read"
        ? parameters.ProofDomainName === "proof.vornan.co" && Boolean(parameters.CertificateArn)
        : (!parameters.ProofDomainName && !parameters.CertificateArn) ||
          (ltlDemoQaActive && parameters.ProofDomainName === "proof.vornan.co" && Boolean(parameters.CertificateArn)),
    waf_configured: parameters.ManagedWebAclEnabled === "true" || Boolean(parameters.ProofWebAclArn),
    required_outputs_available: Object.values(outputGates).every(Boolean),
    all_expected_alarms_present: missingAlarms.length === 0,
    all_alarms_ok: missingAlarms.length === 0 && nonOkAlarms.length === 0,
    sync_queue_empty: mainQueueDepth === 0,
    dead_letter_queue_empty: deadLetterQueueDepth === 0,
    access_records_well_formed: access.malformed_records === 0,
    no_active_grants: access.grants_active === 0,
    no_active_sessions: access.sessions_active === 0
  };
  const safetyGateNames = [
    "stack_complete",
    "environment_is_dev",
    "lift_environment_is_dev",
    "production_reads_acknowledged",
    "recognized_window_mode",
    "public_read_window_enabled",
    "read_only_qa_recorded",
    "operator_boundary_valid",
    "approved_cohort_configured",
    "ltl_demo_order_allowlist_configured",
    "production_public_read_boundary_valid",
    "synthetic_worker_disabled",
    "domain_boundary_valid",
    "waf_configured",
    "required_outputs_available"
  ];
  let status = "healthy_no_active_access";
  let nextAction = "continue_bounded_read_only_monitoring";
  if (safetyGateNames.some((name) => !gates[name])) {
    status = "unsafe_window_configuration";
    nextAction = "restore_dark_stack_and_investigate";
  } else if (!gates.activation_deadline_active) {
    status = "window_expired_restore_dark";
    nextAction = "revoke_access_and_restore_dark_stack";
  } else if (!gates.access_records_well_formed) {
    status = "access_inventory_unreadable";
    nextAction = "preserve_evidence_and_investigate_access_store";
  } else if (!gates.all_expected_alarms_present || !gates.all_alarms_ok) {
    status = "alarm_attention_required";
    nextAction = "follow_alarm_response_runbook";
  } else if (!gates.sync_queue_empty || !gates.dead_letter_queue_empty) {
    status = "queue_attention_required";
    nextAction = "preserve_queue_evidence_and_investigate";
  } else if (!gates.no_active_grants || !gates.no_active_sessions) {
    status = "active_access_requires_review";
    nextAction = "verify_expected_use_or_revoke_access";
  }

  return {
    status,
    checked_at: now.toISOString(),
    window_mode: windowMode,
    activation_expires_at: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
    cohort_size: cohort.length,
    allowed_order_count: allowedOrders.length,
    capabilities: {
      public_read: parameters.PublicReadEnabled === "true" || ltlDemoQaActive,
      operator_grant_creation: parameters.OperatorGrantCreationEnabled === "true",
      customer_approval:
        parameters.CustomerApprovalEnabled === "true" || ltlDemoQaActive,
      customer_revision_upload:
        parameters.CustomerRevisionUploadEnabled === "true" || ltlDemoQaActive,
      private_asset_upload:
        parameters.ProofAssetUploadEnabled === "true" || ltlDemoQaActive
    },
    counts: {
      alarms_expected: expectedAlarmNames.length,
      alarms_missing: missingAlarms.length,
      alarms_not_ok: nonOkAlarms.length,
      sync_queue_messages: mainQueueDepth,
      dead_letter_queue_messages: deadLetterQueueDepth,
      ...access
    },
    gates,
    output_gates: outputGates,
    public_read_change_authorized: false,
    grant_creation_change_authorized: false,
    deployment_authorized: false,
    dns_authorized: false,
    email_authorized: false,
    decision_authorized: false,
    lift_write_authorized: false,
    phase3_authorized: false,
    next_action: nextAction
  };
}

function awsJson(args) {
  const result = spawnSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    env: { ...process.env, AWS_PAGER: "" },
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Read-only AWS inventory failed for ${args[0]} ${args[1]}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Read-only AWS inventory returned invalid JSON for ${args[0]} ${args[1]}.`);
  }
}

function queueAttributes(queueUrl, region) {
  return awsJson([
    "sqs", "get-queue-attributes",
    "--queue-url", queueUrl,
    "--attribute-names",
    "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible",
    "ApproximateNumberOfMessagesDelayed",
    "--region", region
  ]).Attributes ?? {};
}

export function collectProofReadOnlyWindowStatus({
  stackName = "vornan-proof-dev",
  region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
} = {}) {
  if (stackName !== "vornan-proof-dev") {
    throw new Error("The window status check is restricted to vornan-proof-dev.");
  }
  const described = awsJson([
    "cloudformation", "describe-stacks", "--stack-name", stackName, "--region", region
  ]);
  const stack = described.Stacks?.[0];
  if (!stack) throw new Error("The isolated Proof dev stack was not found.");
  const outputs = entries(stack.Outputs, "OutputKey", "OutputValue");
  const alarms = awsJson([
    "cloudwatch", "describe-alarms",
    "--alarm-name-prefix", "vornan-proof-dev-",
    "--region", region
  ]).MetricAlarms ?? [];
  const access = awsJson([
    "dynamodb", "scan",
    "--table-name", outputs.ProofCoreTableName,
    "--projection-expression", "#data",
    "--filter-expression", "begins_with(sk, :grant) OR begins_with(pk, :session)",
    "--expression-attribute-names", JSON.stringify({ "#data": "data" }),
    "--expression-attribute-values", JSON.stringify({
      ":grant": { S: "GRANT#" },
      ":session": { S: "SESSION#" }
    }),
    "--region", region
  ]);
  return evaluateProofReadOnlyWindowStatus({
    stack,
    alarms,
    queue_attributes: queueAttributes(outputs.ProofSyncQueueUrl, region),
    dlq_attributes: queueAttributes(outputs.ProofSyncDeadLetterQueueUrl, region),
    access_items: access.Items ?? []
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = collectProofReadOnlyWindowStatus({
      stackName: process.env.PATHFINDER_PROOF_STACK_NAME?.trim() || "vornan-proof-dev"
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "healthy_no_active_access") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `Vornan Proof read-only window status failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  }
}

import { pathToFileURL } from "node:url";
import { collectProofReadOnlyWindowStatus } from "./proof-readonly-window-status.mjs";

export const PROOF_DARK_RESTORE_PARAMETER_CHANGES = Object.freeze({
  PublicReadEnabled: "false",
  ReadOnlyActivationExpiresAt: "",
  OperatorGrantCreationEnabled: "false",
  GrantAllowedCustomerIds: "",
  SyntheticQaEnabled: "false",
  ReadOnlyQaConfirmed: "false",
  ProductionPublicReadApproved: "false",
  ProofDomainName: "",
  CertificateArn: ""
});

export const PROOF_DARK_RESTORE_RETAINED_RESOURCES = Object.freeze([
  "ProofCoreTableName",
  "ProofAuditTableName",
  "ProofOperatorFunctionName",
  "ProofPublicApiEndpoint",
  "ProofWebDistributionDomainName",
  "ProofSyncQueueUrl",
  "ProofSyncDeadLetterQueueUrl",
  "ProofOperationalDashboardName"
]);

const ALLOWED_TRIGGERS = new Set(["preparation", "deadline", "rollback"]);

function exactDarkTarget(target = {}) {
  return Object.entries(PROOF_DARK_RESTORE_PARAMETER_CHANGES)
    .every(([name, expected]) => target[name] === expected)
    && Object.keys(target).length === Object.keys(PROOF_DARK_RESTORE_PARAMETER_CHANGES).length;
}

export function evaluateProofDarkRestorePreflight(
  windowStatus = {},
  {
    trigger = "preparation",
    rollbackApproved = false,
    targetParameters = PROOF_DARK_RESTORE_PARAMETER_CHANGES,
    now = new Date()
  } = {}
) {
  const expiryMs = Date.parse(windowStatus.activation_expires_at ?? "");
  const triggerValid = ALLOWED_TRIGGERS.has(trigger);
  const triggerSatisfied = trigger === "preparation"
    || (trigger === "deadline" && Number.isFinite(expiryMs) && now.getTime() >= expiryMs)
    || (trigger === "rollback" && rollbackApproved === true);
  const outputGates = windowStatus.output_gates ?? {};
  const retainedOutputsAvailable = PROOF_DARK_RESTORE_RETAINED_RESOURCES
    .every((name) => outputGates[name] === true);
  const sourceGates = windowStatus.gates ?? {};
  const gates = {
    source_stack_complete: sourceGates.stack_complete === true,
    source_environment_is_dev: sourceGates.environment_is_dev === true,
    source_window_is_bounded: sourceGates.activation_deadline_active === true
      || trigger === "deadline",
    production_public_read_unapproved: sourceGates.production_public_read_unapproved === true,
    synthetic_worker_disabled: sourceGates.synthetic_worker_disabled === true,
    custom_domain_absent: sourceGates.custom_domain_absent === true,
    waf_retained: sourceGates.waf_configured === true,
    retained_outputs_available: retainedOutputsAvailable,
    access_records_well_formed: sourceGates.access_records_well_formed === true,
    no_active_grants: sourceGates.no_active_grants === true,
    no_active_sessions: sourceGates.no_active_sessions === true,
    all_expected_alarms_present: sourceGates.all_expected_alarms_present === true,
    all_alarms_ok: sourceGates.all_alarms_ok === true,
    sync_queue_empty: sourceGates.sync_queue_empty === true,
    dead_letter_queue_empty: sourceGates.dead_letter_queue_empty === true,
    exact_dark_target: exactDarkTarget(targetParameters),
    trigger_valid: triggerValid,
    trigger_satisfied: triggerSatisfied
  };
  const unmet = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  let status = "ready_for_dark_restore_preparation_review";
  let nextAction = "prepare_minimal_reviewed_change_set_without_execution";
  if (!triggerValid) {
    status = "dark_restore_preflight_blocked";
    nextAction = "select_valid_restore_trigger";
  } else if (trigger === "deadline" && !triggerSatisfied) {
    status = "awaiting_dark_restore_deadline";
    nextAction = "continue_monitoring_until_deadline_or_rollback";
  } else if (trigger === "rollback" && !triggerSatisfied) {
    status = "rollback_approval_required";
    nextAction = "record_explicit_rollback_approval";
  } else if (unmet.length > 0) {
    status = "dark_restore_preflight_blocked";
    nextAction = "resolve_preflight_blockers_before_change_review";
  } else if (trigger !== "preparation") {
    status = "ready_for_manual_dark_restore_change_review";
    nextAction = "review_exact_parameter_only_change_set";
  }

  return {
    status,
    checked_at: now.toISOString(),
    trigger,
    activation_expires_at: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
    source_window_status: typeof windowStatus.status === "string" ? windowStatus.status : "unknown",
    access_counts: {
      grants_active: Number(windowStatus.counts?.grants_active) || 0,
      sessions_active: Number(windowStatus.counts?.sessions_active) || 0,
      malformed_records: Number(windowStatus.counts?.malformed_records) || 0
    },
    queue_counts: {
      sync: Number(windowStatus.counts?.sync_queue_messages) || 0,
      dead_letter: Number(windowStatus.counts?.dead_letter_queue_messages) || 0
    },
    alarm_counts: {
      expected: Number(windowStatus.counts?.alarms_expected) || 0,
      missing: Number(windowStatus.counts?.alarms_missing) || 0,
      not_ok: Number(windowStatus.counts?.alarms_not_ok) || 0
    },
    target_parameter_changes: { ...PROOF_DARK_RESTORE_PARAMETER_CHANGES },
    use_previous_value_for_all_other_parameters: true,
    retain_resources: [...PROOF_DARK_RESTORE_RETAINED_RESOURCES],
    execution_review_ready: unmet.length === 0 && trigger !== "preparation" && triggerSatisfied,
    gates,
    unmet_gates: unmet,
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

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const trigger = process.env.PATHFINDER_PROOF_DARK_RESTORE_TRIGGER?.trim() || "preparation";
    const result = evaluateProofDarkRestorePreflight(collectProofReadOnlyWindowStatus(), {
      trigger,
      rollbackApproved: enabled(process.env.PATHFINDER_PROOF_DARK_RESTORE_ROLLBACK_APPROVED)
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!["ready_for_dark_restore_preparation_review", "ready_for_manual_dark_restore_change_review"]
      .includes(result.status)) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `Vornan Proof dark-restore preflight failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  }
}

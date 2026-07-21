import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { evaluateProofPhase2Readiness } from "./proof-phase2-readiness.mjs";

const TRUE = "true";

export const REQUIRED_ACTIVATION_SCOPE = Object.freeze([
  "dev_stack_only_recorded",
  "demo_account_cohort_recorded",
  "time_bounded_window_recorded",
  "private_link_handoff_recorded"
]);

export const REQUIRED_OPERATING_CONTROLS = Object.freeze([
  "rollback_operator_recorded",
  "monitoring_operator_recorded",
  "support_response_target_recorded",
  "customer_escalation_path_recorded",
  "grant_revocation_plan_recorded",
  "dark_restore_plan_recorded"
]);

export const REQUIRED_SAFETY_CONSTRAINTS = Object.freeze([
  "production_public_read_approval_disabled",
  "dns_change_excluded",
  "link_email_disabled",
  "decisions_disabled",
  "lift_writes_disabled",
  "pathfinder_production_surfaces_unchanged",
  "synthetic_mode_disabled"
]);

function passed(source, name) {
  return source?.[name] === true;
}

function evaluateGroup(source, names) {
  const gates = Object.fromEntries(names.map((name) => [name, passed(source, name)]));
  const unmet = names.filter((name) => !gates[name]);
  return {
    complete: unmet.length === 0,
    passed: names.length - unmet.length,
    total: names.length,
    gates,
    unmet
  };
}

export function evaluateProofReadOnlyActivationReview(phase2Input = {}, reviewInput = {}) {
  const phase2 = evaluateProofPhase2Readiness(phase2Input);
  const scope = evaluateGroup(reviewInput.activation_scope, REQUIRED_ACTIVATION_SCOPE);
  const operating = evaluateGroup(reviewInput.operating_controls, REQUIRED_OPERATING_CONTROLS);
  const safety = evaluateGroup(reviewInput.safety_constraints, REQUIRED_SAFETY_CONSTRAINTS);
  const deployedBoundaryComplete = phase2.gates.activation_review.deployed_grant_session_lifecycle_passed
    && phase2.gates.activation_review.deployed_one_order_customer_boundary_passed;
  const approvalRecorded = phase2.gates.activation_review.explicit_read_only_activation_approval_recorded;

  let status;
  let nextAction;
  if (!safety.complete) {
    status = "unsafe_activation_constraint_violation";
    nextAction = "restore_read_only_activation_constraints";
  } else if (!phase2.isolated_read_only_evidence_complete || !phase2.dark_guardrails_intact) {
    status = "phase2_readiness_regressed";
    nextAction = "restore_phase2_evidence_and_dark_guardrails";
  } else if (!deployedBoundaryComplete) {
    status = "deployed_boundary_prerequisites_incomplete";
    nextAction = "complete_deployed_customer_boundary_qa";
  } else if (!scope.complete || !operating.complete) {
    status = "activation_review_packet_incomplete";
    nextAction = "record_activation_scope_and_operating_owners";
  } else if (!approvalRecorded) {
    status = "awaiting_explicit_read_only_activation_approval";
    nextAction = "request_explicit_read_only_activation_approval";
  } else {
    status = "ready_for_manual_read_only_activation_review";
    nextAction = "perform_human_change_and_rollback_review";
  }

  return {
    status,
    phase2_status: phase2.status,
    isolated_read_only_evidence_complete: phase2.isolated_read_only_evidence_complete,
    dark_guardrails_intact: phase2.dark_guardrails_intact,
    deployed_boundary_prerequisites_complete: deployedBoundaryComplete,
    explicit_read_only_activation_approval_recorded: approvalRecorded,
    activation_scope_complete: scope.complete,
    operating_controls_complete: operating.complete,
    safety_constraints_intact: safety.complete,
    safe_to_prepare_activation_review: safety.complete
      && phase2.isolated_read_only_evidence_complete
      && phase2.dark_guardrails_intact
      && deployedBoundaryComplete,
    public_read_change_authorized: false,
    grant_creation_change_authorized: false,
    deployment_authorized: false,
    dns_authorized: false,
    email_authorized: false,
    decision_authorized: false,
    lift_write_authorized: false,
    phase3_authorized: false,
    counts: {
      activation_scope_passed: scope.passed,
      activation_scope_total: scope.total,
      operating_controls_passed: operating.passed,
      operating_controls_total: operating.total,
      safety_constraints_passed: safety.passed,
      safety_constraints_total: safety.total
    },
    gates: {
      activation_scope: scope.gates,
      operating_controls: operating.gates,
      safety_constraints: safety.gates
    },
    unmet_gates: {
      activation_scope: scope.unmet,
      operating_controls: operating.unmet,
      safety_constraints: safety.unmet
    },
    next_action: nextAction
  };
}

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === TRUE;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const phase2Path = process.env.PATHFINDER_PROOF_PHASE2_READINESS_FILE?.trim()
      || "docs/VORNAN_PROOF_PHASE_2_READINESS_STATE_2026-07-21.json";
    const reviewPath = process.env.PATHFINDER_PROOF_ACTIVATION_REVIEW_FILE?.trim()
      || "docs/VORNAN_PROOF_READ_ONLY_ACTIVATION_REVIEW_STATE_2026-07-21.json";
    const result = evaluateProofReadOnlyActivationReview(
      JSON.parse(readFileSync(phase2Path, "utf8")),
      JSON.parse(readFileSync(reviewPath, "utf8"))
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    const unsafe = [
      "unsafe_activation_constraint_violation",
      "phase2_readiness_regressed",
      "deployed_boundary_prerequisites_incomplete"
    ].includes(result.status);
    const requireReady = enabled(process.env.PATHFINDER_PROOF_REQUIRE_ACTIVATION_PACKET_READY)
      && result.status !== "ready_for_manual_read_only_activation_review";
    if (unsafe || requireReady) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `Vornan Proof read-only activation review failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  }
}

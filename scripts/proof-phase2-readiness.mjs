import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TRUE = "true";

export const REQUIRED_READ_ONLY_EVIDENCE = Object.freeze([
  "dark_boundary_passed",
  "synthetic_lifecycle_passed",
  "fixture_purged",
  "lift_origin_read_passed",
  "pathfinder_origin_read_passed",
  "cached_refresh_passed",
  "order_line_correlation_passed",
  "audit_coverage_passed",
  "queue_failure_handling_passed",
  "telemetry_alarms_logs_passed",
  "responsive_fail_closed_passed"
]);

export const REQUIRED_DARK_GUARDRAILS = Object.freeze([
  "public_read_disabled",
  "grant_creation_disabled",
  "link_email_disabled",
  "decisions_disabled",
  "lift_writes_disabled",
  "dns_absent",
  "read_only_qa_confirmation_disabled",
  "production_public_read_approval_disabled"
]);

export const REQUIRED_ACTIVATION_REVIEW = Object.freeze([
  "deployed_grant_session_lifecycle_passed",
  "deployed_one_order_customer_boundary_passed",
  "explicit_read_only_activation_approval_recorded"
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

export function evaluateProofPhase2Readiness(input = {}) {
  const evidence = evaluateGroup(input.evidence, REQUIRED_READ_ONLY_EVIDENCE);
  const guardrails = evaluateGroup(input.guardrails, REQUIRED_DARK_GUARDRAILS);
  const activation = evaluateGroup(input.activation_review, REQUIRED_ACTIVATION_REVIEW);

  let status;
  let nextAction;
  if (!guardrails.complete) {
    status = "unsafe_guardrail_violation";
    nextAction = "restore_dark_guardrails";
  } else if (!evidence.complete) {
    status = "read_only_evidence_incomplete";
    nextAction = "complete_isolated_read_only_qa";
  } else if (!activation.complete) {
    status = "isolated_read_qa_complete_activation_blocked";
    nextAction = activation.unmet.length === 1
      && activation.unmet[0] === "explicit_read_only_activation_approval_recorded"
      ? "request_explicit_read_only_activation_approval"
      : "request_explicit_customer_boundary_approval";
  } else {
    status = "ready_for_explicit_activation_review";
    nextAction = "perform_human_activation_review";
  }

  return {
    status,
    isolated_read_only_evidence_complete: evidence.complete,
    dark_guardrails_intact: guardrails.complete,
    activation_review_prerequisites_complete: activation.complete,
    safe_to_continue_read_only_work: guardrails.complete,
    public_read_change_authorized: false,
    mutation_authorized: false,
    counts: {
      evidence_passed: evidence.passed,
      evidence_total: evidence.total,
      guardrails_passed: guardrails.passed,
      guardrails_total: guardrails.total,
      activation_review_passed: activation.passed,
      activation_review_total: activation.total
    },
    gates: {
      evidence: evidence.gates,
      dark_guardrails: guardrails.gates,
      activation_review: activation.gates
    },
    unmet_gates: {
      evidence: evidence.unmet,
      dark_guardrails: guardrails.unmet,
      activation_review: activation.unmet
    },
    next_action: nextAction
  };
}

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === TRUE;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidencePath = process.env.PATHFINDER_PROOF_PHASE2_READINESS_FILE?.trim()
      || "docs/VORNAN_PROOF_PHASE_2_READINESS_STATE_2026-07-21.json";
    const input = JSON.parse(readFileSync(evidencePath, "utf8"));
    const result = evaluateProofPhase2Readiness(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (
      enabled(process.env.PATHFINDER_PROOF_REQUIRE_ACTIVATION_REVIEW_READY)
      && result.status !== "ready_for_explicit_activation_review"
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `Vornan Proof Phase 2 readiness check failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  }
}

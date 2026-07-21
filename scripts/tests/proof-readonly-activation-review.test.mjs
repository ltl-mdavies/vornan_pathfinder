import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_ACTIVATION_SCOPE,
  REQUIRED_OPERATING_CONTROLS,
  REQUIRED_SAFETY_CONSTRAINTS,
  evaluateProofReadOnlyActivationReview
} from "../proof-readonly-activation-review.mjs";
import {
  REQUIRED_ACTIVATION_REVIEW,
  REQUIRED_DARK_GUARDRAILS,
  REQUIRED_READ_ONLY_EVIDENCE
} from "../proof-phase2-readiness.mjs";

function complete(names) {
  return Object.fromEntries(names.map((name) => [name, true]));
}

function phase2State() {
  return {
    evidence: complete(REQUIRED_READ_ONLY_EVIDENCE),
    guardrails: complete(REQUIRED_DARK_GUARDRAILS),
    activation_review: {
      deployed_grant_session_lifecycle_passed: true,
      deployed_one_order_customer_boundary_passed: true,
      explicit_read_only_activation_approval_recorded: false
    }
  };
}

function incompleteReviewState() {
  return {
    activation_scope: {
      dev_stack_only_recorded: true,
      single_order_scope_recorded: false,
      time_bounded_window_recorded: false,
      private_link_handoff_recorded: true
    },
    operating_controls: {
      rollback_operator_recorded: false,
      monitoring_operator_recorded: false,
      support_response_target_recorded: false,
      customer_escalation_path_recorded: false,
      grant_revocation_plan_recorded: true,
      dark_restore_plan_recorded: true
    },
    safety_constraints: complete(REQUIRED_SAFETY_CONSTRAINTS)
  };
}

test("reports the bounded activation packet gaps without authorizing a change", () => {
  const result = evaluateProofReadOnlyActivationReview(phase2State(), incompleteReviewState());

  assert.equal(result.status, "activation_review_packet_incomplete");
  assert.equal(result.safe_to_prepare_activation_review, true);
  assert.equal(result.counts.activation_scope_passed, 2);
  assert.equal(result.counts.operating_controls_passed, 2);
  assert.equal(result.counts.safety_constraints_passed, REQUIRED_SAFETY_CONSTRAINTS.length);
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.grant_creation_change_authorized, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.lift_write_authorized, false);
  assert.equal(result.phase3_authorized, false);
});

test("waits for explicit activation approval after scope and operations are complete", () => {
  const review = {
    activation_scope: complete(REQUIRED_ACTIVATION_SCOPE),
    operating_controls: complete(REQUIRED_OPERATING_CONTROLS),
    safety_constraints: complete(REQUIRED_SAFETY_CONSTRAINTS)
  };
  const result = evaluateProofReadOnlyActivationReview(phase2State(), review);

  assert.equal(result.status, "awaiting_explicit_read_only_activation_approval");
  assert.equal(result.next_action, "request_explicit_read_only_activation_approval");
  assert.equal(result.deployment_authorized, false);
});

test("requires a separate manual change review even after explicit approval is recorded", () => {
  const phase2 = phase2State();
  phase2.activation_review = complete(REQUIRED_ACTIVATION_REVIEW);
  const review = {
    activation_scope: complete(REQUIRED_ACTIVATION_SCOPE),
    operating_controls: complete(REQUIRED_OPERATING_CONTROLS),
    safety_constraints: complete(REQUIRED_SAFETY_CONSTRAINTS)
  };
  const result = evaluateProofReadOnlyActivationReview(phase2, review);

  assert.equal(result.status, "ready_for_manual_read_only_activation_review");
  assert.equal(result.next_action, "perform_human_change_and_rollback_review");
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.grant_creation_change_authorized, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.dns_authorized, false);
  assert.equal(result.email_authorized, false);
  assert.equal(result.decision_authorized, false);
  assert.equal(result.lift_write_authorized, false);
});

test("gives a safety-constraint violation priority over recorded approval", () => {
  const phase2 = phase2State();
  phase2.activation_review = complete(REQUIRED_ACTIVATION_REVIEW);
  const review = {
    activation_scope: complete(REQUIRED_ACTIVATION_SCOPE),
    operating_controls: complete(REQUIRED_OPERATING_CONTROLS),
    safety_constraints: complete(REQUIRED_SAFETY_CONSTRAINTS)
  };
  review.safety_constraints.link_email_disabled = false;
  const result = evaluateProofReadOnlyActivationReview(phase2, review);

  assert.equal(result.status, "unsafe_activation_constraint_violation");
  assert.deepEqual(result.unmet_gates.safety_constraints, ["link_email_disabled"]);
  assert.equal(result.safe_to_prepare_activation_review, false);
  assert.equal(result.deployment_authorized, false);
});

test("fails closed when Phase 2 evidence or the deployed boundary regresses", () => {
  const review = incompleteReviewState();
  const evidenceRegression = phase2State();
  evidenceRegression.evidence.cached_refresh_passed = false;
  assert.equal(
    evaluateProofReadOnlyActivationReview(evidenceRegression, review).status,
    "phase2_readiness_regressed"
  );

  const boundaryRegression = phase2State();
  boundaryRegression.activation_review.deployed_one_order_customer_boundary_passed = false;
  assert.equal(
    evaluateProofReadOnlyActivationReview(boundaryRegression, review).status,
    "deployed_boundary_prerequisites_incomplete"
  );
});

test("treats truthy strings and missing controls as unpassed", () => {
  const review = incompleteReviewState();
  review.activation_scope.single_order_scope_recorded = "true";
  delete review.safety_constraints.synthetic_mode_disabled;
  const result = evaluateProofReadOnlyActivationReview(phase2State(), review);

  assert.equal(result.gates.activation_scope.single_order_scope_recorded, false);
  assert.equal(result.gates.safety_constraints.synthetic_mode_disabled, false);
  assert.equal(result.status, "unsafe_activation_constraint_violation");
});

test("ignores identifying or hostile extra fields in bounded output", () => {
  const marker = "A0999999-secret@example.test-https://signed.example/token";
  const phase2 = phase2State();
  const review = incompleteReviewState();
  phase2.order_number = marker;
  review.activation_scope.approval_note = marker;
  review.operating_controls.owner_email = marker;
  review.safety_constraints.raw_link = marker;

  const serialized = JSON.stringify(evaluateProofReadOnlyActivationReview(phase2, review));
  assert.equal(serialized.includes(marker), false);
  assert.equal(serialized.includes("approval_note"), false);
  assert.equal(serialized.includes("owner_email"), false);
});

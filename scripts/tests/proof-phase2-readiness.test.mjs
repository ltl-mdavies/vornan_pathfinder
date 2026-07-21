import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProofPhase2Readiness,
  REQUIRED_ACTIVATION_REVIEW,
  REQUIRED_DARK_GUARDRAILS,
  REQUIRED_READ_ONLY_EVIDENCE
} from "../proof-phase2-readiness.mjs";

function complete(names) {
  return Object.fromEntries(names.map((name) => [name, true]));
}

function currentDarkState() {
  return {
    evidence: complete(REQUIRED_READ_ONLY_EVIDENCE),
    guardrails: complete(REQUIRED_DARK_GUARDRAILS),
    activation_review: {
      deployed_grant_session_lifecycle_passed: false,
      deployed_one_order_customer_boundary_passed: false,
      explicit_read_only_activation_approval_recorded: false
    }
  };
}

test("recognizes complete isolated read QA while keeping activation blocked", () => {
  const result = evaluateProofPhase2Readiness(currentDarkState());

  assert.equal(result.status, "isolated_read_qa_complete_activation_blocked");
  assert.equal(result.isolated_read_only_evidence_complete, true);
  assert.equal(result.dark_guardrails_intact, true);
  assert.equal(result.activation_review_prerequisites_complete, false);
  assert.equal(result.safe_to_continue_read_only_work, true);
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.mutation_authorized, false);
  assert.deepEqual(result.unmet_gates.activation_review, REQUIRED_ACTIVATION_REVIEW);
  assert.equal(result.next_action, "request_explicit_customer_boundary_approval");
});

test("requests activation approval after the deployed boundary prerequisites pass", () => {
  const input = currentDarkState();
  input.activation_review.deployed_grant_session_lifecycle_passed = true;
  input.activation_review.deployed_one_order_customer_boundary_passed = true;
  const result = evaluateProofPhase2Readiness(input);

  assert.equal(result.status, "isolated_read_qa_complete_activation_blocked");
  assert.deepEqual(result.unmet_gates.activation_review, ["explicit_read_only_activation_approval_recorded"]);
  assert.equal(result.next_action, "request_explicit_read_only_activation_approval");
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.mutation_authorized, false);
});

test("fails closed when any required read-only evidence is absent", () => {
  const input = currentDarkState();
  input.evidence.pathfinder_origin_read_passed = false;
  const result = evaluateProofPhase2Readiness(input);

  assert.equal(result.status, "read_only_evidence_incomplete");
  assert.deepEqual(result.unmet_gates.evidence, ["pathfinder_origin_read_passed"]);
  assert.equal(result.public_read_change_authorized, false);
});

test("gives dark guardrail restoration priority over completed evidence", () => {
  const input = currentDarkState();
  input.guardrails.public_read_disabled = false;
  input.activation_review = complete(REQUIRED_ACTIVATION_REVIEW);
  const result = evaluateProofPhase2Readiness(input);

  assert.equal(result.status, "unsafe_guardrail_violation");
  assert.equal(result.next_action, "restore_dark_guardrails");
  assert.equal(result.safe_to_continue_read_only_work, false);
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.mutation_authorized, false);
});

test("requires an explicit human review even when every prerequisite passes", () => {
  const input = currentDarkState();
  input.activation_review = complete(REQUIRED_ACTIVATION_REVIEW);
  const result = evaluateProofPhase2Readiness(input);

  assert.equal(result.status, "ready_for_explicit_activation_review");
  assert.equal(result.activation_review_prerequisites_complete, true);
  assert.equal(result.next_action, "perform_human_activation_review");
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.mutation_authorized, false);
});

test("ignores hostile or identifying extra fields in its bounded output", () => {
  const marker = "A0999999-secret@example.test-https://signed.example/token";
  const input = currentDarkState();
  input.order_number = marker;
  input.evidence.notes = marker;
  input.guardrails.raw_payload = marker;
  input.activation_review.reviewer_email = marker;

  const serialized = JSON.stringify(evaluateProofPhase2Readiness(input));
  assert.equal(serialized.includes(marker), false);
  assert.equal(serialized.includes("order_number"), false);
  assert.equal(serialized.includes("reviewer_email"), false);
});

test("treats truthy strings and missing values as unpassed", () => {
  const input = currentDarkState();
  input.evidence.dark_boundary_passed = "true";
  delete input.guardrails.dns_absent;
  const result = evaluateProofPhase2Readiness(input);

  assert.equal(result.gates.evidence.dark_boundary_passed, false);
  assert.equal(result.gates.dark_guardrails.dns_absent, false);
  assert.equal(result.status, "unsafe_guardrail_violation");
});

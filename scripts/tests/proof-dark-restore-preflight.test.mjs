import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateProofDarkRestorePreflight,
  PROOF_DARK_RESTORE_PARAMETER_CHANGES
} from "../proof-dark-restore-preflight.mjs";

function status(overrides = {}) {
  const {
    counts: countOverrides = {},
    gates: gateOverrides = {},
    output_gates: outputGateOverrides,
    ...extra
  } = overrides;
  return {
    status: "healthy_no_active_access",
    activation_expires_at: "2026-07-28T21:49:50.000Z",
    counts: {
      alarms_expected: 10,
      alarms_missing: 0,
      alarms_not_ok: 0,
      sync_queue_messages: 0,
      dead_letter_queue_messages: 0,
      grants_active: 0,
      sessions_active: 0,
      malformed_records: 0,
      ...countOverrides
    },
    gates: {
      stack_complete: true,
      environment_is_dev: true,
      activation_deadline_active: true,
      production_public_read_unapproved: true,
      synthetic_worker_disabled: true,
      custom_domain_absent: true,
      waf_configured: true,
      access_records_well_formed: true,
      no_active_grants: true,
      no_active_sessions: true,
      all_expected_alarms_present: true,
      all_alarms_ok: true,
      sync_queue_empty: true,
      dead_letter_queue_empty: true,
      ...gateOverrides
    },
    output_gates: outputGateOverrides ?? Object.fromEntries([
      "ProofCoreTableName",
      "ProofAuditTableName",
      "ProofOperatorFunctionName",
      "ProofPublicApiEndpoint",
      "ProofWebDistributionDomainName",
      "ProofSyncQueueUrl",
      "ProofSyncDeadLetterQueueUrl",
      "ProofOperationalDashboardName"
    ].map((name) => [name, true])),
    ...extra
  };
}

test("prepares the exact flag-only dark target without authorizing execution", () => {
  const result = evaluateProofDarkRestorePreflight(status(), {
    now: new Date("2026-07-22T00:00:00.000Z")
  });
  assert.equal(result.status, "ready_for_dark_restore_preparation_review");
  assert.deepEqual(result.target_parameter_changes, PROOF_DARK_RESTORE_PARAMETER_CHANGES);
  assert.equal(result.use_previous_value_for_all_other_parameters, true);
  assert.equal(result.execution_review_ready, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.lift_write_authorized, false);
});

test("blocks preparation with active access, queue work, alarms, or malformed records", () => {
  const result = evaluateProofDarkRestorePreflight(status({
    counts: { grants_active: 1, sessions_active: 1, sync_queue_messages: 1, alarms_not_ok: 1, malformed_records: 1 },
    gates: {
      no_active_grants: false,
      no_active_sessions: false,
      sync_queue_empty: false,
      all_alarms_ok: false,
      access_records_well_formed: false
    }
  }));
  assert.equal(result.status, "dark_restore_preflight_blocked");
  assert.deepEqual(result.unmet_gates.filter((name) => [
    "access_records_well_formed",
    "no_active_grants",
    "no_active_sessions",
    "all_alarms_ok",
    "sync_queue_empty"
  ].includes(name)), [
    "access_records_well_formed",
    "no_active_grants",
    "no_active_sessions",
    "all_alarms_ok",
    "sync_queue_empty"
  ]);
});

test("requires the real deadline before a deadline-triggered execution review", () => {
  const before = evaluateProofDarkRestorePreflight(status(), {
    trigger: "deadline",
    now: new Date("2026-07-28T20:00:00.000Z")
  });
  assert.equal(before.status, "awaiting_dark_restore_deadline");
  assert.equal(before.execution_review_ready, false);

  const after = evaluateProofDarkRestorePreflight(status({ gates: { activation_deadline_active: false } }), {
    trigger: "deadline",
    now: new Date("2026-07-28T21:49:50.000Z")
  });
  assert.equal(after.status, "ready_for_manual_dark_restore_change_review");
  assert.equal(after.execution_review_ready, true);
  assert.equal(after.deployment_authorized, false);
});

test("requires explicit approval for a rollback-triggered review", () => {
  const blocked = evaluateProofDarkRestorePreflight(status(), { trigger: "rollback" });
  assert.equal(blocked.status, "rollback_approval_required");
  const ready = evaluateProofDarkRestorePreflight(status(), {
    trigger: "rollback",
    rollbackApproved: true
  });
  assert.equal(ready.status, "ready_for_manual_dark_restore_change_review");
  assert.equal(ready.execution_review_ready, true);
});

test("rejects target drift and missing retained resources", () => {
  const target = { ...PROOF_DARK_RESTORE_PARAMETER_CHANGES, PublicReadEnabled: "true" };
  const missing = status();
  missing.output_gates.ProofCoreTableName = false;
  const result = evaluateProofDarkRestorePreflight(missing, { targetParameters: target });
  assert.equal(result.status, "dark_restore_preflight_blocked");
  assert.equal(result.gates.exact_dark_target, false);
  assert.equal(result.gates.retained_outputs_available, false);
});

test("emits only bounded counts and never imports a mutating AWS operation", () => {
  const input = status({
    customer_id: "sensitive-customer",
    order_number: "sensitive-order",
    access_url: "sensitive-url"
  });
  const result = evaluateProofDarkRestorePreflight(input);
  assert.doesNotMatch(JSON.stringify(result), /sensitive-customer|sensitive-order|sensitive-url/);
  const source = readFileSync(new URL("../proof-dark-restore-preflight.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /"update-stack"|"create-change-set"|"execute-change-set"|"invoke"|"put-item"|"delete-item"|"send-message"/
  );
});

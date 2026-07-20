import assert from "node:assert/strict";
import test from "node:test";
import { proofReadOnlyPosture, type ProofIntegrationHealth } from "../src/proof-ops-health.ts";

const deployedHealth: ProofIntegrationHealth = {
  phase: "tokenized_customer_read_foundation",
  storage_driver: "dynamodb",
  core_table_configured: true,
  audit_table_configured: true,
  lift_reads: {
    order_host: "qa.lifterp.example",
    report_host: "qa.lifterp.example",
    timeout_ms: 15_000,
    concurrency: 5,
    proof_readable_min_step: null,
    custom_auth_configured: false
  },
  sync: {
    queue_configured: true,
    stale_after_minutes: 15,
    automatic_refresh_max_inactive_days: 14
  },
  access: {
    edge_secret_configured: true,
    public_base_host: "proof.qa.vornan.co",
    grant_ttl_days: 14,
    session_ttl_minutes: 30
  },
  feature_flags: {
    grant_creation: false,
    proof_link_email: false,
    public_read: false,
    approve: false,
    revision: false,
    undo: false
  },
  qa_lifecycle: {
    isolated_endpoint_confirmed: false,
    dedicated_credentials_confirmed: false,
    approval_cycle_confirmed: false,
    revision_cycle_confirmed: false,
    lift_writes_enabled: false
  }
};

test("distinguishes dark and active read-only deployment posture without implying decision readiness", () => {
  const dark = proofReadOnlyPosture(deployedHealth);
  assert.equal(dark.level, "dark_deploy_ready");
  assert.deepEqual(dark.blockers, []);

  const active = proofReadOnlyPosture({
    ...deployedHealth,
    feature_flags: { ...deployedHealth.feature_flags, public_read: true }
  });
  assert.equal(active.level, "deployed_read_only");
  assert.match(active.detail, /decision and Lift-write capabilities remain locked/i);
});

test("labels local QA separately and reports every missing deployment boundary", () => {
  const local = proofReadOnlyPosture({
    ...deployedHealth,
    storage_driver: "local",
    core_table_configured: false,
    audit_table_configured: false,
    sync: { ...deployedHealth.sync, queue_configured: false },
    access: { ...deployedHealth.access, edge_secret_configured: false }
  });
  assert.equal(local.level, "local_qa");
  assert.deepEqual(local.blockers, [
    "Dedicated DynamoDB core and audit persistence are not fully configured.",
    "The isolated synchronization queue is not configured.",
    "The CloudFront-to-API edge secret is not configured."
  ]);
});

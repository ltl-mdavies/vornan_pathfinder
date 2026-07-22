import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateProofReadOnlyWindowStatus,
  summarizeProofAccess
} from "../proof-readonly-window-status.mjs";

const alarmSuffixes = [
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
];

function item(data) {
  return { data: { S: JSON.stringify(data) } };
}

function inventory(overrides = {}) {
  const parameters = {
    EnvironmentName: "dev",
    LiftReadEnvironment: "dev",
    ProductionLiftReadsAcknowledged: "true",
    PublicReadEnabled: "true",
    ReadOnlyActivationExpiresAt: "2099-07-28T21:49:50.000Z",
    OperatorGrantCreationEnabled: "true",
    GrantAllowedCustomerIds: "1249",
    SyntheticQaEnabled: "false",
    ReadOnlyQaConfirmed: "true",
    ProductionPublicReadApproved: "false",
    ProofDomainName: "",
    CertificateArn: "",
    ManagedWebAclEnabled: "true",
    ProofWebAclArn: "",
    ...(overrides.parameters ?? {})
  };
  const outputs = Object.fromEntries([
    "ProofCoreTableName",
    "ProofAuditTableName",
    "ProofOperatorFunctionName",
    "ProofPublicApiEndpoint",
    "ProofWebDistributionDomainName",
    "ProofSyncQueueUrl",
    "ProofSyncDeadLetterQueueUrl",
    "ProofOperationalDashboardName"
  ].map((name) => [name, `${name}-value`]));
  return {
    stack: {
      StackStatus: overrides.stackStatus ?? "UPDATE_COMPLETE",
      Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
      Outputs: Object.entries({ ...outputs, ...(overrides.outputs ?? {}) })
        .map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }))
    },
    alarms: (overrides.alarms ?? alarmSuffixes.map((suffix) => ({
      AlarmName: `vornan-proof-dev-${suffix}`,
      StateValue: "OK"
    }))),
    queue_attributes: overrides.queue ?? {},
    dlq_attributes: overrides.dlq ?? {},
    access_items: overrides.access ?? []
  };
}

test("reports a healthy bounded window with no active access", () => {
  const result = evaluateProofReadOnlyWindowStatus(inventory(), new Date("2026-07-21T22:00:00.000Z"));
  assert.equal(result.status, "healthy_no_active_access");
  assert.equal(result.cohort_size, 1);
  assert.equal(result.counts.alarms_expected, 10);
  assert.equal(result.public_read_change_authorized, false);
  assert.equal(result.grant_creation_change_authorized, false);
  assert.equal(result.deployment_authorized, false);
  assert.equal(result.lift_write_authorized, false);
});

test("fails closed for an expired or unsafe stack posture", () => {
  const expired = evaluateProofReadOnlyWindowStatus(
    inventory({ parameters: { ReadOnlyActivationExpiresAt: "2026-07-20T00:00:00.000Z" } }),
    new Date("2026-07-21T22:00:00.000Z")
  );
  assert.equal(expired.status, "window_expired_restore_dark");

  const unsafe = evaluateProofReadOnlyWindowStatus(inventory({ parameters: {
    ProductionPublicReadApproved: "true",
    ProofDomainName: "proof.vornan.co",
    CertificateArn: "certificate"
  } }), new Date("2026-07-21T22:00:00.000Z"));
  assert.equal(unsafe.status, "unsafe_window_configuration");
  assert.equal(unsafe.next_action, "restore_dark_stack_and_investigate");
});

test("surfaces alarm, queue, and active-access attention without identifiers", () => {
  const alarms = inventory().alarms;
  alarms[0] = { ...alarms[0], StateValue: "ALARM" };
  const alarmResult = evaluateProofReadOnlyWindowStatus(inventory({ alarms }));
  assert.equal(alarmResult.status, "alarm_attention_required");
  assert.equal(alarmResult.counts.alarms_not_ok, 1);

  const queueResult = evaluateProofReadOnlyWindowStatus(inventory({
    queue: { ApproximateNumberOfMessagesNotVisible: "1" }
  }));
  assert.equal(queueResult.status, "queue_attention_required");

  const accessResult = evaluateProofReadOnlyWindowStatus(inventory({ access: [
    item({ grant_id: "sensitive-grant", status: "active", revoked_at: null, expires_at: "2099-01-01T00:00:00.000Z" }),
    item({ session_hash: "sensitive-session", ended_at: null, expires_at: "2099-01-01T00:00:00.000Z" })
  ] }));
  assert.equal(accessResult.status, "active_access_requires_review");
  assert.equal(accessResult.counts.grants_active, 1);
  assert.equal(accessResult.counts.sessions_active, 1);
  assert.doesNotMatch(JSON.stringify(accessResult), /sensitive-grant|sensitive-session/);
});

test("counts revoked, expired, ended, and malformed records safely", () => {
  const result = summarizeProofAccess([
    item({ grant_id: "g1", status: "revoked", revoked_at: "2026-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" }),
    item({ grant_id: "g2", status: "active", revoked_at: null, expires_at: "2020-01-01T00:00:00Z" }),
    item({ session_hash: "s1", ended_at: "2026-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" }),
    { data: { S: "not-json" } }
  ], new Date("2026-07-21T22:00:00.000Z"));
  assert.deepEqual(result, {
    grants_total: 2,
    grants_active: 0,
    sessions_total: 1,
    sessions_active: 0,
    malformed_records: 1
  });
});

test("the collector is dev-only and contains no mutating AWS operations", () => {
  const source = readFileSync(new URL("../proof-readonly-window-status.mjs", import.meta.url), "utf8");
  assert.match(source, /stackName !== "vornan-proof-dev"/);
  assert.match(source, /cloudformation", "describe-stacks/);
  assert.match(source, /cloudwatch", "describe-alarms/);
  assert.match(source, /sqs", "get-queue-attributes/);
  assert.match(source, /dynamodb", "scan/);
  assert.doesNotMatch(source, /lambda", "invoke|update-stack|create-change-set|put-item|delete-item|send-message|purge-queue/);
});

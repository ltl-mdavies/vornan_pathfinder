import assert from "node:assert/strict";
import test from "node:test";
import { proofMetricEnvelope, proofPublicOperation } from "../src/proof/telemetry.ts";

test("classifies every read-only public route without using customer identifiers as metric dimensions", () => {
  assert.deepEqual([
    proofPublicOperation("POST", "/api/public/proof/sessions"),
    proofPublicOperation("GET", "/api/public/proof/order"),
    proofPublicOperation("POST", "/api/public/proof/order/refresh"),
    proofPublicOperation("DELETE", "/api/public/proof/sessions/current"),
    proofPublicOperation("POST", "/api/public/proof/participants"),
    proofPublicOperation("GET", "/api/public/proof/tasks/private-task-id/history"),
    proofPublicOperation("POST", "/api/public/proof/tasks/private-task-id/feedback-acknowledgements"),
    proofPublicOperation("GET", "/api/public/proof/health")
  ], [
    "token_exchange",
    "cached_order_read",
    "manual_refresh",
    "session_logout",
    "participant_identity",
    "task_history",
    "feedback_acknowledgement",
    "health_read"
  ]);
  assert.equal(proofPublicOperation("POST", "/api/public/proof/tasks/private-task-id/approve"), "unknown_public_route");
  assert.equal(proofPublicOperation("GET", "/api/public/proof/tasks/private/task/history"), "unknown_public_route");
});

test("emits bounded CloudWatch metric dimensions without proof secrets or customer data", () => {
  process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME = "qa";
  const envelope = proofMetricEnvelope({
    service: "public-api",
    operation: "token_exchange",
    duration_ms: 123.6,
    server_error: false,
    denied: true,
    correlation_id: "request-123",
    timestamp: 1_721_476_800_000
  });
  assert.equal(envelope.Environment, "qa");
  assert.equal(envelope.Duration, 124);
  assert.equal(envelope.DeniedRequests, 1);
  assert.deepEqual(envelope._aws.CloudWatchMetrics[0]?.Dimensions, [
    ["Service", "Environment"],
    ["Service", "Environment", "Operation"]
  ]);
  const serialized = JSON.stringify(envelope).toLowerCase();
  for (const forbidden of [
    "must-not-appear",
    "vornan_proof_session",
    "session_hash",
    "customer_name",
    "attachment_id",
    "signed_url",
    "order_number"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `metric envelope contained ${forbidden}`);
  }
});

test("sanitizes untrusted correlation and failure labels", () => {
  const envelope = proofMetricEnvelope({
    service: "sync-worker",
    operation: "sync_order",
    duration_ms: -10,
    server_error: true,
    denied: false,
    correlation_id: "unsafe token=value",
    failure_class: "LiftProofReadError: https://secret.invalid/?token=value",
    timestamp: 1
  });
  assert.equal(envelope.Duration, 0);
  assert.match(envelope.correlation_id, /^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(envelope.failure_class, "OtherError");
});

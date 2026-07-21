import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { proofMetricEnvelope, proofPublicOperation, proofPublicTelemetry } from "../src/proof/telemetry.ts";

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

test("captures the public operation before mounted routers rewrite the request path", () => {
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "console";
  const emitted: Record<string, unknown>[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => {
    if (typeof value === "string") emitted.push(JSON.parse(value));
  };
  try {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      setHeader(name: string, value: string): void;
    };
    response.statusCode = 200;
    response.setHeader = () => undefined;
    const request = { method: "GET", path: "/api/public/proof/order" } as never;
    proofPublicTelemetry(request, response as never, () => {
      (request as { path: string }).path = "/order";
    });
    response.emit("finish");
  } finally {
    console.log = originalLog;
  }
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.Operation, "cached_order_read");
});

test("classifies an intentionally disabled public lifecycle as a denial instead of a server error", () => {
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "console";
  const emitted: Record<string, unknown>[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => {
    if (typeof value === "string") emitted.push(JSON.parse(value));
  };
  try {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      locals: Record<string, unknown>;
      setHeader(name: string, value: string): void;
    };
    response.statusCode = 503;
    response.locals = { proof_expected_denial: true };
    response.setHeader = () => undefined;
    proofPublicTelemetry({ method: "POST", path: "/api/public/proof/sessions" } as never, response as never, () => undefined);
    response.emit("finish");
  } finally {
    console.log = originalLog;
  }
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.Operation, "token_exchange");
  assert.equal(emitted[0]?.DeniedRequests, 1);
  assert.equal(emitted[0]?.ServerErrors, 0);
});

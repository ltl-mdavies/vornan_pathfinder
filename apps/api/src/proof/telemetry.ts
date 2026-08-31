import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const METRIC_NAMESPACE = "Vornan/Proof";
export const PROOF_EXPECTED_DENIAL_LOCAL = "proof_expected_denial";
const SAFE_FAILURE_CLASSES = new Set([
  "Error",
  "LiftProofReadError",
  "ProofSyntheticQaFailure",
  "ProofOrderNotFoundError",
  "ProofStorageDisabledError",
  "SyntaxError",
  "TypeError"
]);
const SAFE_OPERATIONS = new Map([
  ["POST /api/public/proof/sessions", "token_exchange"],
  ["GET /api/public/proof/order", "cached_order_read"],
  ["POST /api/public/proof/order/refresh", "manual_refresh"],
  ["POST /api/public/proof/sessions/current/extend", "session_extend"],
  ["DELETE /api/public/proof/sessions/current", "session_logout"],
  ["POST /api/public/proof/participants", "participant_identity"],
  ["GET /api/public/proof/shares", "shared_link_list"],
  ["POST /api/public/proof/shares", "shared_link_create"],
  ["GET /api/public/proof/health", "health_read"]
]);
const PUBLIC_PROOF_TASK_PREFIX = "/api/public/proof/tasks/";

interface MetricEnvelopeInput {
  service: "public-api" | "sync-worker" | "operator-admin" | "asset-worker";
  operation: string;
  duration_ms: number;
  server_error: boolean;
  denied: boolean;
  correlation_id: string;
  failure_class?: string | null;
  timestamp?: number;
}

function environmentName() {
  const value = process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME?.trim().toLowerCase() || "local";
  return /^[a-z0-9-]{1,32}$/.test(value) ? value : "invalid";
}

function safeCorrelationId(value: string) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : randomUUID();
}

export function proofMetricEnvelope(input: MetricEnvelopeInput) {
  const metrics = [
    { Name: "Requests", Unit: "Count" },
    { Name: "Duration", Unit: "Milliseconds" },
    { Name: "ServerErrors", Unit: "Count" },
    { Name: "DeniedRequests", Unit: "Count" }
  ];
  return {
    _aws: {
      Timestamp: input.timestamp ?? Date.now(),
      CloudWatchMetrics: [{
        Namespace: METRIC_NAMESPACE,
        Dimensions: [["Service", "Environment"], ["Service", "Environment", "Operation"]],
        Metrics: metrics
      }]
    },
    Service: input.service,
    Environment: environmentName(),
    Operation: input.operation,
    Requests: 1,
    Duration: Math.max(0, Math.round(input.duration_ms)),
    ServerErrors: input.server_error ? 1 : 0,
    DeniedRequests: input.denied ? 1 : 0,
    correlation_id: safeCorrelationId(input.correlation_id),
    ...(input.failure_class ? { failure_class: SAFE_FAILURE_CLASSES.has(input.failure_class) ? input.failure_class : "OtherError" } : {})
  };
}

export function emitProofMetric(input: MetricEnvelopeInput) {
  if (process.env.PATHFINDER_PROOF_TELEMETRY_MODE === "off") {
    return;
  }
  console.log(JSON.stringify(proofMetricEnvelope(input)));
}

export function proofPublicOperation(method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "DELETE" && /^\/api\/public\/proof\/shares\/[^/]+$/.test(path)) {
    return "shared_link_revoke";
  }
  const exact = SAFE_OPERATIONS.get(`${normalizedMethod} ${path}`);
  if (exact) return exact;
  if (!path.startsWith(PUBLIC_PROOF_TASK_PREFIX)) return "unknown_public_route";

  const segments = path.slice(PUBLIC_PROOF_TASK_PREFIX.length).split("/");
  if (!segments[0] || segments.some((segment) => !segment)) return "unknown_public_route";
  if (normalizedMethod === "GET" && segments.length === 2 && segments[1] === "history") {
    return "task_history";
  }
  if (normalizedMethod === "POST" && segments.length === 2 && segments[1] === "feedback-acknowledgements") {
    return "feedback_acknowledgement";
  }
  if (segments.length === 3 && segments[1] === "detailed-reports") {
    if (normalizedMethod === "POST") return "detailed_report_start";
    if (normalizedMethod === "GET") return "detailed_report_status";
  }
  return "unknown_public_route";
}

export function proofPublicTelemetry(req: Request, res: Response, next: NextFunction) {
  const startedAt = performance.now();
  const correlationId = randomUUID();
  const operation = proofPublicOperation(req.method, req.path);
  res.setHeader("X-Request-ID", correlationId);
  res.on("finish", () => {
    const expectedDenial = res.locals?.[PROOF_EXPECTED_DENIAL_LOCAL] === true;
    emitProofMetric({
      service: "public-api",
      operation,
      duration_ms: performance.now() - startedAt,
      server_error: res.statusCode >= 500 && !expectedDenial,
      denied: expectedDenial || res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429,
      correlation_id: correlationId
    });
  });
  next();
}

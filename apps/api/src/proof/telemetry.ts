import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const METRIC_NAMESPACE = "Vornan/Proof";
const SAFE_FAILURE_CLASSES = new Set([
  "Error",
  "LiftProofReadError",
  "ProofOrderNotFoundError",
  "ProofStorageDisabledError",
  "SyntaxError",
  "TypeError"
]);
const SAFE_OPERATIONS = new Map([
  ["POST /api/public/proof/sessions", "token_exchange"],
  ["GET /api/public/proof/order", "cached_order_read"],
  ["POST /api/public/proof/order/refresh", "manual_refresh"],
  ["DELETE /api/public/proof/sessions/current", "session_logout"],
  ["POST /api/public/proof/participants", "participant_identity"],
  ["GET /api/public/proof/health", "health_read"]
]);
const SAFE_TASK_OPERATIONS = [
  { method: "GET", suffix: "/history", operation: "task_history" },
  { method: "POST", suffix: "/feedback-acknowledgements", operation: "feedback_acknowledgement" }
] as const;

interface MetricEnvelopeInput {
  service: "public-api" | "sync-worker";
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
  const exact = SAFE_OPERATIONS.get(`${normalizedMethod} ${path}`);
  if (exact) return exact;
  for (const route of SAFE_TASK_OPERATIONS) {
    if (
      normalizedMethod === route.method
      && path.startsWith("/api/public/proof/tasks/")
      && path.endsWith(route.suffix)
      && path.slice("/api/public/proof/tasks/".length, -route.suffix.length).length > 0
      && !path.slice("/api/public/proof/tasks/".length, -route.suffix.length).includes("/")
    ) {
      return route.operation;
    }
  }
  return "unknown_public_route";
}

export function proofPublicTelemetry(req: Request, res: Response, next: NextFunction) {
  const startedAt = performance.now();
  const correlationId = randomUUID();
  res.setHeader("X-Request-ID", correlationId);
  res.on("finish", () => {
    emitProofMetric({
      service: "public-api",
      operation: proofPublicOperation(req.method, req.path),
      duration_ms: performance.now() - startedAt,
      server_error: res.statusCode >= 500,
      denied: res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429,
      correlation_id: correlationId
    });
  });
  next();
}

import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import request from "supertest";
import { LiftProofReadError } from "@pathfinder/lift-proof-adapter";
import type { ProofOrder } from "@pathfinder/proof-domain";
import { createProofAdminRouter, type ProofAdminRouterDependencies } from "../src/proof/router.ts";

const previousGrantCreationFlag = process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION;
process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";

after(() => {
  if (previousGrantCreationFlag === undefined) delete process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION;
  else process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = previousGrantCreationFlag;
});

const now = "2026-07-20T12:00:00.000Z";
const cachedOrder: ProofOrder = {
  order_number: "A0221132",
  order_title: "QA proof packet",
  customer_name: null,
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [],
  tasks: [],
  archived_tasks: [],
  warnings: [],
  created_at: now,
  updated_at: now,
  last_synced_at: now
};

const grantResult = {
  grant: {
    grant_id: "pgrant_route_qa",
    order_number: cachedOrder.order_number,
    scope: "view" as const,
    label: "Customer review",
    status: "active" as const,
    created_at: now,
    expires_at: "2026-08-03T12:00:00.000Z",
    exchanged_at: null,
    revoked_at: null,
    last_used_at: null,
    participant_count: 0
  },
  access_url: "https://proof.vornan.co/#/access/route-test-token"
};

function appWith(dependencies: ProofAdminRouterDependencies) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { uid: "operator-route-qa" };
    next();
  });
  app.use("/api/proof", createProofAdminRouter(dependencies));
  return app;
}

function successfulSync(order: ProofOrder) {
  return {
    order,
    diagnostics: {
      source: "lift_read" as const,
      completed_at: now,
      line_reads: { attempted: 0, succeeded: 0, failed: 0, proof_rows: 0 },
      fallback_read: { attempted: false, ok: null, proof_rows: 0 },
      normalization_warning_count: 0
    }
  };
}

test("reports a redacted operator integration-health posture without exposing secrets or Lift paths", async () => {
  const names = [
    "PATHFINDER_RUNTIME",
    "PATHFINDER_PROOF_STORAGE_DRIVER",
    "PATHFINDER_PROOF_CORE_TABLE",
    "PATHFINDER_PROOF_AUDIT_TABLE",
    "PATHFINDER_PROOF_SYNC_QUEUE_URL",
    "PATHFINDER_PROOF_EDGE_SHARED_SECRET",
    "PATHFINDER_PROOF_PUBLIC_BASE_URL",
    "PATHFINDER_PROOF_LIFT_ORDER_READ_URL",
    "PATHFINDER_PROOF_LIFT_REPORT_READ_URL"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    PATHFINDER_RUNTIME: "lambda",
    PATHFINDER_PROOF_STORAGE_DRIVER: "dynamodb",
    PATHFINDER_PROOF_CORE_TABLE: "Pathfinder-ProofCore-qa",
    PATHFINDER_PROOF_AUDIT_TABLE: "Pathfinder-ProofAudit-qa",
    PATHFINDER_PROOF_SYNC_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123456789012/private-proof-queue",
    PATHFINDER_PROOF_EDGE_SHARED_SECRET: "must-not-appear-in-health-response",
    PATHFINDER_PROOF_PUBLIC_BASE_URL: "https://proof.qa.vornan.co/private/path",
    PATHFINDER_PROOF_LIFT_ORDER_READ_URL: "https://qa-lift.example.invalid/private/AS360Orders/N?token=secret",
    PATHFINDER_PROOF_LIFT_REPORT_READ_URL: "https://qa-lift.example.invalid/private/AS360ProofReport/N?token=secret"
  });
  try {
    const response = await request(appWith({})).get("/api/proof/health/lift").expect(200);
    assert.equal(response.body.storage_driver, "dynamodb");
    assert.equal(response.body.core_table_configured, true);
    assert.equal(response.body.audit_table_configured, true);
    assert.deepEqual(response.body.sync, {
      queue_configured: true,
      stale_after_minutes: 15,
      automatic_refresh_max_inactive_days: 14
    });
    assert.deepEqual(response.body.access, {
      edge_secret_configured: true,
      public_base_host: "proof.qa.vornan.co",
      grant_ttl_days: 14,
      session_ttl_minutes: 30
    });
    assert.equal(response.body.lift_reads.order_host, "qa-lift.example.invalid");
    assert.equal(response.body.feature_flags.approve, false);
    assert.equal(response.body.feature_flags.revision, false);
    assert.equal(response.body.feature_flags.undo, false);
    assert.equal(response.body.qa_lifecycle.lift_writes_enabled, false);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("must-not-appear"), false);
    assert.equal(serialized.includes("token=secret"), false);
    assert.equal(serialized.includes("private-proof-queue"), false);
    assert.equal(serialized.includes("/private/"), false);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("performs no cache lookup or Lift sync while grant creation is disabled", async () => {
  const lifecycle: string[] = [];
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "false";
  try {
    const response = await request(appWith({
      getOrderForGrant: async () => {
        lifecycle.push("get");
        return null;
      },
      syncOrderForGrant: async () => {
        lifecycle.push("sync");
        return successfulSync(cachedOrder);
      },
      createGrant: async () => {
        lifecycle.push("grant");
        return grantResult;
      }
    }))
      .post("/api/proof/orders/A0221132/grants")
      .send({ scope: "view" })
      .expect(503);

    assert.deepEqual(lifecycle, []);
    assert.deepEqual(response.body, { error: "Vornan Proof grant creation is disabled." });
  } finally {
    process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  }
});

test("performs the first read-only sync before creating a grant for an uncached order", async () => {
  const lifecycle: string[] = [];
  const response = await request(appWith({
    getOrderForGrant: async (orderNumber) => {
      lifecycle.push(`get:${orderNumber}`);
      return null;
    },
    syncOrderForGrant: async (orderNumber, options) => {
      lifecycle.push(`sync:${orderNumber}`);
      assert.deepEqual(options.audit_context, {
        actor_type: "operator",
        actor_id: "operator-route-qa",
        correlation_id: "grant-first-sync-1",
        source: "operator"
      });
      return successfulSync(cachedOrder);
    },
    createGrant: async (input) => {
      lifecycle.push(`grant:${input.order_number}`);
      assert.equal(input.scope, "view");
      assert.equal(input.label, "Customer review");
      return grantResult;
    }
  }))
    .post("/api/proof/orders/a0221132/grants")
    .set("X-Request-Id", "grant-first-sync-1")
    .send({ scope: "view", label: "Customer review" })
    .expect(201);

  assert.deepEqual(lifecycle, ["get:A0221132", "sync:A0221132", "grant:A0221132"]);
  assert.deepEqual(response.body, grantResult);
});

test("refreshes a stale cached order but does not re-read a fresh order before grant creation", async () => {
  for (const [stale, expectedLifecycle] of [
    [true, ["get", "stale", "sync", "grant"]],
    [false, ["get", "fresh", "grant"]]
  ] as const) {
    const lifecycle: string[] = [];
    await request(appWith({
      getOrderForGrant: async () => {
        lifecycle.push("get");
        return cachedOrder;
      },
      orderIsStale: () => {
        lifecycle.push(stale ? "stale" : "fresh");
        return stale;
      },
      syncOrderForGrant: async () => {
        lifecycle.push("sync");
        return successfulSync(cachedOrder);
      },
      createGrant: async () => {
        lifecycle.push("grant");
        return grantResult;
      }
    }))
      .post("/api/proof/orders/A0221132/grants")
      .send({ scope: "view" })
      .expect(201);
    assert.deepEqual(lifecycle, expectedLifecycle);
  }
});

test("returns the read failure and never creates a grant when the prerequisite sync fails", async () => {
  let grantCreated = false;
  const response = await request(appWith({
    getOrderForGrant: async () => null,
    syncOrderForGrant: async () => {
      throw new LiftProofReadError("Lift proof read failed with HTTP 503.", 503, "https://qa-lift.example.invalid/orders");
    },
    createGrant: async () => {
      grantCreated = true;
      return grantResult;
    }
  }))
    .post("/api/proof/orders/A0221132/grants")
    .send({ scope: "view" })
    .expect(502);

  assert.equal(grantCreated, false);
  assert.deepEqual(response.body, { error: "Lift proof read failed with HTTP 503." });
});

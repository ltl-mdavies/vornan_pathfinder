import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import request from "supertest";
import { LiftProofReadError } from "@pathfinder/lift-proof-adapter";
import type { ProofOrder } from "@pathfinder/proof-domain";
import { createProofAdminRouter, type ProofAdminRouterDependencies } from "../src/proof/router.ts";

const previousGrantCreationFlag = process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION;
const previousAllowedCustomerIds = process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS;
const previousActivationExpiry = process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT;
process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = "1249";
process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT = "2099-07-28T21:49:50.000Z";

after(() => {
  if (previousGrantCreationFlag === undefined) delete process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION;
  else process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = previousGrantCreationFlag;
  if (previousAllowedCustomerIds === undefined) delete process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS;
  else process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = previousAllowedCustomerIds;
  if (previousActivationExpiry === undefined) delete process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT;
  else process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT = previousActivationExpiry;
});

const now = "2026-07-20T12:00:00.000Z";
const cachedOrder: ProofOrder = {
  order_number: "A0221132",
  order_title: "QA proof packet",
  customer_id: "1249",
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
  app.use("/api/proof", createProofAdminRouter({
    resolveCustomerCapability: async () => ({
      association_status: "associated",
      pathfinder_customer_id: "284619",
      proof_customer_id: "1249",
      identity_verified_at: "2026-08-13T15:59:00.000Z",
      customer_name: "Empirical - Momentara",
      access_mode: "view_only",
      review_experience: "simple",
      source: "customer_default",
      policy_updated_at: "2026-08-08T15:30:00.000Z"
    }),
    resolveCustomerCapabilityForCustomerOrder: async () => ({
      association_status: "associated",
      pathfinder_customer_id: "1249",
      proof_customer_id: "1249",
      identity_verified_at: "2026-08-13T15:59:00.000Z",
      customer_name: "LTL Demo",
      access_mode: "review",
      review_experience: "simple",
      source: "customer_default",
      policy_updated_at: "2026-08-08T15:30:00.000Z"
    }),
    ...dependencies
  }));
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
      session_ttl_minutes: 30,
      durable_customer_authority: true,
      legacy_view_grant_cohort_configured: true,
      activation_expiry_configured: true
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

test("lists source-neutral LTL Demo orders only through the persistent customer-1249 boundary", async () => {
  const previousScope = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  const previousOrderUrl = process.env.PATHFINDER_PROOF_LIFT_ORDER_READ_URL;
  process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE =
    "true||LTL_DEMO_ALL|true|true|true|true|true";
  process.env.PATHFINDER_PROOF_LIFT_ORDER_READ_URL =
    "https://lift.example/AS360Orders/N?offset=0&token=server-only";
  try {
    let receivedBaseUrl = "";
    let receivedInput: Record<string, unknown> | null = null;
    const response = await request(appWith({
      readCustomerOrders: async (baseUrl, input) => {
        receivedBaseUrl = baseUrl;
        receivedInput = input as unknown as Record<string, unknown>;
        return {
          adapter_version: "as360_orders_v2",
          customer_id: "1249",
          query: { order_number: null, days_back: 30 },
          total_count: 1,
          returned_count: 1,
          truncated: false,
          orders: [{
            source: "as360_orders_v2",
            source_order_reference: "A0229276",
            order_number: "A0229276",
            customer_id: "1249",
            customer_name: "LTL Demo",
            order_title: "Proof QA clone",
            po_number: "LTL1249-HEW-002",
            creation_date: "2026-08-24",
            created_by: "PATHFINDER",
            order_type_name: "Premium Graphics",
            order_status: "Pending Art Approval",
            order_step_id: "1037",
            header_step_number: 7.02,
            line_count: 3,
            proof_availability: "not_checked",
            lines: []
          }]
        };
      }
    }))
      .get("/api/proof/customer-orders?days_back=30")
      .expect(200);

    assert.equal(receivedBaseUrl.includes("token=server-only"), true);
    assert.equal(receivedInput?.verified_customer_id, "1249");
    assert.equal(receivedInput?.days_back, 30);
    assert.equal(receivedInput?.result_limit, 100);
    assert.equal(response.headers["cache-control"], "private, no-store, max-age=0");
    assert.equal(response.body.orders[0].order_number, "A0229276");
    assert.equal(JSON.stringify(response.body).includes("token=server-only"), false);
  } finally {
    if (previousScope === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = previousScope;
    if (previousOrderUrl === undefined) delete process.env.PATHFINDER_PROOF_LIFT_ORDER_READ_URL;
    else process.env.PATHFINDER_PROOF_LIFT_ORDER_READ_URL = previousOrderUrl;
  }
});

test("keeps customer order discovery default-dark outside persistent LTL Demo QA", async () => {
  const previousScope = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  let readAttempted = false;
  try {
    const response = await request(appWith({
      readCustomerOrders: async () => {
        readAttempted = true;
        throw new Error("must not read");
      }
    }))
      .get("/api/proof/customer-orders?days_back=30")
      .expect(503);
    assert.equal(readAttempted, false);
    assert.equal(response.body.error, "LTL Demo order discovery is disabled.");
  } finally {
    if (previousScope === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = previousScope;
  }
});

test("syncs a discovered order with the exact verified customer boundary", async () => {
  const previousScope = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE =
    "true||LTL_DEMO_ALL|true|true|true|true|true";
  try {
    const lifecycle: string[] = [];
    const discoveredOrder = { ...cachedOrder, order_number: "A0229276" };
    const response = await request(appWith({
      resolveCustomerCapabilityForCustomerOrder: async () => ({
        association_status: "associated",
        pathfinder_customer_id: "1249",
        proof_customer_id: "1249",
        identity_verified_at: "2026-08-13T15:59:00.000Z",
        customer_name: "LTL Demo",
        access_mode: "disabled",
        review_experience: "simple",
        source: "customer_default",
        policy_updated_at: "2026-08-08T15:30:00.000Z"
      }),
      syncOrderForGrant: async (orderNumber, options) => {
        lifecycle.push(orderNumber);
        assert.deepEqual(options.allowed_customer_ids, ["1249"]);
        assert.equal(options.audit_context?.actor_id, "operator-route-qa");
        return successfulSync(discoveredOrder);
      }
    }))
      .post("/api/proof/customer-orders/A0229276/sync")
      .set("X-Request-Id", "source-neutral-sync-1")
      .send({})
      .expect(200);
    assert.deepEqual(lifecycle, ["A0229276"]);
    assert.equal(response.body.order.order_number, "A0229276");
    assert.equal(response.body.customer_capability.proof_customer_id, "1249");
    assert.equal(response.body.customer_capability.access_mode, "review");
    assert.equal(response.body.customer_capability.source, "ltl_demo_qa");
  } finally {
    if (previousScope === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = previousScope;
  }
});

test("creates review access for a verified source-neutral LTL Demo order without a Pathfinder job", async () => {
  const previousScope = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE =
    "true||LTL_DEMO_ALL|true|true|true|true|true";
  const lifecycle: string[] = [];
  const sourceNeutralOrder = { ...cachedOrder, order_number: "A0228667" };
  try {
    const response = await request(appWith({
      getOrderForGrant: async (orderNumber) => {
        lifecycle.push(`get:${orderNumber}`);
        return sourceNeutralOrder;
      },
      orderIsStale: () => false,
      resolveCustomerCapability: async (orderNumber) => {
        lifecycle.push(`legacy:${orderNumber}`);
        return {
          association_status: "unassociated",
          pathfinder_customer_id: null,
          proof_customer_id: null,
          identity_verified_at: null,
          customer_name: null,
          access_mode: "view_only",
          review_experience: "simple",
          source: "safe_default",
          policy_updated_at: null
        };
      },
      resolveCustomerCapabilityForCustomerOrder: async (customerId, orderNumber) => {
        lifecycle.push(`customer:${customerId}:${orderNumber}`);
        return {
          association_status: "associated",
          pathfinder_customer_id: "1249",
          proof_customer_id: "1249",
          identity_verified_at: "2026-08-13T15:59:00.000Z",
          customer_name: "LTL Demo",
          access_mode: "disabled",
          review_experience: "simple",
          source: "customer_default",
          policy_updated_at: "2026-08-08T15:30:00.000Z"
        };
      },
      createGrant: async (input) => {
        lifecycle.push(`grant:${input.order_number}:${input.scope}`);
        assert.equal(input.capability.pathfinder_customer_id, "1249");
        assert.equal(input.capability.proof_customer_id, "1249");
        assert.equal(input.capability.access_mode, "review");
        assert.equal(input.capability.source, "ltl_demo_qa");
        return grantResult;
      }
    }))
      .post("/api/proof/orders/A0228667/grants")
      .send({ scope: "review", label: "LTL Demo customer QA" })
      .expect(201);

    assert.deepEqual(lifecycle, [
      "legacy:A0228667",
      "get:A0228667",
      "customer:1249:A0228667",
      "grant:A0228667:review"
    ]);
    assert.equal(response.body.grant.grant_id, grantResult.grant.grant_id);
  } finally {
    if (previousScope === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = previousScope;
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
      assert.deepEqual(input.capability, {
        pathfinder_customer_id: "284619",
        proof_customer_id: "1249",
        identity_verified_at: "2026-08-13T15:59:00.000Z",
        access_mode: "view_only",
        review_experience: "simple",
        source: "customer_default",
        policy_updated_at: "2026-08-08T15:30:00.000Z"
      });
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

test("refreshes a legacy cached order that predates the customer cohort field", async () => {
  const lifecycle: string[] = [];
  await request(appWith({
    getOrderForGrant: async () => {
      lifecycle.push("get");
      return { ...cachedOrder, customer_id: null };
    },
    orderIsStale: () => {
      lifecycle.push("stale-check");
      return false;
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
  assert.deepEqual(lifecycle, ["get", "sync", "grant"]);
});

test("fails closed before grant creation when the synchronized order is outside the configured customer cohort", async () => {
  let grantCreated = false;
  const response = await request(appWith({
    getOrderForGrant: async () => ({ ...cachedOrder, customer_id: "9999" }),
    orderIsStale: () => false,
    createGrant: async () => {
      grantCreated = true;
      return grantResult;
    }
  }))
    .post("/api/proof/orders/A0221132/grants")
    .send({ scope: "view" })
    .expect(403);

  assert.equal(grantCreated, false);
  assert.deepEqual(response.body, { error: "Proof access is outside the configured read-only grant cohort." });
});

test("fails closed before cache or Lift access when the order has no authoritative customer Proof policy", async () => {
  const lifecycle: string[] = [];
  const response = await request(appWith({
    resolveCustomerCapability: async () => ({
      association_status: "unassociated",
      pathfinder_customer_id: null,
      proof_customer_id: null,
      identity_verified_at: null,
      customer_name: null,
      access_mode: "view_only",
      review_experience: "simple",
      source: "safe_default",
      policy_updated_at: null
    }),
    getOrderForGrant: async () => {
      lifecycle.push("cache");
      return cachedOrder;
    },
    createGrant: async () => {
      lifecycle.push("grant");
      return grantResult;
    }
  }))
    .post("/api/proof/orders/A0221132/grants")
    .send({ scope: "view" })
    .expect(403);

  assert.deepEqual(lifecycle, []);
  assert.deepEqual(response.body, { error: "Proof access is outside the configured read-only grant cohort." });
});

test("creates a durably bound grant without a configured environment customer cohort", async () => {
  const configured = process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS;
  delete process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS;
  try {
    await request(appWith({
      getOrderForGrant: async () => cachedOrder,
      orderIsStale: () => false,
      createGrant: async () => grantResult
    }))
      .post("/api/proof/orders/A0221132/grants")
      .send({ scope: "view" })
      .expect(201);
  } finally {
    if (configured !== undefined) process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = configured;
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

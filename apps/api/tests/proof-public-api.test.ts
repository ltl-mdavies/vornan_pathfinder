import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import express from "express";
import request from "supertest";
import type { ProofOrder } from "@pathfinder/proof-domain";

let testDirectory = "";
let app: import("express").Express;
let access: typeof import("../src/proof/access-service.ts");
let store: typeof import("../src/proof/store.ts");
let createPublicRouter: typeof import("../src/proof/public-router.ts")["createProofPublicRouter"];
let createAdminRouter: typeof import("../src/proof/router.ts")["createProofAdminRouter"];

const reviewCapability = {
  pathfinder_customer_id: "284619",
  access_mode: "review" as const,
  review_experience: "simple" as const,
  source: "customer_default" as const,
  policy_updated_at: "2026-08-08T15:30:00.000Z"
};

function exchangeCredentials(exchange: request.Response) {
  const cookies = exchange.headers["set-cookie"] ?? [];
  const session = cookies.find((cookie: string) => cookie.startsWith("vornan_proof_session=")) ?? "";
  const csrfCookie = cookies.find((cookie: string) => cookie.startsWith("vornan_proof_csrf=")) ?? "";
  const csrf = csrfCookie.split(";")[0]!.split("=")[1] ?? "";
  return {
    cookie: `${session.split(";")[0]}; ${csrfCookie.split(";")[0]}`,
    csrf,
    session,
    csrfCookie
  };
}

const order: ProofOrder = {
  order_number: "A0221132",
  customer_id: "1249",
  order_title: "QA proof packet",
  customer_name: "Must not leave the service",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [{ order_line_id: "9301338", line_number: "1", step_number: 7.02, product_name: "Panel", quantity: 20, status: null, cancelled: false }],
  tasks: [{
    task_id: "ptask_public_qa",
    order_line_id: "9301338",
    line_number: "1",
    attachment_id: "25435041",
    product_name: "Panel",
    quantity: 20,
    state: "pending",
    actionable: true,
    sibling_index: 1,
    sibling_count: 1,
    version: 1,
    current_version: {
      version_id: "pversion_public_qa",
      attachment_id: "25435041",
      created_at: "2026-07-20T12:00:00.000Z",
      filename: "panel.pdf",
      content_type: "application/pdf",
      preview_url: "https://proof-assets.example.invalid/panel-low.pdf",
      download_url: "https://proof-assets.example.invalid/panel.pdf",
      approval_status: "PENDING",
      approved_by: null,
      approved_at: null,
      comments: [{
        text: "Check the latest production note.",
        created_at: "2026-07-20T12:05:00.000Z",
        attachment: {
          attachments: [
            { filename: "trim-notes.pdf", url: "https://files.example/trim-notes.pdf", content_type: "application/pdf", internal_id: "comment-private-id" },
            { filename: "trim-notes.pdf", url: "https://files.example/trim-notes.pdf", content_type: "application/pdf" },
            "https://files.example/reference.jpg",
            { filename: "unsafe.html", url: "javascript:alert(1)" }
          ],
          internal_thread_id: "feedback-thread-secret"
        }
      }],
      detailed_report: [{ name: "Trim safety", status: "PASS", internal_id: "report-secret", signed_url: "https://internal.example/report?token=secret" }],
      feedback_fingerprint: "feedback-v1",
      current: true,
      archived_at: null
    },
    versions: [],
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    archived_at: null
  }],
  archived_tasks: [],
  warnings: [{ code: "proof_without_url", message: "Internal warning" }],
  last_sync_diagnostics: {
    source: "lift_read",
    completed_at: "2026-07-20T12:00:00.000Z",
    line_reads: { attempted: 1, succeeded: 1, failed: 0, proof_rows: 1 },
    fallback_read: { attempted: false, ok: null, proof_rows: 0 },
    normalization_warning_count: 1
  },
  created_at: "2026-07-20T12:00:00.000Z",
  updated_at: "2026-07-20T12:00:00.000Z",
  last_synced_at: new Date().toISOString()
};
order.tasks[0]!.versions = [order.tasks[0]!.current_version!];

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-public-api-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = "1249";
  process.env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ = "true";
  process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT = "2099-07-28T21:49:50.000Z";
  process.env.PATHFINDER_PROOF_SYNC_QUEUE_URL = "";
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "off";
  ({ proofPublicApp: app } = await import("../src/proof/public-server.ts"));
  ({ createProofPublicRouter: createPublicRouter } = await import("../src/proof/public-router.ts"));
  ({ createProofAdminRouter: createAdminRouter } = await import("../src/proof/router.ts"));
  access = await import("../src/proof/access-service.ts");
  store = await import("../src/proof/store.ts");
  await store.persistProofOrder(order);
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("rejects an unknown grant scope before it can be persisted", async () => {
  await assert.rejects(
    () => access.createProofGrant({ order_number: order.order_number, scope: "operator" } as never),
    /scope must be view or review/i
  );
});

test("exchanges a fragment token for a narrow hardened cookie and returns only its granted order", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const credentials = exchangeCredentials(exchange);
  assert.match(credentials.session, /^vornan_proof_session=/);
  assert.match(credentials.session, /HttpOnly/i);
  assert.match(credentials.session, /Secure/i);
  assert.match(credentials.session, /SameSite=Lax/i);
  assert.match(credentials.session, /Path=\/api\/public\/proof/i);
  assert.match(credentials.csrfCookie, /^vornan_proof_csrf=/);
  assert.doesNotMatch(credentials.csrfCookie, /HttpOnly/i);
  assert.match(credentials.csrfCookie, /Secure/i);
  assert.match(credentials.csrfCookie, /SameSite=Lax/i);
  assert.match(credentials.csrfCookie, /Path=\//i);
  assert.match(exchange.headers["content-security-policy"], /default-src 'none'/);
  assert.match(exchange.headers["x-request-id"], /^[A-Za-z0-9-]+$/);

  const response = await request(app).get("/api/public/proof/order").set("Cookie", credentials.cookie).expect(200);
  assert.equal(response.body.order.order_number, order.order_number);
  assert.equal(response.body.order.order_title, "QA proof packet");
  assert.equal(response.body.order.order_status, "Pending Art Approval");
  assert.equal(response.body.order.access.decisions_enabled, false);
  assert.equal(response.body.order.access.revision_upload_enabled, false);
  assert.equal(response.body.session_expires_at, exchange.body.expires_at);
  assert.equal(response.body.participant, null);
  assert.deepEqual(response.body.activity, {
    identified_reviewers: 0,
    last_activity_at: null,
    reviewer_names_visible: false
  });
  assert.equal(response.body.order.tasks[0].feedback_required, true);
  assert.equal(response.body.order.tasks[0].feedback_acknowledged, false);
  assert.equal(response.body.order.tasks[0].quantity, 20);
  assert.equal(response.body.order.tasks[0].line_number, "1");
  assert.equal(response.body.order.tasks[0].product_name, "Panel");
  assert.deepEqual(response.body.order.counts, { pending: 1, regenerating: 0, waiting: 0, reviewed: 0, total: 1 });
  assert.equal(response.body.order.tasks[0].current_version.content_type, "application/pdf");
  assert.equal(response.body.order.tasks[0].current_version.preview_kind, "pdf");
  assert.deepEqual(response.body.order.tasks[0].current_version.technical_checks, [{ name: "Trim safety", status: "PASS" }]);
  assert.deepEqual(response.body.order.tasks[0].current_version.comments[0].attachments, [
    { filename: "trim-notes.pdf", url: "https://files.example/trim-notes.pdf", content_type: "application/pdf" },
    { filename: "reference.jpg", url: "https://files.example/reference.jpg", content_type: null }
  ]);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("customer_name"), false);
  assert.equal(serialized.includes("order_line_id"), false);
  assert.equal(serialized.includes("attachment_id"), false);
  assert.equal(serialized.includes("Internal warning"), false);
  assert.equal(serialized.includes("last_sync_diagnostics"), false);
  assert.equal(serialized.includes("feedback-v1"), false);
  assert.equal(serialized.includes("report-secret"), false);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("comment-private-id"), false);
  assert.equal(serialized.includes("feedback-thread-secret"), false);
  assert.equal(serialized.includes("javascript:"), false);
});

test("continues a valid session only with its matching CSRF proof", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const exchange = await request(app)
    .post("/api/public/proof/sessions")
    .send({ token: created.access_url.split("/").at(-1)! })
    .expect(201);
  const credentials = exchangeCredentials(exchange);

  await request(app)
    .post("/api/public/proof/sessions/current/extend")
    .set("Cookie", credentials.cookie)
    .expect(403);

  const continued = await request(app)
    .post("/api/public/proof/sessions/current/extend")
    .set("Cookie", credentials.cookie)
    .set("X-Vornan-Proof-Csrf", credentials.csrf)
    .expect(200);
  assert.equal(continued.body.extended, true);
  assert.ok(Date.parse(continued.body.expires_at) >= Date.parse(exchange.body.expires_at));
  assert.match(continued.headers["cache-control"], /no-store/);
});

test("replaces an existing browser session only after another valid token is exchanged", async () => {
  const firstGrant = await access.createProofGrant({ order_number: order.order_number });
  const firstExchange = await request(app)
    .post("/api/public/proof/sessions")
    .send({ token: firstGrant.access_url.split("/").at(-1)! })
    .expect(201);
  const firstCredentials = exchangeCredentials(firstExchange);

  await request(app)
    .post("/api/public/proof/sessions")
    .set("Cookie", firstCredentials.cookie)
    .send({ token: "invalid" })
    .expect(401);
  await request(app)
    .get("/api/public/proof/order")
    .set("Cookie", firstCredentials.cookie)
    .expect(200);

  const secondGrant = await access.createProofGrant({ order_number: order.order_number });
  const secondExchange = await request(app)
    .post("/api/public/proof/sessions")
    .set("Cookie", firstCredentials.cookie)
    .send({ token: secondGrant.access_url.split("/").at(-1)! })
    .expect(201);
  const secondCredentials = exchangeCredentials(secondExchange);

  await request(app)
    .get("/api/public/proof/order")
    .set("Cookie", firstCredentials.cookie)
    .expect(401);
  await request(app)
    .get("/api/public/proof/order")
    .set("Cookie", secondCredentials.cookie)
    .expect(200);

  const audit = await store.listProofAuditEvents(order.order_number, { limit: 100 });
  assert.equal(audit.events.some((event) =>
    event.action === "proof.session_ended" && event.grant_id === firstGrant.grant.grant_id
  ), true);
});

test("marks an old active packet stale while withholding every cached asset URL", async () => {
  const staleOrder: ProofOrder = {
    ...order,
    order_number: "A0221133",
    tasks: order.tasks.map((task) => ({ ...task, task_id: `${task.task_id}_stale` })),
    last_synced_at: "2026-07-19T12:00:00.000Z"
  };
  await store.persistProofOrder(staleOrder);
  const created = await access.createProofGrant({ order_number: staleOrder.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const credentials = exchangeCredentials(exchange);

  const response = await request(app).get("/api/public/proof/order").set("Cookie", credentials.cookie).expect(200);
  assert.equal(response.body.order.health, "stale");
  assert.equal(response.body.order.tasks.length, staleOrder.tasks.length);
  assert.equal(response.body.order.tasks[0].filename, undefined);
  assert.equal(response.body.order.tasks[0].current_version.filename, "panel.pdf");
  assert.equal(response.body.order.tasks[0].current_version.preview_url, null);
  assert.equal(response.body.order.tasks[0].current_version.download_url, null);
  assert.equal(response.body.order.tasks[0].current_version.comments[0].attachments[0].url, null);

  const history = await request(app)
    .get(`/api/public/proof/tasks/${staleOrder.tasks[0]!.task_id}/history`)
    .set("Cookie", credentials.cookie)
    .expect(200);
  assert.equal(history.body.versions[0].preview_url, null);
  assert.equal(history.body.versions[0].download_url, null);
  assert.equal(history.body.versions[0].comments[0].attachments[0].url, null);
});

test("bounds automatic refresh to recently changed active or complete orders while preserving manual refresh", async () => {
  const now = Date.now();
  const proofOrders: ProofOrder[] = [
    {
      ...order,
      order_number: "A0221134",
      updated_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      last_synced_at: new Date(now - 60 * 60 * 1000).toISOString()
    },
    {
      ...order,
      order_number: "A0221135",
      updated_at: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
      last_synced_at: new Date(now - 60 * 60 * 1000).toISOString()
    },
    {
      ...order,
      order_number: "A0221136",
      health: "complete",
      updated_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      last_synced_at: new Date(now - 60 * 60 * 1000).toISOString()
    }
  ];
  for (const proofOrder of proofOrders) {
    await store.persistProofOrder({
      ...proofOrder,
      tasks: proofOrder.tasks.map((task) => ({ ...task, task_id: `${task.task_id}_${proofOrder.order_number}` }))
    });
  }

  const queued: Array<{ orderNumber: string; reason: string }> = [];
  const automaticRefreshApp = express();
  automaticRefreshApp.use(express.json());
  automaticRefreshApp.use("/api/public/proof", createPublicRouter({
    queueSync: async (orderNumber, reason) => {
      queued.push({ orderNumber, reason });
      return { queued: true as const };
    }
  }));

  const credentialsByOrder = new Map<string, ReturnType<typeof exchangeCredentials>>();
  for (const proofOrder of proofOrders) {
    const created = await access.createProofGrant({ order_number: proofOrder.order_number });
    const rawToken = created.access_url.split("/").at(-1)!;
    const exchange = await request(automaticRefreshApp)
      .post("/api/public/proof/sessions")
      .send({ token: rawToken })
      .expect(201);
    credentialsByOrder.set(proofOrder.order_number, exchangeCredentials(exchange));
  }

  const recent = await request(automaticRefreshApp)
    .get("/api/public/proof/order")
    .set("Cookie", credentialsByOrder.get("A0221134")!.cookie)
    .expect(200);
  const inactive = await request(automaticRefreshApp)
    .get("/api/public/proof/order")
    .set("Cookie", credentialsByOrder.get("A0221135")!.cookie)
    .expect(200);
  const complete = await request(automaticRefreshApp)
    .get("/api/public/proof/order")
    .set("Cookie", credentialsByOrder.get("A0221136")!.cookie)
    .expect(200);

  assert.equal(recent.body.order.health, "stale");
  assert.equal(recent.body.refresh_queued, true);
  assert.equal(inactive.body.order.health, "stale");
  assert.equal(inactive.body.refresh_queued, false);
  assert.equal(complete.body.order.health, "complete");
  assert.equal(complete.body.refresh_queued, true);
  assert.deepEqual(queued, [
    { orderNumber: "A0221134", reason: "stale_public_read" },
    { orderNumber: "A0221136", reason: "stale_public_read" }
  ]);

  const inactiveCredentials = credentialsByOrder.get("A0221135")!;
  await request(automaticRefreshApp)
    .post("/api/public/proof/order/refresh")
    .set("Cookie", inactiveCredentials.cookie)
    .set("X-Vornan-Proof-Csrf", inactiveCredentials.csrf)
    .expect(202);
  assert.deepEqual(queued.at(-1), { orderNumber: "A0221135", reason: "public_refresh" });
});

test("uses one generic denial and keeps unsupported public decision routes absent", async () => {
  const denied = await request(app).get("/api/public/proof/order").expect(401);
  assert.equal(denied.body.error, "This proof access link is invalid or has expired.");
  await request(app).post("/api/public/proof/orders/A0221132/approve").send({ approve: true }).expect(404);
  await request(app).post("/api/public/proof/tasks/ptask_public_qa/approve").send({ approve: true }).expect(404);
  await request(app).post("/api/public/proof/tasks/ptask_public_qa/revisions").send({ filename: "revision.pdf" }).expect(404);
  await request(app).put("/api/public/proof/tasks/ptask_public_qa").send({ approve: true }).expect(404);
  await request(app).post("/api/public/proof/operator-actions/execute").send({ action: "APPROVE" }).expect(404);
  await request(app).post("/api/public/proof/operator-assets/uploads/prepare").send({}).expect(404);
  await request(app).post("/api/public/proof/operator-assets/uploads/finalize").send({}).expect(404);
  await request(app).post("/api/public/proof/operator-assets/publications").send({}).expect(404);

  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use("/api/proof", createAdminRouter());
  await request(adminApp).post("/api/proof/tasks/ptask_public_qa/approve").send({ approve: true }).expect(404);
  await request(adminApp)
    .post("/api/proof/operator-actions/execute")
    .send({ action: "APPROVE" })
    .expect(401);
  await request(adminApp)
    .post("/api/proof/operator-assets/uploads/prepare")
    .send({})
    .expect(401);
  await request(adminApp)
    .post("/api/proof/operator-assets/uploads/finalize")
    .send({})
    .expect(401);
  await request(adminApp)
    .post("/api/proof/operator-assets/publications")
    .send({})
    .expect(401);
});

test("exposes the one supported approval route only to a review-scoped session", async () => {
  process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS = "true";
  try {
    const approvalCalls: Array<Record<string, unknown>> = [];
    const approvalApp = express();
    approvalApp.use(express.json());
    approvalApp.use("/api/public/proof", createPublicRouter({
      approveProof: async (input) => {
        approvalCalls.push(input as unknown as Record<string, unknown>);
        return {
          status: "new",
          outcome: "confirmed",
          automatic_retry: false,
          authoritative_refresh_completed: true
        };
      }
    }));
    const created = await access.createProofGrant({
      order_number: order.order_number,
      scope: "review",
      capability: reviewCapability
    });
    const exchange = await request(approvalApp)
      .post("/api/public/proof/sessions")
      .send({ token: created.access_url.split("/").at(-1)! })
      .expect(201);
    const { cookie, csrf } = exchangeCredentials(exchange);

    await request(approvalApp)
      .post("/api/public/proof/participants")
      .set("Cookie", cookie)
      .set("X-Vornan-Proof-Csrf", csrf)
      .send({ display_name: "Approval Reviewer", email: "approval@example.com" })
      .expect(201);

    const packet = await request(approvalApp)
      .get("/api/public/proof/order")
      .set("Cookie", cookie)
      .expect(200);
    assert.equal(packet.body.order.access.scope, "review");
    assert.equal(packet.body.order.access.decisions_enabled, true);
    assert.equal(packet.body.order.access.review_experience, "simple");
    assert.equal(packet.body.order.tasks[0].attachment_id, order.tasks[0]!.attachment_id);
    assert.equal(packet.body.order.tasks[0].version, order.tasks[0]!.version);

    await request(approvalApp)
      .post(`/api/public/proof/tasks/${order.tasks[0]!.task_id}/decisions/approve`)
      .set("Cookie", cookie)
      .set("X-Vornan-Proof-Csrf", csrf)
      .send({
        attachment_id: order.tasks[0]!.attachment_id,
        expected_task_version: order.tasks[0]!.version,
        expected_version_id: order.tasks[0]!.current_version!.version_id,
        idempotency_key: "approval-route-qa-0001",
        note: "Approved after review."
      })
      .expect(201)
      .expect({
        decision: {
          status: "new",
          outcome: "confirmed",
          automatic_retry: false,
          authoritative_refresh_completed: true
        }
      });
    assert.equal(approvalCalls.length, 1);
    const call = approvalCalls[0] as {
      session: { scope: string; participant_id: string | null };
      request: { task_id: string; idempotency_key: string };
    };
    assert.equal(call.session.scope, "review");
    assert.ok(call.session.participant_id);
    assert.equal(call.request.task_id, order.tasks[0]!.task_id);
    assert.equal(call.request.idempotency_key, "approval-route-qa-0001");
  } finally {
    delete process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS;
  }
});

test("binds revised-art upload lifecycle calls to one identified review session without publishing or calling Lift", async () => {
  process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_UPLOADS = "true";
  process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS = "true";
  try {
    const calls: Array<{ operation: string; input: any }> = [];
    const revisionApp = express();
    revisionApp.use(express.json());
    revisionApp.use("/api/public/proof", createPublicRouter({
      prepareRevisionAsset: async (input) => {
        calls.push({ operation: "prepare", input });
        return {
          status: "new" as const,
          asset: {
            asset_id: `passet_${"a".repeat(64)}`,
            state: "uploading"
          } as never,
          upload: {
            method: "POST" as const,
            url: "https://proof-upload.example.invalid/",
            fields: { policy: "opaque" },
            expires_at: "2026-08-09T13:10:00.000Z"
          }
        };
      },
      revisionAssetStatus: async (input) => {
        calls.push({ operation: "status", input });
        return { asset: { asset_id: input.request.asset_id, state: "uploading" } as never };
      },
      finalizeRevisionAsset: async (input) => {
        calls.push({ operation: "finalize", input });
        return {
          status: "completed" as const,
          asset: { asset_id: input.request.asset_id, state: "uploaded" } as never
        };
      }
    }));
    const created = await access.createProofGrant({
      order_number: order.order_number,
      scope: "review",
      capability: reviewCapability
    });
    delete process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS;
    const exchange = await request(revisionApp)
      .post("/api/public/proof/sessions")
      .send({ token: created.access_url.split("/").at(-1)! })
      .expect(201);
    const credentials = exchangeCredentials(exchange);
    await request(revisionApp)
      .post("/api/public/proof/participants")
      .set("Cookie", credentials.cookie)
      .set("X-Vornan-Proof-Csrf", credentials.csrf)
      .send({ display_name: "Revision Reviewer", email: "revision@example.com" })
      .expect(201);
    const revisionOrder = await request(revisionApp)
      .get("/api/public/proof/order")
      .set("Cookie", credentials.cookie)
      .expect(200);
    assert.equal(revisionOrder.body.order.access.revision_upload_enabled, true);

    const assetId = `passet_${"a".repeat(64)}`;
    await request(revisionApp)
      .post(`/api/public/proof/tasks/${order.tasks[0]!.task_id}/revised-assets/uploads/prepare`)
      .set("Cookie", credentials.cookie)
      .set("X-Vornan-Proof-Csrf", credentials.csrf)
      .send({
        attachment_id: order.tasks[0]!.attachment_id,
        idempotency_key: "customer-revision-upload-0001",
        original_filename: "customer revision.pdf",
        content_type: "application/pdf",
        content_length: 8192,
        sha256: "b".repeat(64),
        order_number: "A0999999"
      })
      .expect(201);
    await request(revisionApp)
      .get(`/api/public/proof/revised-assets/uploads/${assetId}`)
      .set("Cookie", credentials.cookie)
      .expect(200);
    await request(revisionApp)
      .post("/api/public/proof/revised-assets/uploads/finalize")
      .set("Cookie", credentials.cookie)
      .set("X-Vornan-Proof-Csrf", credentials.csrf)
      .send({ asset_id: assetId, order_number: "A0999999" })
      .expect(200);

    assert.deepEqual(calls.map((call) => call.operation), ["prepare", "status", "finalize"]);
    assert.equal(calls[0]!.input.request.order_number, order.order_number);
    assert.equal(calls[0]!.input.request.task_id, order.tasks[0]!.task_id);
    assert.equal(calls[1]!.input.request.order_number, order.order_number);
    assert.equal(calls[2]!.input.request.order_number, order.order_number);
    for (const call of [calls[0]!, calls[2]!]) {
      assert.equal(call.input.actor_context.actor_type, "customer_session");
      assert.equal(call.input.actor_context.source, "public_api");
      assert.equal(call.input.actor_context.grant_id, created.grant.grant_id);
      assert.match(call.input.actor_context.participant_id, /^pparticipant_[A-Za-z0-9-]{8,80}$/);
    }
    assert.equal(JSON.stringify(calls).includes("delivery_url"), false);
    assert.equal(JSON.stringify(calls).includes("REVISED_ART_WILL_BE_SENT"), false);
  } finally {
    delete process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS;
    delete process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_UPLOADS;
  }
});

test("keeps customer revised-art upload dark before any upload service call", async () => {
  process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS = "true";
  let calls = 0;
  const darkApp = express();
  darkApp.use(express.json());
  darkApp.use("/api/public/proof", createPublicRouter({
    prepareRevisionAsset: async () => {
      calls += 1;
      throw new Error("must not run");
    }
  }));
  const created = await access.createProofGrant({
    order_number: order.order_number,
    scope: "review",
    capability: reviewCapability
  });
  delete process.env.PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS;
  const exchange = await request(darkApp)
    .post("/api/public/proof/sessions")
    .send({ token: created.access_url.split("/").at(-1)! })
    .expect(201);
  const credentials = exchangeCredentials(exchange);
  await request(darkApp)
    .post("/api/public/proof/participants")
    .set("Cookie", credentials.cookie)
    .set("X-Vornan-Proof-Csrf", credentials.csrf)
    .send({ display_name: "Dark Reviewer", email: "dark@example.com" })
    .expect(201);
  await request(darkApp)
    .post(`/api/public/proof/tasks/${order.tasks[0]!.task_id}/revised-assets/uploads/prepare`)
    .set("Cookie", credentials.cookie)
    .set("X-Vornan-Proof-Csrf", credentials.csrf)
    .send({})
    .expect(503);
  assert.equal(calls, 0);
});

test("returns only redacted history for a task in the session order", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie } = exchangeCredentials(exchange);

  const response = await request(app)
    .get(`/api/public/proof/tasks/${order.tasks[0]!.task_id}/history`)
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(response.headers["cache-control"], "private, no-store, max-age=0");
  assert.equal(response.body.task_id, order.tasks[0]!.task_id);
  assert.equal(response.body.versions.length, 1);
  assert.equal(response.body.versions[0].filename, "panel.pdf");
  assert.equal(response.body.versions[0].comments[0].text, "Check the latest production note.");
  assert.equal(response.body.versions[0].comments[0].attachments.length, 2);
  assert.deepEqual(response.body.versions[0].technical_checks, [{ name: "Trim safety", status: "PASS" }]);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("attachment_id"), false);
  assert.equal(serialized.includes("approved_by"), false);
  assert.equal(serialized.includes("detailed_report"), false);
  assert.equal(serialized.includes("feedback_fingerprint"), false);
  assert.equal(serialized.includes("report-secret"), false);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("customer_name"), false);
});

test("does not disclose task history outside the session order", async () => {
  const otherTask: ProofOrder["tasks"][number] = {
    ...order.tasks[0]!,
    task_id: "ptask_other_order",
    order_line_id: "other-line",
    attachment_id: "other-attachment",
    current_version: {
      ...order.tasks[0]!.current_version!,
      version_id: "pversion_other_order",
      attachment_id: "other-attachment"
    },
    versions: []
  };
  otherTask.versions = [otherTask.current_version];
  await store.persistProofOrder({
    ...order,
    order_number: "A0999999",
    lines: [{ ...order.lines[0]!, order_line_id: "other-line" }],
    tasks: [otherTask]
  });
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie } = exchangeCredentials(exchange);

  const response = await request(app)
    .get(`/api/public/proof/tasks/${otherTask.task_id}/history`)
    .set("Cookie", cookie)
    .expect(404);
  assert.deepEqual(response.body, { error: "The selected proof is not available in this review session." });
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("A0999999"), false);
  assert.equal(serialized.includes("other-attachment"), false);
});

test("rejects direct API bypass when an edge secret is configured", async () => {
  process.env.PATHFINDER_PROOF_EDGE_SHARED_SECRET = "qa-edge-secret";
  try {
    await request(app).get("/api/public/proof/health").expect(403);
    await request(app).get("/api/public/proof/health").set("X-Vornan-Proof-Edge", "qa-edge-secret").expect(200);
  } finally {
    delete process.env.PATHFINDER_PROOF_EDGE_SHARED_SECRET;
  }
});

test("revocation invalidates an already exchanged public session", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie } = exchangeCredentials(exchange);
  await access.updateProofGrant(created.grant.grant_id, { action: "revoke" });
  await request(app).get("/api/public/proof/order").set("Cookie", cookie).expect(401);
});

test("queues an authenticated manual refresh without calling Lift in the request path", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie, csrf } = exchangeCredentials(exchange);
  const queued: Array<{ orderNumber: string; reason: string }> = [];
  const refreshApp = express();
  refreshApp.use(express.json());
  refreshApp.use("/api/public/proof", createPublicRouter({
    queueSync: async (orderNumber, reason) => {
      queued.push({ orderNumber, reason });
      return { queued: true as const };
    }
  }));

  const response = await request(refreshApp)
    .post("/api/public/proof/order/refresh")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .expect(202);
  assert.deepEqual(response.body, { refresh_queued: true });
  assert.equal(response.headers["retry-after"], "3");
  assert.deepEqual(queued, [{ orderNumber: order.order_number, reason: "public_refresh" }]);

  const unavailable = await request(app)
    .post("/api/public/proof/order/refresh")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .expect(503);
  assert.equal(unavailable.body.error, "Proof refresh is temporarily unavailable.");
  assert.equal(unavailable.headers["retry-after"], "30");
});

test("denies unauthenticated manual refresh without exposing order state", async () => {
  const response = await request(app).post("/api/public/proof/order/refresh").expect(401);
  assert.deepEqual(response.body, { error: "This proof access link is invalid or has expired." });
});

test("binds optional reviewer identity to the session with CSRF and redacted audit", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie, csrf } = exchangeCredentials(exchange);

  await request(app)
    .post("/api/public/proof/participants")
    .set("Cookie", cookie)
    .send({ display_name: "Morgan Reviewer", email: "morgan@example.com" })
    .expect(403);

  const identified = await request(app)
    .post("/api/public/proof/participants")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .send({ display_name: "  Morgan   Reviewer ", email: "MORGAN@EXAMPLE.COM" })
    .expect(201);
  assert.equal(identified.body.participant.display_name, "Morgan Reviewer");
  assert.equal(identified.body.participant.email, "morgan@example.com");

  const orderResponse = await request(app).get("/api/public/proof/order").set("Cookie", cookie).expect(200);
  assert.deepEqual(orderResponse.body.participant, identified.body.participant);
  assert.equal(orderResponse.body.activity.identified_reviewers, 1);
  assert.equal(orderResponse.body.activity.reviewer_names_visible, false);
  assert.ok(Number.isFinite(Date.parse(orderResponse.body.activity.last_activity_at)));
  assert.equal(JSON.stringify(orderResponse.body.activity).includes("Morgan"), false);
  assert.equal(JSON.stringify(orderResponse.body.activity).includes("morgan@example.com"), false);

  const updated = await request(app)
    .post("/api/public/proof/participants")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .send({ display_name: "Morgan R.", email: "morgan@example.com" })
    .expect(200);
  assert.equal(updated.body.participant.participant_id, identified.body.participant.participant_id);

  const audit = await store.listProofAuditEvents(order.order_number, { limit: 100 });
  const identityEvents = audit.events.filter(
    (event) => event.action.startsWith("proof.participant_") && event.grant_id === created.grant.grant_id
  );
  assert.deepEqual(identityEvents.map((event) => event.action).sort(), ["proof.participant_identified", "proof.participant_updated"]);
  const serializedAudit = JSON.stringify(identityEvents);
  assert.equal(serializedAudit.includes("Morgan"), false);
  assert.equal(serializedAudit.includes("morgan@example.com"), false);

  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use("/api/proof", createAdminRouter());
  const grants = await request(adminApp).get(`/api/proof/orders/${order.order_number}/grants`).expect(200);
  assert.equal(grants.body.grants.find((grant: { grant_id: string }) => grant.grant_id === created.grant.grant_id).participant_count, 1);
  const restricted = await request(adminApp).get(`/api/proof/grants/${created.grant.grant_id}/participants`).expect(200);
  assert.equal(restricted.headers["cache-control"], "private, no-store, max-age=0");
  assert.deepEqual(restricted.body.participants, [{
    participant_id: identified.body.participant.participant_id,
    grant_id: created.grant.grant_id,
    order_number: order.order_number,
    display_name: "Morgan R.",
    email: "morgan@example.com",
    first_seen_at: restricted.body.participants[0].first_seen_at,
    last_seen_at: restricted.body.participants[0].last_seen_at
  }]);
});

test("binds feedback acknowledgement to the participant and current feedback fingerprint", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie, csrf } = exchangeCredentials(exchange);
  const task = order.tasks[0]!;

  await request(app)
    .post(`/api/public/proof/tasks/${task.task_id}/feedback-acknowledgements`)
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .expect(400);

  await request(app)
    .post("/api/public/proof/participants")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .send({ display_name: "Feedback Reviewer", email: "feedback@example.com" })
    .expect(201);

  await request(app)
    .post(`/api/public/proof/tasks/${task.task_id}/feedback-acknowledgements`)
    .set("Cookie", cookie)
    .expect(403);

  const acknowledged = await request(app)
    .post(`/api/public/proof/tasks/${task.task_id}/feedback-acknowledgements`)
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .expect(201);
  assert.deepEqual(Object.keys(acknowledged.body.feedback).sort(), ["acknowledged", "acknowledged_at", "required"]);

  const afterAcknowledgement = await request(app).get("/api/public/proof/order").set("Cookie", cookie).expect(200);
  assert.equal(afterAcknowledgement.body.order.tasks[0].feedback_acknowledged, true);
  const participantId = afterAcknowledgement.body.participant.participant_id as string;
  const firstRecord = await store.getProofFeedbackAcknowledgement(created.grant.grant_id, participantId, task.task_id);
  assert.equal(firstRecord?.feedback_fingerprint, "feedback-v1");

  const changedOrder: ProofOrder = {
    ...order,
    version: order.version + 1,
    tasks: [{
      ...task,
      version: task.version + 1,
      current_version: {
        ...task.current_version!,
        comments: [{ text: "Updated production note.", created_at: "2026-07-20T13:00:00.000Z", attachment: null }],
        feedback_fingerprint: "feedback-v2"
      },
      versions: [{
        ...task.current_version!,
        comments: [{ text: "Updated production note.", created_at: "2026-07-20T13:00:00.000Z", attachment: null }],
        feedback_fingerprint: "feedback-v2"
      }]
    }]
  };

  try {
    await store.persistProofOrder(changedOrder);
    const afterChange = await request(app).get("/api/public/proof/order").set("Cookie", cookie).expect(200);
    assert.equal(afterChange.body.order.tasks[0].feedback_required, true);
    assert.equal(afterChange.body.order.tasks[0].feedback_acknowledged, false);

    await request(app)
      .post(`/api/public/proof/tasks/${task.task_id}/feedback-acknowledgements`)
      .set("Cookie", cookie)
      .set("X-Vornan-Proof-Csrf", csrf)
      .expect(200);
    const secondRecord = await store.getProofFeedbackAcknowledgement(created.grant.grant_id, participantId, task.task_id);
    assert.equal(secondRecord?.acknowledgement_id, firstRecord?.acknowledgement_id);
    assert.equal(secondRecord?.feedback_fingerprint, "feedback-v2");

    await request(app)
      .post(`/api/public/proof/tasks/${task.task_id}/feedback-acknowledgements`)
      .set("Cookie", cookie)
      .set("X-Vornan-Proof-Csrf", csrf)
      .expect(200);
  } finally {
    await store.persistProofOrder(order);
  }

  const audit = await store.listProofAuditEvents(order.order_number, { limit: 100 });
  const acknowledgementEvents = audit.events.filter((event) =>
    event.action === "proof.feedback_acknowledged" && event.grant_id === created.grant.grant_id
  );
  assert.equal(acknowledgementEvents.length, 2);
  const serializedAudit = JSON.stringify(acknowledgementEvents);
  assert.equal(serializedAudit.includes("production note"), false);
  assert.equal(serializedAudit.includes("feedback-v"), false);
});

test("requires CSRF before ending an authenticated session and clears both cookies", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie, csrf } = exchangeCredentials(exchange);
  await request(app).delete("/api/public/proof/sessions/current").set("Cookie", cookie).expect(403);
  const ended = await request(app)
    .delete("/api/public/proof/sessions/current")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .expect(204);
  const cleared = ended.headers["set-cookie"] ?? [];
  assert.equal(cleared.some((value: string) => value.startsWith("vornan_proof_session=")), true);
  assert.equal(cleared.some((value: string) => value.startsWith("vornan_proof_csrf=")), true);
});

test("ends and audits a session after its grant is revoked while reads remain denied", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
  const { cookie, csrf } = exchangeCredentials(exchange);
  await access.updateProofGrant(created.grant.grant_id, { action: "revoke" });

  await request(app).get("/api/public/proof/order").set("Cookie", cookie).expect(401);
  await request(app).delete("/api/public/proof/sessions/current").set("Cookie", cookie).expect(403);
  const ended = await request(app)
    .delete("/api/public/proof/sessions/current")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", csrf)
    .expect(204);

  const cleared = ended.headers["set-cookie"] ?? [];
  assert.equal(cleared.some((value: string) => value.startsWith("vornan_proof_session=")), true);
  assert.equal(cleared.some((value: string) => value.startsWith("vornan_proof_csrf=")), true);
  const audit = await store.listProofAuditEvents(order.order_number, { limit: 100 });
  const sessionEnded = audit.events.filter((event) =>
    event.action === "proof.session_ended" && event.grant_id === created.grant.grant_id
  );
  assert.equal(sessionEnded.length, 1);
});

test("ends and audits an expired session while reads remain denied", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const created = await access.createProofGrant({ order_number: order.order_number, now });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchanged = await access.exchangeProofToken(rawToken, now);
  const cookie = `vornan_proof_session=${exchanged.raw_session}; vornan_proof_csrf=${exchanged.raw_csrf}`;

  await request(app).get("/api/public/proof/order").set("Cookie", cookie).expect(401);
  await request(app)
    .delete("/api/public/proof/sessions/current")
    .set("Cookie", cookie)
    .set("X-Vornan-Proof-Csrf", exchanged.raw_csrf)
    .expect(204);

  const audit = await store.listProofAuditEvents(order.order_number, { limit: 100 });
  const sessionEnded = audit.events.filter((event) =>
    event.action === "proof.session_ended" && event.grant_id === created.grant.grant_id
  );
  assert.equal(sessionEnded.length, 1);
});

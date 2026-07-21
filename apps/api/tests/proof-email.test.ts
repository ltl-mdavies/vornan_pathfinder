import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import express from "express";
import request from "supertest";
import type { ProofOrder } from "@pathfinder/proof-domain";

let testDirectory = "";
let storePath = "";
let app: import("express").Express;
let access: typeof import("../src/proof/access-service.ts");
let store: typeof import("../src/proof/store.ts");

const order: ProofOrder = {
  order_number: "A0221132",
  order_title: "QA artwork review",
  customer_id: "1249",
  customer_name: "Private customer",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [],
  tasks: [],
  archived_tasks: [],
  warnings: [],
  created_at: "2026-07-20T12:00:00.000Z",
  updated_at: "2026-07-20T12:00:00.000Z",
  last_synced_at: "2026-07-20T12:00:00.000Z"
};

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-email-"));
  storePath = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = storePath;
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = "1249";
  process.env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL = "true";
  process.env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ = "false";
  process.env.PATHFINDER_PROOF_PUBLIC_BASE_URL = "https://proof.vornan.co";
  process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT = "2099-07-28T21:49:50.000Z";
  process.env.PATHFINDER_STATUS_EMAIL_MODE = "log";

  const { createProofAdminRouter } = await import("../src/proof/router.ts");
  access = await import("../src/proof/access-service.ts");
  store = await import("../src/proof/store.ts");
  await store.persistProofOrder(order);
  app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.authUser = { uid: "operator-qa" };
    next();
  });
  app.use("/api/proof", createProofAdminRouter());
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("authenticated operator delivery returns masked metadata and records no bearer secret", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number, label: "QA reviewer" });
  const response = await request(app)
    .post(`/api/proof/grants/${created.grant.grant_id}/email`)
    .set("X-Request-Id", "proof-email-qa-1")
    .send({ recipient_email: "reviewer@example.com", access_url: created.access_url })
    .expect(200);

  assert.deepEqual(response.body.delivery, {
    mode: "log",
    status: "logged",
    recipient_masked: "re***@example.com"
  });
  assert.match(response.headers["cache-control"], /no-store/);
  const serializedResponse = JSON.stringify(response.body);
  assert.equal(serializedResponse.includes(created.access_url), false);
  assert.equal(serializedResponse.includes("reviewer@example.com"), false);

  const audit = await store.listProofAuditEvents(order.order_number);
  const deliveryEvent = audit.events.find((event) => event.action === "proof.link_email_sent");
  assert.ok(deliveryEvent);
  assert.equal(deliveryEvent.metadata.delivery_mode, "log");
  assert.equal(deliveryEvent.metadata.delivery_status, "logged");
  const persisted = await readFile(storePath, "utf8");
  assert.equal(persisted.includes(created.access_url), false);
  assert.equal(persisted.includes(created.access_url.split("/").at(-1)!), false);
  assert.equal(persisted.includes("reviewer@example.com"), false);
});

test("rejects a link belonging to a different grant", async () => {
  const first = await access.createProofGrant({ order_number: order.order_number });
  const second = await access.createProofGrant({ order_number: order.order_number });
  const response = await request(app)
    .post(`/api/proof/grants/${first.grant.grant_id}/email`)
    .send({ recipient_email: "reviewer@example.com", access_url: second.access_url })
    .expect(400);
  assert.match(response.body.error, /unused active grant/);
});

test("keeps the email endpoint unavailable when its independent gate is off", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  process.env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL = "false";
  try {
    const response = await request(app)
      .post(`/api/proof/grants/${created.grant.grant_id}/email`)
      .send({ recipient_email: "reviewer@example.com", access_url: created.access_url })
      .expect(503);
    assert.equal(response.body.error, "Vornan Proof proof link email is disabled.");
  } finally {
    process.env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL = "true";
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import express from "express";
import request from "supertest";

let testDirectory = "";
let recordProofAuditEvent: typeof import("../src/proof/audit-service.ts")["recordProofAuditEvent"];
let appendProofAuditEvent: typeof import("../src/proof/store.ts")["appendProofAuditEvent"];
let listProofAuditEvents: typeof import("../src/proof/store.ts")["listProofAuditEvents"];
let app: express.Express;

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-audit-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "off";
  ({ recordProofAuditEvent } = await import("../src/proof/audit-service.ts"));
  ({ appendProofAuditEvent, listProofAuditEvents } = await import("../src/proof/store.ts"));
  const { createProofAdminRouter } = await import("../src/proof/router.ts");
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { uid: "operator-123", email: "not-persisted@example.invalid" };
    next();
  });
  app.use("/api/proof", createProofAdminRouter());
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("appends immutable, sanitized audit events and paginates newest first", async () => {
  const first = await recordProofAuditEvent({
    action: "proof.sync_completed",
    order_number: "A0221132",
    metadata: { order_health: "active", order_version: 1, active_task_count: 4, archived_task_count: 0 },
    context: { actor_type: "system", actor_id: "proof-sync-worker", correlation_id: "sync-1", source: "sync_worker" },
    occurred_at: "2026-07-20T12:00:00.000Z"
  });
  await recordProofAuditEvent({
    action: "proof.grant_created",
    order_number: "A0221132",
    grant_id: "pgrant_qa-1",
    metadata: { grant_scope: "view", grant_status: "active" },
    context: { actor_type: "operator", actor_id: "operator-123", correlation_id: "request-2", source: "operator" },
    occurred_at: "2026-07-20T12:01:00.000Z"
  });
  await recordProofAuditEvent({
    action: "proof.session_exchanged",
    order_number: "A0221132",
    grant_id: "pgrant_qa-1",
    metadata: { grant_scope: "view" },
    context: { actor_type: "customer_session", actor_id: "psession_qa-1", source: "public_api" },
    occurred_at: "2026-07-20T12:02:00.000Z"
  });

  const pageOne = await listProofAuditEvents("A0221132", { limit: 2 });
  assert.deepEqual(pageOne.events.map((event) => event.action), ["proof.session_exchanged", "proof.grant_created"]);
  assert.ok(pageOne.next_cursor);
  const pageTwo = await listProofAuditEvents("A0221132", { limit: 2, cursor: pageOne.next_cursor });
  assert.deepEqual(pageTwo.events.map((event) => event.action), ["proof.sync_completed"]);
  assert.equal(pageTwo.next_cursor, null);
  await assert.rejects(() => appendProofAuditEvent(first), { name: "ConditionalCheckFailedException" });

  const serialized = JSON.stringify([...pageOne.events, ...pageTwo.events]).toLowerCase();
  for (const forbidden of ["not-persisted@example.invalid", "token_hash", "session_hash", "signed_url", "filename", "comment"]) {
    assert.equal(serialized.includes(forbidden), false, `audit exposed ${forbidden}`);
  }
  const unsafeActor = await recordProofAuditEvent({
    action: "proof.sync_failed",
    outcome: "failed",
    order_number: "A0221133",
    metadata: { failure_class: "Error" },
    context: { actor_type: "operator", actor_id: "not-persisted@example.invalid", source: "operator" }
  });
  assert.equal(unsafeActor.actor_id, "unknown");
});

test("serves redacted audit only through the authenticated operator router contract", async () => {
  const response = await request(app).get("/api/proof/orders/A0221132/audit?limit=2").expect(200);
  assert.equal(response.body.events.length, 2);
  assert.match(response.headers["cache-control"], /no-store/);
  assert.equal(response.body.events[0].actor_id, "psession_qa-1");
  await request(app).get("/api/proof/orders/A0221132/audit?cursor=not-a-cursor").expect(400);
});

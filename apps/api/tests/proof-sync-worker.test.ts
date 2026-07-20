import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let handler: typeof import("../src/proof-sync-lambda.ts")["handler"];
let getProofOrder: typeof import("../src/proof/store.ts")["getProofOrder"];
let listProofAuditEvents: typeof import("../src/proof/store.ts")["listProofAuditEvents"];
let originalFetch: typeof globalThis.fetch;
const methods: string[] = [];

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-sync-worker-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "off";
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    methods.push(init?.method ?? "GET");
    const url = new URL(String(input));
    if (url.pathname.includes("AS360Orders")) {
      return new Response(JSON.stringify({
        rowset: [{
          ORDER_NUMBER: "A0221132",
          ORDER_STATUS: "Pending Art Approval",
          LINES: [{ ORDER_LINE_ID: 9301338, LINE_NUMBER: 1, LINE_STEP_NUMBER: 7.02, PRODUCT_NAME: "Panel" }]
        }]
      }), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221132",
        ORDER_LINE_ID: 9301338,
        LINE_NUMBER: 1,
        ATTACHMENT_ID: 25435041,
        PROOF_FILENAME: "panel.pdf",
        PROOF_LINK_HIGH: "https://proof-assets.example.invalid/panel.pdf",
        PROOF_APPROVAL_STATUS: "PENDING"
      }]
    }), { headers: { "content-type": "application/json" } });
  };
  ({ handler } = await import("../src/proof-sync-lambda.ts"));
  ({ getProofOrder, listProofAuditEvents } = await import("../src/proof/store.ts"));
});

after(async () => {
  globalThis.fetch = originalFetch;
  await rm(testDirectory, { recursive: true, force: true });
});

test("processes a queued cached-read refresh through Lift GETs only", async () => {
  const result = await handler({ Records: [{ body: JSON.stringify({ order_number: "a0221132" }), messageId: "qa-1" }] });
  const stored = await getProofOrder("A0221132");
  assert.equal(result.processed, 1);
  assert.equal(stored?.tasks[0]?.attachment_id, "25435041");
  assert.deepEqual(new Set(methods), new Set(["GET"]));
  const audit = await listProofAuditEvents("A0221132");
  const syncCompleted = audit.events.find((event) => event.action === "proof.sync_completed");
  const reviewReady = audit.events.find((event) => event.action === "proof.review_ready");
  assert.equal(syncCompleted?.metadata.source, "sync_worker");
  assert.equal(reviewReady?.metadata.source, "sync_worker");
  assert.equal(reviewReady?.metadata.review_state, "review_ready");
  assert.equal(reviewReady?.metadata.pending_task_count, 1);
  assert.equal(reviewReady?.metadata.total_task_count, 1);
});

test("rejects malformed queue messages without contacting Lift or exposing the payload", async () => {
  const beforeCount = methods.length;
  await assert.rejects(
    () => handler({ Records: [{ body: JSON.stringify({ token: "must-not-appear" }), messageId: "qa-2" }] }),
    (error: Error) => error.message === "Proof sync failed for correlation qa-2."
  );
  assert.equal(methods.length, beforeCount);
});

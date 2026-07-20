import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let getProofRuntimeConfig: typeof import("../src/proof/runtime-config.ts")["getProofRuntimeConfig"];
let getProofOrder: typeof import("../src/proof/store.ts")["getProofOrder"];
let listProofAuditEvents: typeof import("../src/proof/store.ts")["listProofAuditEvents"];
let syncProofOrder: typeof import("../src/proof/service.ts")["syncProofOrder"];

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-foundation-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_PROOF_QA_ISOLATED_ENDPOINT_CONFIRMED = "true";
  process.env.PATHFINDER_PROOF_QA_DEDICATED_CREDENTIALS_CONFIRMED = "true";
  process.env.PATHFINDER_PROOF_QA_APPROVAL_CYCLE_CONFIRMED = "true";
  process.env.PATHFINDER_PROOF_QA_REVISION_CYCLE_CONFIRMED = "true";
  process.env.PATHFINDER_PROOF_ENABLE_APPROVE = "true";
  process.env.PATHFINDER_PROOF_ENABLE_REVISION = "true";
  process.env.PATHFINDER_PROOF_ENABLE_UNDO = "true";

  ({ getProofRuntimeConfig } = await import("../src/proof/runtime-config.ts"));
  ({ getProofOrder, listProofAuditEvents } = await import("../src/proof/store.ts"));
  ({ syncProofOrder } = await import("../src/proof/service.ts"));
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("keeps every Lift Proof write flag hard-disabled during the read-only phase", () => {
  const config = getProofRuntimeConfig();
  assert.equal(config.phase, "tokenized_customer_read_foundation");
  assert.deepEqual(config.feature_flags, {
    grant_creation: false,
    proof_link_email: false,
    public_read: false,
    approve: false,
    revision: false,
    undo: false
  });
  assert.equal(config.qa_lifecycle.lift_writes_enabled, false);
});

test("synchronizes a direct Lift order without a Pathfinder job and persists the normalized aggregate", async () => {
  const fetchedUrls: string[] = [];
  let approvalStatus = "PENDING";
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    fetchedUrls.push(url.toString());
    if (url.pathname.includes("AS360Orders")) {
      return new Response(
        JSON.stringify({
          rowset: [
            {
              ORDER_NUMBER: "A0221132",
              ORDER_LINE_ID: 9301338,
              LINE_NUMBER: 10,
              PRODUCT_NAME: "North wall panel"
            }
          ]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        rowset: [
          {
            ORDER_NUMBER: "A0221132",
            ORDER_LINE_ID: 9301338,
            LINE_NUMBER: 10,
            ATTACHMENT_ID: 25435041,
            PROOF_FILENAME: "north.pdf",
            PROOF_LINK_HIGH: "https://files.example/north.pdf",
            PROOF_APPROVAL_STATUS: approvalStatus
          }
        ]
      }),
      { headers: { "content-type": "application/json" } }
    );
  };

  const result = await syncProofOrder("a0221132", {
    fetcher,
    synced_at: "2026-07-20T12:00:00.000Z"
  });
  const persisted = await getProofOrder("A0221132");

  assert.equal(result.order.order_number, "A0221132");
  assert.equal(result.order.tasks[0]?.attachment_id, "25435041");
  assert.deepEqual(result.order.last_sync_diagnostics, {
    source: "lift_read",
    completed_at: "2026-07-20T12:00:00.000Z",
    line_reads: { attempted: 1, succeeded: 1, failed: 0, proof_rows: 1 },
    fallback_read: { attempted: false, ok: null, proof_rows: 0 },
    normalization_warning_count: 0
  });
  assert.deepEqual(result.diagnostics, result.order.last_sync_diagnostics);
  assert.equal(JSON.stringify(result.diagnostics).includes("url"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("error"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("order_line_id"), false);
  assert.deepEqual(persisted, result.order);
  assert.ok(fetchedUrls.some((url) => new URL(url).searchParams.get("p0") === "A0221132"));
  assert.ok(fetchedUrls.some((url) => new URL(url).searchParams.get("p2") === "9301338"));

  await syncProofOrder("A0221132", { fetcher, synced_at: "2026-07-20T12:01:00.000Z" });
  approvalStatus = "APPROVED";
  await syncProofOrder("A0221132", { fetcher, synced_at: "2026-07-20T12:02:00.000Z" });
  approvalStatus = "PENDING";
  await syncProofOrder("A0221132", { fetcher, synced_at: "2026-07-20T12:03:00.000Z" });

  const audit = await listProofAuditEvents("A0221132", { limit: 100 });
  const reviewActions = audit.events
    .map((event) => event.action)
    .filter((action) => action === "proof.review_ready" || action === "proof.all_reviewed" || action === "proof.review_reopened");
  assert.deepEqual(reviewActions.sort(), ["proof.all_reviewed", "proof.review_ready", "proof.review_reopened"]);
  assert.equal(audit.events.filter((event) => event.action === "proof.review_ready").length, 1);
  assert.equal(audit.events.filter((event) => event.action === "proof.sync_completed").length, 4);
  const lifecycleEvent = audit.events.find((event) => event.action === "proof.all_reviewed");
  assert.equal(lifecycleEvent?.metadata.review_state, "all_reviewed");
  assert.equal(lifecycleEvent?.metadata.reviewed_task_count, 1);
  assert.equal(lifecycleEvent?.metadata.total_task_count, 1);
});

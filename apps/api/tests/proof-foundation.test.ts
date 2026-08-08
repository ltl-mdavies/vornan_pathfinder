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

test("keeps every opt-in Proof capability dark by default", () => {
  const config = getProofRuntimeConfig();
  assert.equal(config.phase, "single_proof_customer_approval_foundation");
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

test("rejects a non-cohort order header before proof reads or aggregate persistence", async () => {
  const fetchedUrls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    fetchedUrls.push(url.toString());
    if (!url.pathname.includes("AS360Orders")) {
      throw new Error("Proof report must not be read for a denied customer.");
    }
    return new Response(
      JSON.stringify({
        rowset: [{
          ORDER_NUMBER: "A0999999",
          CUSTOMER_ID: 9999,
          ORDER_LINE_ID: 1,
          LINE_NUMBER: 1
        }]
      }),
      { headers: { "content-type": "application/json" } }
    );
  };

  await assert.rejects(
    () => syncProofOrder("A0999999", {
      fetcher,
      synced_at: "2026-07-21T12:00:00.000Z",
      allowed_customer_ids: ["1249"]
    }),
    { name: "ProofSyncCohortDeniedError" }
  );
  assert.equal(fetchedUrls.length, 1);
  assert.equal(fetchedUrls[0]?.includes("AS360Orders"), true);
  assert.equal(await getProofOrder("A0999999"), null);
  const audit = await listProofAuditEvents("A0999999", { limit: 10 });
  assert.equal(audit.events[0]?.action, "proof.sync_failed");
  assert.equal(audit.events[0]?.metadata.failure_class, "ProofSyncCohortDeniedError");
});

test("does not replace the aggregate when any expected Lift line read is incomplete", async () => {
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("AS360Orders")) {
      return new Response(JSON.stringify({
        rowset: [
          { ORDER_NUMBER: "A0221140", ORDER_LINE_ID: 1, LINE_NUMBER: 1 },
          { ORDER_NUMBER: "A0221140", ORDER_LINE_ID: 2, LINE_NUMBER: 2 }
        ]
      }), { headers: { "content-type": "application/json" } });
    }
    if (url.searchParams.get("p2") === "2") {
      return new Response("unavailable", { status: 503 });
    }
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221140",
        ORDER_LINE_ID: 1,
        LINE_NUMBER: 1,
        ATTACHMENT_ID: 10,
        PROOF_FILENAME: "line-one.pdf",
        PROOF_LINK_HIGH: "https://files.example/line-one.pdf",
        PROOF_APPROVAL_STATUS: "PENDING"
      }]
    }), { headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => syncProofOrder("A0221140", { fetcher, synced_at: "2026-08-03T20:00:00.000Z" }),
    { name: "ProofSyncIncompleteError" }
  );
  assert.equal(await getProofOrder("A0221140"), null);
  const audit = await listProofAuditEvents("A0221140", { limit: 10 });
  assert.equal(audit.events[0]?.action, "proof.sync_failed");
  assert.equal(audit.events[0]?.metadata.failure_class, "ProofSyncIncompleteError");
});

test("requires two consecutive reads to agree on the current proof asset identity", async () => {
  let proofRead = 0;
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("AS360Orders")) {
      return new Response(JSON.stringify({
        rowset: [{ ORDER_NUMBER: "A0221141", ORDER_LINE_ID: 11, LINE_NUMBER: 1 }]
      }), { headers: { "content-type": "application/json" } });
    }
    proofRead += 1;
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221141",
        ORDER_LINE_ID: 11,
        LINE_NUMBER: 1,
        ATTACHMENT_ID: 110,
        PROOF_FILENAME: "changing.pdf",
        PROOF_LINK_HIGH: `https://files.example/changing-v${proofRead}.pdf?token=${proofRead}`,
        PROOF_APPROVAL_STATUS: "PENDING"
      }]
    }), { headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => syncProofOrder("A0221141", { fetcher, synced_at: "2026-08-03T20:01:00.000Z" }),
    { name: "ProofSyncUnstableError" }
  );
  assert.equal(proofRead, 2);
  assert.equal(await getProofOrder("A0221141"), null);
});

test("accepts query-only Lift token rotation and retains the second proven URL", async () => {
  let proofRead = 0;
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("AS360Orders")) {
      return new Response(JSON.stringify({
        rowset: [{ ORDER_NUMBER: "A0221142", ORDER_LINE_ID: 12, LINE_NUMBER: 1 }]
      }), { headers: { "content-type": "application/json" } });
    }
    proofRead += 1;
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221142",
        ORDER_LINE_ID: 12,
        LINE_NUMBER: 1,
        ATTACHMENT_ID: 120,
        PROOF_FILENAME: "stable.pdf",
        PROOF_LINK_HIGH: `https://files.example/stable.pdf?token=${proofRead}`,
        PROOF_APPROVAL_STATUS: "PENDING",
        COMMENT_ATTACHMENT: JSON.stringify({
          filename: "reference.pdf",
          url: `https://files.example/reference.pdf?token=${proofRead}`
        })
      }]
    }), { headers: { "content-type": "application/json" } });
  };

  const result = await syncProofOrder("A0221142", {
    fetcher,
    synced_at: "2026-08-03T20:02:00.000Z"
  });
  assert.equal(proofRead, 2);
  assert.equal(result.order.tasks[0]?.current_version?.download_url, "https://files.example/stable.pdf?token=2");
});

test("rejects a quantity-only change between consecutive Lift reads", async () => {
  let proofRead = 0;
  let orderRead = 0;
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("AS360Orders")) {
      orderRead += 1;
      return new Response(JSON.stringify({
        rowset: [{
          ORDER_NUMBER: "A0221145",
          ORDER_LINE_ID: 15,
          LINE_NUMBER: 1,
          QUANTITY: orderRead === 1 ? 4 : 5
        }]
      }), { headers: { "content-type": "application/json" } });
    }
    proofRead += 1;
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221145",
        ORDER_LINE_ID: 15,
        LINE_NUMBER: 1,
        ATTACHMENT_ID: 150,
        PROOF_FILENAME: "quantity-drift.pdf",
        PROOF_LINK_HIGH: "https://files.example/quantity-drift.pdf",
        PROOF_APPROVAL_STATUS: "PENDING"
      }]
    }), { headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => syncProofOrder("A0221145", { fetcher, synced_at: "2026-08-03T20:02:30.000Z" }),
    { name: "ProofSyncUnstableError" }
  );
  assert.equal(proofRead, 2);
  assert.equal(orderRead, 2);
  assert.equal(await getProofOrder("A0221145"), null);
});

test("rejects a feedback-only change between consecutive Lift reads", async () => {
  let proofRead = 0;
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("AS360Orders")) {
      return new Response(JSON.stringify({
        rowset: [{ ORDER_NUMBER: "A0221143", ORDER_LINE_ID: 13, LINE_NUMBER: 1 }]
      }), { headers: { "content-type": "application/json" } });
    }
    proofRead += 1;
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221143",
        ORDER_LINE_ID: 13,
        LINE_NUMBER: 1,
        ATTACHMENT_ID: 130,
        PROOF_FILENAME: "feedback.pdf",
        PROOF_LINK_HIGH: "https://files.example/feedback.pdf",
        PROOF_APPROVAL_STATUS: "PENDING",
        PROOF_COMMENT: proofRead === 1 ? "First note" : "Changed note"
      }]
    }), { headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => syncProofOrder("A0221143", { fetcher, synced_at: "2026-08-03T20:03:00.000Z" }),
    { name: "ProofSyncUnstableError" }
  );
  assert.equal(await getProofOrder("A0221143"), null);
});

test("rejects a stable same-customer Lift payload for a different order", async () => {
  let fetchCount = 0;
  const fetcher = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      rowset: [{
        ORDER_NUMBER: "A0221199",
        CUSTOMER_ID: 1249,
        ORDER_LINE_ID: 14,
        LINE_NUMBER: 1
      }]
    }), { headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    () => syncProofOrder("A0221144", {
      fetcher,
      synced_at: "2026-08-03T20:04:00.000Z",
      allowed_customer_ids: ["1249"]
    }),
    { name: "ProofSyncOrderMismatchError" }
  );
  assert.equal(fetchCount, 1);
  assert.equal(await getProofOrder("A0221144"), null);
});

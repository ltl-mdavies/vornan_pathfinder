import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeProofOrder } from "@pathfinder/proof-domain";

process.env.PATHFINDER_RUNTIME = "lambda";
process.env.PATHFINDER_REQUIRE_AUTH = "false";

const { buildOrderSnapshot, publicOrderStatusSnapshotFromInternal } = await import("../src/server.ts");

const captured = JSON.parse(
  await readFile(
    new URL("../../../packages/proof-domain/tests/fixtures/lift-siblings-A0221132.redacted.json", import.meta.url),
    "utf8"
  )
) as {
  order_number: string;
  order_payload: unknown;
  proof_payloads: unknown[];
};

function realProofSnapshot() {
  const proofOrder = normalizeProofOrder({
    ...captured,
    synced_at: "2026-07-20T12:00:00.000Z"
  });

  return buildOrderSnapshot({
    customer: {} as never,
    job: {
      job_id: "job-real-proof-rollup-contract",
      state: "Order Confirmed",
      import_method_name: "Lift order lookup",
      source_file_name: "Not applicable",
      created_at: "2026-07-20T11:00:00.000Z",
      updated_at: "2026-07-20T12:00:00.000Z",
      source_customer_id: "redacted-customer",
      source_customer_name: "Redacted customer",
      submit_customer_id: "redacted-submit-customer",
      submit_customer_name: "Redacted submit customer",
      lift_payload: {
        order: {
          ext_id: "REDACTED-EXT-ID",
          order_title: "Redacted proof order"
        },
        lines: [{
          line_number: 1,
          product_id: null,
          product_name: "Redacted product",
          description: "Redacted product",
          quantity: 20,
          unit_number: "",
          dimensions: { final_height: 1, final_width: 1 },
          production: {}
        }]
      }
    } as never,
    route: {
      output_route_id: "route-real-proof-contract",
      name: "Redacted Lift route",
      environment_id: "prod",
      output_template: "Lift order"
    } as never,
    target: { name: "Lift ERP" } as never,
    attempts: [] as never,
    orderNumber: captured.order_number,
    orderLookup: {
      ok: true,
      http_status: 200,
      fetched_at: "2026-07-20T12:00:00.000Z",
      payload: captured.order_payload
    } as never,
    proofReport: null,
    proofOrder,
    packageDetails: null,
    issues: []
  });
}

test("renders every redacted real sibling proof exactly once on its authoritative Lift line", () => {
  const snapshot = realProofSnapshot();
  const line = snapshot.lines[0];

  assert.equal(snapshot.order_number, "A0221132");
  assert.equal(line?.order_line_id, 9301338);
  assert.equal(line?.proof_count, 4);
  assert.equal(new Set(line?.proofs.map((proof) => proof.proof_filename)).size, 4);
  assert.equal(new Set(line?.proofs.map((proof) => proof.proof_link_high)).size, 4);
  assert.ok(line?.proofs.every((proof) => proof.preview_kind === "image"));
  assert.ok(line?.proofs.every((proof) => proof.proof_state === "pending"));
  assert.deepEqual(snapshot.proof_summary, {
    source: "proof_cache",
    health: "active",
    pending: 4,
    regenerating: 0,
    waiting: 0,
    reviewed: 0,
    total: 4,
    review_required: true,
    last_synced_at: "2026-07-20T12:00:00.000Z",
    decisions_enabled: false
  });
});

test("projects the real proof gallery through the public status boundary without decision authority", () => {
  const snapshot = publicOrderStatusSnapshotFromInternal(realProofSnapshot());
  const proofs = snapshot.lines[0]?.proofs ?? [];

  assert.equal(proofs.length, 4);
  assert.ok(proofs.every((proof) => {
    const low = typeof (proof as { proof_link_low?: unknown }).proof_link_low === "string"
      ? String((proof as { proof_link_low: string }).proof_link_low)
      : "";
    const high = typeof (proof as { proof_link_high?: unknown }).proof_link_high === "string"
      ? String((proof as { proof_link_high: string }).proof_link_high)
      : "";
    return low.startsWith("https://") && high.startsWith("https://");
  }));
  assert.equal(snapshot.proof_summary?.decisions_enabled, false);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("ATTACHMENT_ID"), false);
  assert.equal(serialized.includes("PROOF_APPROVED_BY"), false);
  assert.equal(serialized.includes("DETAILED_REPORT"), false);
  assert.equal(serialized.includes("grant"), false);
  assert.equal(serialized.includes("session"), false);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("source-order review disposition is exact, append-only, and idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-source-review-"));
  const storePath = join(directory, "pathfinder.json");
  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const {
        WrikeSourceOrderReviewConflictError,
        getJob,
        persistJobSnapshot,
        recordWrikeSourceOrderReviewDisposition
      } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "284619",
        customer_name: "Empirical - Momentara",
        customer_number: "0000000960",
        customer_status: "Active",
        contacts: []
      };
      await persistJobSnapshot(customer, {
        job_id: "job-review",
        customer_id: customer.lift_customer_id,
        customer_name: customer.customer_name,
        state: "Order Confirmed",
        created_at: "2026-08-13T14:28:10.000Z",
        updated_at: "2026-08-13T14:43:07.000Z",
        source_order_history: [{
          event_id: "event-material",
          action: "source_change_observed_after_transport",
          created_at: "2026-08-13T14:43:07.000Z",
          source_evidence_id: "evidence-1",
          import_method_fingerprint: "fingerprint-2",
          reference_proof_evidence_ids: ["proof-1"],
          message: "Review required."
        }]
      });
      const first = await recordWrikeSourceOrderReviewDisposition(customer, {
        job_id: "job-review",
        event_id: "event-material",
        disposition: "no_lift_update_needed",
        actor_id: "OPERATOR@VORNAN.CO",
        note: "  Confirmed   internally. "
      });
      assert.equal(first.reused, false);
      assert.equal(first.disposition.actor_id, "operator@vornan.co");
      assert.equal(first.disposition.note, "Confirmed internally.");
      const replay = await recordWrikeSourceOrderReviewDisposition(customer, {
        job_id: "job-review",
        event_id: "event-material",
        disposition: "resolved",
        actor_id: "other@vornan.co"
      });
      assert.equal(replay.reused, true);
      assert.equal(replay.disposition.disposition, "no_lift_update_needed");
      const stored = await getJob(customer, "job-review");
      assert.equal(stored.source_order_history.length, 1);
      assert.equal(stored.source_order_review_dispositions.length, 1);
      await assert.rejects(
        recordWrikeSourceOrderReviewDisposition(customer, {
          job_id: "job-review",
          event_id: "missing-event",
          disposition: "resolved",
          actor_id: "operator@vornan.co"
        }),
        (error) => error instanceof WrikeSourceOrderReviewConflictError && /no longer available/.test(error.message)
      );
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx/esm", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATHFINDER_LOCAL_STORE_PATH: storePath,
          PATHFINDER_STORAGE_DRIVER: "local"
        },
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


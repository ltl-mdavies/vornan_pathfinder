import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("conditionally associates one uncertain attempt without modifying or duplicating it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-uncertain-association-"));
  const storePath = join(directory, "pathfinder.json");
  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const {
        associateJobWithLiftOrder,
        getJob,
        listSubmitAttemptsForJob,
        persistJobSnapshot,
        persistSubmitAttempt
      } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "284619", customer_name: "Momentara", customer_number: null,
        customer_type: null, customer_status: "Regular", sales_rep: null,
        default_invoice_email_address: null, created_date: null, crm_id: null,
        terms: null, terms_status: null, credit_limit: null, credit_hold: null,
        unpaid_total: null, available_credit: null
      };
      const job = {
        job_id: "job_20260826165801_4e2284", customer_id: "284619",
        customer_name: "Momentara", output_route_id: "route-prod", state: "Submitted",
        target_order_number: null, created_at: "2026-08-26T16:58:01.000Z",
        updated_at: "2026-08-26T16:58:16.000Z"
      };
      await persistJobSnapshot(customer, job);
      const attempt = {
        attempt_id: "submit_b5d039", idempotency_key: "idempotency-b5d039",
        customer_id: "284619", customer_name: "Momentara", job_id: job.job_id,
        output_route_id: "route-prod", output_route_name: "Lift Production",
        submit_profile_id: "profile-live", submit_profile_name: "Live",
        submit_mode: "live_customer", sandbox: false, state: "Submission Uncertain",
        transport_mode: "live", external_submit_enabled: true,
        request_fingerprint: "request-fingerprint", endpoint_url: "https://lift.invalid",
        ext_id: "PFMTAC7UY1272E", company_id: "91", submit_request_masked: {},
        certification: { can_submit: true, external_submit_enabled: true, summary: "ready", items: [] },
        blocking_items: [], response: {
          status: "error", http_status: null, lift_order_id: null,
          message: "Lift timeout", raw_body: null, received_at: "2026-08-26T16:58:16.000Z"
        }, created_at: "2026-08-26T16:58:01.000Z", updated_at: "2026-08-26T16:58:16.000Z"
      };
      await persistSubmitAttempt(customer, attempt);
      const verification = {
        order_number: "A0229496", customer_id: "284619", customer_name: "Momentara",
        order_title: "C316981", contract_number: "C316981", created_by: "PATHFINDER",
        order_status: "Pending Art", line_count: 11,
        fetched_at: "2026-08-26T17:10:00.000Z", external_order_id: "PFMTAC7UY1272E",
        company_id: "91", po_number: "C316981", order_type: "High End Work",
        line_fingerprint: "line-fingerprint", submit_attempt_id: attempt.attempt_id,
        request_fingerprint: attempt.request_fingerprint
      };
      const result = await associateJobWithLiftOrder(customer, {
        job_id: job.job_id, order_number: "A0229496", expected_current_order_number: null,
        linked_by_email: "operator@vornan.co",
        reason: "Reconcile the one exact Lift timeout without retry.", verification,
        source: "scheduled_uncertain_reconciliation",
        expected_uncertain_attempt: {
          attempt_id: attempt.attempt_id, idempotency_key: attempt.idempotency_key,
          request_fingerprint: attempt.request_fingerprint
        }
      });
      assert.equal(result.job.target_order_number, "A0229496");
      assert.equal(result.association.source, "scheduled_uncertain_reconciliation");
      assert.equal(result.association.automatic_wrike_status_writeback_suppressed, undefined);
      const attempts = await listSubmitAttemptsForJob(customer, job.job_id);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].state, "Submission Uncertain");
      assert.equal(attempts[0].response.lift_order_id, null);
      const persisted = await getJob(customer, job.job_id);
      assert.equal(persisted.target_order_association_history.length, 1);
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

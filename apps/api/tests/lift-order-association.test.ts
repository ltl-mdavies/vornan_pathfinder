import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("verified Lift order associations are replay-safe, replaceable, audited, and rebind active status tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-lift-order-association-"));
  const storePath = join(directory, "pathfinder.json");

  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const {
        LiftOrderAssociationConflictError,
        associateJobWithLiftOrder,
        getJob,
        getOrderStatusToken,
        persistJobSnapshot,
        persistOrderStatusToken,
        rebindActiveOrderStatusTokensForJob
      } = await import(${JSON.stringify(storeModuleUrl)});

      const customer = {
        lift_customer_id: "284619",
        customer_name: "Empirical - Momentara",
        customer_number: "0000000960",
        customer_status: "Active",
        contacts: []
      };
      await persistJobSnapshot(customer, {
        job_id: "job-timeout-recovery",
        customer_id: customer.lift_customer_id,
        customer_name: customer.customer_name,
        output_route_id: "route-lift-prod",
        state: "Submitted",
        created_at: "2026-08-03T18:00:00.000Z",
        updated_at: "2026-08-03T18:00:00.000Z"
      });

      const verification = (orderNumber) => ({
        order_number: orderNumber,
        customer_id: "284619",
        customer_name: "Empirical - Momentara",
        order_title: "C316870 - AZ Lottery",
        contract_number: "C316870",
        created_by: "PATHFINDER",
        order_status: "Pending Art Approval",
        line_count: 3,
        fetched_at: "2026-08-03T18:05:00.000Z"
      });

      const linked = await associateJobWithLiftOrder(customer, {
        job_id: "job-timeout-recovery",
        order_number: "A0227641",
        expected_current_order_number: null,
        linked_by_email: "operator@vornan.co",
        reason: "Recover the order created after an upstream timeout.",
        verification: verification("A0227641")
      });
      assert.equal(linked.reused, false);
      assert.equal(linked.job.state, "Order Confirmed");
      assert.equal(linked.job.target_order_number, "A0227641");
      assert.equal(linked.job.order_confirmed_at, linked.association.linked_at);
      assert.equal(linked.job.target_order_association_history.length, 1);
      assert.equal(linked.association.action, "linked");
      assert.equal(linked.association.previous_order_number, null);

      const replay = await associateJobWithLiftOrder(customer, {
        job_id: "job-timeout-recovery",
        order_number: "a0227641",
        expected_current_order_number: null,
        linked_by_email: "operator@vornan.co",
        reason: "Exact operator replay should not duplicate the audit entry.",
        verification: verification("A0227641")
      });
      assert.equal(replay.reused, true);
      assert.equal(replay.job.target_order_association_history.length, 1);

      await persistOrderStatusToken({
        token_hash: "status-token-hash",
        order_key: "284619:job-timeout-recovery:A0227641",
        customer_id: "284619",
        job_id: "job-timeout-recovery",
        order_number: "A0227641",
        status: "Active",
        created_at: "2026-08-03T18:06:00.000Z",
        updated_at: "2026-08-03T18:06:00.000Z",
        expires_at: "2026-09-03T18:06:00.000Z",
        expires_at_epoch: 1788458760
      });

      const replaced = await associateJobWithLiftOrder(customer, {
        job_id: "job-timeout-recovery",
        order_number: "A0228000",
        expected_current_order_number: "A0227641",
        linked_by_email: "operator@vornan.co",
        reason: "Replace the original Lift order after production reconciliation.",
        verification: verification("A0228000")
      });
      assert.equal(replaced.reused, false);
      assert.equal(replaced.association.action, "replaced");
      assert.equal(replaced.association.previous_order_number, "A0227641");
      assert.equal(replaced.job.target_order_association_history.length, 2);
      assert.equal(replaced.job.order_confirmed_at, linked.job.order_confirmed_at);

      const reboundCount = await rebindActiveOrderStatusTokensForJob({
        customer_id: "284619",
        job_id: "job-timeout-recovery",
        order_number: "A0228000",
        order_key: "284619:job-timeout-recovery:A0228000"
      });
      assert.equal(reboundCount, 1);
      const token = await getOrderStatusToken("status-token-hash");
      assert.equal(token.order_number, "A0228000");
      assert.equal(token.order_key, "284619:job-timeout-recovery:A0228000");

      await assert.rejects(
        associateJobWithLiftOrder(customer, {
          job_id: "job-timeout-recovery",
          order_number: "A0229000",
          expected_current_order_number: "A0227641",
          reason: "This replacement was verified against a stale job version.",
          verification: verification("A0229000")
        }),
        (error) => error instanceof LiftOrderAssociationConflictError && /changed after verification/.test(error.message)
      );
      await assert.rejects(
        associateJobWithLiftOrder(customer, {
          job_id: "job-timeout-recovery",
          order_number: "A0229000",
          expected_current_order_number: "A0228000",
          reason: "Mismatch should fail closed before changing the association.",
          verification: verification("A0229999")
        }),
        (error) => error instanceof LiftOrderAssociationConflictError && /binding is invalid/.test(error.message)
      );

      const finalJob = await getJob(customer, "job-timeout-recovery");
      assert.equal(finalJob.target_order_number, "A0228000");
      assert.equal(finalJob.order_confirmed_at, linked.job.order_confirmed_at);
      assert.equal(finalJob.target_order_association_history.length, 2);
      assert.ok(finalJob.target_order_association_history.every((entry) => !JSON.stringify(entry).includes("status-token-hash")));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_LOCAL_STORE_PATH: storePath,
        PATHFINDER_STORAGE_DRIVER: "local"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

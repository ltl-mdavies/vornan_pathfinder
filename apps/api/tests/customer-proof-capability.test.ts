import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("customer Proof settings are safe by default, audited, order-aware, and persist across reloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-proof-capability-"));
  const storePath = join(directory, "pathfinder.json");

  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const {
        CustomerProofCapabilityValidationError,
        getOrCreateWorkspace,
        persistJobSnapshot,
        removeCustomerProofOrderOverride,
        resolveCustomerProofCapabilityForOrder,
        updateCustomerProofCapabilityPolicy,
        upsertCustomerProofOrderOverride,
        verifyCustomerProofCustomerIdentity
      } = await import(${JSON.stringify(storeModuleUrl)});

      const customer = {
        lift_customer_id: "284619",
        customer_name: "Empirical - Momentara",
        customer_number: "0000000960",
        customer_status: "Active",
        contacts: []
      };
      const initial = await getOrCreateWorkspace(customer);
      assert.equal(initial.proof_capability_policy.access_mode, "view_only");
      assert.equal(initial.proof_capability_policy.review_experience, "simple");
      assert.deepEqual(initial.proof_capability_policy.order_overrides, []);
      assert.equal(initial.proof_capability_policy.customer_identity, null);

      await persistJobSnapshot(customer, {
        job_id: "job-proof-capability",
        customer_id: customer.lift_customer_id,
        customer_name: customer.customer_name,
        output_route_id: "route-lift-prod",
        target_order_number: "A0226753",
        state: "Order Confirmed",
        created_at: "2026-08-04T12:00:00.000Z",
        updated_at: "2026-08-04T12:00:00.000Z"
      });

      const before = await resolveCustomerProofCapabilityForOrder("A0226753");
      assert.equal(before.association_status, "associated");
      assert.equal(before.access_mode, "view_only");
      assert.equal(before.review_experience, "simple");

      const identified = await verifyCustomerProofCustomerIdentity(
        customer,
        "1249",
        "A0226753",
        "operator-test",
        before.policy_updated_at
      );
      assert.equal(identified.proof_capability_policy.customer_identity.proof_customer_id, "1249");
      assert.equal(identified.proof_capability_audit[0].scope, "identity");

      const advanced = await updateCustomerProofCapabilityPolicy(customer, {
        access_mode: "review",
        review_experience: "advanced"
      }, "operator-test", identified.proof_capability_policy.updated_at);
      assert.equal(advanced.proof_capability_audit.length, 2);
      assert.equal(advanced.proof_capability_audit[0].scope, "customer");

      const inherited = await resolveCustomerProofCapabilityForOrder("A0226753");
      assert.equal(inherited.source, "customer_default");
      assert.equal(inherited.access_mode, "review");
      assert.equal(inherited.review_experience, "advanced");
      assert.equal(inherited.proof_customer_id, "1249");

      const simpleOverride = await upsertCustomerProofOrderOverride(customer, "a0226753", {
        access_mode: "review",
        review_experience: "simple"
      }, "operator-test", advanced.proof_capability_policy.updated_at);
      assert.equal(simpleOverride.proof_capability_policy.order_overrides[0].order_number, "A0226753");
      assert.equal(simpleOverride.proof_capability_audit.length, 3);

      const overridden = await resolveCustomerProofCapabilityForOrder("A0226753");
      assert.equal(overridden.source, "order_override");
      assert.equal(overridden.review_experience, "simple");

      await removeCustomerProofOrderOverride(
        customer,
        "A0226753",
        "operator-test",
        simpleOverride.proof_capability_policy.updated_at
      );
      const restored = await resolveCustomerProofCapabilityForOrder("A0226753");
      assert.equal(restored.source, "customer_default");
      assert.equal(restored.review_experience, "advanced");

      const unrelated = await resolveCustomerProofCapabilityForOrder("A0229999");
      assert.equal(unrelated.association_status, "unassociated");
      assert.equal(unrelated.access_mode, "view_only");
      assert.equal(unrelated.review_experience, "simple");

      await assert.rejects(
        updateCustomerProofCapabilityPolicy(customer, {
          access_mode: "view_only",
          review_experience: "advanced"
        }, "operator-test", restored.policy_updated_at),
        (error) => error instanceof CustomerProofCapabilityValidationError
      );

      await assert.rejects(
        updateCustomerProofCapabilityPolicy(customer, {
          access_mode: "disabled",
          review_experience: "simple"
        }, "operator-test", advanced.proof_capability_policy.updated_at),
        (error) => error.name === "CustomerProofCapabilityConflictError"
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

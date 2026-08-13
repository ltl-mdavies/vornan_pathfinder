import assert from "node:assert/strict";
import test from "node:test";
import type { ProofAccessGrant } from "@pathfinder/proof-domain";
import {
  proofCapabilityBindingMatchesWorkspace,
  revalidateProofCustomerCapability
} from "../src/proof/customer-capability-authority.ts";

const grant: ProofAccessGrant = {
  grant_id: "pgrant_authority-qa",
  order_number: "A0226753",
  scope: "review",
  label: null,
  status: "active",
  token_hash: "a".repeat(64),
  created_at: "2026-08-13T16:00:00.000Z",
  expires_at: "2026-08-13T18:00:00.000Z",
  expires_at_epoch: 1786644000,
  exchanged_at: null,
  revoked_at: null,
  last_used_at: null,
  capability: {
    pathfinder_customer_id: "284619",
    proof_customer_id: "1249",
    identity_verified_at: "2026-08-13T15:59:00.000Z",
    access_mode: "review",
    review_experience: "simple",
    source: "order_override",
    policy_updated_at: "2026-08-13T16:00:00.000Z"
  }
};

const workspace = {
  customer: { lift_customer_id: "284619" },
  proof_capability_policy: {
    access_mode: "view_only",
    review_experience: "simple",
    customer_identity: {
      proof_customer_id: "1249",
      verified_order_number: "A0226753",
      verified_at: "2026-08-13T15:59:00.000Z"
    },
    order_overrides: [{
      order_number: "A0226753",
      access_mode: "review",
      review_experience: "simple",
      updated_at: "2026-08-13T16:00:00.000Z"
    }],
    updated_at: "2026-08-13T16:00:00.000Z"
  }
};

test("matches the exact saved customer, order override, identity, profile, and policy version", () => {
  assert.equal(
    proofCapabilityBindingMatchesWorkspace(grant.capability!, grant.order_number, grant.scope, workspace),
    true
  );
});

test("fails closed for every stale or cross-customer authority dimension", async () => {
  for (const changed of [
    { ...workspace, customer: { lift_customer_id: "999999" } },
    {
      ...workspace,
      proof_capability_policy: {
        ...workspace.proof_capability_policy,
        customer_identity: { ...workspace.proof_capability_policy.customer_identity, proof_customer_id: "9999" }
      }
    },
    {
      ...workspace,
      proof_capability_policy: {
        ...workspace.proof_capability_policy,
        order_overrides: [{ ...workspace.proof_capability_policy.order_overrides[0]!, access_mode: "disabled" }]
      }
    },
    {
      ...workspace,
      proof_capability_policy: {
        ...workspace.proof_capability_policy,
        order_overrides: [{ ...workspace.proof_capability_policy.order_overrides[0]!, updated_at: "2026-08-13T16:01:00.000Z" }]
      }
    }
  ]) {
    assert.equal(await revalidateProofCustomerCapability(grant, async () => changed), false);
  }
  assert.equal(await revalidateProofCustomerCapability(grant, async () => null), false);
  assert.equal(await revalidateProofCustomerCapability(grant, async () => { throw new Error("denied"); }), false);
});

test("retains legacy unbound view-only compatibility but never unbound review authority", async () => {
  assert.equal(await revalidateProofCustomerCapability({ ...grant, scope: "view", capability: null }), true);
  assert.equal(await revalidateProofCustomerCapability({ ...grant, capability: null }), false);
});

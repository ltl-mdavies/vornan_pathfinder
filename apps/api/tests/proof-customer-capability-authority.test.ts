import assert from "node:assert/strict";
import test from "node:test";
import type { ProofAccessGrant } from "@pathfinder/proof-domain";
import {
  proofCapabilityBindingMatchesWorkspace,
  proofLtlDemoQaBindingMatchesWorkspace,
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

test("revalidates source-neutral review authority through the persistent exact-customer QA profile", async () => {
  const previousScope = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE =
    "true||LTL_DEMO_ALL|true|true|true|true|true";
  const sourceNeutralWorkspace = {
    customer: { lift_customer_id: "1249" },
    proof_capability_policy: {
      access_mode: "disabled",
      review_experience: "simple",
      customer_identity: {
        proof_customer_id: "1249",
        verified_order_number: "A0226753",
        verified_at: "2026-08-13T15:59:00.000Z"
      },
      order_overrides: [],
      updated_at: "2026-08-13T16:00:00.000Z"
    }
  };
  const sourceNeutralGrant: ProofAccessGrant = {
    ...grant,
    order_number: "A0228667",
    capability: {
      pathfinder_customer_id: "1249",
      proof_customer_id: "1249",
      identity_verified_at: "2026-08-13T15:59:00.000Z",
      access_mode: "review",
      review_experience: "simple",
      source: "ltl_demo_qa",
      policy_updated_at: "2026-08-13T16:00:00.000Z"
    }
  };
  try {
    assert.equal(
      proofLtlDemoQaBindingMatchesWorkspace(
        sourceNeutralGrant.capability!,
        sourceNeutralGrant.order_number,
        sourceNeutralGrant.scope,
        sourceNeutralWorkspace
      ),
      true
    );
    assert.equal(
      await revalidateProofCustomerCapability(sourceNeutralGrant, async () => sourceNeutralWorkspace),
      true
    );
    assert.equal(
      await revalidateProofCustomerCapability(sourceNeutralGrant, async () => ({
        ...sourceNeutralWorkspace,
        customer: { lift_customer_id: "9999" }
      })),
      false
    );
    assert.equal(
      await revalidateProofCustomerCapability(sourceNeutralGrant, async () => ({
        ...sourceNeutralWorkspace,
        proof_capability_policy: {
          ...sourceNeutralWorkspace.proof_capability_policy,
          updated_at: "2026-08-13T16:01:00.000Z"
        }
      })),
      false
    );
  } finally {
    if (previousScope === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = previousScope;
  }
});

test("keeps source-neutral review authority dark outside its persistent exact-order profile", async () => {
  const previousScope = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  const sourceNeutralGrant: ProofAccessGrant = {
    ...grant,
    order_number: "A0228667",
    capability: {
      pathfinder_customer_id: "1249",
      proof_customer_id: "1249",
      identity_verified_at: "2026-08-13T15:59:00.000Z",
      access_mode: "review",
      review_experience: "simple",
      source: "ltl_demo_qa",
      policy_updated_at: "2026-08-13T16:00:00.000Z"
    }
  };
  const sourceNeutralWorkspace = {
    customer: { lift_customer_id: "1249" },
    proof_capability_policy: {
      access_mode: "disabled",
      review_experience: "simple",
      customer_identity: {
        proof_customer_id: "1249",
        verified_order_number: "A0226753",
        verified_at: "2026-08-13T15:59:00.000Z"
      },
      order_overrides: [],
      updated_at: "2026-08-13T16:00:00.000Z"
    }
  };
  try {
    for (const packedScope of [
      "false||LTL_DEMO_ALL|true|true|true|true|true",
      "true||A0229276|true|true|true|true|true",
      "true||LTL_DEMO_ALL|true|true|false|false|true"
    ]) {
      process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = packedScope;
      assert.equal(
        await revalidateProofCustomerCapability(sourceNeutralGrant, async () => sourceNeutralWorkspace),
        false
      );
    }
  } finally {
    if (previousScope === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = previousScope;
  }
});

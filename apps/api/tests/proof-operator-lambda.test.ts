import assert from "node:assert/strict";
import test from "node:test";
import type { ProofOrder } from "@pathfinder/proof-domain";
import { createProofOperatorHandler } from "../src/proof-operator-lambda.ts";

const timestamp = "2026-07-21T12:00:00.000Z";
const order: ProofOrder = {
  order_number: "A0226753",
  order_title: "Internal demo",
  customer_id: "1249",
  customer_name: "LTL Demo",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [],
  tasks: [],
  archived_tasks: [],
  warnings: [],
  created_at: timestamp,
  updated_at: timestamp,
  last_synced_at: timestamp
};

const grant = {
  grant_id: "pgrant_abcdefgh",
  order_number: order.order_number,
  scope: "view" as const,
  label: "Internal review",
  status: "active" as const,
  created_at: timestamp,
  expires_at: "2099-07-28T21:49:50.000Z",
  exchanged_at: null,
  revoked_at: null,
  last_used_at: null,
  participant_count: 0
};

function environment(enabled = true) {
  process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME = "dev";
  process.env.PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED = String(enabled);
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = "1249";
  process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT = "2099-07-28T21:49:50.000Z";
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "off";
}

test("synchronizes the configured cohort before creating an IAM-invoked view grant", async () => {
  environment();
  const lifecycle: string[] = [];
  const handler = createProofOperatorHandler({
    syncOrder: async (orderNumber, options) => {
      lifecycle.push("sync");
      assert.equal(orderNumber, "A0226753");
      assert.deepEqual(options.allowed_customer_ids, ["1249"]);
      return { order, diagnostics: null } as never;
    },
    createGrant: async (input) => {
      lifecycle.push("grant");
      assert.equal(input.scope, "view");
      return { grant, access_url: "https://proof.invalid/#/access/test" };
    },
    listGrants: async () => [],
    revokeGrant: async () => null,
    getGrant: async () => null,
    getOrder: async () => order
  });

  const result = await handler({
    operation: "create_view_grant",
    order_number: "a0226753",
    label: "Internal review"
  }, { awsRequestId: "operator-qa-1" });
  assert.deepEqual(lifecycle, ["sync", "grant"]);
  assert.equal(result.operation, "create_view_grant");
  assert.equal(result.order.cohort_verified, true);
  assert.equal(result.grant.scope, "view");
});

test("fails before synchronization while the operator activation window is dark", async () => {
  environment(false);
  let synchronized = false;
  const handler = createProofOperatorHandler({
    syncOrder: async () => {
      synchronized = true;
      return { order, diagnostics: null } as never;
    },
    createGrant: async () => ({ grant, access_url: "https://proof.invalid/#/access/test" }),
    listGrants: async () => [],
    revokeGrant: async () => null,
    getGrant: async () => null,
    getOrder: async () => order
  });
  await assert.rejects(
    () => handler({ operation: "sync_order", order_number: order.order_number }),
    /Proof operator sync_order failed/
  );
  assert.equal(synchronized, false);
});

test("allows emergency revocation after creation is disabled while retaining cohort scope", async () => {
  environment(false);
  let revoked = false;
  const handler = createProofOperatorHandler({
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    createGrant: async () => ({ grant, access_url: "https://proof.invalid/#/access/test" }),
    listGrants: async () => [],
    revokeGrant: async () => {
      revoked = true;
      return { ...grant, status: "revoked", revoked_at: timestamp };
    },
    getGrant: async () => ({ ...grant, token_hash: "a".repeat(64), expires_at_epoch: 4_100_000_000 }),
    getOrder: async () => order
  });
  const result = await handler({ operation: "revoke_grant", grant_id: grant.grant_id });
  assert.equal(revoked, true);
  assert.equal(result.grant?.status, "revoked");
});

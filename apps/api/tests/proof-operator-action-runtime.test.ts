import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type ProofOrder
} from "@pathfinder/proof-domain";
import {
  buildProofRevisionAssetKeys,
  computeProofAssetCleanupEligibleAtEpoch,
  computeProofAssetLiftNotBeforeEpoch,
  type ProofRevisionAssetReadiness
} from "@pathfinder/proof-domain/proof-asset-lifecycle";
import type { TargetConfig } from "../src/store.ts";
import type { ProofOperatorActionQaConfig } from "../src/proof/operator-action-config.ts";
import {
  createProofOperatorActionService,
  ProofOperatorActionError
} from "../src/proof/operator-action-service.ts";
import type {
  ProofOperatorActionRecord
} from "../src/proof/operator-action-store.ts";

const now = new Date("2026-07-27T12:00:00.000Z");
const order: ProofOrder = {
  order_number: "A0226753",
  order_title: "Synthetic LTL Demo",
  customer_id: "1249",
  customer_name: "LTL Demo",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [],
  tasks: [{
    task_id: "ptask_synthetic_001",
    order_line_id: "line-synthetic-001",
    line_number: "1",
    attachment_id: "proofing-synthetic-0001",
    product_name: "Synthetic panel",
    quantity: 4,
    state: "pending",
    actionable: true,
    sibling_index: 0,
    sibling_count: 1,
    version: 7,
    current_version: {
      version_id: "pversion-synthetic-001",
      attachment_id: "proofing-synthetic-0001",
      created_at: "2026-07-27T11:00:00.000Z",
      filename: "synthetic-proof.pdf",
      preview_url: null,
      download_url: null,
      approval_status: null,
      approved_by: null,
      approved_at: null,
      comments: [],
      detailed_report: null,
      feedback_fingerprint: "feedback-synthetic-001",
      current: true,
      archived_at: null
    },
    versions: [],
    created_at: "2026-07-27T11:00:00.000Z",
    updated_at: "2026-07-27T11:00:00.000Z",
    archived_at: null
  }],
  archived_tasks: [],
  warnings: [],
  created_at: "2026-07-27T11:00:00.000Z",
  updated_at: "2026-07-27T11:00:00.000Z",
  last_synced_at: "2026-07-27T11:00:00.000Z"
};

const targets = [{
  target_id: "lift-standard-graphics",
  adapter: "lift-standard-graphics",
  environments: [{
    environment_id: "env-lift-prod",
    role: "PROD",
    status: "Active",
    endpoint_url: "https://proofing.example.invalid/order-import"
  }]
}] as TargetConfig[];

function runtimeConfig(enabled = true): ProofOperatorActionQaConfig {
  return {
    enabled,
    allowed_customer_id: "1249",
    allowed_company_id: "91",
    allowed_order_numbers: ["A0226753"],
    jwt_ttl_seconds: 60,
    activation_expires_at: "2026-07-27T13:00:00.000Z"
  };
}

const request = {
  order_number: "A0226753",
  task_id: "ptask_synthetic_001",
  attachment_id: "proofing-synthetic-0001",
  action: "APPROVE" as const,
  idempotency_key: "operator-action-synthetic-0001",
  comment: "Synthetic supervised approval",
  revision_asset_id: null
};

const revisionAssetId = `passet_${"a".repeat(64)}`;
const revisionId = `prevision_${"b".repeat(64)}`;
const publicationId = `ppublication_${"c".repeat(64)}`;
const revisionKeys = buildProofRevisionAssetKeys({
  order_number: order.order_number,
  task_id: order.tasks[0].task_id,
  revision_id: revisionId,
  asset_id: revisionAssetId,
  publication_id: publicationId,
  filename: "Synthetic Revised Art.pdf"
});
const readyRevisionAsset: ProofRevisionAssetReadiness = {
  asset_id: revisionAssetId,
  publication_id: publicationId,
  revision_id: revisionId,
  source_kind: "proof_upload",
  order_number: order.order_number,
  task_id: order.tasks[0].task_id,
  attachment_id: order.tasks[0].attachment_id!,
  replaces_proof_version_id: order.tasks[0].current_version!.version_id,
  original_filename: "Synthetic Revised Art.pdf",
  content_type: "application/pdf",
  content_length: 4_096,
  sha256: "d".repeat(64),
  source_object_version_id: "3/L4kqtJlcpXroDTDmJ+sourceVersion=",
  source_key: revisionKeys.source_key,
  outbound_object_version_id: "3/L4kqtJlcpXroDTDmJ+outboundVersion=",
  outbound_sha256: "d".repeat(64),
  outbound_key: revisionKeys.outbound_key,
  delivery_host: "go.vornan.co",
  delivery_url: "https://go.vornan.co/a/synthetic-revised-art?Policy=synthetic",
  delivery_url_sha256: createHash("sha256")
    .update("https://go.vornan.co/a/synthetic-revised-art?Policy=synthetic")
    .digest("hex"),
  state: "ready_for_lift",
  malware_scan_status: "no_threats_found",
  outbound_status: "published",
  delivery_status: "verified_direct_200",
  upload_completed_at: "2026-07-27T11:59:50.000Z",
  verified_at: "2026-07-27T11:59:52.000Z",
  published_at: "2026-07-27T11:59:55.000Z",
  delivery_verified_at: "2026-07-27T11:59:58.000Z",
  settle_delay_seconds: 2,
  lift_not_before_epoch: computeProofAssetLiftNotBeforeEpoch({
    delivery_verified_at: "2026-07-27T11:59:58.000Z",
    settle_delay_seconds: 2
  }),
  retention_days: 90,
  order_completed_at: null,
  last_proof_activity_at: "2026-07-27T12:00:00.000Z",
  retention_anchor_at: "2026-07-27T12:00:00.000Z",
  cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
    retention_anchor_at: "2026-07-27T12:00:00.000Z",
    retention_days: 90
  }),
  legal_hold: false
};

test("denies a dark gate before target, Lift read, persistence, secrets, or transport", async () => {
  const calls: string[] = [];
  const service = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(false),
    now: () => now,
    listTargetConfigs: async () => {
      calls.push("targets");
      return targets;
    },
    syncOrder: async () => {
      calls.push("sync");
      return { order, diagnostics: null } as never;
    },
    readCredentials: async () => {
      calls.push("credentials");
      throw new Error("must not run");
    },
    reserve: async () => {
      calls.push("reserve");
      throw new Error("must not run");
    },
    send: async () => {
      calls.push("send");
      throw new Error("must not run");
    }
  });

  await assert.rejects(
    () => service.prepare({
      request,
      operator_uid: "operator-synthetic",
      correlation_id: "correlation-synthetic"
    }),
    (error: unknown) =>
      error instanceof ProofOperatorActionError && error.code === "disabled"
  );
  assert.deepEqual(calls, []);
});

test("prepares only a sanitized atomic intent and does not read credentials or send", async () => {
  let reserved: ProofOperatorActionRecord | null = null;
  let credentialReads = 0;
  let sends = 0;
  const service = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(),
    now: () => now,
    listTargetConfigs: async () => targets,
    syncOrder: async (_orderNumber, options) => {
      assert.deepEqual(options.allowed_customer_ids, ["1249"]);
      return { order, diagnostics: null } as never;
    },
    reserve: async (record) => {
      reserved = record;
      return { status: "new" as const, record };
    },
    readCredentials: async () => {
      credentialReads += 1;
      throw new Error("must not run");
    },
    send: async () => {
      sends += 1;
      throw new Error("must not run");
    }
  });

  const prepared = await service.prepare({
    request,
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });
  assert.equal(prepared.status, "new");
  assert.equal(prepared.confirmation_phrase, "CONFIRM APPROVE A0226753 proofing-synthetic-0001");
  assert.match(prepared.operator_action.action_id, /^poperator_[a-f0-9]{64}$/);
  assert.equal(prepared.operator_action.action_id.includes(request.idempotency_key), false);
  assert.equal(credentialReads, 0);
  assert.equal(sends, 0);
  const serialized = JSON.stringify(reserved);
  assert.equal(serialized.includes(request.comment), false);
  assert.equal(serialized.includes("client"), false);
  assert.equal(serialized.includes("Bearer"), false);
});

test("fails revised art closed without a verified Proof upload and binds only the opaque asset when ready", async () => {
  const revisedRequest = {
    ...request,
    action: "REVISED_ART_WILL_BE_SENT" as const,
    idempotency_key: "operator-action-revision-0001",
    revision_asset_id: revisionAssetId
  };
  let reservations = 0;
  const unavailable = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(),
    now: () => now,
    listTargetConfigs: async () => targets,
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    resolveRevisionAsset: async () => null,
    reserve: async () => {
      reservations += 1;
      throw new Error("must not run");
    }
  });
  await assert.rejects(
    () =>
      unavailable.prepare({
        request: revisedRequest,
        operator_uid: "operator-synthetic",
        correlation_id: "correlation-synthetic"
      }),
    (error: unknown) =>
      error instanceof ProofOperatorActionError && error.code === "not_allowed"
  );
  assert.equal(reservations, 0);

  let reserved: ProofOperatorActionRecord | null = null;
  const ready = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(),
    now: () => now,
    listTargetConfigs: async () => targets,
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    resolveRevisionAsset: async (assetId) =>
      assetId === revisionAssetId ? readyRevisionAsset : null,
    reserve: async (record) => {
      reserved = record;
      return { status: "new" as const, record };
    }
  });
  await ready.prepare({
    request: revisedRequest,
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });
  assert.equal(reserved?.revision_asset_id, revisionAssetId);
  assert.equal(reserved?.revision_publication_id, publicationId);
  assert.equal(reserved?.revision_id, revisionId);
  assert.equal(reserved?.revision_asset_sha256, readyRevisionAsset.sha256);
  assert.equal(
    reserved?.revision_source_object_version_sha256,
    createHash("sha256")
      .update(readyRevisionAsset.source_object_version_id)
      .digest("hex")
  );
  assert.equal(
    reserved?.revision_outbound_object_version_sha256,
    createHash("sha256")
      .update(readyRevisionAsset.outbound_object_version_id)
      .digest("hex")
  );
  assert.equal(
    reserved?.revision_cleanup_eligible_at_epoch,
    readyRevisionAsset.cleanup_eligible_at_epoch
  );
  assert.equal(
    JSON.stringify(reserved).includes(readyRevisionAsset.delivery_url),
    false
  );

  assert.ok(reserved);
  const substitutedRevisionId = `prevision_${"e".repeat(64)}`;
  const substitutedRevisionKeys = buildProofRevisionAssetKeys({
    order_number: order.order_number,
    task_id: order.tasks[0].task_id,
    revision_id: substitutedRevisionId,
    asset_id: revisionAssetId,
    publication_id: publicationId,
    filename: readyRevisionAsset.original_filename
  });
  const retentionAnchor = "2026-07-27T12:00:01.000Z";
  const substitutions: Array<{
    asset: ProofRevisionAssetReadiness;
    code: ProofOperatorActionError["code"];
  }> = [
    {
      asset: {
        ...readyRevisionAsset,
        revision_id: substitutedRevisionId,
        source_key: substitutedRevisionKeys.source_key,
        outbound_key: substitutedRevisionKeys.outbound_key
      },
      code: "stale"
    },
    {
      asset: {
        ...readyRevisionAsset,
        source_object_version_id:
          "3/L4kqtJlcpXroDTDmJ+differentSourceVersion="
      },
      code: "stale"
    },
    {
      asset: {
        ...readyRevisionAsset,
        outbound_object_version_id:
          "3/L4kqtJlcpXroDTDmJ+differentOutboundVersion="
      },
      code: "stale"
    },
    {
      asset: {
        ...readyRevisionAsset,
        outbound_sha256: "e".repeat(64)
      },
      code: "not_allowed"
    },
    {
      asset: {
        ...readyRevisionAsset,
        last_proof_activity_at: retentionAnchor,
        retention_anchor_at: retentionAnchor,
        cleanup_eligible_at_epoch: computeProofAssetCleanupEligibleAtEpoch({
          retention_anchor_at: retentionAnchor,
          retention_days: readyRevisionAsset.retention_days
        })
      },
      code: "stale"
    }
  ];
  for (const substitution of substitutions) {
    const execution = createProofOperatorActionService({
      runtimeConfig: () => runtimeConfig(),
      now: () => new Date("2026-07-27T12:00:02.000Z"),
      listTargetConfigs: async () => targets,
      getRecord: async () => reserved,
      syncOrder: async () => ({ order, diagnostics: null }) as never,
      resolveRevisionAsset: async () => substitution.asset,
      readCredentials: async () => {
        throw new Error("must not read credentials for a changed asset");
      }
    });
    await assert.rejects(
      () =>
        execution.execute({
          request: revisedRequest,
          confirmation_phrase:
            "CONFIRM REVISED_ART_WILL_BE_SENT A0226753 proofing-synthetic-0001",
          operator_uid: "operator-synthetic",
          correlation_id: "correlation-synthetic"
        }),
      (error: unknown) =>
        error instanceof ProofOperatorActionError &&
        error.code === substitution.code
    );
  }
});

test("persists submission_uncertain before one PUT and immediately reconciles without retry", async () => {
  const lifecycle: string[] = [];
  let currentRecord: ProofOperatorActionRecord | null = null;
  const preparation = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(),
    now: () => now,
    listTargetConfigs: async () => targets,
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    reserve: async (record) => {
      currentRecord = record;
      return { status: "new" as const, record };
    }
  });
  await preparation.prepare({
    request,
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });

  let syncCount = 0;
  let sendCount = 0;
  const execution = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(),
    now: () => now,
    listTargetConfigs: async () => targets,
    getRecord: async () => currentRecord,
    syncOrder: async () => {
      syncCount += 1;
      lifecycle.push(syncCount === 1 ? "preflight-get" : "reconcile-get");
      return { order, diagnostics: null } as never;
    },
    readCredentials: async () => ({
      base_url: "https://proofing.example.invalid/api",
      company_id: "91",
      action_user_name: "VORNAN_PROOF",
      client_id: "client-synthetic-0001",
      client_secret: "synthetic-signing-material-".repeat(2)
    }),
    transition: async (_existing, next) => {
      lifecycle.push(`persist-${next.outcome}`);
      currentRecord = next;
      return next;
    },
    send: async () => {
      sendCount += 1;
      lifecycle.push("put");
      return {
        status: 202,
        transport_error: false,
        classification: {
          classification: "success_observed_unconfirmed",
          confirmed: false,
          retryable: false,
          reconciliation: "authoritative_read_after_write_required",
          reason: "success_response_requires_authoritative_confirmation"
        }
      };
    }
  });

  const result = await execution.execute({
    request,
    confirmation_phrase: "CONFIRM APPROVE A0226753 proofing-synthetic-0001",
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });
  assert.deepEqual(lifecycle, [
    "preflight-get",
    "persist-submission_uncertain",
    "put",
    "reconcile-get",
    "persist-reconciling"
  ]);
  assert.equal(sendCount, 1);
  assert.equal(result.observation.confirmed, false);
  assert.equal(result.observation.automatic_retry, false);
  assert.equal(result.authoritative_reconciliation.requires_manual_review, true);
});

test("never replays a record that already crossed the submission boundary", async () => {
  let sends = 0;
  const service = createProofOperatorActionService({
    runtimeConfig: () => runtimeConfig(),
    now: () => now,
    listTargetConfigs: async () => targets,
    getRecord: async () => ({
      idempotency_key: request.idempotency_key,
      outcome: "submission_uncertain"
    }) as ProofOperatorActionRecord,
    send: async () => {
      sends += 1;
      throw new Error("must not run");
    }
  });

  await assert.rejects(
    () => service.execute({
      request,
      confirmation_phrase: "CONFIRM APPROVE A0226753 proofing-synthetic-0001",
      operator_uid: "operator-synthetic",
      correlation_id: "correlation-synthetic"
    }),
    (error: unknown) =>
      error instanceof ProofOperatorActionError &&
      error.code === "already_attempted"
  );
  assert.equal(sends, 0);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { matchLiftLineRecord, normalizeLiftOrderLookupPayload } from "@pathfinder/order-rollup";
import {
  classifyProofDecisionIdempotency,
  InvalidProofDecisionOutcomeTransitionError,
  normalizeLiftOrderNumber,
  normalizeProofOrder,
  proofDecisionOutcomeClass,
  proofReviewLifecycleState,
  proofReviewLifecycleTransitions,
  recordProofTaskDecisionContext,
  transitionProofDecisionOutcome,
  toCustomerSafeOrderRollupProof,
  toOrderRollupProofProjection,
  toPublicProofOrder,
  toPublicProofTaskHistory,
  toPublicProofVersion
} from "../src/index.ts";

const syncedAt = "2026-07-20T12:00:00.000Z";

async function fixture(name: string) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as {
    order_number: string;
    order_payload: unknown;
    proof_payloads: unknown[];
  };
}

const orderPayload = {
  rowset: [
    {
      ORDER_NUMBER: "A0221132",
      ORDER_LINE_ID: 9301338,
      LINE_NUMBER: 10,
      LINE_STEP_NUMBER: 4,
      PRODUCT_NAME: "North wall panel",
      QUANTITY: 1,
      CUSTOMER_ID: 1249,
      CUSTOMER_NAME: "Example Customer",
      ORDER_TITLE: "Summer refresh"
    },
    {
      ORDER_NUMBER: "A0221132",
      ORDER_LINE_ID: 9301339,
      LINE_NUMBER: 20,
      LINE_STEP_NUMBER: 3,
      PRODUCT_NAME: "South wall panel",
      QUANTITY: 1
    }
  ]
};

const proofPayload = {
  rowset: [
    {
      ORDER_NUMBER: "A0221132",
      ORDER_LINE_ID: 9301338,
      LINE_NUMBER: 999,
      ATTACHMENT_ID: 25435041,
      CREATION_DATE: "2026-07-19T10:00:00Z",
      PROOF_FILENAME: "north-a.pdf",
      PROOF_MIME_TYPE: "application/pdf",
      PROOF_LINK_LOW: "https://files.example/north-a-preview",
      PROOF_LINK_HIGH: "https://files.example/north-a.pdf",
      PROOF_APPROVAL_STATUS: "PENDING",
      PROOF_COMMENT: "Increase the logo clear space.",
      COMMENT_TS: "2026-07-19T11:00:00Z"
    },
    {
      ORDER_NUMBER: "A0221132",
      ORDER_LINE_ID: 9301338,
      LINE_NUMBER: 999,
      ATTACHMENT_ID: 25435041,
      CREATION_DATE: "2026-07-19T10:00:00Z",
      PROOF_FILENAME: "north-a.pdf",
      PROOF_MIME_TYPE: "application/pdf",
      PROOF_LINK_LOW: "https://files.example/north-a-preview",
      PROOF_LINK_HIGH: "https://files.example/north-a.pdf",
      PROOF_APPROVAL_STATUS: "PENDING",
      PROOF_COMMENT: "Confirm final trim.",
      COMMENT_TS: "2026-07-19T11:05:00Z"
    },
    {
      ORDER_NUMBER: "A0221132",
      ORDER_LINE_ID: 9301338,
      LINE_NUMBER: 10,
      ATTACHMENT_ID: 25435042,
      CREATION_DATE: "2026-07-19T10:10:00Z",
      PROOF_FILENAME: "north-b.pdf",
      PROOF_LINK_HIGH: "https://files.example/north-b.pdf",
      PROOF_APPROVAL_STATUS: "APPROVED",
      PROOF_APPROVED_BY: "Reviewer",
      PROOF_APPROVED_DATE: "2026-07-20T08:00:00Z"
    }
  ]
};

test("normalizes Lift order numbers and rejects unsupported shapes", () => {
  assert.equal(normalizeLiftOrderNumber(" a0221132 "), "A0221132");
  assert.throws(() => normalizeLiftOrderNumber("221132"), /must match A followed by 7 or 8 digits/);
});

test("models only forward decision outcomes and keeps terminal outcomes immutable", () => {
  assert.equal(proofDecisionOutcomeClass("prepared"), "pending");
  assert.equal(proofDecisionOutcomeClass("submission_uncertain"), "reconciling");
  assert.equal(proofDecisionOutcomeClass("reconciling"), "reconciling");
  assert.equal(proofDecisionOutcomeClass("confirmed"), "terminal");
  assert.equal(proofDecisionOutcomeClass("failed"), "terminal");

  const states = ["prepared", "submission_uncertain", "reconciling", "confirmed", "failed"] as const;
  const allowed = new Set([
    "prepared>submission_uncertain",
    "prepared>confirmed",
    "prepared>failed",
    "submission_uncertain>reconciling",
    "submission_uncertain>confirmed",
    "submission_uncertain>failed",
    "reconciling>confirmed",
    "reconciling>failed"
  ]);
  for (const current of states) {
    for (const next of states) {
      if (allowed.has(`${current}>${next}`)) {
        assert.equal(transitionProofDecisionOutcome(current, next), next);
      } else {
        assert.throws(
          () => transitionProofDecisionOutcome(current, next),
          InvalidProofDecisionOutcomeTransitionError
        );
      }
    }
  }
});

test("distinguishes a new decision, an exact replay, and a changed-body conflict", () => {
  const candidate = { idempotency_key: "decision-key-0001", canonical_body_hash: "a".repeat(64) };
  assert.deepEqual(classifyProofDecisionIdempotency(null, candidate), { status: "new" });
  assert.deepEqual(classifyProofDecisionIdempotency({
    ...candidate,
    outcome: "reconciling"
  }, candidate), { status: "replay", outcome: "reconciling" });
  assert.deepEqual(classifyProofDecisionIdempotency({
    idempotency_key: candidate.idempotency_key,
    canonical_body_hash: "b".repeat(64),
    outcome: "prepared"
  }, candidate), { status: "conflict" });
  assert.deepEqual(classifyProofDecisionIdempotency({
    idempotency_key: "decision-key-0002",
    canonical_body_hash: candidate.canonical_body_hash,
    outcome: "prepared"
  }, candidate), { status: "new" });
});

test("keeps sibling attachments separate and joins by ORDER_LINE_ID before LINE_NUMBER", () => {
  const order = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });

  assert.equal(order.tasks.length, 3);
  const siblings = order.tasks.filter((task) => task.order_line_id === "9301338");
  assert.deepEqual(siblings.map((task) => task.attachment_id), ["25435041", "25435042"]);
  assert.deepEqual(siblings.map((task) => task.sibling_count), [2, 2]);
  assert.equal(siblings[0]?.current_version?.comments.length, 2);
  assert.deepEqual(siblings.map((task) => task.quantity), [1, 1]);
  assert.equal(siblings[0]?.current_version?.content_type, "application/pdf");
  assert.equal(siblings[0]?.state, "pending");
  assert.equal(siblings[1]?.state, "approved");
  assert.equal(order.tasks.find((task) => task.order_line_id === "9301339")?.state, "waiting");
  assert.equal(order.warnings.some((warning) => warning.code === "line_number_fallback"), false);
});

test("keeps a Lift attachment that is shared across order lines visible on every line", () => {
  const sharedProofRow = {
    ORDER_NUMBER: "A0221132",
    ATTACHMENT_ID: 25435041,
    CREATION_DATE: "2026-07-19T10:00:00Z",
    PROOF_FILENAME: "shared-hardware.pdf",
    PROOF_MIME_TYPE: "application/pdf",
    PROOF_LINK_LOW: "https://files.example/shared-hardware-preview",
    PROOF_LINK_HIGH: "https://files.example/shared-hardware.pdf",
    PROOF_APPROVAL_STATUS: "APPROVED"
  };
  const initial = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [{
      rowset: [{ ...sharedProofRow, ORDER_LINE_ID: 9301338, LINE_NUMBER: 10 }]
    }],
    synced_at: syncedAt
  });
  const originalTaskId = initial.tasks.find((task) => task.order_line_id === "9301338")?.task_id;

  const shared = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [{
      rowset: [
        { ...sharedProofRow, ORDER_LINE_ID: 9301338, LINE_NUMBER: 10 },
        { ...sharedProofRow, ORDER_LINE_ID: 9301339, LINE_NUMBER: 20 }
      ]
    }],
    previous: initial,
    synced_at: "2026-07-20T12:05:00.000Z"
  });

  assert.equal(shared.tasks.length, 2);
  assert.deepEqual(shared.tasks.map((task) => task.order_line_id), ["9301338", "9301339"]);
  assert.deepEqual(shared.tasks.map((task) => task.attachment_id), ["25435041", "25435041"]);
  assert.equal(new Set(shared.tasks.map((task) => task.task_id)).size, 2);
  assert.equal(shared.tasks[0]?.task_id, originalTaskId);
  assert.deepEqual(shared.tasks.map((task) => task.current_version?.filename), [
    "shared-hardware.pdf",
    "shared-hardware.pdf"
  ]);
  assert.deepEqual(shared.tasks.map((task) => task.actionable), [false, false]);
  assert.equal(shared.tasks.some((task) => task.state === "waiting"), false);
  assert.equal(shared.warnings.length, 0);

  const publicOrder = toPublicProofOrder(shared, "view", { include_asset_urls: true });
  assert.deepEqual(publicOrder.tasks.map((task) => task.shared_line_numbers), [["10", "20"], ["10", "20"]]);
  assert.deepEqual(publicOrder.tasks.map((task) => task.current_version?.preview_url), [
    "https://files.example/shared-hardware-preview",
    "https://files.example/shared-hardware-preview"
  ]);
  assert.equal(JSON.stringify(publicOrder).includes("attachment_id"), false);

  const replayed = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [{
      rowset: [
        { ...sharedProofRow, ORDER_LINE_ID: 9301338, LINE_NUMBER: 10 },
        { ...sharedProofRow, ORDER_LINE_ID: 9301339, LINE_NUMBER: 20 }
      ]
    }],
    previous: shared,
    synced_at: "2026-07-20T12:10:00.000Z"
  });
  assert.deepEqual(replayed.tasks.map((task) => task.task_id), shared.tasks.map((task) => task.task_id));
  assert.deepEqual(replayed.tasks.map((task) => task.updated_at), shared.tasks.map((task) => task.updated_at));
});

test("emits read-derived review lifecycle transitions only when the normalized state changes", () => {
  const ready = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const reviewed = {
    ...ready,
    health: "complete" as const,
    tasks: ready.tasks.map((task) => ({ ...task, state: "approved" as const, actionable: false }))
  };
  const reopened = {
    ...reviewed,
    health: "active" as const,
    tasks: reviewed.tasks.map((task, index) => index === 0 ? { ...task, state: "pending" as const, actionable: true } : task)
  };

  assert.equal(proofReviewLifecycleState(ready), "review_ready");
  assert.deepEqual(proofReviewLifecycleTransitions(null, ready), ["proof.review_ready"]);
  assert.deepEqual(proofReviewLifecycleTransitions(ready, ready), []);
  assert.equal(proofReviewLifecycleState(reviewed), "all_reviewed");
  assert.deepEqual(proofReviewLifecycleTransitions(ready, reviewed), ["proof.all_reviewed"]);
  assert.deepEqual(proofReviewLifecycleTransitions(reviewed, reopened), ["proof.review_reopened"]);
  const degraded = { ...reopened, health: "error" as const };
  assert.equal(proofReviewLifecycleState(degraded), "degraded");
  assert.deepEqual(proofReviewLifecycleTransitions(reviewed, degraded), []);
});

test("keeps a local unconfirmed action out of Lift-authoritative public proof status", () => {
  const initial = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const pending = initial.tasks.find((task) => task.state === "pending")!;
  const rejected = recordProofTaskDecisionContext(initial, {
    task_id: pending.task_id,
    attachment_id: pending.attachment_id!,
    action: "REJECT",
    recorded_at: "2026-07-20T12:01:00.000Z"
  });

  assert.equal(rejected.tasks.find((task) => task.task_id === pending.task_id)?.decision_context?.state, "rejected_pending_action");
  const publicTask = toPublicProofOrder(rejected).tasks.find((task) => task.task_id === pending.task_id);
  assert.equal(publicTask?.decision_state, null);
  assert.equal(publicTask?.action_reconciliation_pending, true);
  assert.equal(JSON.stringify(toPublicProofOrder(rejected)).includes("pathfinder_operator_action"), false);

  const refreshed = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    previous: rejected,
    synced_at: "2026-07-20T12:02:00.000Z"
  });
  assert.equal(refreshed.tasks.find((task) => task.task_id === pending.task_id)?.decision_context?.state, "rejected_pending_action");

  const settled = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    previous: refreshed,
    synced_at: "2026-07-20T12:16:00.000Z"
  });
  const settledTask = settled.tasks.find((task) => task.task_id === pending.task_id);
  assert.equal(settledTask?.state, "pending");
  assert.equal(settledTask?.decision_context, null);
  assert.equal(toPublicProofOrder(settled).tasks.find((task) => task.task_id === pending.task_id)?.action_reconciliation_pending, false);

  const approvedPayload = {
    rowset: proofPayload.rowset.map((row) =>
      row.ATTACHMENT_ID === Number(pending.attachment_id)
        ? { ...row, PROOF_APPROVAL_STATUS: "APPROVED", PROOF_APPROVED_BY: "Synthetic reviewer" }
        : row
    )
  };
  const approved = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [approvedPayload],
    previous: settled,
    synced_at: "2026-07-20T12:17:00.000Z"
  });
  assert.equal(approved.tasks.find((task) => task.task_id === pending.task_id)?.decision_context, null);
});

test("canonicalizes Lift feedback order and rotating attachment URLs without hiding real changes", () => {
  const firstPayload = {
    rowset: [
      {
        ...proofPayload.rowset[0],
        PROOF_COMMENT: "Later feedback.",
        COMMENT_TS: "2026-07-19T11:10:00Z",
        COMMENT_ATTACHMENT: [{ LINK_TO_ATTACHMENT: "https://files.example/notes.pdf?signature=first" }]
      },
      {
        ...proofPayload.rowset[0],
        PROOF_COMMENT: "Earlier feedback.",
        COMMENT_TS: "2026-07-19T11:00:00Z",
        COMMENT_ATTACHMENT: [{ LINK_TO_ATTACHMENT: "https://files.example/trim.pdf?signature=first" }]
      }
    ]
  };
  const reorderedPayload = {
    rowset: [...firstPayload.rowset].reverse().map((row) => ({
      ...row,
      COMMENT_ATTACHMENT: Array.isArray(row.COMMENT_ATTACHMENT)
        ? row.COMMENT_ATTACHMENT.map((attachment) => ({
            ...attachment,
            LINK_TO_ATTACHMENT: String(attachment.LINK_TO_ATTACHMENT).replace("signature=first", "signature=rotated")
          }))
        : row.COMMENT_ATTACHMENT
    }))
  };
  const first = normalizeProofOrder({ order_number: "A0221132", order_payload: orderPayload, proof_payloads: [firstPayload], synced_at: syncedAt });
  const reordered = normalizeProofOrder({ order_number: "A0221132", order_payload: orderPayload, proof_payloads: [reorderedPayload], synced_at: "2026-07-20T12:01:00.000Z" });
  const firstVersion = first.tasks.find((task) => task.state === "pending")!.current_version!;
  const reorderedVersion = reordered.tasks.find((task) => task.state === "pending")!.current_version!;

  assert.deepEqual(firstVersion.comments.map((comment) => comment.text), ["Earlier feedback.", "Later feedback."]);
  assert.equal(reorderedVersion.feedback_fingerprint, firstVersion.feedback_fingerprint);

  const changed = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [{ rowset: [...reorderedPayload.rowset, { ...proofPayload.rowset[0], PROOF_COMMENT: "New feedback.", COMMENT_TS: "2026-07-19T11:15:00Z" }] }],
    synced_at: "2026-07-20T12:02:00.000Z"
  });
  assert.notEqual(changed.tasks.find((task) => task.state === "pending")!.current_version!.feedback_fingerprint, firstVersion.feedback_fingerprint);
});

test("rejects malformed Proof decision context timestamps", () => {
  const initial = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const pending = initial.tasks.find((task) => task.state === "pending")!;

  assert.throws(
    () => recordProofTaskDecisionContext(initial, {
      task_id: pending.task_id,
      attachment_id: pending.attachment_id!,
      action: "REJECT",
      recorded_at: "2026-07-20 12:01:00"
    }),
    /exact UTC ISO instant/
  );
});

test("projects one customer-safe cached Proof summary for Status and Order Rollup", () => {
  const order = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const projection = toOrderRollupProofProjection(order);
  const serialized = JSON.stringify(projection);

  assert.deepEqual(projection.summary, {
    source: "proof_cache",
    health: "active",
    pending: 1,
    regenerating: 0,
    waiting: 1,
    reviewed: 1,
    total: 3,
    review_required: true,
    last_synced_at: syncedAt,
    decisions_enabled: false
  });
  assert.equal(projection.proofs.length, 2);
  assert.ok(projection.proofs.every((proof) => proof.order_line_id === "9301338"));
  assert.deepEqual(projection.proofs.map((proof) => proof.proof_state), ["pending", "approved"]);
  assert.equal(serialized.includes("attachment_id"), false);
  assert.equal(serialized.includes("task_id"), false);
  assert.equal(serialized.includes("proof_comment"), false);
  assert.equal(serialized.includes("approved_by"), false);
});

test("sanitizes raw fallback proof records before they enter public Status", () => {
  const safe = toCustomerSafeOrderRollupProof({
    proof_filename: " proof\u0000-name.pdf ",
    proof_approval_status: " PENDING\nREVIEW ",
    proof_link_low: "javascript:alert(1)",
    proof_link_high: "https://user:secret@proof.example/file.pdf",
    creation_date: "not-a-date",
    proof_state: "pending"
  });

  assert.deepEqual(safe, {
    proof_filename: "proof -name.pdf",
    proof_approval_status: "PENDING REVIEW",
    proof_link_low: null,
    proof_link_high: null,
    creation_date: null,
    proof_state: "pending"
  });
});

test("emits an observable warning only when LINE_NUMBER compatibility fallback is used", () => {
  const order = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [
      {
        rowset: [
          {
            ORDER_NUMBER: "A0221132",
            ORDER_LINE_ID: 999999,
            LINE_NUMBER: 20,
            ATTACHMENT_ID: 300,
            PROOF_FILENAME: "fallback.pdf",
            PROOF_LINK_HIGH: "https://files.example/fallback.pdf"
          }
        ]
      }
    ],
    synced_at: syncedAt
  });

  assert.equal(order.tasks.find((task) => task.attachment_id === "300")?.order_line_id, "9301339");
  assert.equal(order.warnings.filter((warning) => warning.code === "line_number_fallback").length, 1);
});

test("preserves task versions and timestamps on a no-op sync", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });

  assert.equal(second.version, first.version);
  assert.equal(second.updated_at, first.updated_at);
  assert.equal(second.last_synced_at, "2026-07-20T12:15:00.000Z");
  assert.deepEqual(
    second.tasks.map((task) => [task.task_id, task.version, task.updated_at]),
    first.tasks.map((task) => [task.task_id, task.version, task.updated_at])
  );
});

test("refreshes rotating signed proof URLs without creating false file versions", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const rotatedPayload = {
    rowset: (proofPayload.rowset as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      ...(typeof row.PROOF_LINK_LOW === "string"
        ? { PROOF_LINK_LOW: `${row.PROOF_LINK_LOW}?X-Amz-Signature=rotated-low` }
        : {}),
      ...(typeof row.PROOF_LINK_HIGH === "string"
        ? { PROOF_LINK_HIGH: `${row.PROOF_LINK_HIGH}?X-Amz-Signature=rotated-high` }
        : {})
    }))
  };
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [rotatedPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });

  assert.equal(second.version, first.version);
  assert.equal(second.updated_at, first.updated_at);
  assert.equal(second.last_synced_at, "2026-07-20T12:15:00.000Z");
  assert.deepEqual(second.tasks.map((task) => task.version), first.tasks.map((task) => task.version));
  assert.deepEqual(second.tasks.map((task) => task.versions.length), first.tasks.map((task) => task.versions.length));
  assert.deepEqual(
    second.tasks.map((task) => task.current_version?.version_id),
    first.tasks.map((task) => task.current_version?.version_id)
  );
  assert.ok(second.tasks.some((task) => task.current_version?.download_url?.includes("rotated-high")));
  assert.ok(second.tasks.some((task) => task.versions[0]?.download_url?.includes("rotated-high")));
});

test("updates Lift comments on the current proof without creating a second proof version", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const commentedPayload = {
    rowset: [
      ...(proofPayload.rowset as Array<Record<string, unknown>>),
      {
        ...(proofPayload.rowset[0] as Record<string, unknown>),
        PROOF_COMMENT: "Use the updated legal line.",
        COMMENT_TS: "2026-07-20T12:14:00.000Z"
      }
    ]
  };
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [commentedPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });
  const before = first.tasks.find((task) => task.attachment_id === "25435041")!;
  const after = second.tasks.find((task) => task.attachment_id === "25435041")!;

  assert.equal(after.current_version?.version_id, before.current_version?.version_id);
  assert.equal(after.current_version?.comments.length, 3);
  assert.equal(after.versions.length, 1);
  assert.equal(after.versions[0]?.current, true);
  assert.equal(after.version, before.version + 1);
});

test("creates a new proof version when the asset path changes", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const replacedPayload = {
    rowset: (proofPayload.rowset as Array<Record<string, unknown>>).map((row) =>
      row.ATTACHMENT_ID === 25435042
        ? { ...row, PROOF_LINK_HIGH: "https://files.example/north-b-replacement.pdf?X-Amz-Signature=fresh" }
        : row
    )
  };
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [replacedPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });
  const changed = second.tasks.find((task) => task.attachment_id === "25435042");

  assert.equal(second.version, first.version + 1);
  assert.equal(changed?.version, 2);
  assert.equal(changed?.versions.length, 2);
});

test("preserves the prior proof version when approval metadata changes on the same attachment", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const approvedPayload = {
    rowset: (proofPayload.rowset as Array<Record<string, unknown>>).map((row) =>
      row.ATTACHMENT_ID === 25435041
        ? {
            ...row,
            PROOF_APPROVAL_STATUS: "APPROVED",
            PROOF_APPROVED_BY: "Reviewer",
            PROOF_APPROVED_DATE: "2026-07-20T12:10:00.000Z"
          }
        : row
    )
  };
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [approvedPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });
  const task = second.tasks.find((candidate) => candidate.attachment_id === "25435041");

  assert.equal(task?.state, "approved");
  assert.equal(task?.version, 2);
  assert.equal(task?.versions.length, 2);
  assert.equal(task?.versions.filter((version) => version.current).length, 1);
  assert.equal(task?.versions.some((version) => version.approval_status === "PENDING" && !version.current), true);
});

test("maps Lift revision statuses to a non-actionable regenerating cycle", () => {
  for (const approvalStatus of ["REVISION", "REVISED", "REJECTED", "REGENERATING", "CHANGES REQUESTED"]) {
    const revisedPayload = {
      rowset: (proofPayload.rowset as Array<Record<string, unknown>>).map((row) =>
        row.ATTACHMENT_ID === 25435041 ? { ...row, PROOF_APPROVAL_STATUS: approvalStatus } : row
      )
    };
    const order = normalizeProofOrder({
      order_number: "A0221132",
      order_payload: orderPayload,
      proof_payloads: [revisedPayload],
      synced_at: syncedAt
    });
    const task = order.tasks.find((candidate) => candidate.attachment_id === "25435041");
    assert.equal(task?.state, "revised", approvalStatus);
    assert.equal(task?.actionable, false, approvalStatus);
  }
});

test("archives disappeared attachments and retains cached history when Lift reports a missing order", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const replacementPayload = {
    rowset: (proofPayload.rowset as Array<Record<string, unknown>>).filter((row) => row.ATTACHMENT_ID !== 25435041)
  };
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [replacementPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });
  const missing = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: { rowset: [] },
    proof_payloads: [],
    previous: second,
    synced_at: "2026-07-20T12:30:00.000Z"
  });

  assert.equal(second.tasks.some((task) => task.attachment_id === "25435041"), false);
  assert.equal(second.archived_tasks.some((task) => task.attachment_id === "25435041"), true);
  assert.equal(missing.health, "missing");
  assert.deepEqual(missing.tasks, second.tasks);
  assert.deepEqual(missing.archived_tasks, second.archived_tasks);
});

test("accepts an operator-swapped Lift attachment as the new actionable proof", () => {
  const first = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const swappedPayload = {
    rowset: (proofPayload.rowset as Array<Record<string, unknown>>)
      .filter((row) => row.ATTACHMENT_ID !== 25435041)
      .concat({
        ORDER_NUMBER: "A0221132",
        ORDER_LINE_ID: 9301338,
        LINE_NUMBER: 10,
        ATTACHMENT_ID: 25435999,
        CREATION_DATE: "2026-07-20T12:10:00Z",
        PROOF_FILENAME: "north-c-corrected.pdf",
        PROOF_MIME_TYPE: "application/pdf",
        PROOF_LINK_HIGH: "https://files.example/north-c-corrected.pdf",
        PROOF_APPROVAL_STATUS: "PENDING"
      })
  };
  const second = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [swappedPayload],
    previous: first,
    synced_at: "2026-07-20T12:15:00.000Z"
  });
  const replacement = second.tasks.find((task) => task.attachment_id === "25435999");

  assert.equal(replacement?.state, "pending");
  assert.equal(replacement?.actionable, true);
  assert.equal(replacement?.current_version?.filename, "north-c-corrected.pdf");
  assert.equal(second.tasks.some((task) => task.attachment_id === "25435041"), false);
  assert.equal(second.archived_tasks.some((task) => task.attachment_id === "25435041"), true);
  assert.equal(second.warnings.some((warning) => warning.attachment_id === "25435999"), false);
});

test("keeps explicit Lift proof statuses authoritative over a completed line fallback", () => {
  const completedPayload = {
    rowset: [
      {
        ...(orderPayload.rowset[0] as Record<string, unknown>),
        LINE_STATUS: "COMPLETE"
      }
    ]
  };
  const order = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: completedPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });

  assert.deepEqual(
    order.tasks.filter((task) => task.order_line_id === "9301338").map((task) => task.state),
    ["pending", "approved"]
  );
  assert.equal(order.tasks.find((task) => task.attachment_id === "25435041")?.actionable, true);
});

test("uses the neutral production fallback only when Lift provides no proof status", () => {
  const completedPayload = {
    rowset: [{ ...(orderPayload.rowset[0] as Record<string, unknown>), LINE_STATUS: "COMPLETE" }]
  };
  const unstatedProof = {
    rowset: [{
      ...(proofPayload.rowset[0] as Record<string, unknown>),
      PROOF_APPROVAL_STATUS: null
    }]
  };
  const order = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: completedPayload,
    proof_payloads: [unstatedProof],
    synced_at: syncedAt
  });

  assert.equal(order.tasks[0]?.state, "reference");
  assert.equal(order.tasks[0]?.actionable, false);
});

test("normalizes the redacted live sibling fixture as four distinct pending attachments", async () => {
  const captured = await fixture("lift-siblings-A0221132.redacted.json");
  const liftOrder = normalizeLiftOrderLookupPayload(captured.order_payload);
  const proofRows = (captured.proof_payloads[0] as { rowset: Array<Record<string, unknown>> }).rowset;
  const sharedMatches = proofRows.map((row) => matchLiftLineRecord(liftOrder?.lines ?? [], {
    order_line_id: row.ORDER_LINE_ID as string | number | null,
    line_number: row.LINE_NUMBER as string | number | null
  }));
  const order = normalizeProofOrder({ ...captured, synced_at: syncedAt });

  assert.equal(liftOrder?.lines[0]?.order_line_id, 9301338);
  assert.ok(sharedMatches.every((match) => match?.matched_by === "order_line_id"));
  assert.ok(sharedMatches.every((match) => String(match?.line.order_line_id) === "9301338"));
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0]?.order_line_id, "9301338");
  assert.equal(order.tasks.length, 4);
  assert.equal(new Set(order.tasks.map((task) => task.attachment_id)).size, 4);
  assert.ok(order.tasks.every((task) => task.sibling_count === 4));
  assert.ok(order.tasks.every((task) => task.state === "pending" && task.actionable));
  assert.equal(order.warnings.some((warning) => warning.code === "line_number_fallback"), false);
});

test("normalizes the redacted live invoiced fixture as approved when Lift says approved", async () => {
  const captured = await fixture("lift-completed-A0219609.redacted.json");
  const order = normalizeProofOrder({ ...captured, synced_at: syncedAt });

  assert.equal(order.order_status, "Invoiced");
  assert.equal(order.health, "complete");
  assert.equal(order.tasks.length, 1);
  assert.equal(order.tasks[0]?.state, "approved");
  assert.equal(order.tasks[0]?.actionable, false);
  assert.equal(order.tasks[0]?.current_version?.approval_status, "APPROVED");
});

test("creates a customer-safe DTO without Lift identities or internal proof metadata", () => {
  const normalized = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: "2026-07-20T12:00:00.000Z"
  });
  normalized.warnings.push({ code: "proof_without_url", message: "internal warning" });
  normalized.tasks[0]!.current_version!.approved_by = "internal@example.com";
  normalized.tasks[0]!.current_version!.detailed_report = [{
    name: "Artwork dimensions",
    status: "PASS",
    internal_id: "private-report-id",
    signed_url: "https://internal.example/report?token=secret"
  }];
  normalized.order_title = "  Summer\u0000 retail\n rollout  ";
  normalized.order_status = " Pending\tArt Approval ";
  normalized.tasks[0]!.line_number = " 10\n ";
  normalized.tasks[0]!.product_name = " North\u0000 wall panel ";
  normalized.tasks[0]!.current_version!.approval_status = " PENDING\nREVIEW ";
  normalized.tasks[0]!.current_version!.approved_at = "not-a-date";
  normalized.tasks[0]!.current_version!.comments[0]!.text = " Increase\u0000 the\n logo clear space. ";
  normalized.tasks[1]!.product_name = "x".repeat(161);
  const publicOrder = toPublicProofOrder(normalized);
  const serialized = JSON.stringify(publicOrder);
  assert.equal(normalized.customer_id, "1249");
  assert.equal("customer_id" in publicOrder, false);
  assert.equal(serialized.includes("1249"), false);
  assert.equal(publicOrder.tasks[0]?.current_version?.content_type, "application/pdf");
  assert.equal(publicOrder.tasks[0]?.current_version?.preview_kind, "pdf");
  assert.equal(publicOrder.tasks[0]?.current_version?.preview_url, "https://files.example/north-a-preview");
  assert.equal(publicOrder.tasks[0]?.current_version?.download_url, "https://files.example/north-a.pdf");
  assert.equal(publicOrder.tasks[0]?.quantity, 1);
  assert.deepEqual(publicOrder.counts, { pending: 1, regenerating: 0, waiting: 1, reviewed: 1, total: 3 });
  assert.equal(publicOrder.order_title, "Summer retail rollout");
  assert.equal(publicOrder.order_status, "Pending Art Approval");
  assert.equal(publicOrder.tasks[0]?.line_number, "10");
  assert.equal(publicOrder.tasks[0]?.product_name, "North wall panel");
  assert.equal(publicOrder.tasks[0]?.current_version?.approval_status, "PENDING REVIEW");
  assert.equal(publicOrder.tasks[0]?.current_version?.approved_at, null);
  assert.equal(publicOrder.tasks[0]?.current_version?.comments[0]?.text, "Confirm final trim.");
  assert.equal(publicOrder.tasks[1]?.product_name, null);
  for (const [quantity, expected] of [
    [0, 0],
    [12.5, 12.5],
    [-1, null],
    [Number.POSITIVE_INFINITY, null],
    [1_000_000_001, null]
  ] as const) {
    normalized.tasks[1]!.quantity = quantity;
    assert.equal(toPublicProofOrder(normalized).tasks[1]?.quantity, expected);
  }
  assert.equal(serialized.includes("order_line_id"), false);
  assert.equal(serialized.includes("attachment_id"), false);
  assert.equal(serialized.includes("approved_by"), false);
  assert.equal(serialized.includes("detailed_report"), false);
  assert.equal(serialized.includes("internal warning"), false);
  assert.match(serialized, /\"decisions_enabled\":false/);
  assert.equal(publicOrder.access.review_experience, "simple");
  const revisionOnlyOrder = toPublicProofOrder(normalized, "review", {
    revision_action_enabled: true
  });
  assert.equal(revisionOnlyOrder.access.decisions_enabled, false);
  assert.equal(revisionOnlyOrder.tasks[0]?.attachment_id, normalized.tasks[0]?.attachment_id);
  assert.equal(revisionOnlyOrder.tasks[0]?.version, normalized.tasks[0]?.version);
  const redactedReviewOrder = toPublicProofOrder(normalized, "review", {
    revision_action_enabled: false
  });
  assert.equal("attachment_id" in redactedReviewOrder.tasks[0]!, false);
  assert.equal("version" in redactedReviewOrder.tasks[0]!, false);
  const redactedViewOrder = toPublicProofOrder(normalized, "view", {
    revision_action_enabled: true
  });
  assert.equal("attachment_id" in redactedViewOrder.tasks[0]!, false);
  assert.equal("version" in redactedViewOrder.tasks[0]!, false);
  assert.deepEqual(
    toPublicProofOrder(normalized, "review", {
      decisions_enabled: true,
      review_experience: "advanced"
    }).access,
    {
      scope: "review",
      decisions_enabled: true,
      review_experience: "advanced"
    }
  );
});

test("creates customer-safe task history without Lift identifiers or private approval metadata", () => {
  const normalized = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: "2026-07-20T12:00:00.000Z"
  });
  normalized.tasks[0]!.current_version!.approved_by = "internal@example.com";
  normalized.tasks[0]!.current_version!.detailed_report = [{
    name: "Artwork dimensions",
    status: "PASS",
    internal_id: "private-report-id",
    signed_url: "https://internal.example/report?token=secret"
  }];
  normalized.tasks[0]!.current_version!.feedback_fingerprint = "private-feedback-fingerprint";
  normalized.tasks[0]!.versions[0] = normalized.tasks[0]!.current_version!;
  const history = toPublicProofTaskHistory(normalized.tasks[0]!);
  const serialized = JSON.stringify(history);
  assert.equal(history.task_id, normalized.tasks[0]!.task_id);
  assert.equal(history.versions.length, 1);
  assert.deepEqual(history.versions[0]?.technical_checks, [{ name: "Artwork dimensions", status: "PASS" }]);
  assert.equal(serialized.includes("attachment_id"), false);
  assert.equal(serialized.includes("approved_by"), false);
  assert.equal(serialized.includes("detailed_report"), false);
  assert.equal(serialized.includes("feedback_fingerprint"), false);
  assert.equal(serialized.includes("private-report-id"), false);
  assert.equal(serialized.includes("token=secret"), false);
});

test("allowlists bounded technical check names and statuses from Lift detailed reports", () => {
  const normalized = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: "2026-07-20T12:00:00.000Z"
  });
  const version = normalized.tasks[0]!.current_version!;
  version.detailed_report = JSON.stringify({
    results: [
      { name: "Bleed check", status: "PASS", signed_url: "https://internal.example/report?token=secret" },
      { name: "Bleed check", status: "PASS" },
      { label: "Image resolution", result: "WARNING", internal_id: "private-report-id" },
      { name: "https://internal.example/unsafe", status: "FAIL" },
      { name: "Credential check", status: "Bearer secret-value" }
    ]
  });
  const publicVersion = toPublicProofVersion(version);
  assert.deepEqual(publicVersion.technical_checks, [
    { name: "Bleed check", status: "PASS" },
    { name: "Image resolution", status: "WARNING" },
    { name: "Credential check", status: null }
  ]);
  const serialized = JSON.stringify(publicVersion);
  assert.equal(serialized.includes("internal.example"), false);
  assert.equal(serialized.includes("private-report-id"), false);
  assert.equal(serialized.includes("secret-value"), false);
});

test("projects only customer-safe HTTPS feedback attachments", () => {
  const normalized = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: "2026-07-20T12:00:00.000Z"
  });
  const version = normalized.tasks[0]!.current_version!;
  version.comments[0]!.attachment = JSON.stringify({
    attachments: [
      { filename: "markup.pdf", url: "https://files.example/markup.pdf?X-Amz-Signature=signed", content_type: "application/pdf", internal_id: "private-comment-id" },
      { filename: "markup.pdf", url: "https://files.example/markup.pdf?X-Amz-Signature=signed", content_type: "application/pdf" },
      { name: "reference.png", href: "https://files.example/reference.png", mime_type: "image/png" },
      { filename: "operator-note.txt", content_type: "text/plain", private_note: "not for customer" },
      { filename: "unsafe.html", url: "javascript:alert(1)" },
      { filename: "credentials.pdf", url: "https://user:password@files.example/credentials.pdf" },
      { LINK_TO_ATTACHMENT: "https://files.example/lift-comment-preview.jpg?X-Amz-Signature=signed" },
      "raw internal attachment blob"
    ],
    internal_thread_id: "private-thread-id"
  });
  const publicVersion = toPublicProofVersion(version);
  assert.deepEqual(publicVersion.comments.find((comment) => comment.text === "Increase the logo clear space.")?.attachments, [
    { filename: "markup.pdf", url: "https://files.example/markup.pdf?X-Amz-Signature=signed", content_type: "application/pdf" },
    { filename: "reference.png", url: "https://files.example/reference.png", content_type: "image/png" },
    { filename: "operator-note.txt", url: null, content_type: "text/plain" },
    { filename: "lift-comment-preview.jpg", url: "https://files.example/lift-comment-preview.jpg?X-Amz-Signature=signed", content_type: null }
  ]);
  const serialized = JSON.stringify(publicVersion);
  assert.equal(serialized.includes("private-comment-id"), false);
  assert.equal(serialized.includes("private-thread-id"), false);
  assert.equal(serialized.includes("not for customer"), false);
  assert.equal(serialized.includes("javascript:"), false);
  assert.equal(serialized.includes("user:password"), false);
  assert.equal(serialized.includes("raw internal attachment blob"), false);
});

test("orders public feedback newest-first while preserving undated provider order", () => {
  const normalized = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: "2026-07-20T12:00:00.000Z"
  });
  const version = normalized.tasks[0]!.current_version!;
  version.comments = [
    { text: "second", created_at: "26-AUG-2026 04:24:20 PM", attachment: null },
    { text: "undated first", created_at: "not-a-timestamp", attachment: null },
    {
      text: "third with image",
      created_at: "26-AUG-2026 04:27:34 PM",
      attachment: [{ LINK_TO_ATTACHMENT: "https://files.example/comment-image.jpg?X-Amz-Signature=signed" }]
    },
    { text: "original", created_at: "24-AUG-2026 08:19:32 PM", attachment: null },
    { text: "undated second", created_at: null, attachment: null }
  ];

  const comments = toPublicProofVersion(version).comments;
  assert.deepEqual(comments.map((comment) => comment.text), [
    "third with image",
    "second",
    "original",
    "undated first",
    "undated second"
  ]);
  assert.deepEqual(comments[0]?.attachments, [{
    filename: "comment-image.jpg",
    url: "https://files.example/comment-image.jpg?X-Amz-Signature=signed",
    content_type: null
  }]);
  assert.equal(comments[3]?.created_at, null);
  assert.equal(comments[4]?.created_at, null);
});

test("projects customer-safe proof assets with deterministic preview behavior", () => {
  const normalized = normalizeProofOrder({
    order_number: "A0221132",
    order_payload: orderPayload,
    proof_payloads: [proofPayload],
    synced_at: syncedAt
  });
  const version = normalized.tasks[0]!.current_version!;

  version.filename = "../../final-proof.pdf";
  version.content_type = "application/pdf";
  version.preview_url = "javascript:alert(1)";
  version.download_url = "https://files.example/final-proof.pdf?X-Amz-Signature=signed";
  assert.deepEqual(toPublicProofVersion(version), {
    version_id: version.version_id,
    created_at: version.created_at,
    filename: "final-proof.pdf",
    content_type: "application/pdf",
    preview_kind: "pdf",
    preview_url: "https://files.example/final-proof.pdf?X-Amz-Signature=signed",
    download_url: "https://files.example/final-proof.pdf?X-Amz-Signature=signed",
    approval_status: version.approval_status,
    approved_at: version.approved_at,
    comments: [...version.comments]
      .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""))
      .map((comment) => ({ text: comment.text, created_at: comment.created_at, attachments: [] })),
    technical_checks: [],
    current: true
  });

  version.filename = "layered-artwork.psd";
  version.content_type = "image/vnd.adobe.photoshop";
  version.preview_url = "https://files.example/layered-artwork.svg";
  version.download_url = "https://files.example/layered-artwork.psd";
  const prepress = toPublicProofVersion(version);
  assert.equal(prepress.preview_kind, "download");
  assert.equal(prepress.preview_url, null);
  assert.equal(prepress.download_url, "https://files.example/layered-artwork.psd");

  version.preview_url = "http://files.example/unsafe.pdf";
  version.download_url = "https://user:password@files.example/unsafe.pdf";
  const unavailable = toPublicProofVersion(version);
  assert.equal(unavailable.preview_kind, "unavailable");
  assert.equal(unavailable.preview_url, null);
  assert.equal(unavailable.download_url, null);
});

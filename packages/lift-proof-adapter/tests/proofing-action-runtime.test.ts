import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiftProofingRuntimeHeaders,
  buildLiftProofingRuntimePlan,
  sendLiftProofingRuntimeAction
} from "../src/proofing-action-runtime.ts";

const syntheticSecret = "synthetic-signing-material-".repeat(2);

test("builds the five exact runtime action bodies and omits quantity for simple approval", () => {
  const cases = [
    ["APPROVE", { approve: true, userName: "VORNAN_PROOF" }],
    ["REJECT", { approve: false, rejectReason: "REJECT", userName: "VORNAN_PROOF" }],
    [
      "SEND_BACK_TO_ARTIST",
      { approve: false, rejectReason: "SEND_BACK_TO_ARTIST", userName: "VORNAN_PROOF", comment: "Move the logo above the legal copy." }
    ],
    [
      "CANCEL_LINE",
      { approve: false, rejectReason: "CANCEL_LINE", userName: "VORNAN_PROOF" }
    ],
    [
      "REVISED_ART_WILL_BE_SENT",
      {
        approve: false,
        rejectReason: "REVISED_ART_WILL_BE_SENT",
        artUrl: "https://files.example.invalid/revised-art.pdf",
        upload: true,
        userName: "VORNAN_PROOF"
      }
    ]
  ] as const;

  for (const [action, expectedBody] of cases) {
    const plan = buildLiftProofingRuntimePlan({
      action,
      company_id: "91",
      proofing_id: "proofing-synthetic-0001",
      comment: action === "SEND_BACK_TO_ARTIST" ? "Move the logo above the legal copy." : null,
      revised_art_url:
        action === "REVISED_ART_WILL_BE_SENT"
          ? "https://files.example.invalid/revised-art.pdf"
          : null
    });
    assert.equal(plan.method, "PUT");
    assert.deepEqual(plan.body, expectedBody);
    assert.match(plan.path, /91/);
    assert.match(plan.path, /proofing-synthetic-0001/);
  }
});

test("requires meaningful prepress instructions for send back to artist", () => {
  for (const comment of [null, "", "   "]) {
    assert.throws(
      () => buildLiftProofingRuntimePlan({
        action: "SEND_BACK_TO_ARTIST",
        company_id: "91",
        proofing_id: "proofing-synthetic-0001",
        comment,
        revised_art_url: null
      }),
      /requires instructions for the prepress team/
    );
  }
});

test("adds an explicit positive quantity only for an advanced approval allocation", () => {
  const plan = buildLiftProofingRuntimePlan({
    action: "APPROVE",
    company_id: "91",
    proofing_id: "proofing-synthetic-0001",
    comment: "Synthetic allocation",
    revised_art_url: null,
    approve_quantity: 12
  });
  assert.deepEqual(plan.body, {
    approve: true,
    approveQuantity: 12,
    comment: "Synthetic allocation",
    userName: "VORNAN_PROOF"
  });
  assert.throws(
    () => buildLiftProofingRuntimePlan({
      action: "APPROVE",
      company_id: "91",
      proofing_id: "proofing-synthetic-0001",
      comment: null,
      revised_art_url: null,
      approve_quantity: 0
    }),
    /positive whole number/
  );
});

test("uses only injected credentials to create the server-only JWT header envelope", () => {
  const plan = buildLiftProofingRuntimePlan({
    action: "APPROVE",
    company_id: "91",
    proofing_id: "proofing-synthetic-0001",
    comment: "Synthetic runtime contract",
    revised_art_url: null
  });
  const headers = buildLiftProofingRuntimeHeaders({
    plan,
    client_id: "client-synthetic-0001",
    client_secret: syntheticSecret,
    issued_at_epoch: 1_800_000_000,
    expires_at_epoch: 1_800_000_060
  });

  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["Lift-ERP-Client-Id"], "client-synthetic-0001");
  assert.match(headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(headers).includes(syntheticSecret), false);
});

test("sends exactly one PUT with redirects disabled and never retries ambiguous responses", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const plan = buildLiftProofingRuntimePlan({
    action: "REJECT",
    company_id: "91",
    proofing_id: "proofing-synthetic-0001",
    comment: null,
    revised_art_url: null
  });
  const headers = buildLiftProofingRuntimeHeaders({
    plan,
    client_id: "client-synthetic-0001",
    client_secret: syntheticSecret,
    issued_at_epoch: 1_800_000_000,
    expires_at_epoch: 1_800_000_060
  });
  const observation = await sendLiftProofingRuntimeAction({
    base_url: "https://proofing.example.invalid/api",
    plan,
    headers,
    timeout_ms: 1_000,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 503 });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.redirect, "error");
  assert.equal(calls[0]?.init?.body, plan.canonical_body_json);
  assert.equal(observation.status, 503);
  assert.equal(observation.classification.confirmed, false);
  assert.equal(observation.classification.retryable, false);
});
test("contains transport failure without a second request", async () => {
  let calls = 0;
  const plan = buildLiftProofingRuntimePlan({
    action: "APPROVE",
    company_id: "91",
    proofing_id: "proofing-synthetic-0001",
    comment: null,
    revised_art_url: null
  });
  const headers = buildLiftProofingRuntimeHeaders({
    plan,
    client_id: "client-synthetic-0001",
    client_secret: syntheticSecret,
    issued_at_epoch: 1_800_000_000,
    expires_at_epoch: 1_800_000_060
  });
  const observation = await sendLiftProofingRuntimeAction({
    base_url: "https://proofing.example.invalid/api",
    plan,
    headers,
    timeout_ms: 1_000,
    fetcher: async () => {
      calls += 1;
      throw new Error("synthetic network failure");
    }
  });

  assert.equal(calls, 1);
  assert.equal(observation.status, null);
  assert.equal(observation.transport_error, true);
  assert.equal(observation.classification.confirmed, false);
  assert.equal(observation.classification.retryable, false);
});

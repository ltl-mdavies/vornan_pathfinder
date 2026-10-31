import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProofOrder } from "@pathfinder/proof-domain";
import { freshStatusProofSummary } from "../src/proof/status-fresh-summary.js";
import { statusHandoffUrl } from "../src/proof/status-handoff.js";

const now = "2026-10-31T16:30:00.000Z";
const orderPayload = { rowset: [{ ORDER_NUMBER: "A0234529", CUSTOMER_ID: 1249,
  LINES: [{ ORDER_LINE_ID: 100, LINE_NUMBER: 1, LINE_STEP_NUMBER: 7.02, QUANTITY: 10 }] }] };
const proofPayload = { rowset: [{ ORDER_NUMBER: "A0234529", ORDER_LINE_ID: 100, LINE_NUMBER: 1,
  ATTACHMENT_ID: 200, PROOF_FILENAME: "current.jpg", PROOF_APPROVAL_STATUS: "PENDING",
  PROOF_LINK_LOW: "https://example.invalid/current.jpg" }] };
const cached = normalizeProofOrder({ order_number: "A0234529", order_payload: orderPayload,
  proof_payloads: [proofPayload], synced_at: now });
const base = { orderNumber: "A0234529", cached, orderPayload, proofPayload, orderOk: true, proofOk: true, now,
  orderFetchedAt: now, proofFetchedAt: now };

test("fresh report retains verified summary and eligible LTL navigation without granting decisions", () => {
  const result = freshStatusProofSummary(base)!;
  assert.equal(result.source, "lift_report");
  assert.equal(result.pending, 1);
  assert.equal(result.decisions_enabled, false);
  assert.ok(statusHandoffUrl({ enabled: true, customerId: "1249", orderNumber: base.orderNumber,
    pending: result.pending, reviewRequired: result.review_required, healthy: result.health === "active",
    cancelled: false, visibility: "review_link" }));
});

test("current production step removes pending action without altering cached order", () => {
  const result = freshStatusProofSummary({ ...base, orderPayload: { rowset: [{ ...orderPayload.rowset[0],
    LINES: [{ ...orderPayload.rowset[0].LINES[0], LINE_STEP_NUMBER: 10 }] }] } })!;
  assert.equal(result.pending, 0);
  assert.equal(result.review_required, false);
  assert.equal(cached.tasks[0].state, "pending");
});

test("missing, mismatched, unhealthy, and failed sources suppress summary", () => {
  for (const patch of [
    { cached: null }, { cached: { ...cached, last_synced_at: "invalid" } },
    { cached: { ...cached, last_synced_at: "2026-11-01T00:00:00Z" } },
    { cached: { ...cached, customer_id: "175332" } }, { cached: { ...cached, order_number: "A0233367" } },
    { cached: { ...cached, health: "stale" as const } }, { orderOk: false }, { proofOk: false },
    { proofPayload: { rowset: null } },
    { proofPayload: { rowset: [{ ...proofPayload.rowset[0], ORDER_NUMBER: "A0233367" }] } }
  ]) assert.equal(freshStatusProofSummary({ ...base, ...patch }), null);
});

test("fresh Lift reads retain review navigation after the independent Proof cache ages", () => {
  for (const age of [15 * 60 * 1000 + 1, 24 * 60 * 60 * 1000]) {
    const old = { ...cached, last_synced_at: new Date(Date.parse(now) - age).toISOString() };
    const before = JSON.stringify(old);
    const result = freshStatusProofSummary({ ...base, cached: old })!;
    assert.equal(result.pending, 1);
    assert.equal(result.last_synced_at, now);
    assert.equal(result.source, "lift_report");
    assert.equal(result.decisions_enabled, false);
    assert.ok(statusHandoffUrl({enabled:true,customerId:"1249",orderNumber:base.orderNumber,pending:result.pending,
      reviewRequired:result.review_required,healthy:result.health === "active",cancelled:false,visibility:"review_link"}));
    assert.equal(JSON.stringify(old), before);
    for (const rowset of [[], [{ ORDER_NUMBER: "A0234529", ORDER_LINE_ID: 100, LINE_NUMBER: 1 }]])
      assert.equal(freshStatusProofSummary({...base,cached:old,proofPayload:{rowset}})?.pending ?? 0, 0);
    for (const step of [{LINE_STEP_NUMBER:10}, {LINE_STEP_ID:-1,LINE_STEP_NUMBER:null}]) {
      const currentOrder = {rowset:[{...orderPayload.rowset[0],LINES:[{...orderPayload.rowset[0].LINES[0],...step}]}]};
      assert.equal(freshStatusProofSummary({...base,cached:old,orderPayload:currentOrder})?.pending ?? 0, 0);
    }
    assert.equal(freshStatusProofSummary({...base,cached:old,orderPayload:{rowset:null}}),null);
  }
});

test("report freshness is required independently for both successful Lift reads", () => {
  for (const field of ["orderFetchedAt", "proofFetchedAt"] as const) {
    for (const value of [undefined, "invalid", "2026-10-31T16:14:59.999Z", "2026-10-31T16:30:00.001Z"])
      assert.equal(freshStatusProofSummary({...base,[field]:value}), null);
    assert.ok(freshStatusProofSummary({...base,[field]:"2026-10-31T16:15:00.000Z"}));
  }
});

test("empty or unusable fresh proof rows cannot revive cached pending tasks", () => {
  for (const rowset of [[], [{ ORDER_NUMBER: "A0234529", ORDER_LINE_ID: 100, LINE_NUMBER: 1 }]]) {
    const summary = freshStatusProofSummary({ ...base, proofPayload: { rowset } });
    assert.equal(summary?.pending ?? 0, 0);
    assert.equal(summary?.review_required ?? false, false);
  }
});

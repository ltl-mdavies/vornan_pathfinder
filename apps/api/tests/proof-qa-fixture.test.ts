import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProofSyntheticQaOrder,
  parseProofSyntheticQaRequest,
  PROOF_SYNTHETIC_QA_MARKER,
  PROOF_SYNTHETIC_QA_ORDER_NUMBER
} from "../src/proof/qa-fixture.ts";

test("builds one unmistakably synthetic cached order and line aggregate", () => {
  const fixtureId = "vpqa-20260721-foundation";
  const order = buildProofSyntheticQaOrder(fixtureId, new Date("2026-07-21T14:00:00.000Z"));
  assert.equal(order.order_number, PROOF_SYNTHETIC_QA_ORDER_NUMBER);
  assert.equal(order.customer_name, PROOF_SYNTHETIC_QA_MARKER);
  assert.match(order.order_title ?? "", new RegExp(fixtureId));
  assert.equal(order.lines.length, 1);
  assert.equal(order.tasks.length, 1);
  assert.equal(order.tasks[0]?.order_line_id, order.lines[0]?.order_line_id);
  assert.equal(order.tasks[0]?.state, "pending");
  assert.equal(order.tasks[0]?.actionable, true);
  assert.equal(order.last_sync_diagnostics, null);
  assert.equal(JSON.stringify(order).includes("lifterp.com"), false);
});

test("recognizes only bounded synthetic queue envelopes", () => {
  assert.equal(parseProofSyntheticQaRequest({ order_number: PROOF_SYNTHETIC_QA_ORDER_NUMBER }), null);
  assert.deepEqual(parseProofSyntheticQaRequest({
    qa_fixture: { fixture_id: "vpqa-20260721-foundation", outcome: "success" }
  }), { fixture_id: "vpqa-20260721-foundation", outcome: "success" });
  for (const qa_fixture of [
    null,
    { fixture_id: "customer-order", outcome: "success" },
    { fixture_id: "vpqa-20260721-foundation", outcome: "write" },
    { fixture_id: "vpqa-20260721-foundation", outcome: "success", token: "must-not-be-accepted" }
  ]) {
    assert.throws(() => parseProofSyntheticQaRequest({ qa_fixture }), /synthetic Proof QA/i);
  }
});

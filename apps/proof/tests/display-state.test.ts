import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { proofApprovalTimestamp, proofOrderDisplayStatus, proofOrderDisplayTitle } from "../src/display-state.ts";

test("approval timestamps are shown only with authoritative approved status", () => {
  const version = { approval_status: "PENDING", proof_approved_ts: "2026-10-29T12:26:00Z", approved_at: "2026-10-29" };
  for (const status of ["PENDING", "REJECTED", "REVISION", "", null]) {
    assert.equal(proofApprovalTimestamp({ ...version, approval_status: status }), null);
  }
  assert.equal(proofApprovalTimestamp({ ...version, approval_status: "APPROVED" }), version.proof_approved_ts);
  assert.equal(proofApprovalTimestamp({ ...version, approval_status: " approved ", proof_approved_ts: null }), version.approved_at);
  assert.equal(proofApprovalTimestamp({ approval_status: "APPROVED", proof_approved_ts: null, approved_at: null }), null);
});

test("uses Lift display metadata when present and deterministic order fallbacks when absent", () => {
  assert.equal(proofOrderDisplayTitle({ order_number: "A0221132", order_title: "Summer retail rollout" }), "Summer retail rollout");
  assert.equal(proofOrderDisplayTitle({ order_number: "A0221132", order_title: "  " }), "Order A0221132");
  assert.equal(proofOrderDisplayStatus("Pending Art Approval"), "Pending Art Approval");
  assert.equal(proofOrderDisplayStatus(""), "Proof review");
});

test("distinguishes Prepress feedback from line-associated production messages", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /Prepress team feedback/);
  assert.match(source, /function decisionStateDetail\(task: ProofTask\) \{\n  return proofStatePresentation\(task\.state\)\.detail;/);
  assert.equal(source.includes("> Feedback<"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PROOF_BACKGROUND_CHECK_INTERVAL_MS,
  PROOF_BACKGROUND_LIFT_REFRESH_INTERVAL_MS,
  proofBackgroundCheckAllowed,
  proofBackgroundLiftRefreshDue
} from "../src/background-refresh-state.ts";

test("runs background checks only for an idle visible review", () => {
  assert.equal(PROOF_BACKGROUND_CHECK_INTERVAL_MS, 60_000);
  assert.equal(proofBackgroundCheckAllowed({ visible: true, ready: true, in_flight: false, refresh_state: "idle" }), true);
  assert.equal(proofBackgroundCheckAllowed({ visible: false, ready: true, in_flight: false, refresh_state: "idle" }), false);
  assert.equal(proofBackgroundCheckAllowed({ visible: true, ready: true, in_flight: true, refresh_state: "idle" }), false);
  assert.equal(proofBackgroundCheckAllowed({ visible: true, ready: true, in_flight: false, refresh_state: "queued" }), false);
});

test("bounds authoritative Lift refreshes to one per five active minutes", () => {
  const now = Date.parse("2026-08-24T20:16:00.000Z");
  assert.equal(PROOF_BACKGROUND_LIFT_REFRESH_INTERVAL_MS, 300_000);
  assert.equal(proofBackgroundLiftRefreshDue({ last_synced_at: "2026-08-24T20:13:00.000Z", last_requested_at: 0, now }), false);
  assert.equal(proofBackgroundLiftRefreshDue({ last_synced_at: "2026-08-24T20:11:00.000Z", last_requested_at: 0, now }), true);
  assert.equal(proofBackgroundLiftRefreshDue({ last_synced_at: "2026-08-24T20:00:00.000Z", last_requested_at: now - 60_000, now }), false);
});

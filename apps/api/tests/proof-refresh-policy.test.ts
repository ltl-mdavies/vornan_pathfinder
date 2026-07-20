import assert from "node:assert/strict";
import test from "node:test";
import { proofAutomaticRefreshState } from "../src/proof/sync-queue.ts";

process.env.PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS = "14";
process.env.PATHFINDER_PROOF_STALE_AFTER_MINUTES = "15";

const now = new Date("2026-07-20T18:00:00.000Z");

test("automatically refreshes only stale active orders with a recent proof change", () => {
  assert.deepEqual(proofAutomaticRefreshState({
    health: "active",
    updated_at: "2026-07-19T18:00:00.000Z",
    last_synced_at: "2026-07-20T17:00:00.000Z"
  }, now), { stale: true, eligible: true, reason: "active_recent" });

  assert.deepEqual(proofAutomaticRefreshState({
    health: "active",
    updated_at: "2026-07-19T18:00:00.000Z",
    last_synced_at: "2026-07-20T17:50:00.000Z"
  }, now), { stale: false, eligible: false, reason: "fresh" });
});

test("stops automatic polling for complete, degraded, or long-inactive packets", () => {
  assert.deepEqual(proofAutomaticRefreshState({
    health: "complete",
    updated_at: "2026-07-19T18:00:00.000Z",
    last_synced_at: "2026-07-20T17:00:00.000Z"
  }, now), { stale: true, eligible: false, reason: "non_interactive" });

  assert.deepEqual(proofAutomaticRefreshState({
    health: "error",
    updated_at: "2026-07-19T18:00:00.000Z",
    last_synced_at: "2026-07-20T17:00:00.000Z"
  }, now), { stale: true, eligible: false, reason: "non_interactive" });

  assert.deepEqual(proofAutomaticRefreshState({
    health: "active",
    updated_at: "2026-07-06T18:00:00.000Z",
    last_synced_at: "2026-07-20T17:00:00.000Z"
  }, now), { stale: true, eligible: false, reason: "inactive" });

  assert.deepEqual(proofAutomaticRefreshState({
    health: "active",
    updated_at: "invalid",
    last_synced_at: "2026-07-20T17:00:00.000Z"
  }, now), { stale: true, eligible: false, reason: "inactive" });
});

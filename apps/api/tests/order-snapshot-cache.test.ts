import assert from "node:assert/strict";
import test from "node:test";
import { BoundedSnapshotCache } from "../src/order-snapshot-cache.ts";

test("reuses a recent snapshot only inside the configured refresh window", () => {
  const cache = new BoundedSnapshotCache<{ refreshed_at: string; value: string }>(15_000);
  const cachedAt = Date.parse("2026-07-20T20:30:00.000Z");
  const snapshot = { refreshed_at: "2026-07-20T20:29:59.900Z", value: "first" };

  const window = cache.set("customer:job", snapshot, cachedAt);

  assert.deepEqual(window, {
    checked_at: snapshot.refreshed_at,
    next_refresh_at: "2026-07-20T20:30:15.000Z"
  });
  assert.equal(cache.getRecent("customer:job", cachedAt + 14_999)?.snapshot.value, "first");
  assert.equal(cache.getRecent("customer:job", cachedAt + 15_000), null);
});

test("evicts the oldest bounded entry and replaces an existing key cleanly", () => {
  const cache = new BoundedSnapshotCache<{ refreshed_at: string; value: string }>(15_000, 2);
  const start = Date.parse("2026-07-20T20:30:00.000Z");

  cache.set("one", { refreshed_at: new Date(start).toISOString(), value: "old" }, start);
  cache.set("two", { refreshed_at: new Date(start + 1).toISOString(), value: "two" }, start + 1);
  cache.set("one", { refreshed_at: new Date(start + 2).toISOString(), value: "new" }, start + 2);
  cache.set("three", { refreshed_at: new Date(start + 3).toISOString(), value: "three" }, start + 3);

  assert.equal(cache.getRecent("one", start + 4)?.snapshot.value, "new");
  assert.equal(cache.getRecent("two", start + 4), null);
  assert.equal(cache.getRecent("three", start + 4)?.snapshot.value, "three");
});

import assert from "node:assert/strict";
import test from "node:test";
import { ExpiringPromiseCache } from "../src/expiring-promise-cache.js";

test("coalesces concurrent reads and reuses successful and empty results", async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new ExpiringPromiseCache(60_000, () => now);
  const loader = async () => {
    calls += 1;
    await Promise.resolve();
    return {};
  };

  const [first, second] = await Promise.all([
    cache.read("missing-target", loader),
    cache.read("missing-target", loader)
  ]);
  const third = await cache.read("missing-target", loader);

  assert.deepEqual(first, {});
  assert.deepEqual(second, {});
  assert.deepEqual(third, {});
  assert.equal(calls, 1);

  now += 60_001;
  await cache.read("missing-target", loader);
  assert.equal(calls, 2);
});

test("evicts failed reads so a later safe read can recover", async () => {
  let calls = 0;
  const cache = new ExpiringPromiseCache(60_000);
  const loader = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("transient read failure");
    }
    return { configured: true };
  };

  await assert.rejects(cache.read("target", loader), /transient read failure/);
  assert.deepEqual(await cache.read("target", loader), { configured: true });
  assert.equal(calls, 2);
});

test("write-through values replace a cached read without waiting for expiry", async () => {
  const cache = new ExpiringPromiseCache(60_000);
  await cache.read("target", async () => ({ version: 1 }));
  cache.set("target", { version: 2 });

  assert.deepEqual(
    await cache.read("target", async () => ({ version: 3 })),
    { version: 2 }
  );
});

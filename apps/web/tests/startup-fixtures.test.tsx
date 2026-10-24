import test from "node:test";
import assert from "node:assert/strict";
import { createStartupReview } from "../../../tests/ux/startup-fixtures";

test("held bootstrap reads stay pending until explicit release, including reordered completions", async () => {
  const fixture = createStartupReview(new URLSearchParams("startupHold=targets,registry"));
  let completed = 0;
  const targets = fixture.intercept("/api/targets", "GET").then(() => completed++);
  const registry = fixture.intercept("/api/canonical-registry", "GET").then(() => completed++);
  await fixture.intercept("/api/lift/customers", "GET");
  assert.equal(completed, 0);
  fixture.release();
  await Promise.all([targets, registry]);
  assert.equal(completed, 2);
  assert.equal(await fixture.intercept("/api/targets", "GET"), null);
});

test("reload gets a fresh gate and customer error permits exactly the next retry", async () => {
  for (let reload = 0; reload < 2; reload++) {
    const fixture = createStartupReview(new URLSearchParams("startupHold=workspace&startupFail=workspace"));
    const read = fixture.intercept("/api/customers/1249/workspace", "GET");
    fixture.release();
    assert.equal((await read)?.status, 503);
    assert.equal(await fixture.intercept("/api/customers/1249/workspace", "GET"), null);
  }
});

test("startup fixture never intercepts writes or unrelated routes", async () => {
  const fixture = createStartupReview(new URLSearchParams("startupHold=workspace&startupFail=directory"));
  assert.equal(await fixture.intercept("/api/customers/1249/workspace", "POST"), null);
  assert.equal(await fixture.intercept("/api/jobs", "GET"), null);
  assert.equal((await fixture.intercept("/api/lift/customers", "GET"))?.status, 503);
  assert.equal(await fixture.intercept("/api/lift/customers", "GET"), null);
});

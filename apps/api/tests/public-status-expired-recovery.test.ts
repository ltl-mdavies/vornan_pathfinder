import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import request from "supertest";

const directory = await mkdtemp(join(tmpdir(), "pathfinder-expired-status-"));
process.env.PATHFINDER_RUNTIME = "lambda";
process.env.PATHFINDER_STORAGE_DRIVER = "local";
process.env.PATHFINDER_LOCAL_STORE_PATH = join(directory, "pathfinder.json");

const [{ app }, { persistOrderStatusToken }] = await Promise.all([
  import("../src/server.js"),
  import("../src/store.js")
]);

test("an expired retained token returns its Lift order number without exposing status data", async () => {
  const rawToken = "expired-private-status-token";
  await persistOrderStatusToken({
    token_hash: createHash("sha256").update(rawToken).digest("hex"),
    order_key: "284619:job-expired:A0229017",
    customer_id: "284619",
    job_id: "job-expired",
    order_number: "A0229017",
    status: "Active",
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    expires_at: "2000-08-30T12:00:00.000Z",
    expires_at_epoch: Date.parse("2000-08-30T12:00:00.000Z") / 1000,
    purge_at_epoch: Date.parse("2099-11-28T12:00:00.000Z") / 1000
  });

  const response = await request(app).get(`/public/status/${rawToken}`).expect(410);
  assert.deepEqual(response.body, {
    error: "Order status link has expired.",
    order_numbers: ["A0229017"]
  });
  assert.equal(JSON.stringify(response.body).includes("job-expired"), false);
});

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("proof asset resolver rejects missing and expired tokens before contacting Lift", async () => {
  await request(app).get("/public/status/unknown-token/proof-asset?order_number=A100&line_number=1&filename=proof.jpg").expect(404);
  const response = await request(app).get("/public/status/expired-private-status-token/proof-asset?order_number=A0229017&line_number=1&filename=proof.jpg").expect(410);
  assert.equal(response.headers.location, undefined);
  assert.match(response.headers["cache-control"], /no-store/);
});

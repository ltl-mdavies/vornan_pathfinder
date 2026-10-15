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
process.env.PATHFINDER_SECRETS_DRIVER = "local";
process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(directory, "secrets.json");

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

test("proof asset HTTP route uses trusted p2 and rejects identity bypasses before redirecting", async (context) => {
  const store = await import("../src/store.js");
  const customer = { lift_customer_id: "status-asset-fixture", customer_name: "Asset fixture", customer_status: "Active" } as Parameters<typeof store.getOrCreateWorkspace>[0];
  const workspace = await store.getOrCreateWorkspace(customer);
  const routeId = "asset-fixture-job-route";
  await store.updateOutputRoute(customer, routeId, {
    target_id: workspace.output_routes[0].target_id,
    proof_report_url: "https://lift.fixture.invalid/job-route?offset=0"
  });
  await store.updateStatusAccessPolicy(customer, { proof_visibility: "status_only" });
  const binding = { order_key: "fixture:asset:order", customer_id: customer.lift_customer_id, job_id: "asset-job", order_number: "A100" };
  await store.persistJobSnapshot(customer, {
    ...binding, customer_name: customer.customer_name, output_route_id: routeId,
    state: "Order Confirmed", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"
  } as Parameters<typeof store.persistJobSnapshot>[1]);
  const snapshot = {
    ...binding, job: { job_id: binding.job_id }, proof_visibility: "status_only",
    lines: Array.from({ length: 7 }, (_, index) => ({ line_number: index + 1, order_line_id: 101 + index,
      proofs: [{ proof_filename: "same.jpg", created_ts: "version-1" }] }))
  } as unknown as Parameters<typeof store.persistPublicOrderStatusSnapshot>[0];
  await store.persistPublicOrderStatusSnapshot(snapshot);
  const token = "synthetic-active-status-asset-token";
  await store.persistOrderStatusToken({ ...binding,
    token_hash: createHash("sha256").update(token).digest("hex"), status: "Active",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z", expires_at_epoch: Date.parse("2099-01-01T00:00:00Z") / 1000
  });
  const calls: URL[] = [];
  const low = "https://fixture.s3.amazonaws.com/thumbs/91/same.jpg?signature=synthetic";
  const high = "https://fixture.s3.amazonaws.com/originals/91/same.jpg?signature=synthetic";
  context.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin, "https://lift.fixture.invalid");
    assert.equal(url.pathname, "/job-route");
    assert.equal(url.searchParams.get("p1"), "A100");
    const line = Number(url.searchParams.get("p2")) - 100;
    assert.ok(line >= 1 && line <= 7, "only trusted line IDs may reach Lift");
    const row = { ORDER_NUMBER: "A100", LINE_NUMBER: line, ORDER_LINE_ID: 100 + line,
      ATTACHMENT_ID: 1, PROOF_FILENAME: "same.jpg", CREATED_TS: "version-1",
      PROOF_LINK_LOW: low, PROOF_LINK_HIGH: high };
    if (line === 2) row.ORDER_LINE_ID = 999;
    if (line === 3) row.ORDER_NUMBER = "A999";
    if (line === 4) row.PROOF_FILENAME = "other.jpg";
    if (line === 5) row.CREATED_TS = "other-version";
    if (line === 6) { row.PROOF_LINK_LOW = "https://evil.invalid/thumbs/91/same.jpg"; row.PROOF_LINK_HIGH = row.PROOF_LINK_LOW; }
    return Response.json({ rowset: line === 7 ? [row, { ...row, ATTACHMENT_ID: 2 }] : [row] });
  });
  const endpoint = `/public/status/${token}/proof-asset`;
  const query = { order_number: "A100", line_number: "1", filename: "same.jpg", asset_kind: "thumbnail", created_ts: "version-1" };
  for (const invalid of [{ order_number: "A999" }, { line_number: "999" }, { filename: "unknown.jpg" }, { created_ts: "old" }]) {
    const response = await request(app).get(endpoint).query({ ...query, ...invalid }).expect(404);
    assert.equal(response.headers.location, undefined);
  }
  assert.equal(calls.length, 0);
  const thumbnail = await request(app).get(endpoint).query({ ...query, order_line_id: "999", p2: "999" }).expect(302);
  assert.equal(thumbnail.headers.location, low);
  assert.match(thumbnail.headers["cache-control"], /no-store/);
  const original = await request(app).get(endpoint).query({ ...query, asset_kind: "image" }).expect(302);
  assert.equal(original.headers.location, high);
  assert.equal(calls.length, 1, "thumbnail/high-res coalesce by trusted line");
  assert.equal(calls[0].searchParams.get("p2"), "101");
  for (let line = 2; line <= 7; line++) {
    const response = await request(app).get(endpoint).query({ ...query, line_number: String(line) }).expect(404);
    assert.equal(response.headers.location, undefined);
  }
  await store.updateStatusAccessPolicy(customer, { proof_visibility: "off" });
  await request(app).get(endpoint).query(query).expect(404);
  assert.equal(calls.length, 7, "disabled visibility must prevent even a cached redirect");
});

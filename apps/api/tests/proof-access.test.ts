import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { ProofOrder } from "@pathfinder/proof-domain";

let testDirectory = "";
let storePath = "";
let access: typeof import("../src/proof/access-service.ts");
let store: typeof import("../src/proof/store.ts");

const order: ProofOrder = {
  order_number: "A0221132",
  order_title: "Retail launch",
  customer_name: "Internal customer name",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [{ order_line_id: "9301338", line_number: "1", step_number: 7.02, product_name: "Panel", quantity: 20, status: null, cancelled: false }],
  tasks: [{
    task_id: "ptask_safe",
    order_line_id: "9301338",
    line_number: "1",
    attachment_id: "25435041",
    product_name: "Panel",
    state: "pending",
    actionable: true,
    sibling_index: 1,
    sibling_count: 1,
    version: 1,
    current_version: {
      version_id: "pversion_safe",
      attachment_id: "25435041",
      created_at: "2026-07-20T12:00:00.000Z",
      filename: "panel.pdf",
      preview_url: "https://files.example/panel-low.pdf",
      download_url: "https://files.example/panel.pdf",
      approval_status: "PENDING",
      approved_by: "internal@example.com",
      approved_at: null,
      comments: [{ text: "Check color", created_at: "2026-07-20T12:05:00.000Z", attachment: { internal: true } }],
      detailed_report: { internal: true },
      feedback_fingerprint: "private",
      current: true,
      archived_at: null
    },
    versions: [],
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    archived_at: null
  }],
  archived_tasks: [],
  warnings: [{ code: "proof_without_url", message: "internal warning" }],
  created_at: "2026-07-20T12:00:00.000Z",
  updated_at: "2026-07-20T12:00:00.000Z",
  last_synced_at: "2026-07-20T12:00:00.000Z"
};
order.tasks[0]!.versions = [order.tasks[0]!.current_version!];

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-access-"));
  storePath = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = storePath;
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  process.env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ = "true";
  process.env.PATHFINDER_PROOF_PUBLIC_BASE_URL = "https://proof.vornan.co";
  access = await import("../src/proof/access-service.ts");
  store = await import("../src/proof/store.ts");
  await store.persistProofOrder(order);
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("returns a raw grant once, persists only hashes, and exchanges it only once", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number, label: "Customer review" });
  const rawToken = created.access_url.split("/").at(-1)!;
  assert.match(rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.grant.scope, "view");
  assert.equal("token_hash" in created.grant, false);
  assert.equal((await readFile(storePath, "utf8")).includes(rawToken), false);

  const exchanged = await access.exchangeProofToken(rawToken);
  assert.match(exchanged.raw_session, /^[A-Za-z0-9_-]{43}$/);
  assert.match(exchanged.raw_csrf, /^[A-Za-z0-9_-]{43}$/);
  const persisted = await readFile(storePath, "utf8");
  assert.equal(persisted.includes(exchanged.raw_session), false);
  assert.equal(persisted.includes(exchanged.raw_csrf), false);
  assert.equal(access.validateProofCsrf(exchanged.session, exchanged.raw_csrf), true);
  assert.equal(access.validateProofCsrf(exchanged.session, "invalid"), false);
  assert.equal((await access.validateProofSession(exchanged.raw_session)).session.order_number, order.order_number);
  await assert.rejects(() => access.exchangeProofToken(rawToken), access.ProofAccessDeniedError);
});

test("revalidates the grant on each request so revocation ends an existing session", async () => {
  const created = await access.createProofGrant({ order_number: order.order_number });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchanged = await access.exchangeProofToken(rawToken);
  await access.revokeProofGrant(created.grant.grant_id);
  await assert.rejects(() => access.validateProofSession(exchanged.raw_session), access.ProofAccessDeniedError);
});

test("rejects decision scopes while proof access is read-only", async () => {
  await assert.rejects(
    () => access.createProofGrant({ order_number: order.order_number, scope: "review_and_decide" as "view" }),
    /Only view-scoped/
  );
});

test("uses a 14-day default and regenerates by revoking the prior grant", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const created = await access.createProofGrant({ order_number: order.order_number, label: "First link", now });
  assert.equal(created.grant.expires_at, "2026-08-03T12:00:00.000Z");
  const regenerated = await access.updateProofGrant(created.grant.grant_id, { action: "regenerate" }, now);
  assert.ok(regenerated?.access_url);
  assert.notEqual(regenerated?.grant.grant_id, created.grant.grant_id);
  assert.equal((await store.getProofGrantById(created.grant.grant_id))?.status, "revoked");
});

test("rejects expired sessions even while their grant remains active", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const created = await access.createProofGrant({ order_number: order.order_number, now });
  const rawToken = created.access_url.split("/").at(-1)!;
  const exchanged = await access.exchangeProofToken(rawToken, now);
  await assert.rejects(
    () => access.validateProofSession(exchanged.raw_session, new Date("2026-07-20T12:31:00.000Z")),
    access.ProofAccessDeniedError
  );
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import express from "express";
import request from "supertest";
import type { ProofOrder } from "@pathfinder/proof-domain";

let directory: string, path: string;
let access: typeof import("../src/proof/access-service.js"), store: typeof import("../src/proof/store.js"), shares: typeof import("../src/proof/share-service.js");
let router: typeof import("../src/proof/public-router.js");
let grantStore: typeof import("../src/proof/grant-store.js");
const now = new Date();
const capability = {
  pathfinder_customer_id: "284619", proof_customer_id: "1249", identity_verified_at: "2026-01-01T12:00:00.000Z",
  access_mode: "review" as const, review_experience: "advanced" as const, source: "customer_default" as const,
  policy_updated_at: "2026-01-02T12:00:00.000Z"
};
const readWorkspace = async () => ({
  customer: { lift_customer_id: capability.pathfinder_customer_id },
  proof_capability_policy: { access_mode: "review", review_experience: "advanced", updated_at: capability.policy_updated_at,
    customer_identity: { proof_customer_id: "1249", verified_order_number: "A0232139", verified_at: capability.identity_verified_at } }
});
const afterTime = (ms: number) => new Date(now.getTime() + ms);
const token = (url: string) => url.split("/").at(-1)!;
async function root(scope: "review" | "view" = "review", expires = afterTime(7 * 86400000).toISOString()) {
  const grant = await access.createProofGrant({ order_number: "A0232139", scope, capability, expires_at: expires, now });
  const exchanged = await access.exchangeProofToken(token(grant.access_url), now, readWorkspace);
  const { proofShareContext } = await import("../src/proof/share-policy.js");
  return { ...exchanged, grant, session: exchanged.session, csrf: exchanged.raw_csrf, readWorkspace,
    expected_order_number: "A0232139", expected_share_context: proofShareContext(exchanged.session) };
}
const payload = () => ({ idempotency_key: randomUUID(), scope: "view" as "view" | "review", days: 1, description: "Art team" });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "proof-sharing-test-")); path = join(directory, "store.json");
  Object.assign(process.env, {
    PATHFINDER_RUNTIME: "lambda", PATHFINDER_PROOF_STORAGE_DRIVER: "local", PATHFINDER_PROOF_LOCAL_STORE_PATH: path,
    PATHFINDER_PROOF_ENABLE_GRANT_CREATION: "true", PATHFINDER_PROOF_ENABLE_PUBLIC_READ: "true",
    PATHFINDER_PROOF_ENABLE_CUSTOMER_APPROVALS: "true", PATHFINDER_PROOF_ENABLE_SHARING: "true",
    PATHFINDER_PROOF_SHARING_SCOPES: "1249:A0232139", PATHFINDER_PROOF_PUBLIC_BASE_URL: "https://proof.example.invalid",
    PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT: "2099-01-01T00:00:00.000Z"
  });
  access = await import("../src/proof/access-service.js"); store = await import("../src/proof/store.js");
  shares = await import("../src/proof/share-service.js"); router = await import("../src/proof/public-router.js");
  grantStore = await import("../src/proof/grant-store.js");
  await store.persistProofOrder({ order_number: "A0232139", customer_id: "1249", customer_name: "Demo", order_title: "QA", order_status: "Pending",
    health: "active", version: 1, tasks: [], archived_tasks: [], lines: [], warnings: [], created_at: now.toISOString(), updated_at: now.toISOString(), last_synced_at: now.toISOString() } as ProofOrder);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("default off, exact customer/order scope, no legacy view or delegated management", async () => {
  const owner = await root();
  delete process.env.PATHFINDER_PROOF_ENABLE_SHARING;
  await assert.rejects(shares.listSharedProofLinks(owner), access.ProofAccessDeniedError);
  process.env.PATHFINDER_PROOF_ENABLE_SHARING = "true";
  process.env.PATHFINDER_PROOF_SHARING_SCOPES = "1249:A0232140";
  await assert.rejects(shares.createSharedProofLink({ ...owner, ...payload() }), access.ProofAccessDeniedError);
  process.env.PATHFINDER_PROOF_SHARING_SCOPES = "1249:A0232139";
  for (const invalid of ["1249:A0232139,bad", "1249:A0232139,", "1249:A0232139,*", Array(26).fill("1249:A0232139").join(",")]) {
    process.env.PATHFINDER_PROOF_SHARING_SCOPES = invalid;
    await assert.rejects(shares.listSharedProofLinks(owner), access.ProofAccessDeniedError);
  }
  process.env.PATHFINDER_PROOF_SHARING_SCOPES = "1249:A0232139";
  await assert.rejects(shares.createSharedProofLink({ ...await root("view"), ...payload() }), access.ProofAccessDeniedError);
});

test("same request recovers identical secret/expiry; stores only hash and atomic creation audit", async () => {
  const owner = await root(), input = { ...owner, ...payload() };
  const created = await shares.createSharedProofLink(input, now);
  const replay = await shares.createSharedProofLink(input, afterTime(1000));
  assert.deepEqual(replay, created);
  const saved = await readFile(path, "utf8");
  for (const secret of [token(created.access_url), owner.raw_csrf, owner.raw_session, created.access_url]) assert.equal(saved.includes(secret), false);
  assert.equal((await shares.listSharedProofLinks(owner)).length, 1);
  assert.equal((await store.listProofAuditEvents("A0232139", { limit: 100 })).events.filter((event) => event.grant_id === created.link.id && event.action === "proof.grant_created").length, 1);
  for (const changed of [{ scope: "review" }, { days: 3 }, { description: "Different" }]) {
    await assert.rejects(shares.createSharedProofLink({ ...input, ...changed }, now), (error: unknown) => error instanceof shares.ProofShareError && error.status === 409);
  }
  await assert.rejects(shares.createSharedProofLink({ ...input, csrf: "x".repeat(43) }, now), access.ProofAccessDeniedError);
});

test("reusable recipient sessions are independent, cannot share onward, and legacy stays single-use", async () => {
  const owner = await root();
  const created = await shares.createSharedProofLink({ ...owner, ...payload(), scope: "review" }, now);
  const first = await access.exchangeProofToken(token(created.access_url), now, readWorkspace);
  const second = await access.exchangeProofToken(token(created.access_url), now, readWorkspace);
  assert.notEqual(first.session.session_id, second.session.session_id);
  assert.notEqual(first.raw_csrf, second.raw_csrf); assert.equal(first.session.participant_id, null);
  assert.equal(first.session.delegated, true);
  const { proofShareContext } = await import("../src/proof/share-policy.js");
  const recipientAuthority = { session: first.session, readWorkspace, expected_order_number: "A0232139", expected_share_context: proofShareContext(first.session) };
  await assert.rejects(shares.listSharedProofLinks(recipientAuthority), access.ProofAccessDeniedError);
  await assert.rejects(shares.createSharedProofLink({ ...recipientAuthority, csrf: first.raw_csrf, ...payload() }), access.ProofAccessDeniedError);
  await assert.rejects(access.exchangeProofToken(token(owner.grant.access_url), now, readWorkspace), access.ProofAccessDeniedError);
  await access.validateProofSession(first.raw_session, now, readWorkspace);
});

test("child revoke ends all existing sessions, prevents exchange and response-loss replay", async () => {
  const owner = await root(), input = { ...owner, ...payload() }, created = await shares.createSharedProofLink(input, now);
  const recipient = await access.exchangeProofToken(token(created.access_url), now, readWorkspace);
  await shares.revokeSharedProofLink({ ...owner, id: created.link.id }, now);
  await shares.revokeSharedProofLink({ ...owner, id: created.link.id }, now);
  await assert.rejects(access.validateProofSession(recipient.raw_session, now, readWorkspace), access.ProofAccessDeniedError);
  await assert.rejects(access.exchangeProofToken(token(created.access_url), now, readWorkspace), access.ProofAccessDeniedError);
  await assert.rejects(shares.createSharedProofLink(input, now), shares.ProofShareError);
});

test("parent revoke, expiry, policy downgrade, and sharing kill switch fail closed", async () => {
  for (const reason of ["revoke", "expiry", "policy", "switch"] as const) {
    const owner = await root(), created = await shares.createSharedProofLink({ ...owner, ...payload() }, now);
    const recipient = await access.exchangeProofToken(token(created.access_url), now, readWorkspace);
    if (reason === "revoke") await access.revokeProofGrant(owner.session.grant_id, now);
    if (reason === "switch") process.env.PATHFINDER_PROOF_ENABLE_SHARING = "false";
    const at = reason === "expiry" ? afterTime(8 * 86400000) : now;
    const reader = reason === "policy" ? async () => null : readWorkspace;
    await assert.rejects(access.validateProofSession(recipient.raw_session, at, reader), access.ProofAccessDeniedError);
    await assert.rejects(access.exchangeProofToken(token(created.access_url), at, reader), access.ProofAccessDeniedError);
    process.env.PATHFINDER_PROOF_ENABLE_SHARING = "true";
  }
});

test("expiry choices are strict and bounded; description private, parent/order ownership enforced", async () => {
  const owner = await root("review", afterTime(2 * 86400000).toISOString()), other = await root();
  for (const days of [0, 2, 30, "1", null]) await assert.rejects(shares.createSharedProofLink({ ...owner, ...payload(), days }, now), shares.ProofShareError);
  const created = await shares.createSharedProofLink({ ...owner, ...payload(), days: 14 }, now);
  assert.equal(created.link.expires_at, owner.grant.grant.expires_at);
  assert.deepEqual(await shares.listSharedProofLinks(other, now), []);
  await assert.rejects(shares.revokeSharedProofLink({ ...other, id: created.link.id }, now), access.ProofAccessDeniedError);
  await assert.rejects(shares.listSharedProofLinks({ ...owner, session: { ...owner.session, order_number: "A0232140" } }, now), shares.ProofShareError);
  const safe = access.publicProofGrant((await store.getProofGrantForOrder("A0232139", created.link.id))!);
  for (const key of ["token_hash", "capability", "parent_grant_id", "created_by_session_id", "share_request_hash"]) assert.equal(key in safe, false);
});

test("concurrent retries create one link; CAS cannot restore revoked parent or child", async () => {
  const owner = await root(), input = { ...owner, ...payload() };
  const outcomes = await Promise.all([shares.createSharedProofLink(input, now), shares.createSharedProofLink(input, now)]);
  assert.deepEqual(outcomes[0], outcomes[1]);
  const staleParent = (await store.getProofGrantForOrder("A0232139", owner.session.grant_id))!;
  await access.revokeProofGrant(owner.session.grant_id, now);
  assert.equal(await grantStore.replaceProofGrant(staleParent, { ...staleParent, label: "Old snapshot" }), false);
  await assert.rejects(shares.createSharedProofLink(input, now), access.ProofAccessDeniedError);
});

test("new sessions/parents cannot replay another creation; creation rate is bounded", async () => {
  const owner = await root(), other = await root(), values = payload();
  const a = await shares.createSharedProofLink({ ...owner, ...values }, now);
  const b = await shares.createSharedProofLink({ ...other, ...values }, now);
  assert.notEqual(a.link.id, b.link.id); assert.notEqual(a.access_url, b.access_url);
  await assert.rejects(shares.createSharedProofLink({ ...owner, ...payload() }, now), (e: unknown) => e instanceof shares.ProofShareError && e.status === 429);
});

test("cross-tab cookie changes cannot list/create/revoke with a stale order or session context", async () => {
  const a = await root(), b = await root(), input = { ...a, ...payload() };
  const original = await shares.createSharedProofLink(input, now);
  const changedSession = { ...input, session: b.session, csrf: b.csrf };
  for (const operation of [
    () => shares.createSharedProofLink(changedSession, now),
    () => shares.listSharedProofLinks(changedSession, now),
    () => shares.revokeSharedProofLink({ ...changedSession, id: original.link.id }, now),
    () => shares.createSharedProofLink({ ...input, expected_order_number: "A0000001" }, now)
  ]) await assert.rejects(operation(), (e: unknown) => e instanceof shares.ProofShareError && e.code === "access_changed");
  assert.equal((await shares.listSharedProofLinks(b, now)).length, 0);
  assert.equal((await shares.listSharedProofLinks(a, now))[0]?.status, "active");
  const app = express(); app.use(express.json()); app.use("/proof", router.createProofPublicRouter({ readCustomerCapabilityWorkspace: readWorkspace }));
  const cookieB = `vornan_proof_session=${b.raw_session}; vornan_proof_csrf=${b.csrf}`;
  const response = await request(app).post("/proof/shares").set("Cookie", cookieB).set("x-vornan-proof-csrf", b.csrf).send({
    ...payload(), expected_order_number: a.expected_order_number, expected_share_context: a.expected_share_context
  }).expect(409);
  assert.equal(response.body.code, "access_changed");
});

test("the injected clock controls management expiry and existing effective activation semantics", async () => {
  const owner = await root(), policy = await import("../src/proof/share-policy.js");
  const grant = (await store.getProofGrantForOrder(owner.session.order_number, owner.session.grant_id))!;
  assert.equal(policy.proofShareManagementAllowed(grant, now), true);
  assert.equal(policy.proofShareManagementAllowed(grant, afterTime(8 * 86400000)), false);
  assert.equal(access.activationDeadline(now, true)?.toISOString(), "2099-01-01T00:00:00.000Z");
  const originalProfile = process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
  try {
    process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = "true|2000-01-01T00:00:00.000Z|A0232139|true|true|true|false|true";
    assert.equal(access.activationDeadline(now, true), null);
    const fresh = await root();
    const link = await shares.createSharedProofLink({ ...fresh, ...payload() }, now);
    assert.equal(link.link.expires_at, afterTime(86400000).toISOString());
  } finally {
    if (originalProfile === undefined) delete process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE;
    else process.env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE = originalProfile;
  }
});

test("HTTP CSRF enforced; recipient cannot manage shares or submit revised art", async () => {
  const app = express(); app.use(express.json()); app.use("/proof", router.createProofPublicRouter({ readCustomerCapabilityWorkspace: readWorkspace, queueSync: async () => ({ queued: false }) as never }));
  const owner = await root(), ownerCookie = `vornan_proof_session=${owner.raw_session}; vornan_proof_csrf=${owner.raw_csrf}`;
  await request(app).post("/proof/shares").set("Cookie", ownerCookie).send(payload()).expect(403);
  const binding = { expected_order_number: owner.expected_order_number, expected_share_context: owner.expected_share_context };
  const result = await request(app).post("/proof/shares").set("Cookie", ownerCookie).set("x-vornan-proof-csrf", owner.raw_csrf).send({ ...payload(), ...binding, scope: "review" }).expect(201);
  const query = new URLSearchParams({ order: binding.expected_order_number, context: binding.expected_share_context }).toString();
  await request(app).get(`/proof/shares?${query}`).set("Cookie", ownerCookie).expect(200);
  const recipient = await access.exchangeProofToken(token(result.body.access_url), new Date(), readWorkspace);
  const cookie = `vornan_proof_session=${recipient.raw_session}; vornan_proof_csrf=${recipient.raw_csrf}`;
  const { proofShareContext } = await import("../src/proof/share-policy.js");
  const recipientQuery = new URLSearchParams({ order: "A0232139", context: proofShareContext(recipient.session) }).toString();
  await request(app).get(`/proof/shares?${recipientQuery}`).set("Cookie", cookie).expect(401);
  await request(app).delete(`/proof/shares/${result.body.link.id}?${recipientQuery}`).set("Cookie", cookie).set("x-vornan-proof-csrf", recipient.raw_csrf).expect(401);
  const response = await request(app).get("/proof/order").set("Cookie", cookie).expect(200);
  assert.equal(response.body.order.access.sharing_enabled, false);
  assert.equal(response.body.order.access.revision_upload_enabled, false);
  assert.equal(response.body.order.access.revision_submission_enabled, false);
  await request(app).post("/proof/tasks/test/revised-art/submissions").set("Cookie", cookie).set("x-vornan-proof-csrf", recipient.raw_csrf).send({}).expect(403);
  const viewOwner = await root();
  const viewLink = await shares.createSharedProofLink({ ...viewOwner, ...payload() }, now);
  const viewer = await access.exchangeProofToken(token(viewLink.access_url), now, readWorkspace);
  const view = await request(app).get("/proof/order").set("Cookie", `vornan_proof_session=${viewer.raw_session}`).expect(200);
  assert.equal(view.body.order.access.scope, "view");
  for (const flag of ["decisions_enabled", "allocation_enabled", "revision_upload_enabled", "revision_submission_enabled", "sharing_enabled"]) assert.equal(view.body.order.access[flag], false, flag);
});

test("Dynamo indexes only locate: authoritative read follows and grant writes use CAS/transactions", async () => {
  const owner = await root(), created = await shares.createSharedProofLink({ ...owner, ...payload() }, now);
  const child = (await store.getProofGrantForOrder("A0232139", created.link.id))!;
  const parent = (await store.getProofGrantForOrder("A0232139", owner.session.grant_id))!;
  const client = store.getProofDynamoClient(), original = client.send;
  const commands: Array<{ name: string; input: any }> = [];
  try {
    process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
    process.env.PATHFINDER_PROOF_CORE_TABLE = "proof-test-core";
    process.env.PATHFINDER_PROOF_AUDIT_TABLE = "proof-test-audit";
    client.send = (async (command: any) => {
      commands.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "QueryCommand") return { Items: [{ data: { S: JSON.stringify(child) } }] };
      if (command.constructor.name === "GetItemCommand") return { Item: { data: { S: JSON.stringify({ ...child, status: "revoked", revoked_at: now.toISOString() }) } } };
      return {};
    }) as typeof client.send;
    const lookup = await store.getProofGrantByTokenHash(child.token_hash);
    assert.equal(lookup?.status, "revoked");
    assert.equal(commands[1]!.input.ConsistentRead, true);
    assert.deepEqual(commands[1]!.input.Key, { pk: { S: "ORDER#A0232139" }, sk: { S: `GRANT#${child.grant_id}` } });
    await grantStore.replaceProofGrant(parent, { ...parent, status: "revoked", revoked_at: now.toISOString() });
    assert.equal(commands.at(-1)!.input.ConditionExpression, "#data = :expected");
    assert.equal(commands.at(-1)!.input.ExpressionAttributeValues[":expected"].S, JSON.stringify(parent));
    const audit = (await import("node:crypto")).randomUUID();
    await grantStore.createDelegatedProofGrant(parent, child, {
      event_id: `paudit_${audit}`, occurred_at: now.toISOString(), action: "proof.grant_created", outcome: "succeeded",
      order_number: child.order_number, grant_id: child.grant_id, task_id: null, order_line_id: null, attachment_id: null, participant_id: null,
      actor_type: "customer_session", actor_id: owner.session.session_id, correlation_id: child.grant_id, metadata: { source: "public_api" }
    });
    const transaction = commands.at(-1)!;
    assert.equal(transaction.name, "TransactWriteItemsCommand");
    assert.equal(transaction.input.TransactItems.length, 3);
    assert.equal(transaction.input.TransactItems[0].Put.ConditionExpression, "#data = :expected");
    assert.equal(transaction.input.TransactItems[1].Put.ConditionExpression, "attribute_not_exists(pk)");
    assert.equal(transaction.input.TransactItems[2].Put.TableName, "proof-test-audit");
  } finally { client.send = original; process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local"; }
});

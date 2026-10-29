import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createCustomerAllocationService, customerAllocationScopeAllowed, type AllocationRequest } from "../src/proof/customer-quantity-service.ts";
import type { CustomerAllocation } from "../src/proof/customer-allocation-store.ts";
import type { ProofAccessSession, ProofOrder } from "@pathfinder/proof-domain";

for (const delegated of [false, true]) describe(delegated ? "delegated reviewer allocations" : "original reviewer allocations", () => {
const timestamp = "2026-10-22T12:00:00.000Z";
const session = {
  delegated,
  session_id: "psession_test", grant_id: "pgrant_test", order_number: "A0229638", participant_id: "pparticipant_test", scope: "review",
  capability: { proof_customer_id: "1249", access_mode: "review", review_experience: "advanced" }
} as ProofAccessSession;
function order(): ProofOrder {
  return {
    order_number: session.order_number, customer_id: "1249", health: "active", lines: [{ order_line_id: "123", line_number: "1", quantity: 10, cancelled: false }],
    tasks: ["201", "202"].map((attachment, index) => {
      const version = { version_id: `pversion_${attachment}`, attachment_id: attachment, current: true, filename: `${attachment}.pdf`, approval_status: "PENDING", feedback_fingerprint: "none", comments: [], archived_at: null };
      return { task_id: `ptask_${attachment}`, attachment_id: attachment, order_line_id: "123", line_number: "1", quantity: 10, state: "pending", actionable: true, version: 1, current_version: version, versions: [version], sibling_index: index + 1, sibling_count: 2, archived_at: null };
    })
  } as ProofOrder;
}
const request: AllocationRequest = {
  idempotency_key: "allocation-test-key-0001", note: "Print these quantities",
  entries: ["201", "202"].map((id, i) => ({ task_id: `ptask_${id}`, attachment_id: id, expected_task_version: 1, expected_version_id: `pversion_${id}`, quantity: i ? 6 : 4 }))
};
function fixture(scopeAllowed = true) {
  let snapshot = order();
  let saved: CustomerAllocation | null = null;
  let enabled = true;
  let reads = 0;
  let outage = false;
  let evidenceFailure: "none" | "conflict" | "outage" = "none";
  const sends: unknown[] = [];
  const events: string[] = [];
  const service = createCustomerAllocationService({
    enabled: () => enabled,
    scopeAllowed: () => scopeAllowed,
    runtime: () => ({ feature_flags: { approve: true, public_read: true } }) as never,
    now: () => new Date(timestamp),
    recordApproval: async () => { if (evidenceFailure === "outage") throw new Error("storage unavailable"); return evidenceFailure !== "conflict"; }, reopenAction: async () => false,
    sync: async () => { reads++; if (outage) throw new Error("offline"); return { order: structuredClone(snapshot) } as never; },
    participant: async () => ({ participant_id: session.participant_id!, grant_id: session.grant_id, order_number: session.order_number, display_name: "Test Reviewer", email: "reviewer@example.invalid", first_seen_at: timestamp, last_seen_at: timestamp }),
    acknowledgement: async () => null,
    read: async (_order, id) => saved?.batch_id === id ? structuredClone(saved) : null,
    list: async () => saved ? [structuredClone(saved)] : [],
    reserve: async (record) => { if (saved) return false; saved = structuredClone(record); events.push("reserve"); return true; },
    replace: async (before, after) => { if (before.record_version !== saved?.record_version) return false; saved = structuredClone(after); events.push(after.state); return true; },
    target: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://proofing.example.invalid/order-import" }] }) as never,
    credentials: async () => ({ base_url: "https://proofing.example.invalid/api", company_id: "91", action_user_name: "VORNAN_PROOF", client_id: "test", client_secret: "synthetic-secret-material-for-tests" }),
    send: async ({ plan, headers }) => {
      assert.equal(saved?.state, "checking", "durable boundary must precede PUT");
      assert.ok(Object.values(headers).some((value) => String(value).startsWith("Bearer ")), "existing proof bearer transport");
      sends.push(plan.body); events.push("send");
      throw new Error("response lost");
    }
  });
  const context = { session, correlation_id: "test-allocation" };
  return { service, context, sends, events, get saved() { return saved!; }, get reads() { return reads; }, snapshot,
    setSnapshot: (value: ProofOrder) => { snapshot = value; }, disable: () => { enabled = false; }, outage: () => { outage = true; },
    evidenceFailure: (value: typeof evidenceFailure) => { evidenceFailure = value; },
    prepare: (value = request, identity = session) => service.prepare({ ...context, session: identity, request: value }),
    advance: () => service.advance({ ...context, batch_id: saved!.batch_id }) };
}

test("allocation release scope requires an exact customer/order pair and rejects malformed scope", () => {
  for (const scope of [undefined, "", "*", "1249:*", "1249:A0229638,", "1249:A0229638,bad", "999:A0229638", "1249:A0232139"]) {
    assert.equal(customerAllocationScopeAllowed(session, { PATHFINDER_PROOF_CUSTOMER_ALLOCATION_SCOPE: scope }), false);
  }
  assert.equal(customerAllocationScopeAllowed(session, { PATHFINDER_PROOF_CUSTOMER_ALLOCATION_SCOPE: "999:A0232139,1249:A0229638" }), true);
  assert.equal(customerAllocationScopeAllowed({ ...session, capability: undefined }, { PATHFINDER_PROOF_CUSTOMER_ALLOCATION_SCOPE: "1249:A0229638" }), false);
});

test("out-of-scope allocation calls fail before reads, reservations or Lift writes", async () => {
  const f = fixture(false);
  await assert.rejects(f.prepare(), /not enabled for this order/);
  await assert.rejects(f.service.list(f.context), /not enabled for this order/);
  await assert.rejects(f.service.advance({ ...f.context, batch_id: "pbatch_denied" }), /not enabled for this order/);
  assert.equal(f.reads, 0);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.sends, []);
});

test("allocation gate and advanced reviewer authorization fail before reads or writes", async () => {
  for (const identity of [{ ...session, scope: "view" }, { ...session, participant_id: null }, { ...session, capability: { ...session.capability!, review_experience: "simple" } }]) {
    const f = fixture(); await assert.rejects(f.prepare(request, identity as ProofAccessSession)); assert.equal(f.reads, 0); assert.equal(f.sends.length, 0);
  }
  const f = fixture(); f.disable(); await assert.rejects(f.prepare()); assert.equal(f.reads, 0);
});
test("validates exact complete membership, quantities, customer, current art, feedback and cancellation", async () => {
  for (const mutate of [
    (o: ProofOrder) => { o.customer_id = "999"; },
    (o: ProofOrder) => { o.health = "cancelled"; },
    (o: ProofOrder) => { o.tasks[0]!.version++; },
    (o: ProofOrder) => { o.tasks[0]!.state = "approved"; o.tasks[0]!.actionable = false; },
    (o: ProofOrder) => { o.tasks[0]!.current_version!.comments = [{ text: "New feedback", created_at: timestamp, attachment: null }]; },
    (o: ProofOrder) => { o.tasks.push({ ...o.tasks[0]!, task_id: "shared", order_line_id: "other" }); }
  ]) { const f = fixture(); mutate(f.snapshot); await assert.rejects(f.prepare()); assert.equal(f.sends.length, 0); }
  for (const entries of [request.entries.slice(0, 1), request.entries.map(e => ({ ...e, quantity: 0 })), request.entries.map(e => ({ ...e, quantity: 4 })), [request.entries[0]!, request.entries[0]!]]) {
    await assert.rejects(fixture().prepare({ ...request, entries }));
  }
});
test("idempotent prepare returns the same receipt; changed quantities conflict; responses omit private bindings", async () => {
  const f = fixture(); const a = await f.prepare(); const b = await f.prepare(); assert.deepEqual(a, b); assert.equal(f.reads, 1);
  assert.equal(JSON.stringify(a).includes("pgrant_test"), false);
  assert.equal(JSON.stringify(a).includes("Print these quantities"), false);
  await assert.rejects(f.prepare({ ...request, entries: request.entries.map(e => ({ ...e, quantity: 5 })) }));
  await assert.rejects(f.prepare({ ...request, idempotency_key: "allocation-test-key-0002" }));
});
test("concurrent advance and lost response send exactly once; repeated checks never resend", async () => {
  const f = fixture(); await f.prepare(); await Promise.allSettled([f.advance(), f.advance()]);
  assert.equal(f.sends.length, 1); assert.equal(f.saved.entries[0]!.state, "submitted");
  for (let i = 0; i < 3; i++) await f.advance();
  assert.equal(f.sends.length, 1);
  assert.deepEqual(f.sends[0], { approve: true, userName: "VORNAN_PROOF", approveQuantity: 4, comment: request.note });
});
test("only explicit APPROVED with exact quantity confirms; reference or wrong quantity cannot advance", async () => {
  const f = fixture(); await f.prepare(); await f.advance();
  const task = f.snapshot.tasks[0]!;
  for (const [state, status, quantity] of [["reference", "APPROVED", 4], ["approved", "PENDING", 4], ["approved", "APPROVED", 10]] as const) {
    task.state = state; task.current_version!.approval_status = status; task.quantity = quantity;
    assert.equal((await f.advance()).state, "checking"); assert.equal(f.sends.length, 1);
  }
});
test("confirms Lift split by attachment, then sends remaining quantity and completes", async () => {
  const f = fixture(); await f.prepare(); await f.advance();
  const first = f.snapshot.tasks[0]!;
  first.task_id = "ptask_split"; first.order_line_id = "456"; first.line_number = "2"; first.quantity = 4; first.state = "approved"; first.actionable = false; first.current_version!.approval_status = "APPROVED";
  f.snapshot.tasks[1]!.quantity = 6;
  assert.equal((await f.advance()).state, "ready"); assert.equal(f.sends.length, 1);
  assert.equal((await f.advance()).state, "checking"); assert.equal(f.sends.length, 2);
  const second = f.snapshot.tasks[1]!; second.state = "approved"; second.actionable = false; second.current_version!.approval_status = "APPROVED";
  f.snapshot.health = "complete";
  const result = await f.advance(); assert.equal(result.state, "completed"); assert.deepEqual(result.entries.map(e => e.state), ["confirmed", "confirmed"]);
  await f.advance(); assert.equal(f.sends.length, 2);
});
test("a complete order cannot start an unsent approval or fabricate confirmation", async () => {
  const f = fixture(); await f.prepare(); f.snapshot.health = "complete";
  assert.equal((await f.advance()).state, "paused"); assert.equal(f.sends.length, 0);
  const checking = fixture(); await checking.prepare(); await checking.advance(); checking.snapshot.health = "complete";
  assert.equal((await checking.advance()).state, "checking"); assert.equal(checking.sends.length, 1);
});
test("evidence persistence trouble preserves checking state and retries only readback", async () => {
  const f = fixture(); await f.prepare(); await f.advance();
  const task = f.snapshot.tasks[0]!; task.state = "approved"; task.quantity = 4; task.current_version!.approval_status = "APPROVED";
  for (const failure of ["conflict", "outage"] as const) {
    f.evidenceFailure(failure);
    assert.equal((await f.advance()).state, "checking"); assert.equal(f.sends.length, 1);
  }
  f.evidenceFailure("none"); assert.equal((await f.advance()).state, "ready"); assert.equal(f.sends.length, 1);
});
test("changed artwork, feedback, quantities or cancelled order pause before any PUT", async () => {
  for (const mutate of [
    (o: ProofOrder) => { o.tasks[1]!.current_version!.version_id = "new-art"; },
    (o: ProofOrder) => { o.tasks[1]!.current_version!.feedback_fingerprint = "new-feedback"; },
    (o: ProofOrder) => { o.tasks[0]!.quantity = 11; },
    (o: ProofOrder) => { o.tasks[1]!.quantity = 11; },
    (o: ProofOrder) => { o.tasks[1]!.version++; },
    (o: ProofOrder) => { o.lines[0]!.cancelled = true; },
    (o: ProofOrder) => { o.health = "cancelled"; }
  ]) { const f = fixture(); await f.prepare(); mutate(f.snapshot); assert.equal((await f.advance()).state, "paused"); assert.equal(f.sends.length, 0); }
});
test("read outage preserves optimistic state and permission is checked again before advancement", async () => {
  const f = fixture(); await f.prepare(); await f.advance(); f.outage(); assert.equal((await f.advance()).state, "checking"); assert.equal(f.sends.length, 1);
  f.disable(); await assert.rejects(f.advance()); assert.equal(f.sends.length, 1);
});
test("receipt visibility is bound to customer, grant and participant", async () => {
  const f = fixture(); await f.prepare();
  for (const identity of [{ ...session, grant_id: "other" }, { ...session, participant_id: "other" }, { ...session, capability: { ...session.capability!, proof_customer_id: "999" } }]) {
    assert.deepEqual(await f.service.list({ ...f.context, session: identity }), []);
    await assert.rejects(f.service.advance({ ...f.context, session: identity, batch_id: f.saved.batch_id }));
  }
});
});

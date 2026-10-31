import assert from "node:assert/strict";
import test from "node:test";
import type { PathfinderCustomerWorkspace, PublicOrderStatusSnapshot } from "../src/store.js";
import { statusProofingEnabled } from "../src/status-proof-capability.js";

function workspace(mode: "review" | "view_only" | "disabled" = "review") {
  return { customer:{lift_customer_id:"1249"}, proof_capability_policy:{
    access_mode:mode, updated_at:"2026-10-31T12:00:00Z",order_overrides:[],
    customer_identity:{proof_customer_id:"1249",verified_order_number:"A0233367",verified_at:"2026-10-31T12:00:00Z"}
  }} as unknown as PathfinderCustomerWorkspace;
}
const snapshot={order_number:"A0233367",live_order:{order_number:"A0233367",customer_id:1249}} as PublicOrderStatusSnapshot;
test("verified capability supports both view-only and review without granting authorization",()=>{
  assert.equal(statusProofingEnabled(snapshot,workspace(),"1249"),true);
  assert.equal(statusProofingEnabled(snapshot,workspace("view_only"),"1249"),true);
  assert.equal(statusProofingEnabled(snapshot,workspace("disabled"),"1249"),false);
});
test("unknown policy and customer/order identity mismatches fail closed",()=>{
  assert.equal(statusProofingEnabled(snapshot,undefined,"1249"),false);
  assert.equal(statusProofingEnabled(snapshot,workspace(),undefined),false);
  assert.equal(statusProofingEnabled(snapshot,workspace(),"175332"),false);
  assert.equal(statusProofingEnabled({...snapshot,live_order:null},workspace(),"1249"),false);
  for (const change of [{customer_id:175332},{order_number:"A0234529"}])
    assert.equal(statusProofingEnabled({...snapshot,live_order:{...snapshot.live_order!,...change}},workspace(),"1249"),false);
  const missing=workspace(); missing.proof_capability_policy.customer_identity=null;
  assert.equal(statusProofingEnabled(snapshot,missing,"1249"),false);
  const invalid=workspace(); invalid.proof_capability_policy.customer_identity!.verified_at="invalid";
  assert.equal(statusProofingEnabled(snapshot,invalid,"1249"),false);
});
test("exact order overrides win in both directions; other orders do not leak",()=>{
  const w=workspace();
  w.proof_capability_policy.order_overrides=[{order_number:"A0233367",access_mode:"disabled",review_experience:"simple",updated_at:"2026-10-31T13:00:00Z",updated_by:"test"}];
  assert.equal(statusProofingEnabled(snapshot,w,"1249"),false);
  w.proof_capability_policy.access_mode="disabled";
  w.proof_capability_policy.order_overrides[0]!.access_mode="review";
  assert.equal(statusProofingEnabled(snapshot,w,"1249"),true);
  w.proof_capability_policy.order_overrides[0]!.order_number="A0234529";
  assert.equal(statusProofingEnabled(snapshot,w,"1249"),false);
});

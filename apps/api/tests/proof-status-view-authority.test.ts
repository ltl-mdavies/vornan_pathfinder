import assert from "node:assert/strict";
import test from "node:test";
import type { ProofAccessGrant } from "@pathfinder/proof-domain";
import type { OrderStatusTokenRecord } from "../src/store.ts";
import { statusParentAllows } from "../src/proof/status-view-authority.ts";
const now = new Date("2026-10-31T16:00:00Z");
const parent: OrderStatusTokenRecord = {token_hash:"a".repeat(64),order_key:"qa",customer_id:"1249",job_id:"qa",order_number:"A0233367",status:"Active",created_at:now.toISOString(),updated_at:now.toISOString(),expires_at:"2026-10-31T17:00:00Z",expires_at_epoch:1793466000};
const grant = {scope:"view",order_number:parent.order_number,expires_at:"2026-10-31T16:15:00Z",status_origin:{token_hash:parent.token_hash,order_key:parent.order_key,customer_id:"1249"}} as ProofAccessGrant;
test("Status viewing follows exact parent membership, expiry, revocation and policy",()=>{
  assert.equal(statusParentAllows(grant,parent,"review_link",now),true);
  for(const replacement of [null,{...parent,status:"Revoked" as const},{...parent,expires_at:now.toISOString()},
    {...parent,expires_at:"invalid"},{...parent,token_hash:"b".repeat(64)},{...parent,order_key:"different"},
    {...parent,order_number:"A0000000"},{...parent,customer_id:"175332"},
    {...parent,orders:[{order_key:"other",customer_id:"1249",order_number:parent.order_number,job_id:"qa"}]}]) {
    assert.equal(statusParentAllows(grant,replacement,"review_link",now),false);
  }
  for(const visibility of [undefined,"off","status_only"]) assert.equal(statusParentAllows(grant,parent,visibility,now),false);
  assert.equal(statusParentAllows({...grant,scope:"review"},parent,"review_link",now),false);
  assert.equal(statusParentAllows({...grant,kind:"delegated"},parent,"review_link",now),false);
  assert.equal(statusParentAllows({...grant,expires_at:"2026-10-31T18:00:00Z"},parent,"review_link",now),false);
  assert.equal(statusParentAllows({...grant,expires_at:"invalid"},parent,"review_link",now),false);
  assert.equal(statusParentAllows({...grant,expires_at:now.toISOString()},parent,"review_link",now),false);
});

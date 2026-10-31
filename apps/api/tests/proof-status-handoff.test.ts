import assert from "node:assert/strict";
import test from "node:test";
import { statusHandoffMatches, statusHandoffUrl } from "../src/proof/status-handoff.ts";

const candidate = { enabled: true, customerId: "1249", orderNumber: "A0233367", pending: 1,
  reviewRequired: true, healthy: true, cancelled: false, visibility: "review_link" };
test("Status handoff is default-off and restricted to eligible LTL Demo pending orders", () => {
  assert.equal(statusHandoffUrl(candidate), "https://proof.vornan.co/#/status/A0233367");
  for (const override of [{enabled:false},{customerId:"175332"},{customerId:""},{pending:0},
    {pending:NaN},{pending:1.5},{reviewRequired:false},{healthy:false},{cancelled:true},
    {visibility:"status_only"},{visibility:"off"},{orderNumber:"A0233367?other=1"}]) {
    assert.equal(statusHandoffUrl({...candidate,...override}),null);
  }
});
test("handoff cannot switch orders or customers or bypass the rollout gate", () => {
  assert.equal(statusHandoffMatches(true,"A0233367","A0233367","A0233367","1249"),true);
  for(const expected of [undefined,null,[],["A0233367"],"A0233368","A0233367/extra"]) {
    assert.equal(statusHandoffMatches(true,expected,"A0233367","A0233367","1249"),false);
  }
  assert.equal(statusHandoffMatches(false,"A0233367","A0233367","A0233367","1249"),false);
  assert.equal(statusHandoffMatches(true,"A0233367","A0233368","A0233367","1249"),false);
  assert.equal(statusHandoffMatches(true,"A0233367","A0233367","A0233368","1249"),false);
  assert.equal(statusHandoffMatches(true,"A0233367","A0233367","A0233367","175332"),false);
});

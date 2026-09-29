import assert from 'node:assert/strict';
import test from 'node:test';
import { collectLiftShippingReports, captureCollectedLiftShipping, type ShippingCollectorConfig } from '../src/json-intake/lift-shipping-collector.js';
import type { Receipt, ReceiptStore } from '../src/json-intake/local-store.js';
import { digest } from '../src/webhooks/contract.js';
import { stableJson } from '../src/json-intake/adapter.js';
const time=Date.parse('2026-09-29T12:00:00.000Z');
const scope={customer_id:'synthetic',integration_id:'synthetic',store:'test',environment:'test' as const};
const receipt={receipt_id:'synthetic-receipt',revision:0,identity:scope,confirmation:{order_number:'A0000001',evidence_sha256:'a'.repeat(64)}} as Receipt;
const config=():ShippingCollectorConfig=>({enabled:true,scope,pagination:{order:{kind:'single_response',review_reference:'synthetic-review'},packages:{kind:'offset',page_size:1},shipping:{kind:'single_response',review_reference:'synthetic-review'}}});
const page=(extra:Record<string,unknown>={})=>({rowset:[{ORDER_NUMBER:'A0000001'}],...extra});
const response=(obj:unknown)=>new Response(JSON.stringify(obj),{headers:{'content-type':'application/json'}});
function fakeFetch(seen:Array<{url:URL;init:RequestInit}>) {
  return (async (input:URL|RequestInfo,init?:RequestInit)=>{
    const url=new URL(String(input));seen.push({url,init:init!});
    if(url.pathname.includes('PackageDetails')){
      const offset=Number(url.searchParams.get('offset'));
      return response({rowset:[{ORDER_NUMBER:'A0000001',BOX_NUMBER:offset+1}],offset,count:1,hasMore:offset===0});
    }
    return response(page());
  }) as typeof fetch;
}
test('collector scopes fixed endpoints, authenticates in headers, follows verified offsets and returns no credentials',async()=>{
  const seen:Array<{url:URL;init:RequestInit}>=[];
  const result=await collectLiftShippingReports(receipt,config(),{now:()=>time,credentials:async()=>({user:'synthetic-user',password:'synthetic-secret'}),fetch:fakeFetch(seen)});
  assert.equal(seen.length,4);assert.equal((result.reports.packages as any).rowset.length,2);assert.equal(result.reports.all_pages_read,true);
  for(const call of seen){
    assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');
    assert.equal(call.url.searchParams.get(call.url.pathname.includes('ShippingReport')?'p1':'p0'),'A0000001');
    assert.ok((call.init.headers as any).Authorization.startsWith('Basic '));
    assert.ok(!call.url.href.includes('secret'));
  }
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
  const {evidence_sha256,...evidence}=result;assert.equal(digest(stableJson(evidence)),evidence_sha256);
});
test('disabled, unbound and unreviewed collection performs no fetch',async()=>{
  let calls=0;const deps={credentials:async()=>null,fetch:(async()=>{calls++;return response(page());}) as typeof fetch};
  await assert.rejects(collectLiftShippingReports(receipt,{...config(),enabled:false},deps));
  await assert.rejects(collectLiftShippingReports(receipt,{...config(),scope:{...scope,customer_id:'other'}},deps));
  const c=config();c.pagination.order={kind:'single_response',review_reference:''};
  await assert.rejects(collectLiftShippingReports(receipt,c,deps));assert.equal(calls,0);
});
test('incomplete, repeated, cross-order, redirected and oversized pages fail without a partial result',async()=>{
  const bad:Array<()=>Response>=[
    ()=>response(page()), // offset mode requires explicit completion metadata
    ()=>response(page({hasMore:true,offset:0,count:1})), // second page repeats
    ()=>response({rowset:[{ORDER_NUMBER:'A0000002'}],hasMore:false}),
    ()=>new Response('',{status:302,headers:{location:'https://other.invalid'}}),
    ()=>new Response('x'.repeat(5*1024*1024+1),{headers:{'content-type':'application/json'}}),
    ()=>response(page({hasMore:false,has_more:true})),
    ()=>response(page({hasMore:false,offset:99}))
  ];
  for(const make of bad){const c=config();c.pagination.order={kind:'offset',page_size:1};c.pagination.shipping={kind:'offset',page_size:1};
    await assert.rejects(collectLiftShippingReports(receipt,c,{credentials:async()=>null,fetch:(async()=>make()) as typeof fetch,now:()=>time}),/^Error: Lift shipping collection failed; no complete report set available$/);
  }
});
test('collection duration and downstream stale or modified evidence are rejected and held',async()=>{
  let clock=0;
  await assert.rejects(collectLiftShippingReports(receipt,config(),{credentials:async()=>null,fetch:fakeFetch([]),now:()=>time+(clock++?31000:0)}));
  const result=await collectLiftShippingReports(receipt,config(),{credentials:async()=>null,fetch:fakeFetch([]),now:()=>time});
  for(const {edit,checkedAt} of [
    {edit:(_r:typeof result)=>{},checkedAt:time+60001},
    {edit:(r:typeof result)=>{(r.reports.packages as any).rowset=[];},checkedAt:time}
  ]){
    const candidate=structuredClone(result);edit(candidate);let current=structuredClone(receipt),reviews=0;
    const store={get:async()=>structuredClone(current),compareAndSet:async(before:Receipt,after:Receipt)=>{assert.equal(before.revision,current.revision);current=after;return true;}} as ReceiptStore;
    await assert.rejects(captureCollectedLiftShipping(store,receipt.receipt_id,candidate,async()=>{reviews++;throw new Error('must not load');},()=>checkedAt),/verification failed/);
    assert.equal(reviews,0);assert.equal(current.shipping_review?.code,'SOURCE_UNVERIFIED');
  }
});

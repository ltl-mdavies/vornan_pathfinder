import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stickerPressV1, sha256 } from '../src/json-intake/adapter.js';
import { LocalReceiptStore, type Receipt } from '../src/json-intake/local-store.js';
import { prepareLiftShippingSnapshot, captureLiftShippingReports, type LiftShippingReports, type LiftShippingReview } from '../src/json-intake/lift-shipping-source.js';
import { projectShipping, shippingEvents } from '../src/json-intake/shipping-events.js';
import { currentReceiptEvent } from '../src/json-intake/webhook-events.js';
import { collectLiftShippingReports, captureCollectedLiftShipping } from '../src/json-intake/lift-shipping-collector.js';

const sample=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
function fixture(quantities=[2,1,1]) {
  const payload=structuredClone(sample);
  payload.lines=payload.lines.slice(0,quantities.length).map((l:any,i:number)=>({...l,quantity:quantities[i],area_sq_in:Number((l.print_w_in*l.print_h_in*quantities[i]).toFixed(2))}));
  const identity={customer_id:'synthetic',customer_name:'Synthetic',integration_id:'test-integration',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
  const adapted=stickerPressV1.validate(payload,identity),now='2026-09-29T12:00:00.000Z';
  const receipt={version:1,revision:0,receipt_id:`rcpt_${sha256('shipping-adapter-fixture')}`,identity,adapted,
    fingerprint:adapted.fingerprint,raw_sha256:sha256(JSON.stringify(payload)),received_at:now,updated_at:now,
    signal:{customer_id:identity.customer_id},deadline:now,work:'complete',claim:null,assets:[],issues:[],asset_status:'pending',
    confirmation:{job_id:'synthetic-job',submit_attempt_id:'synthetic-submit',order_number:'A0000001',confirmed_at:now,intake_revision:1,evidence_sha256:'a'.repeat(64)}} as Receipt;
  const review:LiftShippingReview={scope:{customer_id:identity.customer_id,integration_id:identity.integration_id,store:identity.store,environment:'test'},
    receipt_id:receipt.receipt_id,lift_order_number:'A0000001',target_customer_id:'999999',confirmation_sha256:'a'.repeat(64),
    line_bindings:payload.lines.map((l:any,i:number)=>({order_line_id:String(i+1),external_line_id:l.external_line_id})),
    package_identity_review:'synthetic-policy-review',source_revision:1,observed_at:now,packages:[]};
  const reports:LiftShippingReports={all_pages_read:true,
    order:{rowset:[{ORDER_NUMBER:'A0000001',CUSTOMER_ID:'999999',EXT_ID:adapted.canonical.order.external_order_id,
      LINES:quantities.map((q,i)=>({ORDER_LINE_ID:i+1,QUANTITY:q}))}]},
    shipping:{rowset:quantities.map((_,i)=>({ORDER_NUMBER:'A0000001',ORDER_LINE_ID:i+1,ACTUAL_SHIP_DATE:i?'2026-09-28':null,TRACKING_NUMBER:'MASTER-ONLY'}))},
    packages:{rowset:[]}};
  const row=(line:number,quantity:number,box:number)=>({ORDER_NUMBER:'A0000001',ORDER_LINE_ID:line,QUANTITY:quantity,
    SHIPPING_ID:123,BOX_NUMBER:box,SHIP_METHOD:'Source service',PACKAGE_TRACKING_NUMBER:`SYNTHETIC-${box}`});
  const approve=()=>{review.packages=prepareLiftShippingSnapshot(receipt,reports,review).evidence.map(p=>({
    package_id:p.package_id,evidence_sha256:p.evidence_sha256,carrier:'Reviewed Carrier',service:'Reviewed Service',label_source:'purchased',
    status:'shipped',dispatch_evidence:'synthetic-operator-dispatch',shipped_at:null,delivered_at:null,source_updated_at:now}));};
  return {receipt,review,reports,row,approve};
}
test('fresh collected reports capture reviewed partial shipments without a completion event',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lift-collected-shipping-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=fixture(),store=new LocalReceiptStore(root);await store.create(h.receipt);
  (h.reports.packages as any).rowset=[h.row(2,1,1),h.row(3,1,2)];h.approve();
  const pagination={kind:'single_response' as const,review_reference:'synthetic-reviewed-report-contract'};
  const collected=await collectLiftShippingReports(h.receipt,{enabled:true,scope:h.review.scope,pagination:{order:pagination,packages:pagination,shipping:pagination}},{
    credentials:async()=>null,now:()=>Date.parse(h.review.observed_at),
    fetch:(async input=>{
      const url=String(input),body=url.includes('PackageDetails')?h.reports.packages:url.includes('ShippingReport')?h.reports.shipping:h.reports.order;
      return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
    }) as typeof fetch
  });
  let reads=0;
  const saved=await captureCollectedLiftShipping(store,h.receipt.receipt_id,collected,async(r,hash)=>{
    reads++;assert.equal(r.receipt_id,h.receipt.receipt_id);assert.equal(hash,collected.evidence_sha256);return h.review;
  },()=>Date.parse(h.review.observed_at));
  assert.equal(reads,2);assert.equal(projectShipping(saved).fulfillment_status,'partially_shipped');
  const events=shippingEvents(saved);assert.equal(events.length,2);
  assert.ok(events.every(e=>e.envelope.event_type==='shipment.updated'));
});
test('partial Lift reports retain dates without inventing dispatch, then map reviewed packages to external lines',()=>{
  const h=fixture();(h.reports.packages as any).rowset=[h.row(2,1,1),h.row(3,1,2)];
  let p=prepareLiftShippingSnapshot(h.receipt,h.reports,h.review);
  assert.equal(p.snapshot,null);assert.equal(p.gaps.length,2);
  assert.equal(p.evidence[0].lines[0].actual_ship_date,'2026-09-28');
  h.approve();p=prepareLiftShippingSnapshot(h.receipt,h.reports,h.review);
  assert.equal(projectShipping(h.receipt,p.snapshot!).fulfillment_status,'partially_shipped');
  assert.equal(p.snapshot!.packages.length,2);assert.equal(p.snapshot!.packages[0].shipped_at,null);
  assert.ok(p.snapshot!.packages.every(pkg=>pkg.tracking_number!=='MASTER-ONLY'));
  assert.equal(shippingEvents({...h.receipt,shipping:p.snapshot!}).filter(e=>e.envelope.event_type==='order.shipped').length,0);
});
test('one shipping ID can identify seven boxes; duplicate allocation rows do not inflate totals',()=>{
  const h=fixture([1,1,1,1]);
  const rows=[h.row(1,0.5,1),h.row(1,0.5,2),h.row(2,0.5,3),h.row(2,0.5,4),h.row(3,0.5,5),h.row(3,0.5,6),h.row(4,1,7)];
  (h.reports.packages as any).rowset=[...rows,structuredClone(rows[0])];h.approve();
  const p=prepareLiftShippingSnapshot(h.receipt,h.reports,h.review);
  assert.equal(p.snapshot!.packages.length,7);assert.equal(projectShipping(h.receipt,p.snapshot!).all_items_shipped,true);
  assert.equal(new Set(p.snapshot!.packages.map(p=>p.tracking_number)).size,7);
});
test('changed tracking invalidates review while row order and private report fields do not change evidence',()=>{
  const h=fixture();const rows=[h.row(2,1,1),h.row(3,1,2)];(h.reports.packages as any).rowset=rows;h.approve();
  const before=prepareLiftShippingSnapshot(h.receipt,h.reports,h.review);
  (h.reports.packages as any).rowset=rows.reverse().map(r=>({...r,NEGOTIATED_RATE:123,PRIVATE_URL:'https://private.invalid/secret'}));
  assert.deepEqual(prepareLiftShippingSnapshot(h.receipt,h.reports,h.review),before);
  (h.reports.packages as any).rowset[0].PACKAGE_TRACKING_NUMBER='CORRECTED';
  const changed=prepareLiftShippingSnapshot(h.receipt,h.reports,h.review);
  assert.equal(changed.snapshot,null);assert.ok(changed.gaps.some(g=>g.code==='PACKAGE_EVIDENCE_CHANGED'));
  assert.deepEqual(changed.evidence.map(p=>p.package_id),before.evidence.map(p=>p.package_id));
  assert.ok(!JSON.stringify(changed).includes('private.invalid'));
});
test('incomplete, cross-order/customer, ambiguous and contradictory source data reject',()=>{
  const changes:Array<(h:ReturnType<typeof fixture>)=>void>=[
    h=>h.reports.all_pages_read=false,
    h=>(h.reports.packages as any).hasMore=true,
    h=>(h.reports.order as any).rowset[0].CUSTOMER_ID='other',
    h=>(h.reports.order as any).rowset[0].EXT_ID='other',
    h=>(h.reports.order as any).rowset[0].LINES[0].QUANTITY=99,
    h=>(h.reports.shipping as any).rowset.pop(),
    h=>(h.reports.shipping as any).rowset[0].ACTUAL_SHIP_DATE='2026-02-30',
    h=>(h.reports.packages as any).rowset[0].ORDER_NUMBER='A0000002',
    h=>(h.reports.packages as any).rowset.push(h.row(2,0.5,1)),
    h=>h.review.line_bindings.push({...h.review.line_bindings[0]}),
    h=>h.review.scope.customer_id='other'
  ];
  for(const change of changes){const h=fixture();(h.reports.packages as any).rowset=[h.row(2,1,1)];change(h);assert.throws(()=>prepareLiftShippingSnapshot(h.receipt,h.reports,h.review));}
});
test('prepaid label review remains pending until separate dispatch evidence is recorded',()=>{
  const h=fixture();(h.reports.packages as any).rowset=[h.row(2,1,1)];h.approve();
  Object.assign(h.review.packages[0],{label_source:'customer_prepaid',status:'pending',dispatch_evidence:null});
  const p=prepareLiftShippingSnapshot(h.receipt,h.reports,h.review);
  assert.equal(projectShipping(h.receipt,p.snapshot!).all_items_shipped,false);
  assert.equal(shippingEvents({...h.receipt,shipping:p.snapshot!}).length,0);
  h.review.package_identity_review=null;assert.equal(prepareLiftShippingSnapshot(h.receipt,h.reports,h.review).snapshot,null);
});
test('report adapter connects to receipt capture and unresolved changed evidence blocks old pending events',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lift-shipping-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=fixture(),store=new LocalReceiptStore(root);await store.create(h.receipt);
  (h.reports.packages as any).rowset=[h.row(2,1,1)];h.approve();
  const load=async()=>({reports:h.reports,review:h.review});
  const saved=await captureLiftShippingReports(store,h.receipt.receipt_id,load),event=shippingEvents(saved)[0];
  assert.equal(await currentReceiptEvent(store)(event),true);
  assert.equal((await captureLiftShippingReports(store,h.receipt.receipt_id,load)).revision,saved.revision);
  (h.reports.packages as any).rowset[0].PACKAGE_TRACKING_NUMBER='CORRECTED';h.review.source_revision=2;
  await assert.rejects(captureLiftShippingReports(store,h.receipt.receipt_id,load),/review|Incomplete/);
  assert.ok((await store.get(h.receipt.receipt_id))?.shipping_review);
  assert.equal(await currentReceiptEvent(store)(event),false);
});

test('source failures block previously queued complete-shipment events without exposing upstream errors',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lift-shipping-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=fixture([1,1,1]),store=new LocalReceiptStore(root);await store.create(h.receipt);
  (h.reports.packages as any).rowset=[h.row(1,1,1),h.row(2,1,2),h.row(3,1,3)];h.approve();
  const saved=await captureLiftShippingReports(store,h.receipt.receipt_id,async()=>({reports:h.reports,review:h.review}));
  const completion=shippingEvents(saved).find(e=>e.envelope.event_type==='order.shipped')!;
  assert.equal(await currentReceiptEvent(store)(completion),true);
  await assert.rejects(captureLiftShippingReports(store,h.receipt.receipt_id,async()=>{throw new Error('https://private.invalid/?secret=hidden');}),/^Error: Lift shipping source verification failed; review required$/);
  assert.equal((await store.get(h.receipt.receipt_id))?.shipping_review?.code,'SOURCE_UNVERIFIED');
  assert.equal(await currentReceiptEvent(store)(completion),false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stickerPressV1, sha256, stableJson } from '../src/json-intake/adapter.js';
import { LocalReceiptStore, type Receipt } from '../src/json-intake/local-store.js';
import { retainPrepaidLabel, publishPrepaidLabel, applyPrepaidOrderAttachment, PREPAID_INSTRUCTION } from '../src/json-intake/prepaid-label.js';
import { generateLiftPayload } from '@pathfinder/lift-adapter';
import { buildJsonLiftPreview } from '../src/json-intake/lift-preview.js';
import { buildPrepaidSubmitBinding, preflightSubmitDocuments } from '../src/json-intake/prepaid-submit.js';
import { buildSubmitIntegritySnapshot, assertReviewedSubmitIntegrity } from '../src/submit-integrity.js';
import type { ProcessingJobPreview } from '../src/store.js';

const sample=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const bytes=Buffer.from('%PDF-1.7\nsynthetic label only\n%%EOF');
const now=new Date('2026-09-29T12:00:00Z'),required='2026-10-01T12:00:00Z';
async function fixture(t: {after(fn:()=>Promise<unknown>):unknown}) {
  const root=await mkdtemp(join(tmpdir(),'prepaid-label-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const payload=structuredClone(sample);payload.shipping.label_url='https://labels.example.test/private-label?token=secret';
  const identity={customer_id:'synthetic',customer_name:'Synthetic',integration_id:'test-integration',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
  const adapted=stickerPressV1.validate(payload,identity);
  const receipt={version:1,revision:0,receipt_id:`rcpt_${sha256('prepaid-fixture')}`,identity,adapted,fingerprint:adapted.fingerprint,raw_sha256:sha256(JSON.stringify(payload)),
    received_at:now.toISOString(),updated_at:now.toISOString(),signal:{customer_id:identity.customer_id},deadline:now.toISOString(),work:'complete',claim:null,assets:[],issues:[],asset_status:'pending'} as Receipt;
  const store=new LocalReceiptStore(root);await store.create(receipt);let downloads=0;
  const transport={read:async()=>{downloads++;return bytes;},retain:store.retain.bind(store),readRetained:store.readRetained.bind(store)};
  return {receipt,store,transport,downloads:()=>downloads};
}
function publicationHarness(receipt:Receipt) {
  const objects=new Map<string,any>(),calls:string[]=[];
  const sender={send:async(command:any)=>{
    const {Key,Body}=command.input,name=command.constructor.name;calls.push(name);
    if(name==='GetObjectCommand'){const object=objects.get(Key);if(!object)throw {name:'NoSuchKey'};return {Body:{transformToString:async()=>object.Body}};}
    if(name==='PutObjectCommand'){if(objects.has(Key))throw {name:'PreconditionFailed'};objects.set(Key,command.input);return {};}
    if(name==='HeadObjectCommand'){const object=objects.get(Key);return {VersionId:'version-1',LastModified:now,ContentLength:object.ContentLength,Metadata:object.Metadata};}
    throw new Error('Unexpected command');
  }};
  const config={enabled:true,scope:receipt.prepaid_label!.scope,bucket_name:'synthetic-delivery',manifest_bucket_name:'synthetic-private',retention_days:14};
  const review={evidence_sha256:sha256(stableJson(receipt.prepaid_label)),reference:'synthetic-label-review',required_until:required};
  const fetch=(async(input:any,init:any)=>{
    assert.equal(init.redirect,'error');assert.equal(init.method,'GET');
    const response=new Response(bytes);Object.defineProperty(response,'url',{value:String(input)});return response;
  }) as typeof globalThis.fetch;
  return {objects,calls,config,review,sender,fetch,now:()=>now};
}
test('retains a label once, preserves receipt state and reuses verified private bytes',async t=>{
  const h=await fixture(t),saved=await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport);
  assert.equal(saved.revision,1);assert.equal(saved.prepaid_label?.sha256,sha256(bytes));assert.equal(saved.shipping,undefined);
  assert.equal(saved.prepaid_label?.document_role,'prepaid_label');assert.ok(!JSON.stringify(saved.prepaid_label).includes('token='));
  assert.equal((await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport)).revision,1);assert.equal(h.downloads(),1);
  await assert.rejects(retainPrepaidLabel(h.store,h.receipt.receipt_id,{...h.transport,readRetained:async()=>Buffer.from('corrupt')}),/bytes mismatch/);
});
test('rejects non-PDF and over-limit input without recording a label',async t=>{
  const h=await fixture(t);
  for(const invalid of [Buffer.from('not a PDF'),Buffer.alloc(5*1024*1024+1)]){
    await assert.rejects(retainPrepaidLabel(h.store,h.receipt.receipt_id,{...h.transport,read:async()=>invalid}),/bounded PDF/);
    assert.equal((await h.store.get(h.receipt.receipt_id))?.revision,0);
  }
});
test('publishes immutably and passes controlled attachment URL through the existing Lift mapper',async t=>{
  const h=await fixture(t),receipt=await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport),p=publicationHarness(receipt);
  const args={...p,receipt,readRetained:h.transport.readRetained};
  const publication=await publishPrepaidLabel(args),again=await publishPrepaidLabel(args);
  assert.deepEqual(publication,again);assert.equal(p.calls.filter(c=>c==='PutObjectCommand').length,2);
  const canonical=applyPrepaidOrderAttachment(receipt,publication,required,now);
  const lift=generateLiftPayload(canonical,{jobId:'synthetic',canonicalOrderId:'synthetic',extIdStrategy:'customer_order_id'});
  assert.equal(lift.order.order_attachment,publication.direct_url);assert.ok(lift.order.order_note?.includes(PREPAID_INSTRUCTION));
  assert.equal(canonical.order.shipping_policy.label_url,null);
  assert.ok(receipt.adapted.canonical.order.shipping_policy.label_url?.includes('token=secret'));
  assert.equal(receipt.shipping,undefined);assert.ok(!JSON.stringify(lift).includes('token=secret'));
  assert.equal(receipt.adapted.canonical.order.order_attachment??null,null);
  const preview=buildJsonLiftPreview(receipt,{scope:p.config.scope,revision:'synthetic-review',review_reference:'synthetic',customer:null,product_identifier:'lift_unit_number',products:[]},
    {publication,required_until:required},now);
  assert.equal(preview.candidate.order.order_attachment,publication.direct_url);
  assert.equal(preview.submission_allowed,false);
  assert.ok(!preview.gaps.some(g=>g.code==='PREPAID_LABEL_DELIVERY_UNCONFIGURED'));
  assert.equal(preview.evidence.shipping.prepaid_label_supplied,true);
  assert.ok(!JSON.stringify(preview).includes('token=secret'));
});
test('disabled, mismatched, unreviewed or corrupted evidence cannot publish',async t=>{
  const h=await fixture(t),receipt=await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport),p=publicationHarness(receipt);
  const args={...p,receipt,readRetained:h.transport.readRetained};
  await assert.rejects(publishPrepaidLabel({...args,config:{...p.config,enabled:false}}));
  await assert.rejects(publishPrepaidLabel({...args,config:{...p.config,scope:{...p.config.scope,customer_id:'other'}}}));
  await assert.rejects(publishPrepaidLabel({...args,review:{...p.review,evidence_sha256:'wrong'}}));
  await assert.rejects(publishPrepaidLabel({...args,readRetained:async()=>Buffer.from('bad bytes')}));
  const other=structuredClone(receipt);other.receipt_id='other';
  await assert.rejects(publishPrepaidLabel({...args,receipt:other}));assert.equal(p.calls.length,0);
});
test('delivery corruption, redirects, insufficient retention and changed object versions fail closed',async t=>{
  const h=await fixture(t),receipt=await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport);
  for(const kind of ['corrupt','redirect','retention','version']){
    const p=publicationHarness(receipt),args={...p,receipt,readRetained:h.transport.readRetained};
    if(kind==='corrupt')args.fetch=(async input=>{const response=new Response(Buffer.alloc(bytes.length));Object.defineProperty(response,'url',{value:String(input)});return response;}) as typeof fetch;
    if(kind==='redirect')args.fetch=(async()=>new Response('',{status:302})) as typeof fetch;
    if(kind==='retention')args.review={...p.review,required_until:'2026-12-01T00:00:00Z'};
    if(kind==='version'){
      await publishPrepaidLabel(args);const send=p.sender.send;
      args.sender={send:async command=>{const value=await send(command);if((command as any).constructor.name==='HeadObjectCommand')value.VersionId='changed';return value;}};
    }
    await assert.rejects(publishPrepaidLabel(args));
  }
});
test('attachment binding rejects another order, existing grid, expiry and arbitrary URLs',async t=>{
  const h=await fixture(t),receipt=await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport),p=publicationHarness(receipt);
  const publication=await publishPrepaidLabel({...p,receipt,readRetained:h.transport.readRetained});
  const other=structuredClone(receipt);other.adapted.canonical.order.external_order_id='another-order';
  assert.throws(()=>applyPrepaidOrderAttachment(other,publication,required,now));
  const grid=structuredClone(receipt);grid.adapted.canonical.order.order_attachment='https://go.vornan.co/d/grid.xlsx';
  assert.throws(()=>applyPrepaidOrderAttachment(grid,publication,required,now),/Existing order attachment/);
  assert.throws(()=>applyPrepaidOrderAttachment(receipt,{...publication,direct_url:'https://elsewhere.test/label.pdf'},required,now));
  assert.throws(()=>applyPrepaidOrderAttachment(receipt,publication,'2027-01-01T00:00:00Z',now));
});

async function submitFixture(t: {after(fn:()=>Promise<unknown>):unknown}) {
  const h=await fixture(t),receipt=await retainPrepaidLabel(h.store,h.receipt.receipt_id,h.transport),p=publicationHarness(receipt);
  const publication=await publishPrepaidLabel({...p,receipt,readRetained:h.transport.readRetained});
  const canonical=applyPrepaidOrderAttachment(receipt,publication,required,now);
  const payload=generateLiftPayload(canonical,{jobId:'synthetic',canonicalOrderId:'synthetic',extIdStrategy:'customer_order_id'});
  const job={sandbox:true,source_customer_id:receipt.identity.customer_id,canonical_order:canonical,lift_payload:payload,
    prepaid_submit_binding:buildPrepaidSubmitBinding(receipt,publication,required,now),
    submit_request_masked:{endpoint_url:'https://sandbox.example.test/submit',body:payload,headers:{'Content-Type':'application/json',Accept:'application/json',Ext_ID:payload.order.ext_id,User:'synthetic',Password:'********',Company:'synthetic'}}} as ProcessingJobPreview;
  job.submit_integrity=buildSubmitIntegritySnapshot({payload,submit_request_masked:job.submit_request_masked,prepaid_submit_binding:job.prepaid_submit_binding});
  const args={job,publication_enabled:false,delivery_bucket_name:null,s3_sender:p.sender,fetch_impl:p.fetch,now:p.now,
    prepaid_config:{enabled:true,delivery_bucket_name:'synthetic-delivery',manifest_bucket_name:'synthetic-private'}};
  return {h,p,job,args};
}
test('final submit integrity binds the prepaid evidence and fulfillment window without changing legacy fingerprints',async t=>{
  const {job}=await submitFixture(t),fingerprint=job.submit_integrity!.fingerprint;
  assertReviewedSubmitIntegrity({job,reviewed_fingerprint:fingerprint,current_submit_request_masked:job.submit_request_masked});
  job.prepaid_submit_binding!.required_until='2026-10-02T12:00:00Z';
  assert.throws(()=>assertReviewedSubmitIntegrity({job,reviewed_fingerprint:fingerprint,current_submit_request_masked:job.submit_request_masked}),/changed/);
  const base={payload:job.lift_payload,submit_request_masked:job.submit_request_masked,reviewed_at:now.toISOString()};
  assert.deepEqual(buildSubmitIntegritySnapshot(base),buildSubmitIntegritySnapshot({...base,prepaid_submit_binding:undefined}));
});
test('final prepaid preflight verifies existing manifest, version and exact bytes without writes',async t=>{
  const {p,args}=await submitFixture(t);p.calls.length=0;
  const result=await preflightSubmitDocuments(args);
  assert.equal(result.required,true);assert.equal(result.documents[0].document_role,'prepaid_label');
  assert.deepEqual(p.calls,['GetObjectCommand','HeadObjectCommand']);
  await assert.rejects(preflightSubmitDocuments({...args,prepaid_config:{...args.prepaid_config,enabled:false}}),/not enabled/);
  const missing=structuredClone(args.job);delete missing.prepaid_submit_binding;
  await assert.rejects(preflightSubmitDocuments({...args,job:missing}),/missing its reviewed binding/);
  const wrong=structuredClone(args.job);wrong.source_customer_id='other';
  await assert.rejects(preflightSubmitDocuments({...args,job:wrong}),/binding changed/);
});
test('final prepaid preflight blocks corrupt manifests, changed objects, failed downloads and in-flight job changes',async t=>{
  const {p,args}=await submitFixture(t);
  for(const change of ['manifest','object','download','mutation','expiry']){
    const local={...args,job:structuredClone(args.job)};
    if(change==='manifest')local.s3_sender={send:async()=>({Body:{transformToString:async()=>'{"changed":true}'}})};
    if(change==='object')local.s3_sender={send:async command=>{const result=await p.sender.send(command);if((command as any).constructor.name==='HeadObjectCommand')result.VersionId='changed';return result;}};
    if(change==='download')local.fetch_impl=(async()=>new Response('',{status:404})) as typeof fetch;
    if(change==='mutation')local.fetch_impl=(async(input,init)=>{const result=await p.fetch(input,init);local.job.lift_payload.order.order_title='changed';return result;}) as typeof fetch;
    if(change==='expiry')local.now=()=>new Date('2026-10-20T00:00:00Z');
    await assert.rejects(preflightSubmitDocuments(local));
  }
});

test('legacy submit fingerprint retains its fixed compatibility vector',()=>{
  const payload={order:{ext_id:'synthetic'}};
  const result=buildSubmitIntegritySnapshot({payload:payload as any,submit_request_masked:{body:payload} as any,reviewed_at:'2026-09-29T00:00:00Z'});
  assert.equal(result.fingerprint,'cc761c71977e20c93647f60fd28c3a15a77b1bf6272f23cb6578093c1d43d66d');
});
test('prepaid final check aborts and rejects a stalled S3 read at the total deadline',async t=>{
  const {args}=await submitFixture(t);let signal:AbortSignal|undefined;
  t.mock.timers.enable({apis:['setTimeout']});
  const checking=preflightSubmitDocuments({...args,s3_sender:{send:async(_command,options)=>{signal=options?.abortSignal;return new Promise(()=>{});}}});
  const rejection=assert.rejects(checking,/could not be verified/);
  t.mock.timers.tick(30000);await rejection;assert.equal(signal?.aborted,true);
});

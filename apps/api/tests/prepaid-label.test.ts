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

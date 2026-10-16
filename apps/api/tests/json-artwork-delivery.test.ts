import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultLiftTargetConfig} from '@pathfinder/lift-adapter';
import {createSeedOutputTemplate} from '../src/lift-output-templates.js';
import {createStickerPressLiftConfiguration} from '../src/json-intake/stickerpress-lift-configuration.js';
import {prepareReceiptSubmissionJob,assertReceiptJobReplay,stickerPressTestProfile} from '../src/json-intake/submission-job.js';
import {stickerPressV1,sha256} from '../src/json-intake/adapter.js';
import type {Receipt} from '../src/json-intake/local-store.js';
import type {OutputRoute,TargetConfig} from '../src/store.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
function setup(){
 const identity={customer_id:'174094',customer_name:'Silicone Pasture',integration_id:'stickerpress-sandbox',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
 const adapted=stickerPressV1.validate(structuredClone(fixture),identity);
 const receipt={receipt_id:controlledArtworkReceipt,identity,adapted,fingerprint:adapted.fingerprint,revision:4,
 assets:adapted.canonical.lines.map(l=>({external_line_id:l.source_line.external_line_id,sha256:l.source_line.artwork.artwork_sha256,bytes:l.source_line.artwork.bytes,retained_ref:'synthetic-retained-ref',inspection:'metadata_pass'}))} as Receipt;
 const base=createSeedOutputTemplate();
 const route={target_id:'lift-standard-graphics',company_id:'91',output_template_id:base.output_template_id,environment_id:'env-lift-prod',submit_profiles:[stickerPressTestProfile]} as OutputRoute;
 const config=createStickerPressLiftConfiguration(base,route);
 const target={target_id:route.target_id,lift:defaultLiftTargetConfig,output_templates:[base,config.template],environments:[{environment_id:'env-lift-prod',endpoint_url:'https://example.invalid/create_order'}]} as TargetConfig;
 const pdf=Buffer.from('%PDF-1.4 synthetic test original');
 for(const line of adapted.canonical.lines){line.source_line.artwork.artwork_sha256=sha256(pdf);line.source_line.approval.artwork_sha256=sha256(pdf);line.source_line.artwork.bytes=pdf.length;}
 for(const a of receipt.assets){a.sha256=sha256(pdf);a.bytes=pdf.length;a.retained_ref=`worker-originals/${sha256(`174094/stickerpress-sandbox/${receipt.receipt_id}`)}/${a.sha256}.pdf`;}
 return {pdf,receipt,config:{...config,target,order_date_format:'MM/DD/YYYY' as const}};
}

import {publishArtwork,assertArtworkBinding,preflightArtwork,controlledArtworkReceipt} from '../src/json-intake/artwork-delivery.js';
import {buildSubmitIntegritySnapshot} from '../src/submit-integrity.js';
const now=new Date('2026-10-16T16:00:00Z');
async function published(){
 const {pdf,receipt,config}=setup(),job=prepareReceiptSubmissionJob(receipt,config,now),objects=new Map<string,any>();
 let writes=0;
 const sender={send:async(command:any)=>{const i=command.input,k=i.Bucket+'/'+i.Key,v=objects.get(k);
  if(command.constructor.name==='PutObjectCommand'){if(v)throw Object.assign(new Error(),{name:'PreconditionFailed'});writes++;objects.set(k,{Body:i.Body,Metadata:i.Metadata,ContentLength:i.ContentLength,LastModified:now,VersionId:'immutable-version'});return {};}
  if(!v)throw Object.assign(new Error(),{name:'NoSuchKey'});
  if(command.constructor.name==='HeadObjectCommand')return v;
  return {Body:{transformToString:async()=>String(v.Body)}};
 }};
 const fetch_impl=(async(url:string)=>{const r=new Response(pdf,{status:200});Object.defineProperty(r,'url',{value:url});return r;}) as typeof fetch;
 const args={job,delivery_bucket:'delivery',manifest_bucket:'manifest',required_until:'2026-10-23T00:00:00Z',sender,fetch_impl,now:()=>now,readRetained:async()=>pdf};
 job.json_artwork_binding=await publishArtwork(args);
 job.json_artwork_binding.publications.forEach((p,i)=>{job.canonical_order.lines[i].artwork!.file_url=p.direct_url;job.lift_payload.lines[i].artwork!.file_url=p.direct_url;});
 return {job,args,objects,writes:()=>writes,preflight:{job,publication_enabled:true,delivery_bucket_name:'delivery',manifest_bucket_name:'manifest',s3_sender:sender,fetch_impl,now:()=>now}};
}
test('original PDFs publish immutably, retry reuses manifests and final preflight verifies every line',async()=>{
 const x=await published(),writes=x.writes();assertArtworkBinding(x.job,now);
 assert.deepEqual(await publishArtwork(x.args),x.job.json_artwork_binding);assert.equal(x.writes(),writes);
 const result=await preflightArtwork(x.preflight);assert.equal(result?.documents.length,4);assert.equal(result?.required,true);
});
test('wrong scope, missing binding, reordered lines, preview URLs, changed hashes and stale window fail closed',async()=>{
 const x=await published();
 for(const mutate of [
  (j:any)=>delete j.json_artwork_binding,
  (j:any)=>j.customer_id='other',
  (j:any)=>j.output_route_id='route-high-end',
  (j:any)=>j.json_intake_binding.receipt_id='rcpt_'+'0'.repeat(64),
  (j:any)=>j.lift_payload.lines.reverse(),
  (j:any)=>j.lift_payload.lines[0].artwork.file_url='https://example.invalid/preview.png',
  (j:any)=>j.json_artwork_binding.publications[0].evidence.sha256='0'.repeat(64),
  (j:any)=>j.json_artwork_binding.required_until=now.toISOString(),
 ]){const j=structuredClone(x.job);mutate(j);assert.throws(()=>assertArtworkBinding(j,now));}
});
test('changed manifest, S3 version, missing object, and different downloaded bytes prevent submission',async()=>{
 for(const mode of ['manifest','version','missing','download']){
  const x=await published();
  if(mode==='manifest')for(const [k,v]of x.objects)if(k.startsWith('manifest/'))v.Body='{}';
  if(mode==='version')for(const [k,v]of x.objects)if(k.startsWith('delivery/'))v.VersionId='changed';
  if(mode==='missing')x.objects.clear();
  if(mode==='download')x.preflight.fetch_impl=(async(url:string)=>{const r=new Response('wrong');Object.defineProperty(r,'url',{value:url});return r;}) as typeof fetch;
  await assert.rejects(preflightArtwork(x.preflight));
 }
});
test('legacy absent binding is untouched; new publication is covered by the reviewed fingerprint',async()=>{
 const x=await published(),legacy={...x.job,job_id:'job_legacy',import_method_id:'manual',json_intake_binding:undefined,json_artwork_binding:undefined};
 legacy.lift_payload=structuredClone(x.job.lift_payload);legacy.lift_payload.lines.forEach(l=>delete l.artwork!.file_url);
 assert.equal(await preflightArtwork({...x.preflight,job:legacy}),null);
 const args={payload:x.job.lift_payload,submit_request_masked:x.job.submit_request_masked};
 assert.equal(buildSubmitIntegritySnapshot(args).fingerprint,buildSubmitIntegritySnapshot({...args,json_artwork_binding:undefined}).fingerprint);
 const before=buildSubmitIntegritySnapshot({...args,json_artwork_binding:x.job.json_artwork_binding});
 x.job.json_artwork_binding!.publications[0].object_version_id='different';
 assert.notEqual(before.fingerprint,buildSubmitIntegritySnapshot({...args,json_artwork_binding:x.job.json_artwork_binding}).fingerprint);
});
test('stalled storage is bounded and aborts before an external submit can be attempted',async(t)=>{
 const x=await published();t.mock.timers.enable({apis:['setTimeout']});let signal:AbortSignal|undefined;
 const pending=preflightArtwork({...x.preflight,s3_sender:{send:async(_c,_o)=>{signal=_o?.abortSignal;return new Promise(()=>{});}}});
 const rejected=assert.rejects(pending,/could not be verified/);t.mock.timers.tick(30001);await rejected;assert.equal(signal?.aborted,true);
});

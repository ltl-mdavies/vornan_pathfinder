import assert from 'node:assert/strict';
import {GetObjectCommand,HeadObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {sha256,stableJson} from './adapter.js';
import type {Receipt} from './local-store.js';
import type {JsonReceiptJob,JsonReceiptJobBinding} from './submission-job.js';
import type {ProcessingJobPreview,SubmitAttempt} from '../store.js';
import {SubmitIntegrityError} from '../submit-integrity.js';

export const controlledArtworkReceipt='rcpt_1b05a005e1fe64e71a8515dace68753d77c96d727f414d3e07145fb5b767567f';
type Evidence=JsonReceiptJobBinding['artwork'][number] & {receipt_id:string;customer_id:string;integration_id:string;business_fingerprint:string};
export interface ArtworkPublication {evidence:Evidence;direct_url:string;object_version_id:string;published_at:string;expires_at:string}
export interface JsonArtworkBinding {version:1;required_until:string;publications:ArtworkPublication[]}
type Sender={send(command:unknown,options?:{abortSignal:AbortSignal}):Promise<any>};
export const artworkKey=(e:Evidence)=>`d/ja_${sha256(stableJson(e))}/ARTWORK.pdf`;
const manifestKey=(e:Evidence)=>`json-intake/artwork-publications/${sha256(stableJson(e))}.json`;
const metadata=(e:Evidence)=>({evidence_sha256:sha256(stableJson(e)),document_role:'production_artwork',source_sha256:e.sha256});
const missing=(e:any)=>e?.$metadata?.httpStatusCode===404 || ['NoSuchKey','NotFound'].includes(e?.name);
const conflict=(e:any)=>e?.$metadata?.httpStatusCode===412 || e?.name==='PreconditionFailed';
function bytesMatch(e:Evidence,bytes:Buffer){assert.equal(bytes.length,e.bytes);assert.equal(sha256(bytes),e.sha256);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');}
export function artworkEvidence(job:JsonReceiptJob):Evidence[]{
 const b=job.json_intake_binding;
 assert.equal(b.receipt_id,controlledArtworkReceipt);assert.equal(b.environment,'test');assert.equal(b.store,'ltlco');
 assert.equal(b.integration_id,'stickerpress-sandbox');assert.equal(job.customer_id,'174094');assert.equal(job.source_customer_id,'174094');
 assert.equal(job.canonical_order.customer.customer_id,'174094');assert.equal(job.lift_payload.customer.lift_customer_id,'174094');assert.equal(job.submit_customer_id,'174094');
 assert.equal(job.output_route_id,'route-ltl-lift-91-ecomm-orders');assert.equal(job.submit_profile_id,'sandbox-stickerpress-174094');assert.equal(job.sandbox,true);
 assert.equal(job.lift_payload.order.ext_id,job.canonical_order.order.external_order_id);
 assert.equal(job.lift_payload.lines.length,b.artwork.length);assert.equal(job.canonical_order.lines.length,b.artwork.length);
 assert.equal(new Set(b.artwork.map(e=>e.external_line_id)).size,b.artwork.length);assert.ok(b.artwork.length>0,'Missing artwork');
 return b.artwork.map((a,i)=>{
  const line=job.canonical_order.lines[i] as Receipt['adapted']['canonical']['lines'][number],p=job.lift_payload.lines[i] as typeof job.lift_payload.lines[number] & {external_line_id?:string;artwork?:{checksum?:string|null;bytes?:number}};
  assert.equal(line.source_line.external_line_id,a.external_line_id);assert.equal(p.external_line_id,a.external_line_id);
  assert.equal(line.source_line.artwork.artwork_sha256,a.sha256);assert.equal(line.source_line.approval.artwork_sha256,a.sha256);
  assert.equal(line.artwork?.checksum,a.sha256);assert.equal(p.artwork?.checksum,a.sha256);assert.equal(p.artwork?.bytes,a.bytes);
  assert.equal(a.retained_ref,`worker-originals/${sha256(`174094/stickerpress-sandbox/${b.receipt_id}`)}/${a.sha256}.pdf`);
  assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(a.bytes)&&a.bytes>=8&&a.bytes<=25*1024*1024,'Artwork size invalid');
  return {...a,receipt_id:b.receipt_id,customer_id:job.customer_id,integration_id:b.integration_id,business_fingerprint:b.business_fingerprint};
 });
}
async function download(p:ArtworkPublication,fetchImpl:typeof fetch,signal:AbortSignal){
 const response=await fetchImpl(p.direct_url,{method:'GET',redirect:'error',signal});
 if(response.status!==200 || response.redirected || response.url!==p.direct_url || !response.body){await response.body?.cancel();throw new Error('Artwork download unavailable');}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>p.evidence.bytes)throw new Error('Oversized artwork');chunks.push(next.value);}bytesMatch(p.evidence,Buffer.concat(chunks));}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
function verifyHead(p:ArtworkPublication,head:any){
 assert.equal(head.VersionId,p.object_version_id);assert.equal(head.ContentLength,p.evidence.bytes);
 assert.equal(head.LastModified?.toISOString(),p.published_at);
 for(const [k,v] of Object.entries(metadata(p.evidence)))assert.equal(head.Metadata?.[k],v);
}
/** Operator publication only. No source URL fetch, PDF conversion, job mutation, or Lift call. */
export async function publishArtwork(args:{job:JsonReceiptJob;delivery_bucket:string;manifest_bucket:string;required_until:string;
 readRetained(e:Evidence):Promise<Buffer>;sender:Sender;fetch_impl?:typeof fetch;now?:()=>Date}):Promise<JsonArtworkBinding>{
 const publications:ArtworkPublication[]=[];
 for(const evidence of artworkEvidence(args.job)){
  const bytes=await args.readRetained(evidence);bytesMatch(evidence,bytes);
  let existing:ArtworkPublication|null=null;
  try{const r=await args.sender.send(new GetObjectCommand({Bucket:args.manifest_bucket,Key:manifestKey(evidence)}));existing=JSON.parse(await r.Body.transformToString('utf8'));}catch(e){if(!missing(e))throw e;}
  if(!existing)try{await args.sender.send(new PutObjectCommand({Bucket:args.delivery_bucket,Key:artworkKey(evidence),Body:bytes,ContentLength:bytes.length,
   ContentType:'application/pdf',ContentDisposition:'attachment; filename="ARTWORK.pdf"',CacheControl:'no-store, max-age=0',IfNoneMatch:'*',Metadata:metadata(evidence)}));}catch(e){if(!conflict(e))throw e;}
  const head=await args.sender.send(new HeadObjectCommand({Bucket:args.delivery_bucket,Key:artworkKey(evidence)}));
  assert.ok(head.VersionId && head.LastModified instanceof Date);
  const p:ArtworkPublication={evidence,direct_url:`https://go.vornan.co/${artworkKey(evidence)}`,object_version_id:head.VersionId,
   published_at:head.LastModified.toISOString(),expires_at:new Date(head.LastModified.getTime()+14*86400000).toISOString()};
  verifyHead(p,head);if(existing)assert.equal(stableJson(existing),stableJson(p));
  assert.ok(Date.parse(args.required_until)>(args.now?.()??new Date()).getTime() && Date.parse(args.required_until)<Date.parse(p.expires_at));
  await download(p,args.fetch_impl??fetch,AbortSignal.timeout(8000));
  if(!existing)try{await args.sender.send(new PutObjectCommand({Bucket:args.manifest_bucket,Key:manifestKey(evidence),Body:JSON.stringify(p),ContentType:'application/json',IfNoneMatch:'*'}));}
  catch(e){if(!conflict(e))throw e;const r=await args.sender.send(new GetObjectCommand({Bucket:args.manifest_bucket,Key:manifestKey(evidence)}));assert.equal(stableJson(JSON.parse(await r.Body.transformToString('utf8'))),stableJson(p));}
  publications.push(p);
 }
 return {version:1,required_until:args.required_until,publications};
}
export function assertArtworkBinding(job:ProcessingJobPreview,now=new Date()){
 const b=job.json_artwork_binding;
 const isJson=job.import_method_id==='json-stickerpress-sandbox' || job.job_id?.startsWith('job_json_') || !!job.json_intake_binding ||
  (job.lift_payload.lines??[]).some(l=>String(l.artwork?.file_url??'').includes('/d/ja_'));
 if(!b){if(isJson)throw new SubmitIntegrityError('document_binding_invalid','JSON artwork requires a reviewed publication binding.');return null;}
 try{
  const expected=artworkEvidence(job as JsonReceiptJob);
  assert.equal(b.version,1);assert.equal(b.publications.length,expected.length);
  assert.ok(!job.prepaid_submit_binding && !job.source_document_publications?.length && job.source_evidence?.provider!=='wrike','Mixed publication sources unsupported');
  assert.ok(Number.isFinite(now.getTime()) && Date.parse(b.required_until)>now.getTime(),'Artwork review window expired');
  b.publications.forEach((p,i)=>{
   assert.equal(stableJson(p.evidence),stableJson(expected[i]));assert.equal(p.direct_url,`https://go.vornan.co/${artworkKey(expected[i])}`);
   assert.ok(p.object_version_id,'Missing version');assert.ok(Date.parse(p.published_at)<=now.getTime(),'Invalid publication time');assert.ok(Date.parse(p.expires_at)>Date.parse(b.required_until),'Expired publication');
   assert.equal(Date.parse(p.expires_at)-Date.parse(p.published_at),14*86400000);
   assert.equal(job.canonical_order.lines[i].artwork?.file_url,p.direct_url);assert.equal(job.lift_payload.lines[i].artwork?.file_url,p.direct_url);
  });return b;
 }catch{throw new SubmitIntegrityError('document_binding_invalid','JSON artwork receipt, line, publication or delivery window changed; review required.');}
}
export async function preflightArtwork(args:{job:ProcessingJobPreview;publication_enabled:boolean;delivery_bucket_name:string|null;
 manifest_bucket_name?:string|null;s3_sender?:Sender;fetch_impl?:typeof fetch;now?:()=>Date}):Promise<NonNullable<SubmitAttempt['document_preflight']>|null>{
 const now=args.now??(()=>new Date()),started=now(),binding=assertArtworkBinding(args.job,started);if(!binding)return null;
 const manifest=args.manifest_bucket_name??process.env.PATHFINDER_SOURCE_EVIDENCE_BUCKET;
 if(!args.publication_enabled || !args.delivery_bucket_name || !manifest)throw new SubmitIntegrityError('document_delivery_disabled','Artwork delivery storage is unavailable.');
 const saved=stableJson(args.job),sender=args.s3_sender??new S3Client({}),controller=new AbortController(),signal=controller.signal,documents=[];
 const timer=setTimeout(()=>controller.abort(),30000);timer.unref();
 const bounded=<T>(operation:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
  const abort=()=>reject(new Error('Artwork verification deadline exceeded'));
  if(signal.aborted){operation.catch(()=>undefined);abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
 try{
 try{for(const p of binding.publications){
  const r:any=await bounded(sender.send(new GetObjectCommand({Bucket:manifest,Key:manifestKey(p.evidence)}),{abortSignal:signal}));
  assert.equal(stableJson(JSON.parse(await bounded(r.Body.transformToString('utf8')) as string)),stableJson(p));
  verifyHead(p,await bounded(sender.send(new HeadObjectCommand({Bucket:args.delivery_bucket_name,Key:artworkKey(p.evidence)}),{abortSignal:signal})));
  await bounded(download(p,args.fetch_impl??fetch,AbortSignal.any([signal,AbortSignal.timeout(8000)])));
  documents.push({document_role:'production_artwork' as const,publication_id:`artwork_${sha256(stableJson(p.evidence))}`,object_version_id:p.object_version_id,content_length:p.evidence.bytes,http_status:200 as const,redirect_count:0 as const});
 }}catch{throw new SubmitIntegrityError('document_delivery_unavailable','Reviewed production artwork could not be verified for delivery.');}
 const completed=now();assertArtworkBinding(args.job,completed);
 if(stableJson(args.job)!==saved || completed.getTime()<started.getTime() || completed.getTime()-started.getTime()>30000)throw new SubmitIntegrityError('review_mismatch','Artwork verification changed or exceeded its freshness window.');
 return {required:true,checked_at:completed.toISOString(),documents};
 }finally{clearTimeout(timer);controller.abort();}
}

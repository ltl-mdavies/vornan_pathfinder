import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ProcessingJobPreview, SubmitAttempt } from '../store.js';
import { preflightWrikeSubmitDocuments, SubmitIntegrityError } from '../submit-integrity.js';
import { sha256, stableJson } from './adapter.js';
import { applyPrepaidOrderAttachment, PREPAID_INSTRUCTION, type PrepaidLabelEvidence, type PrepaidLabelPublication } from './prepaid-label.js';
import type { Receipt } from './local-store.js';

export interface PrepaidSubmitBinding {
  evidence: PrepaidLabelEvidence;
  publication: PrepaidLabelPublication;
  required_until: string;
}
/** Trusted job preparation only. This binding must be saved with the exact reviewed
 * payload; the public JSON intake body cannot supply it. */
export function buildPrepaidSubmitBinding(receipt: Receipt, publication: PrepaidLabelPublication, requiredUntil: string, now=new Date()): PrepaidSubmitBinding {
  if(receipt.confirmation)throw new Error('Confirmed receipt cannot prepare another order submission');
  applyPrepaidOrderAttachment(receipt,publication,requiredUntil,now);
  return structuredClone({evidence:receipt.prepaid_label!,publication,required_until:requiredUntil});
}
export interface PrepaidSubmitConfig {enabled:boolean;delivery_bucket_name:string|null;manifest_bucket_name:string|null}
export function getPrepaidSubmitConfig(env:NodeJS.ProcessEnv=process.env):PrepaidSubmitConfig {
  return {enabled:env.PATHFINDER_ENABLE_JSON_PREPAID_DOCUMENT_DELIVERY==='true',
    delivery_bucket_name:env.PATHFINDER_JSON_PREPAID_DELIVERY_BUCKET?.trim()||null,
    manifest_bucket_name:env.PATHFINDER_JSON_PREPAID_MANIFEST_BUCKET?.trim()||null};
}
const fail = (message:string):never => {throw new SubmitIntegrityError('document_binding_invalid',message);};
function expectation(job:ProcessingJobPreview,now:Date) {
  const b=job.prepaid_submit_binding;
  const attachment=job.canonical_order.order.order_attachment;
  const payloadAttachment=job.lift_payload.order.order_attachment;
  const prepaidUrl=(typeof payloadAttachment==='string' && payloadAttachment.includes('/d/pl_')) || attachment?.includes('/d/pl_');
  if(!b){if(prepaidUrl)fail('Prepaid attachment is missing its reviewed binding.');return null;}
  const {evidence:e,publication:p}=b,hash=sha256(stableJson(e));
  const required=Date.parse(b.required_until),published=Date.parse(p.published_at),expires=Date.parse(p.expires_at);
  const url=`https://go.vornan.co/d/pl_${hash}/PREPAID_LABEL.pdf`;
  if(!job.sandbox || e.scope.environment!=='test' || e.scope.customer_id!==job.source_customer_id || e.scope.customer_id!==job.canonical_order.customer.customer_id ||
    !e.scope.integration_id || !e.scope.store || !/^rcpt_[a-f0-9]{64}$/.test(e.receipt_id) || !/^[a-f0-9]{64}$/.test(e.fingerprint) ||
    !/^[a-f0-9]{64}$/.test(e.source_url_sha256) || !e.retained_ref || !/^[a-f0-9]{64}$/.test(e.sha256) ||
    e.document_role!=='prepaid_label' || p.document_role!=='prepaid_label' || !Number.isSafeInteger(e.bytes) || e.bytes<8 || e.bytes>5*1024*1024 ||
    e.external_order_id!==job.canonical_order.order.external_order_id || e.external_order_id!==job.lift_payload.order.ext_id ||
    p.evidence_sha256!==hash || p.sha256!==e.sha256 || p.bytes!==e.bytes || !p.object_version_id || p.direct_url!==url ||
    attachment!==url || job.lift_payload.order.order_attachment!==url || Object.values(job.lift_payload.order).filter(value=>value===url).length!==1 ||
    !job.lift_payload.order.order_note?.includes(PREPAID_INSTRUCTION) ||
    !Number.isFinite(now.getTime()) || !Number.isFinite(required) || !Number.isFinite(published) || !Number.isFinite(expires) ||
    published>now.getTime() || required<=now.getTime() || expires<=required || job.source_document_publications?.length || job.source_evidence?.provider==='wrike') {
    fail('Prepaid order, publication or fulfillment binding changed; review is required.');
  }
  return {binding:b,hash,url,key:`d/pl_${hash}/PREPAID_LABEL.pdf`};
}

/** Read-only final check: never republishes missing objects or rewrites a manifest.
 * Existing Wrike-only jobs retain their original preflight behavior. */
export async function preflightSubmitDocuments(args:Omit<Parameters<typeof preflightWrikeSubmitDocuments>[0],'s3_sender'> & {
  s3_sender?:{send(command:unknown,options?:{abortSignal:AbortSignal}):Promise<any>};
  prepaid_config?:PrepaidSubmitConfig;
}):Promise<NonNullable<SubmitAttempt['document_preflight']>> {
  const now=args.now??(()=>new Date()),checked=now(),expected=expectation(args.job,checked);
  if(!expected)return preflightWrikeSubmitDocuments(args);
  const reviewedState=stableJson(args.job);
  const config=args.prepaid_config??getPrepaidSubmitConfig();
  if(!config.enabled || !config.delivery_bucket_name || !config.manifest_bucket_name)throw new SubmitIntegrityError('document_delivery_disabled','Prepaid document delivery is not enabled for this submit window.');
  const sender=args.s3_sender??new S3Client({}),{evidence:e,publication:p}=expected.binding;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30_000);timeout.unref();
  const bounded=<T>(operation:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
    const abort=()=>reject(new Error('Prepaid verification timed out'));
    if(controller.signal.aborted){operation.catch(()=>undefined);abort();return;}
    controller.signal.addEventListener('abort',abort,{once:true});
    operation.then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort));
  });
  try {
  try {
    const result=await bounded(sender.send(new GetObjectCommand({Bucket:config.manifest_bucket_name,Key:`json-intake/prepaid-publications/${expected.hash}.json`}), {abortSignal:controller.signal}));
    const manifest=JSON.parse(await bounded(result.Body.transformToString('utf8')) as string);
    if(stableJson(manifest)!==stableJson(p))throw new Error('Manifest changed');
    const head=await bounded(sender.send(new HeadObjectCommand({Bucket:config.delivery_bucket_name,Key:expected.key}), {abortSignal:controller.signal}));
    if(head.VersionId!==p.object_version_id || head.ContentLength!==e.bytes || head.Metadata?.evidence_sha256!==expected.hash ||
      head.Metadata?.document_role!=='prepaid_label' || head.Metadata?.source_sha256!==e.sha256 ||
      !(head.LastModified instanceof Date) || head.LastModified.toISOString()!==p.published_at)throw new Error('Object changed');
  }catch{throw new SubmitIntegrityError('document_object_invalid','Prepaid publication or delivery object could not be verified.');}
  try {
    const response=await bounded((args.fetch_impl??fetch)(expected.url,{method:'GET',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])}));
    if(response.status!==200 || response.redirected || response.url!==expected.url || !response.body){await response.body?.cancel();throw new Error('Unavailable');}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const next=await bounded(reader.read());if(next.done)break;size+=next.value.length;if(size>e.bytes)throw new Error('Oversize');chunks.push(next.value);}
      if(size!==e.bytes || sha256(Buffer.concat(chunks))!==e.sha256)throw new Error('Changed bytes');
    }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  }catch{throw new SubmitIntegrityError('document_delivery_unavailable','Prepaid label is not directly downloadable with its reviewed checksum.');}
  const completed=now();
  if(stableJson(args.job)!==reviewedState)fail('Reviewed job changed during prepaid document verification.');
  if(completed.getTime()<checked.getTime() || completed.getTime()-checked.getTime()>30_000)throw new SubmitIntegrityError('document_delivery_unavailable','Prepaid document check exceeded its freshness window.');
  expectation(args.job,completed);
  return {required:true,checked_at:completed.toISOString(),documents:[{document_role:'prepaid_label',publication_id:`prepaid_${expected.hash}`,
    object_version_id:p.object_version_id,content_length:e.bytes,http_status:200,redirect_count:0}]};
  } finally {clearTimeout(timeout);controller.abort();}
}

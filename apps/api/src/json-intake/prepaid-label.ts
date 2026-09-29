import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { sha256, stableJson } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';
import { scopeKey, type WebhookScope } from '../webhooks/contract.js';
import type { AssetReadOptions } from './https-assets.js';

export const PREPAID_INSTRUCTION = 'Customer-supplied prepaid label — do not purchase shipping.';
const maxBytes = 5 * 1024 * 1024;
export interface PrepaidLabelEvidence {
  document_role: 'prepaid_label';
  receipt_id: string;
  fingerprint: string;
  scope: WebhookScope;
  external_order_id: string;
  source_url_sha256: string;
  sha256: string;
  bytes: number;
  retained_ref: string;
}
export interface PrepaidLabelPublication {
  evidence_sha256: string;
  document_role: 'prepaid_label';
  direct_url: string;
  object_version_id: string;
  published_at: string;
  expires_at: string;
  sha256: string;
  bytes: number;
}
type LabelReceipt = Pick<Receipt,'identity'|'adapted'|'receipt_id'|'fingerprint'|'prepaid_label'>;
const receiptScope = (r: LabelReceipt): WebhookScope => ({customer_id:r.identity.customer_id,integration_id:r.identity.integration_id,store:r.identity.store,environment:r.identity.environment});
const retentionScope = (r: Receipt) => stableJson({scope:receiptScope(r),receipt_id:r.receipt_id,role:'prepaid_label'});
function binding(r: LabelReceipt) {
  const source = r.adapted.canonical.order.shipping_policy.label_url;
  if (r.identity.environment !== 'test' || !source || !r.fingerprint || !r.receipt_id) throw new Error('Prepaid label receipt is not bound');
  return {document_role:'prepaid_label' as const,receipt_id:r.receipt_id,fingerprint:r.fingerprint,scope:receiptScope(r),
    external_order_id:r.adapted.canonical.order.external_order_id,source_url_sha256:sha256(source)};
}
function assertBinding(r: LabelReceipt, e: PrepaidLabelEvidence) {
  const expected = binding(r);
  if (Object.entries(expected).some(([key,value])=>stableJson(e[key as keyof PrepaidLabelEvidence])!==stableJson(value)) ||
    !/^[a-f0-9]{64}$/.test(e.sha256) || !Number.isSafeInteger(e.bytes) || e.bytes<8 || e.bytes>maxBytes || !e.retained_ref) throw new Error('Prepaid label evidence mismatch');
}
function assertBytes(e: Pick<PrepaidLabelEvidence,'sha256'|'bytes'>, bytes: Buffer) {
  if(bytes.length!==e.bytes || sha256(bytes)!==e.sha256 || bytes.subarray(0,5).toString()!=='%PDF-') throw new Error('Prepaid label bytes mismatch');
}

/** The reader must be the configured pinned HTTPS asset reader. Existing evidence is
 * reused without fetching the mutable source URL again. Retention does not approve the PDF. */
export async function retainPrepaidLabel(store: ReceiptStore, receiptId: string, transport: {
  read(source: string, options: AssetReadOptions): Promise<Buffer>;
  retain(scope: string, bytes: Buffer, format: 'pdf'): Promise<string>;
  readRetained(scope: string, ref: string): Promise<Buffer>;
}) {
  const receipt=await store.get(receiptId);if(!receipt)throw new Error('Receipt unavailable');
  const identity=binding(receipt);
  if(receipt.prepaid_label){assertBinding(receipt,receipt.prepaid_label);assertBytes(receipt.prepaid_label,await transport.readRetained(retentionScope(receipt),receipt.prepaid_label.retained_ref));return receipt;}
  const bytes=await transport.read(receipt.adapted.canonical.order.shipping_policy.label_url!,{max_bytes:maxBytes,content_types:['application/pdf']});
  if(bytes.length<8 || bytes.length>maxBytes || bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Prepaid label must be a bounded PDF');
  const evidence:PrepaidLabelEvidence={...identity,sha256:sha256(bytes),bytes:bytes.length,retained_ref:await transport.retain(retentionScope(receipt),bytes,'pdf')};
  const next={...receipt,revision:receipt.revision+1,prepaid_label:evidence};
  if(await store.compareAndSet(receipt,next))return next;
  const current=await store.get(receiptId);
  if(!current?.prepaid_label || stableJson(current.prepaid_label)!==stableJson(evidence))throw new Error('Prepaid label retention changed; review required');
  return current;
}

export interface PrepaidPublicationConfig {
  enabled: boolean;
  scope: WebhookScope;
  bucket_name: string;
  manifest_bucket_name: string;
  /** Matches the delivery bucket lifecycle, established by deployment review. */
  retention_days: number;
}
type Sender = {send(command: unknown): Promise<any>};
const missing = (e:any) => e?.$metadata?.httpStatusCode===404 || ['NoSuchKey','NotFound'].includes(e?.name);
const conflict = (e:any) => e?.$metadata?.httpStatusCode===412 || e?.name==='PreconditionFailed';
const evidenceHash = (e:PrepaidLabelEvidence) => sha256(stableJson(e));
const deliveryKey = (e:PrepaidLabelEvidence) => `d/pl_${evidenceHash(e)}/PREPAID_LABEL.pdf`;

/** Same controlled URL -> Lift order_attachment mechanism as Momentara. Storage is
 * injected explicitly; no runtime credentials, default enablement, or Lift write. */
export async function publishPrepaidLabel(args: {
  receipt: Receipt; config: PrepaidPublicationConfig;
  review: {evidence_sha256: string; reference: string; required_until: string};
  readRetained(scope: string, ref: string): Promise<Buffer>;
  sender: Sender; fetch: typeof fetch; now?: ()=>Date;
}):Promise<PrepaidLabelPublication> {
  const {receipt,config,review,sender}=args,e=receipt.prepaid_label;
  if(!config.enabled || !e || scopeKey(config.scope)!==scopeKey(receiptScope(receipt)) || !config.bucket_name || !config.manifest_bucket_name ||
    !Number.isInteger(config.retention_days) || config.retention_days<1 || config.retention_days>365)throw new Error('Prepaid publication disabled or unconfigured');
  assertBinding(receipt,e);
  const hash=evidenceHash(e),now=(args.now??(()=>new Date()))(),required=Date.parse(review.required_until);
  if(review.evidence_sha256!==hash || !review.reference.trim() || !Number.isFinite(required) || !Number.isFinite(now.getTime()) || required<=now.getTime())throw new Error('Prepaid label review required');
  if(required>=now.getTime()+config.retention_days*86400000)throw new Error('Prepaid delivery retention does not cover fulfillment');
  const bytes=await args.readRetained(retentionScope(receipt),e.retained_ref);assertBytes(e,bytes);
  const key=deliveryKey(e),directUrl=`https://go.vornan.co/${key}`,manifestKey=`json-intake/prepaid-publications/${hash}.json`;
  let existing:PrepaidLabelPublication|null=null;
  try {const result=await sender.send(new GetObjectCommand({Bucket:config.manifest_bucket_name,Key:manifestKey}));existing=JSON.parse(await result.Body.transformToString('utf8'));}
  catch(error){if(!missing(error))throw new Error('Prepaid publication manifest unavailable');}
  const metadata={evidence_sha256:hash,document_role:'prepaid_label',source_sha256:e.sha256};
  if(!existing)try {await sender.send(new PutObjectCommand({Bucket:config.bucket_name,Key:key,Body:bytes,ContentType:'application/pdf',ContentLength:bytes.length,
    ContentDisposition:'attachment; filename="PREPAID_LABEL.pdf"',CacheControl:'no-store, max-age=0',IfNoneMatch:'*',Metadata:metadata}));}
  catch(error){if(!conflict(error))throw new Error('Prepaid delivery publication failed');}
  let head:any;
  try {head=await sender.send(new HeadObjectCommand({Bucket:config.bucket_name,Key:key}));}catch{throw new Error('Prepaid delivery verification failed');}
  if(!head.VersionId || head.ContentLength!==e.bytes || !(head.LastModified instanceof Date) || !Number.isFinite(head.LastModified.getTime()) ||
    Object.entries(metadata).some(([k,v])=>head.Metadata?.[k]!==v))throw new Error('Prepaid delivery identity conflict');
  const expires=new Date(head.LastModified.getTime()+config.retention_days*86400000);
  if(required>=expires.getTime() || head.LastModified>now)throw new Error('Prepaid delivery retention does not cover fulfillment');
  const publication:PrepaidLabelPublication={evidence_sha256:hash,document_role:'prepaid_label',direct_url:directUrl,object_version_id:head.VersionId,
    published_at:head.LastModified.toISOString(),expires_at:expires.toISOString(),sha256:e.sha256,bytes:e.bytes};
  if(existing && stableJson(existing)!==stableJson(publication))throw new Error('Prepaid publication identity conflict');
  // Verify downloaded bytes, not just Content-Length. Never follow a delivery redirect.
  try {
    const response=await args.fetch(directUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000)});
    if(response.status!==200 || response.redirected || response.url!==directUrl || !response.body) {await response.body?.cancel();throw new Error('Invalid response');}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>e.bytes)throw new Error('Oversized response');chunks.push(part.value);}assertBytes(e,Buffer.concat(chunks));}
    finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  } catch {throw new Error('Prepaid delivery preflight failed');}
  if(!existing)try {await sender.send(new PutObjectCommand({Bucket:config.manifest_bucket_name,Key:manifestKey,Body:JSON.stringify(publication),ContentType:'application/json',IfNoneMatch:'*'}));}
  catch(error){
    if(!conflict(error))throw new Error('Prepaid manifest publication failed');
    try {const result=await sender.send(new GetObjectCommand({Bucket:config.manifest_bucket_name,Key:manifestKey}));if(stableJson(JSON.parse(await result.Body.transformToString('utf8')))!==stableJson(publication))throw new Error('Conflict');}
    catch {throw new Error('Prepaid publication identity conflict');}
  }
  return publication;
}

/** Apply before the existing Lift submit mapper. Does not append to an existing Lift
 * order, change tracking/dispatch, or replace a different order attachment. */
export function applyPrepaidOrderAttachment(receipt: LabelReceipt, publication: PrepaidLabelPublication, requiredUntil: string, now=new Date()) {
  const e=receipt.prepaid_label;if(!e)throw new Error('Prepaid label not retained');assertBinding(receipt,e);
  const required=Date.parse(requiredUntil),expires=Date.parse(publication.expires_at),published=Date.parse(publication.published_at);
  if(publication.document_role!=='prepaid_label' || publication.evidence_sha256!==evidenceHash(e) || publication.sha256!==e.sha256 || publication.bytes!==e.bytes ||
    publication.direct_url!==`https://go.vornan.co/${deliveryKey(e)}` || !publication.object_version_id || !Number.isFinite(required) ||
    !Number.isFinite(expires) || !Number.isFinite(published) || !Number.isFinite(now.getTime()) || published>now.getTime() || required<=now.getTime() || expires<=required)throw new Error('Prepaid publication is not ready');
  const canonical=structuredClone(receipt.adapted.canonical);
  if(canonical.order.order_attachment && canonical.order.order_attachment!==publication.direct_url)throw new Error('Existing order attachment requires review');
  canonical.order.order_attachment=publication.direct_url;
  if(!canonical.order.order_note?.includes(PREPAID_INSTRUCTION))canonical.order.order_note=[canonical.order.order_note,PREPAID_INSTRUCTION].filter(Boolean).join('\n');
  // Original signed source URL remains private receipt evidence, not a Lift download instruction.
  canonical.order.shipping_policy.label_url=null;
  return canonical;
}

import { randomUUID } from 'node:crypto';
import type { Receipt, ReceiptStore } from './local-store.js';
import { sha256, stickerPressV1, stableJson } from './adapter.js';
import type { LocalAssetTransport } from './service.js';
import { AssetCheckError } from './asset-errors.js';

/** One line per invocation/receipt. Crash recovery is bounded per-line, without a shared ledger. */
export function createSandboxArtworkWorker(deps:{store:ReceiptStore;transport:LocalAssetTransport;customerId:string;integrationId:string;now?:()=>string}) {
 const now=deps.now??(()=>new Date().toISOString());
 return async(id:string)=>{
  let r=await deps.store.get(id);
  if(!r || r.identity.customer_id!==deps.customerId || r.identity.integration_id!==deps.integrationId || r.identity.environment!=='test' || r.identity.store!=='ltlco' || r.identity.schema!=='stickerpress.order.v1')return 'out_of_scope';
  if(r.confirmation || r.shipping || r.ledger_projection || r.work==='complete' || r.asset_status!=='pending')return 'terminal';
  if(r.claim && Date.parse(r.claim.until)>Date.parse(now()))return 'busy';
  const adapted=stickerPressV1.validate(r.adapted.evidence,r.identity);
  if(adapted.fingerprint!==r.fingerprint || id!==`rcpt_${sha256(stableJson([r.identity.customer_id,r.identity.integration_id,r.identity.environment,r.identity.store,adapted.canonical.source.source_record_id]))}`)throw new Error('Receipt mismatch');
  const index=adapted.canonical.lines.findIndex(l=>!r!.assets.some(a=>a.external_line_id===l.source_line.external_line_id && a.inspection!=='not_run'));
  if(index<0){
   const next:Receipt={...r,revision:r.revision+1,updated_at:now(),claim:null,work:'complete',asset_status:r.issues.length?(r.issues.some(i=>i.owner==='internal')?'internal_action_required':'action_required'):'integrity_verified'};
   return await deps.store.compareAndSet(r,next)?'complete':'busy';
  }
  const line=adapted.canonical.lines[index],art=line.source_line.artwork;
  const claimed:Receipt={...r,revision:r.revision+1,updated_at:now(),claim:{token:randomUUID(),until:new Date(Date.parse(now())+120000).toISOString()},retry_attempts:(r.retry_attempts??0)+1};
  if(!await deps.store.compareAndSet(r,claimed))return 'busy';r=claimed;
  const save=async(next:Receipt)=>{
   if(Date.parse(r!.claim!.until)<=Date.parse(now()))throw new Error('Lease expired');
   if(!await deps.store.compareAndSet(r!,next))throw new Error('Lease lost');r=next;
  };
  try{
   if((r.retry_attempts??0)>3)throw new AssetCheckError('ASSET_RETRY_EXHAUSTED',false,'internal');
   let asset=r.assets.find(a=>a.external_line_id===line.source_line.external_line_id);
   const scope=`${r.identity.customer_id}/${r.identity.integration_id}/${r.receipt_id}`;
   let bytes:Buffer;
   if(asset){
    if(asset.sha256!==art.artwork_sha256 || asset.bytes!==art.bytes)throw new AssetCheckError('RETAINED_IDENTITY_MISMATCH',false,'internal');
    bytes=await deps.transport.readRetained!(scope,asset.retained_ref);
   }else{
    if(Date.parse(art.artwork_expires_at)<=Date.parse(now()))throw new AssetCheckError('ARTWORK_URL_EXPIRED');
    bytes=await deps.transport.read(art.download_url,{max_bytes:art.bytes,content_types:['application/pdf']});
   }
   if(bytes.length!==art.bytes || sha256(bytes)!==art.artwork_sha256 || sha256(bytes)!==line.source_line.approval.artwork_sha256)throw new AssetCheckError('ARTWORK_CHECKSUM_MISMATCH');
   if(!asset){
    asset={external_line_id:line.source_line.external_line_id,sha256:art.artwork_sha256,bytes:bytes.length,retained_ref:await deps.transport.retain(scope,bytes),inspection:'not_run'};
    await save({...r,revision:r.revision+1,updated_at:now(),assets:[...r.assets,asset]});
    const retained=await deps.transport.readRetained!(scope,asset.retained_ref);
    if(retained.length!==bytes.length || sha256(retained)!==art.artwork_sha256)throw new AssetCheckError('RETAINED_IDENTITY_MISMATCH',false,'internal');
   }
   const inspection=await deps.transport.inspect!(bytes,line);
   const assets=r.assets.map(a=>a.external_line_id===asset!.external_line_id?{...a,inspection:inspection.verdict==='pass'?'metadata_pass' as const:'metadata_fail' as const,inspection_result:inspection}:a);
   const issues=[...r.issues,...inspection.findings.map(code=>({issue_id:`iss_${sha256(id+line.source_line.external_line_id+code).slice(0,24)}`,code,field:`lines[${index}].artwork`,external_line_id:line.source_line.external_line_id,owner:'customer' as const,retryable:false,message:'Artwork needs review.',corrective_action:'Review the reported PDF metadata or color-profile finding; original bytes are preserved.'}))];
   const complete=adapted.canonical.lines.every(l=>assets.some(a=>a.external_line_id===l.source_line.external_line_id && a.inspection!=='not_run'));
   await save({...r,revision:r.revision+1,updated_at:now(),assets,issues,claim:null,retry_attempts:0,work:complete?'complete':'pending',asset_status:complete?(issues.length?'action_required':'integrity_verified'):'pending'});
   return complete?'complete':'pending';
  }catch(error){
   const e=error instanceof AssetCheckError?error:new AssetCheckError('ARTWORK_WORKER_FAILED',false,'internal');
   // No automatic restart of errors. Explicit review must decide any retry.
   await save({...r,revision:r.revision+1,updated_at:now(),claim:null,work:'complete',asset_status:e.owner==='internal'?'internal_action_required':'action_required',issues:[...r.issues,{issue_id:`iss_${sha256(id+e.code).slice(0,24)}`,code:e.code,field:`lines[${index}].artwork`,external_line_id:line.source_line.external_line_id,owner:e.owner,retryable:e.retryable,message:'Artwork processing requires review.',corrective_action:'Review this finding before explicitly retrying.'}]});
   return 'review';
  }
 };
}

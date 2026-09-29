import { digest, scopeKey, type WebhookScope } from '../webhooks/contract.js';
import { stableJson } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';
import { captureLiftShippingReports, type LiftShippingReports, type LiftShippingReview } from './lift-shipping-source.js';

type Report = 'order' | 'packages' | 'shipping';
const endpoints:Record<Report,{url:string;parameter:string}>={
  order:{url:'https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N',parameter:'p0'},
  packages:{url:'https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/PackageDetails/package_details',parameter:'p0'},
  shipping:{url:'https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/ShippingReport/N',parameter:'p1'}
};
export type ReportPagination = {kind:'offset';page_size:number} | {kind:'single_response';review_reference:string};
export interface ShippingCollectorConfig {
  enabled: boolean;
  scope: WebhookScope;
  pagination: Record<Report,ReportPagination>;
}
export interface CollectedShippingReports {
  scope:WebhookScope; receipt_id:string; lift_order_number:string; confirmation_sha256:string;
  started_at:string; completed_at:string; reports:LiftShippingReports;
  pagination:ShippingCollectorConfig['pagination']; evidence_sha256:string;
}
const receiptScope=(r:Receipt):WebhookScope=>({customer_id:r.identity.customer_id,integration_id:r.identity.integration_id,store:r.identity.store,environment:r.identity.environment});
const reportNames:Report[]=['order','packages','shipping'];
const maxBytes=5*1024*1024, maxRows=5000, maxPages=20;

async function boundedJson(response:Response,remainingBytes:number) {
  if (!response.ok || response.status!==200 || !response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) throw new Error('Lift report response rejected');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    for (;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>remainingBytes)throw new Error('Lift report size exceeded');chunks.push(value);}
    return {body:JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>,bytes:size};
  } finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}

/** Explicit test-scope GET collector. Fixed HTTPS destinations; never follows redirects/links.
 * Credentials remain in request headers, and are not returned or included in errors. */
export async function collectLiftShippingReports(receipt:Receipt, config:ShippingCollectorConfig, deps:{
  credentials:(report:Report)=>Promise<{user:string;password:string}|null>;
  fetch?:typeof fetch;
  now?:()=>number;
}):Promise<CollectedShippingReports> {
  if (!config.enabled || config.scope.environment!=='test' || scopeKey(config.scope)!==scopeKey(receiptScope(receipt)) ||
      !receipt.confirmation || !/^A\d{7,8}$/.test(receipt.confirmation.order_number) || !/^[a-f0-9]{64}$/.test(receipt.confirmation.evidence_sha256)) throw new Error('Shipping collector disabled or unbound');
  for (const kind of reportNames) {
    const policy=config.pagination[kind];
    if (!policy || (policy.kind==='offset' ? !Number.isSafeInteger(policy.page_size)||policy.page_size<1||policy.page_size>1000 :
      policy.kind!=='single_response'||!policy.review_reference?.trim())) throw new Error('Lift pagination policy requires review');
  }
  const now=deps.now??Date.now,start=now(),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30_000);timeout.unref();
  try {
    const result=await Promise.allSettled(reportNames.map(async kind=>{
      const policy=config.pagination[kind],endpoint=endpoints[kind],all:Record<string,unknown>[]=[];
      const auth=await deps.credentials(kind);
      if (auth && (!auth.user || !auth.password || auth.password==='********')) throw new Error('Lift report credentials unavailable');
      const headers:Record<string,string>={Accept:'application/json'};
      if(auth)headers.Authorization=`Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`;
      let offset=0,bytes=0;const seenPages=new Set<string>();
      for (let page=0;page<maxPages;page++) {
        const url=new URL(endpoint.url);url.searchParams.set(endpoint.parameter,receipt.confirmation!.order_number);url.searchParams.set('offset',String(offset));
        if(policy.kind==='offset')url.searchParams.set('limit',String(policy.page_size));
        const response=await (deps.fetch??fetch)(url,{method:'GET',headers,redirect:'error',signal:controller.signal});
        const parsed=await boundedJson(response,maxBytes-bytes);bytes+=parsed.bytes;const body=parsed.body;
        if (!body || Array.isArray(body) || !Array.isArray(body.rowset) || body.rowset.some(r=>!r||typeof r!=='object'||Array.isArray(r))) throw new Error('Unsupported Lift report page');
        const rows=body.rowset as Record<string,unknown>[];
        const pageHash=digest(stableJson(rows));if(rows.length&&seenPages.has(pageHash))throw new Error('Repeated Lift report page');seenPages.add(pageHash);
        if(rows.some(r=>String(r.ORDER_NUMBER)!==receipt.confirmation!.order_number))throw new Error('Cross-order report page');
        all.push(...rows);if(all.length>maxRows)throw new Error('Lift report row limit exceeded');
        if(body.hasMore!==undefined && body.has_more!==undefined && body.hasMore!==body.has_more)throw new Error('Conflicting pagination metadata');
        const more=body.hasMore??body.has_more;
        if(policy.kind==='single_response') {
          if(more!==undefined && more!==false)throw new Error('Single-response report is truncated');
          return {rowset:all};
        }
        if(typeof more!=='boolean' || rows.length>policy.page_size ||
          (body.offset!==undefined && body.offset!==offset) ||
          (body.count!==undefined && body.count!==rows.length))throw new Error('Unverified report pagination');
        if(!more)return {rowset:all};
        if(rows.length!==policy.page_size)throw new Error('Ambiguous next report offset');
        offset+=policy.page_size;
      }
      throw new Error('Lift report page limit exceeded');
    }));
    const failure=result.find(r=>r.status==='rejected');if(failure)throw new Error('Lift shipping collection failed');
    const completed=now();if(!Number.isFinite(start)||!Number.isFinite(completed)||completed<start||completed-start>30_000)throw new Error('Lift collection freshness exceeded');
    const values=result.map(r=>(r as PromiseFulfilledResult<{rowset:Record<string,unknown>[]}>).value);
    const reports:LiftShippingReports={order:values[0],packages:values[1],shipping:values[2],all_pages_read:true};
    const evidence={scope:structuredClone(config.scope),receipt_id:receipt.receipt_id,lift_order_number:receipt.confirmation.order_number,
      confirmation_sha256:receipt.confirmation.evidence_sha256,started_at:new Date(start).toISOString(),completed_at:new Date(completed).toISOString(),
      reports,pagination:structuredClone(config.pagination)};
    return {...evidence,evidence_sha256:digest(stableJson(evidence))};
  } catch {throw new Error('Lift shipping collection failed; no complete report set available');}
  finally {clearTimeout(timeout);controller.abort();}
}

/** Reconciliation supplies the durable source revision and reviewed dispatch facts.
 * Recheck freshness and association on both capture reads; no counter/time is invented. */
export async function captureCollectedLiftShipping(store:ReceiptStore,receiptId:string,collected:CollectedShippingReports,
  loadReview:(receipt:Receipt,evidenceSha256:string)=>Promise<LiftShippingReview>,now:()=>number=Date.now) {
  return captureLiftShippingReports(store,receiptId,async receipt=>{
    const {evidence_sha256,...evidence}=collected;
    const age=now()-Date.parse(collected.started_at),completed=Date.parse(collected.completed_at);
    if(digest(stableJson(evidence))!==evidence_sha256 || !Number.isFinite(age)||age<0||age>60_000 ||
      !Number.isFinite(completed)||completed<Date.parse(collected.started_at)||completed>now() ||
      collected.receipt_id!==receiptId || scopeKey(collected.scope)!==scopeKey(receiptScope(receipt)) ||
      collected.lift_order_number!==receipt.confirmation?.order_number || collected.confirmation_sha256!==receipt.confirmation.evidence_sha256) {
      throw new Error('Stale or changed shipping collection');
    }
    return {reports:structuredClone(collected.reports),review:await loadReview(structuredClone(receipt),evidence_sha256)};
  });
}

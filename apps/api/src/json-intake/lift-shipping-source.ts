import { digest, scopeKey, type WebhookScope } from '../webhooks/contract.js';
import { stableJson } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';
import { captureShippingSnapshot, projectShipping, type ShippingSnapshot } from './shipping-events.js';

type Row = Record<string, unknown>;
export interface LiftShippingReports {
  order: unknown;
  packages: unknown;
  shipping: unknown;
  /** Collector must verify every page; a successful first page is insufficient. */
  all_pages_read: boolean;
}
export interface LiftShippingReview {
  scope: WebhookScope;
  receipt_id: string;
  lift_order_number: string;
  target_customer_id: string;
  confirmation_sha256: string;
  line_bindings: Array<{ order_line_id: string; external_line_id: string }>;
  /** Explicit review of the order + SHIPPING_ID + BOX_NUMBER identity convention. */
  package_identity_review: string | null;
  /** Committed reconciliation revision/time, never generated afresh on each read. */
  source_revision: number;
  observed_at: string;
  packages: Array<{
    package_id: string;
    evidence_sha256: string;
    carrier: string;
    service: string;
    label_source: 'purchased' | 'customer_prepaid';
    status: 'pending' | 'shipped' | 'delivered';
    dispatch_evidence: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    source_updated_at: string;
  }>;
}

function text(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim() || String(value).length > 256) {
    throw new Error(`Invalid Lift shipping field: ${field}`);
  }
  return String(value).trim();
}
function amount(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))) throw new Error('Invalid Lift quantity');
  const result=Number(value);
  if (!Number.isFinite(result) || result<=0 || !Number.isSafeInteger(result*1_000_000)) throw new Error('Invalid Lift quantity');
  return result;
}
function rows(payload: unknown): Row[] {
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new Error('Unsupported Lift report envelope');
  const record=payload as Row;
  if (record.hasMore===true || record.has_more===true || !Array.isArray(record.rowset) || record.rowset.length>5000) throw new Error('Incomplete or unsupported Lift report');
  if (record.rowset.some(row=>!row || typeof row!=='object' || Array.isArray(row))) throw new Error('Invalid Lift report row');
  return record.rowset as Row[];
}
function shipDate(value: unknown): string | null {
  if (value==null || value==='') return null;
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid Lift actual ship date');
  const [year,month,day]=value.split('-').map(Number);
  if (year<2000 || month<1 || month>12 || day<1 || day>new Date(Date.UTC(year,month,0)).getUTCDate()) throw new Error('Invalid Lift actual ship date');
  return value;
}

/** Read-only adapter for the inspected Lift report shapes. Raw reports cannot authorize dispatch.
 * Missing package review yields evidence + gaps, never an emittable snapshot. */
export function prepareLiftShippingSnapshot(receipt: Receipt, reports: LiftShippingReports, review: LiftShippingReview) {
  const scope:WebhookScope={customer_id:receipt.identity.customer_id,integration_id:receipt.identity.integration_id,
    store:receipt.identity.store,environment:receipt.identity.environment};
  if (!receipt.confirmation || scopeKey(scope)!==scopeKey(review.scope) || review.scope.environment!=='test' ||
      review.receipt_id!==receipt.receipt_id || review.lift_order_number!==receipt.confirmation.order_number ||
      review.confirmation_sha256!==receipt.confirmation.evidence_sha256 || !/^[a-f0-9]{64}$/.test(review.confirmation_sha256)) {
    throw new Error('Lift shipping association mismatch');
  }
  if (reports.all_pages_read!==true) throw new Error('Lift report completeness unverified');
  const orders=rows(reports.order), packageRows=rows(reports.packages), shippingRows=rows(reports.shipping);
  if (orders.length!==1 || text(orders[0].ORDER_NUMBER,'ORDER_NUMBER')!==review.lift_order_number ||
      text(orders[0].CUSTOMER_ID,'CUSTOMER_ID')!==review.target_customer_id ||
      text(orders[0].EXT_ID,'EXT_ID')!==receipt.adapted.canonical.order.external_order_id || !Array.isArray(orders[0].LINES)) {
    throw new Error('Lift order identity mismatch');
  }
  const bindings=new Map<string,string>(), external=new Set<string>();
  for (const b of review.line_bindings) {
    if (!b.order_line_id || !b.external_line_id || bindings.has(b.order_line_id) || external.has(b.external_line_id)) throw new Error('Ambiguous Lift line binding');
    bindings.set(b.order_line_id,b.external_line_id);external.add(b.external_line_id);
  }
  const expected=new Map(receipt.adapted.canonical.lines.map(l=>[l.source_line.external_line_id,l.quantity]));
  if (expected.size!==receipt.adapted.canonical.lines.length || external.size!==expected.size || [...external].some(id=>!expected.has(id))) throw new Error('Lift line binding coverage mismatch');
  const observedLines=new Set<string>();
  for (const value of orders[0].LINES) {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid Lift order line');
    const line=value as Row,id=text(line.ORDER_LINE_ID,'ORDER_LINE_ID'),ext=bindings.get(id);
    if (!ext || observedLines.has(id) || amount(line.QUANTITY)!==expected.get(ext)) throw new Error('Lift expected quantity mismatch');
    observedLines.add(id);
  }
  if (observedLines.size!==bindings.size) throw new Error('Lift expected lines missing');
  const dates=new Map<string,string|null>();
  for (const row of shippingRows) {
    if (text(row.ORDER_NUMBER,'ORDER_NUMBER')!==review.lift_order_number) throw new Error('Cross-order shipping row');
    const id=text(row.ORDER_LINE_ID,'ORDER_LINE_ID'),date=shipDate(row.ACTUAL_SHIP_DATE);
    if (!bindings.has(id) || (dates.has(id) && dates.get(id)!==date)) throw new Error('Conflicting shipping line evidence');
    dates.set(id,date);
  }
  if (dates.size!==bindings.size) throw new Error('Shipping line coverage incomplete');
  type PackageEvidence = {package_id:string;package_number:number;tracking_number:string;ship_method:string;
    lines:Array<{external_line_id:string;quantity:number;actual_ship_date:string|null}>};
  const grouped=new Map<string,PackageEvidence>();
  for (const row of packageRows) {
    if (text(row.ORDER_NUMBER,'ORDER_NUMBER')!==review.lift_order_number) throw new Error('Cross-order package row');
    const shippingId=text(row.SHIPPING_ID,'SHIPPING_ID'),box=text(row.BOX_NUMBER,'BOX_NUMBER');
    if (!/^[1-9]\d*$/.test(box) || !Number.isSafeInteger(Number(box))) throw new Error('Invalid Lift box number');
    const package_id=`lift_${digest(stableJson([review.lift_order_number,shippingId,box]))}`;
    const tracking=row.PACKAGE_TRACKING_NUMBER==null?'':text(row.PACKAGE_TRACKING_NUMBER,'PACKAGE_TRACKING_NUMBER');
    const method=row.SHIP_METHOD==null?'':text(row.SHIP_METHOD,'SHIP_METHOD');
    let pkg=grouped.get(package_id);
    if (!pkg) {pkg={package_id,package_number:Number(box),tracking_number:tracking,ship_method:method,lines:[]};grouped.set(package_id,pkg);}
    if (pkg.tracking_number!==tracking || pkg.ship_method!==method) throw new Error('Conflicting package metadata');
    const id=text(row.ORDER_LINE_ID,'ORDER_LINE_ID'),ext=bindings.get(id);
    if (!ext) throw new Error('Unknown package line');
    const line={external_line_id:ext,quantity:amount(row.QUANTITY),actual_ship_date:dates.get(id)!};
    const prior=pkg.lines.find(l=>l.external_line_id===ext);
    // Lift's join may repeat allocation rows. Equal projections count once; conflicts never sum.
    if (prior && stableJson(prior)!==stableJson(line)) throw new Error('Conflicting package allocation');
    if (!prior) pkg.lines.push(line);
  }
  const evidence=[...grouped.values()].sort((a,b)=>a.package_id.localeCompare(b.package_id)).map(pkg=>{
    pkg.lines.sort((a,b)=>a.external_line_id.localeCompare(b.external_line_id));
    return {...pkg,evidence_sha256:digest(stableJson(pkg))};
  });
  const gaps:Array<{code:string;package_id?:string}>=[];
  if (!review.package_identity_review?.trim()) gaps.push({code:'PACKAGE_IDENTITY_POLICY_UNREVIEWED'});
  const reviews=new Map<string,LiftShippingReview['packages'][number]>();
  for (const item of review.packages) {
    if (reviews.has(item.package_id) || !grouped.has(item.package_id)) throw new Error('Unknown or duplicate package review');
    reviews.set(item.package_id,item);
  }
  const packages:ShippingSnapshot['packages']=[];
  for (const pkg of evidence) {
    const fact=reviews.get(pkg.package_id);
    if (!fact) {gaps.push({code:'PACKAGE_DISPATCH_REVIEW_REQUIRED',package_id:pkg.package_id});continue;}
    if (fact.evidence_sha256!==pkg.evidence_sha256) {gaps.push({code:'PACKAGE_EVIDENCE_CHANGED',package_id:pkg.package_id});continue;}
    packages.push({package_id:pkg.package_id,package_number:pkg.package_number,tracking_number:pkg.tracking_number,
      carrier:fact.carrier,service:fact.service,label_source:fact.label_source,status:fact.status,
      dispatch_evidence:fact.dispatch_evidence,shipped_at:fact.shipped_at,delivered_at:fact.delivered_at,
      source_updated_at:fact.source_updated_at,lines:pkg.lines.map(({external_line_id,quantity})=>({external_line_id,quantity}))});
  }
  // Validate allocations even before review, using non-dispatched packages only.
  const base={scope,receipt_id:receipt.receipt_id,lift_order_number:review.lift_order_number,
    confirmation_sha256:review.confirmation_sha256,source_revision:review.source_revision,observed_at:review.observed_at,complete:true};
  projectShipping(receipt,{...base,packages:evidence.map(pkg=>({package_id:pkg.package_id,package_number:pkg.package_number,
    tracking_number:pkg.tracking_number,carrier:'',service:'',label_source:'purchased',status:'pending',dispatch_evidence:null,
    shipped_at:null,delivered_at:null,source_updated_at:review.observed_at,
    lines:pkg.lines.map(({external_line_id,quantity})=>({external_line_id,quantity}))}))});
  const snapshot:ShippingSnapshot|null=gaps.length?null:{...base,packages};
  if (snapshot) projectShipping(receipt,snapshot);
  return {evidence,gaps,snapshot};
}

/** Connect committed report/review reads to receipt capture. No HTTP fetches or source writes.
 * Unresolved review is deliberately incomplete so capture places a hold, never drops packages. */
export async function captureLiftShippingReports(store:ReceiptStore, receiptId:string,
  load:(receipt:Receipt)=>Promise<{reports:LiftShippingReports;review:LiftShippingReview}>) {
  return captureShippingSnapshot(store,receiptId,async receipt=>{
    try {
      const {reports,review}=await load(receipt);
      const prepared=prepareLiftShippingSnapshot(receipt,reports,review);
      return prepared.snapshot ?? {scope:review.scope,receipt_id:receipt.receipt_id,lift_order_number:review.lift_order_number,
        confirmation_sha256:review.confirmation_sha256,source_revision:review.source_revision,
        observed_at:review.observed_at,complete:false,packages:[]};
    } catch {
      // Keep the prior evidence but stop pending delivery after an unverified source read.
      if (!receipt.shipping_review && !await store.compareAndSet(receipt,{...receipt,revision:receipt.revision+1,
        shipping_review:{code:'SOURCE_UNVERIFIED',source_revision:receipt.shipping?.source_revision ?? 0}})) {
        throw new Error('Shipping receipt conflict');
      }
      throw new Error('Lift shipping source verification failed; review required');
    }
  });
}

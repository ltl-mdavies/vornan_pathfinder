import { committedEvent, digest, scopeKey, type WebhookScope } from '../webhooks/contract.js';
import { stableJson } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';

/** Trusted, normalized source projection. Never accepted from partner order input.
 * source_revision must come from durable reconciliation, not a polling counter.
 * No live Lift binding or attachment publication is installed by this module. */
export interface ShippingSnapshot {
  scope: WebhookScope;
  receipt_id: string;
  lift_order_number: string;
  confirmation_sha256: string;
  source_revision: number;
  observed_at: string;
  complete: boolean;
  packages: Array<{
    package_id: string;
    package_number: number;
    carrier: string;
    service: string;
    tracking_number: string;
    label_source: 'purchased' | 'customer_prepaid';
    status: 'pending' | 'shipped' | 'delivered';
    dispatch_evidence: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    source_updated_at: string;
    lines: Array<{ external_line_id: string; quantity: number }>;
  }>;
}

const receiptScope = (r: Receipt): WebhookScope => ({customer_id:r.identity.customer_id,
  integration_id:r.identity.integration_id,store:r.identity.store,environment:r.identity.environment});
const nonempty = (s: unknown): s is string => typeof s === 'string' && Boolean(s.trim()) && s.length <= 256;
function timestamp(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) return false;
  const [year,month,day]=s.slice(0,10).split('-').map(Number);
  return year>=2000 && month>=1 && month<=12 && day>=1 && day<=new Date(Date.UTC(year,month,0)).getUTCDate();
}
// Exact bounded millionths avoid floating-point summation and retain fractional allocations.
function quantity(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(value * 1_000_000)) {
    throw new Error('Invalid shipping quantity');
  }
  return BigInt(value * 1_000_000);
}

export function projectShipping(r: Receipt, snapshot = r.shipping) {
  if (!snapshot || !r.confirmation || snapshot.scope.environment !== 'test' ||
      scopeKey(snapshot.scope) !== scopeKey(receiptScope(r)) || snapshot.receipt_id !== r.receipt_id ||
      snapshot.lift_order_number !== r.confirmation.order_number ||
      snapshot.confirmation_sha256 !== r.confirmation.evidence_sha256 ||
      !/^[a-f0-9]{64}$/.test(snapshot.confirmation_sha256) ||
      !Number.isSafeInteger(snapshot.source_revision) || snapshot.source_revision < 1 ||
      !timestamp(snapshot.observed_at) || typeof snapshot.complete !== 'boolean' || !Array.isArray(snapshot.packages)) {
    throw new Error('Shipping evidence binding mismatch');
  }
  const expected = new Map(r.adapted.canonical.lines.map(line => [line.source_line.external_line_id, quantity(line.quantity)]));
  if (!expected.size || expected.size !== r.adapted.canonical.lines.length) throw new Error('Invalid expected shipping lines');
  const allocated = new Map<string,bigint>(), shipped = new Map<string,bigint>();
  const ids = new Set<string>();
  const shipments = [];
  for (const pkg of snapshot.packages) {
    if (!nonempty(pkg.package_id) || ids.has(pkg.package_id) || !Number.isSafeInteger(pkg.package_number) || pkg.package_number < 1 ||
        !['pending','shipped','delivered'].includes(pkg.status) || !['purchased','customer_prepaid'].includes(pkg.label_source) ||
        !timestamp(pkg.source_updated_at) || Date.parse(pkg.source_updated_at) > Date.parse(snapshot.observed_at) ||
        !Array.isArray(pkg.lines) || !pkg.lines.length) throw new Error('Invalid shipment package');
    ids.add(pkg.package_id);
    const dispatched = pkg.status !== 'pending';
    if (dispatched && (!nonempty(pkg.dispatch_evidence) || !nonempty(pkg.carrier) || !nonempty(pkg.service) || !nonempty(pkg.tracking_number))) {
      throw new Error('Shipment dispatch evidence missing');
    }
    if (pkg.status === 'pending' && (pkg.dispatch_evidence !== null || pkg.shipped_at !== null || pkg.delivered_at !== null)) {
      throw new Error('Pending label cannot establish dispatch');
    }
    for (const time of [pkg.shipped_at, pkg.delivered_at]) {
      if (time !== null && (!timestamp(time) || Date.parse(time) > Date.parse(pkg.source_updated_at))) throw new Error('Invalid shipment timestamp');
    }
    if ((pkg.status !== 'delivered' && pkg.delivered_at !== null) ||
        (pkg.shipped_at && pkg.delivered_at && Date.parse(pkg.delivered_at) < Date.parse(pkg.shipped_at))) throw new Error('Invalid delivery chronology');
    const lineIds = new Set<string>();
    for (const line of pkg.lines) {
      if (!expected.has(line.external_line_id) || lineIds.has(line.external_line_id)) throw new Error('Unknown or duplicate shipment line');
      lineIds.add(line.external_line_id);
      const amount = quantity(line.quantity);
      allocated.set(line.external_line_id, (allocated.get(line.external_line_id) ?? 0n) + amount);
      if (allocated.get(line.external_line_id)! > expected.get(line.external_line_id)!) throw new Error('Shipping allocation exceeds order quantity');
      if (dispatched) shipped.set(line.external_line_id, (shipped.get(line.external_line_id) ?? 0n) + amount);
    }
    if (dispatched) shipments.push({
      shipment_id: `shp_${digest(stableJson([scopeKey(snapshot.scope),r.receipt_id,snapshot.lift_order_number,pkg.package_id]))}`,
      package_number: pkg.package_number, carrier:pkg.carrier, service:pkg.service, tracking_number:pkg.tracking_number,
      tracking_url:null, status:pkg.status, shipped_at:pkg.shipped_at, delivered_at:pkg.delivered_at,
      lines:pkg.lines.map(line=>({external_line_id:line.external_line_id,quantity:line.quantity})).sort((a,b)=>a.external_line_id.localeCompare(b.external_line_id)),
      source_updated_at:pkg.source_updated_at
    });
  }
  shipments.sort((a,b)=>a.shipment_id.localeCompare(b.shipment_id));
  const allShipped = snapshot.complete && [...expected].every(([id,total])=>shipped.get(id) === total);
  return {fulfillment_status:allShipped?'shipped':shipments.length?'partially_shipped':'not_shipped',all_items_shipped:allShipped,shipments};
}

/** Double-read the injected authority, then commit in the existing receipt CAS sequence. */
export async function captureShippingSnapshot(store: ReceiptStore, receiptId: string, load: (receipt: Receipt)=>Promise<ShippingSnapshot>) {
  const r = await store.get(receiptId);
  if (!r) throw new Error('Receipt missing');
  const next = structuredClone(await load(structuredClone(r)));
  projectShipping(r,next);
  const hold = async (code: NonNullable<Receipt['shipping_review']>['code'], message: string): Promise<never> => {
    if (!await store.compareAndSet(r,{...r,revision:r.revision+1,shipping_review:{code,source_revision:next.source_revision}})) throw new Error('Shipping receipt conflict');
    throw new Error(message);
  };
  if (r.shipping) {
    if (next.source_revision < r.shipping.source_revision) throw new Error('Stale shipping evidence');
    if (next.source_revision === r.shipping.source_revision && stableJson(next) !== stableJson(r.shipping)) return hold('CONFLICT','Shipping revision conflict');
    if (Date.parse(next.observed_at) < Date.parse(r.shipping.observed_at)) throw new Error('Shipping observation moved backwards');
    for (const old of r.shipping.packages.filter(pkg=>pkg.status!=='pending')) {
      const pkg = next.packages.find(p=>p.package_id===old.package_id);
      if (!pkg || pkg.status==='pending' || (old.status==='delivered' && pkg.status!=='delivered') ||
          stableJson([...pkg.lines].sort((a,b)=>a.external_line_id.localeCompare(b.external_line_id))) !==
          stableJson([...old.lines].sort((a,b)=>a.external_line_id.localeCompare(b.external_line_id)))) {
        return hold('REVERSAL','Dispatched package reversal requires review');
      }
    }
  }
  if (!next.complete) return hold('INCOMPLETE','Incomplete shipping evidence');
  if (stableJson(await load(structuredClone(r))) !== stableJson(next)) return hold('DRIFT','Shipping evidence changed');
  if (r.shipping_review) throw new Error('Shipping review must be resolved before further capture');
  if (r.shipping && stableJson(next) === stableJson(r.shipping)) return r;
  const updated = {...r,revision:r.revision+1,shipping:next,
    updated_at:new Date(Math.max(Date.parse(r.updated_at),Date.parse(next.observed_at))).toISOString()};
  if (!await store.compareAndSet(r,updated)) throw new Error('Shipping receipt conflict');
  return updated;
}

/** Materialized from immutable receipt revisions; normal polling without a change emits nothing. */
export function shippingEvents(r: Receipt, previous?: ReturnType<typeof projectShipping>) {
  if (!r.shipping || !r.shipping.complete || r.shipping_review) return [];
  const current = projectShipping(r);
  const base = {receipt_id:r.receipt_id,order_number:r.adapted.canonical.source.source_record_id,
    lift_order_number:r.confirmation!.order_number,occurred_at:r.shipping.observed_at,order_revision:r.revision+1};
  const events = current.shipments.filter(shipment => {
    const old = previous?.shipments.find(s=>s.shipment_id===shipment.shipment_id);
    return !old || stableJson(old)!==stableJson(shipment) || previous?.fulfillment_status !== current.fulfillment_status;
  }).map(shipment=>committedEvent(receiptScope(r),`${r.receipt_id}:${r.revision}:${shipment.shipment_id}:shipping:v1`,{
    ...base,event_type:'shipment.updated',data:{fulfillment_status:current.fulfillment_status,shipment}
  }));
  if (current.all_items_shipped && stableJson(current)!==stableJson(previous ?? null)) events.push(committedEvent(
    receiptScope(r),`${r.receipt_id}:${r.revision}:shipped:v1`,{...base,event_type:'order.shipped',data:current}
  ));
  return events;
}

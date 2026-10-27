import { digest } from '../webhooks/contract.js';
import { stableJson } from './adapter.js';
import type { Receipt } from './local-store.js';
import { projectShipping, shippingEvents } from './shipping-events.js';

/** Exact reviewed full snapshot/event set. Does not enable general shipping collection. */
export interface FullShippingPermit {
  receipt_id: string;
  receipt_revision: number;
  snapshot_sha256: string;
  event_ids: string[];
  delivery_before: string;
}
export function reviewedFullShipping(r: Receipt, permits: FullShippingPermit[]) {
  if (r.shipping_review || !r.shipping?.complete) throw new Error('Full shipping evidence requires review');
  const projection = projectShipping(r);
  if (!projection.all_items_shipped || projection.fulfillment_status !== 'shipped' || !projection.shipments.length) {
    throw new Error('Full shipping requires every line quantity');
  }
  const events = shippingEvents(r);
  if (events.filter(e => e.envelope.event_type === 'order.shipped').length !== 1) throw new Error('Full shipping event mismatch');
  const ids = events.map(e => e.envelope.event_id).sort();
  const permit = permits.find(p => p.receipt_id === r.receipt_id && p.receipt_revision === r.revision &&
    p.snapshot_sha256 === digest(stableJson(r.shipping)) && Array.isArray(p.event_ids) &&
    stableJson([...p.event_ids].sort()) === stableJson(ids));
  if (!permit || !Number.isFinite(Date.parse(permit.delivery_before))) throw new Error('Full shipping permit mismatch');
  return { events, permit };
}

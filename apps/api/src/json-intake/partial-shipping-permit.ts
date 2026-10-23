import { digest } from '../webhooks/contract.js';
import { stableJson } from './adapter.js';
import type { Receipt } from './local-store.js';
import { projectShipping, shippingEvents } from './shipping-events.js';

/** Operator-reviewed immutable snapshot; does not authorize general shipping delivery. */
export interface PartialShippingPermit {
  receipt_id: string;
  receipt_revision: number;
  snapshot_sha256: string;
  event_id: string;
  delivery_before: string;
}
export function reviewedPartialShipping(r: Receipt, permits: PartialShippingPermit[]) {
  if (r.shipping_review || !r.shipping?.complete) throw new Error('Sandbox callback source requires expanded review');
  const projection = projectShipping(r);
  if (projection.fulfillment_status !== 'partially_shipped' || projection.all_items_shipped || projection.shipments.length !== 1) {
    throw new Error('Only one reviewed partial shipment is permitted');
  }
  const events = shippingEvents(r);
  if (events.length !== 1 || events[0].envelope.event_type !== 'shipment.updated') throw new Error('Partial shipping event mismatch');
  const event = events[0];
  const permit = permits.find(p => p.receipt_id === r.receipt_id && p.receipt_revision === r.revision &&
    p.snapshot_sha256 === digest(stableJson(r.shipping)) && p.event_id === event.envelope.event_id);
  if (!permit || !Number.isFinite(Date.parse(permit.delivery_before))) throw new Error('Partial shipping permit mismatch');
  return { event, permit };
}

import { normalizeProofOrder, toOrderRollupProofProjection, type ProofOrder } from "@pathfinder/proof-domain";
import { normalizeLiftOrderLookupPayload, type OrderRollupProofSummary } from "@pathfinder/order-rollup";

/** Display summary only. Access still requires the separate parent/grant/policy checks. */
export function freshStatusProofSummary(input: {
  orderNumber: string; cached: ProofOrder | null; orderPayload: unknown;
  proofPayload: unknown; orderOk: boolean; proofOk: boolean; now: string;
}): OrderRollupProofSummary | null {
  const cached = input.cached;
  const age = cached ? Date.parse(input.now) - Date.parse(cached.last_synced_at) : NaN;
  const header = normalizeLiftOrderLookupPayload(input.orderPayload);
  const rows = (input.proofPayload as { rowset?: unknown } | null)?.rowset;
  if (!input.orderOk || !input.proofOk || !cached || cached.health !== "active"
    || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000
    || cached.order_number !== input.orderNumber || header?.order_number !== input.orderNumber
    || String(header.customer_id) !== cached.customer_id
    || !Array.isArray(rows) || rows.some(row => !row || String(row.ORDER_NUMBER) !== input.orderNumber)) return null;
  try {
    const current = normalizeProofOrder({ order_number: input.orderNumber,
      order_payload: input.orderPayload, proof_payloads: [input.proofPayload],
      previous: cached, synced_at: input.now });
    if (current.customer_id !== cached.customer_id || current.order_number !== cached.order_number) return null;
    return { ...toOrderRollupProofProjection(current).summary, source: "lift_report" };
  } catch { return null; }
}

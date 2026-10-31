import type { ProofAccessGrant } from "@pathfinder/proof-domain";
import type { OrderStatusTokenRecord } from "../store.js";
import { readStatusParent } from "./status-parent-reader.js";
import { getProofOrder } from "./store.js";
import { LTL_DEMO_STATUS_REVIEWER } from "./status-reviewer-authorization.js";

export function statusParentAllows(grant: ProofAccessGrant, parent: OrderStatusTokenRecord | null,
  visibility: string | undefined, now: Date) {
  const origin = grant.status_origin;
  if (!origin) return true;
  const reviewer = grant.status_reviewer;
  const verifiedReview = grant.scope === "review" && reviewer?.email === LTL_DEMO_STATUS_REVIEWER
    && Boolean(reviewer.uid) && Number.isFinite(Date.parse(reviewer.verified_at))
    && Date.parse(reviewer.verified_at) <= now.getTime()
    && Number.isFinite(Date.parse(reviewer.expires_at)) && Date.parse(reviewer.expires_at) > now.getTime()
    && Date.parse(reviewer.expires_at) - Date.parse(reviewer.verified_at) <= 15 * 60 * 1000
    && Date.parse(grant.expires_at) <= Date.parse(reviewer.expires_at);
  if ((grant.scope !== "view" && !verifiedReview) || (grant.scope === "view" && reviewer) || grant.kind || origin.customer_id !== "1249"
    || !/^[a-f0-9]{64}$/.test(origin.token_hash) || !parent || parent.token_hash !== origin.token_hash
    || parent.status !== "Active" || !Number.isFinite(Date.parse(parent.expires_at))
    || Date.parse(parent.expires_at) <= now.getTime() || !Number.isFinite(Date.parse(grant.expires_at))
    || Date.parse(grant.expires_at) <= now.getTime() || Date.parse(grant.expires_at) > Date.parse(parent.expires_at)
    || visibility !== "review_link") return false;
  const orders = parent.orders?.length ? parent.orders : [parent];
  return orders.some(order => order.order_key === origin.order_key && order.customer_id === origin.customer_id
    && order.order_number === grant.order_number);
}

export async function validateStatusViewParent(grant: ProofAccessGrant, now: Date) {
  if (!grant.status_origin) return true;
  if (process.env.PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO !== "true") return false;
  if (grant.status_reviewer && process.env.PATHFINDER_PROOF_STATUS_REVIEWER_SIGNIN !== "true") return false;
  const [{ parent, visibility }, order] = await Promise.all([
    readStatusParent(grant.status_origin.token_hash, grant.status_origin.customer_id), getProofOrder(grant.order_number)
  ]);
  return order?.customer_id === "1249" && !(order.lines.length > 0 && order.lines.every(line => line.cancelled))
    && statusParentAllows(grant, parent, visibility, now);
}

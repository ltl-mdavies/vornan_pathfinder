import { createHash, createHmac } from "node:crypto";
import type { ProofAccessGrant, ProofAccessSession, ProofAuditEvent } from "@pathfinder/proof-domain";
import { activationDeadline, ProofAccessDeniedError, validateProofCsrf } from "./access-service.js";
import { revalidateProofCustomerCapability, type ProofCustomerCapabilityAuthorityReader } from "./customer-capability-authority.js";
import { proofShareContext, proofShareManagementAllowed } from "./share-policy.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { getProofGrantForOrder, listProofGrants } from "./store.js";
import { createDelegatedProofGrant, replaceProofGrant } from "./grant-store.js";

export class ProofShareError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 410 | 429, message: string, readonly code?: "access_changed" | "request_conflict") { super(message); }
}
type Authority = { session: ProofAccessSession; expected_order_number: unknown; expected_share_context: unknown; readWorkspace?: ProofCustomerCapabilityAuthorityReader };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const active = (grant: ProofAccessGrant, now: Date) => grant.status === "active" && !grant.revoked_at && Date.parse(grant.expires_at) > now.getTime();
function auditFor(grant: ProofAccessGrant, session: ProofAccessSession, now: Date): ProofAuditEvent {
  return {
    event_id: `paudit_share-${hash(`${grant.grant_id}:${grant.status}`)}`, occurred_at: now.toISOString(),
    action: grant.status === "active" ? "proof.grant_created" : "proof.grant_revoked", outcome: "succeeded",
    order_number: grant.order_number, grant_id: grant.grant_id, task_id: null, order_line_id: null, attachment_id: null,
    participant_id: session.participant_id, actor_type: "customer_session", actor_id: session.session_id,
    correlation_id: grant.grant_id, metadata: { source: "public_api", grant_scope: grant.scope, grant_status: grant.status }
  };
}

async function manager({ session, readWorkspace, expected_order_number, expected_share_context }: Authority, now: Date) {
  if (expected_order_number !== session.order_number || expected_share_context !== proofShareContext(session)) {
    throw new ProofShareError(409, "Your review access changed. Reopen sharing from the current order.", "access_changed");
  }
  activationDeadline(now, true);
  const parent = await getProofGrantForOrder(session.order_number, session.grant_id);
  if (session.ended_at || session.delegated || Date.parse(session.expires_at) <= now.getTime() ||
      !parent || !active(parent, now) || !proofShareManagementAllowed(parent, now) || session.scope !== parent.scope ||
      JSON.stringify(session.capability) !== JSON.stringify(parent.capability) ||
      !await revalidateProofCustomerCapability(parent, readWorkspace)) throw new ProofAccessDeniedError();
  return parent;
}

export function publicSharedLink(grant: ProofAccessGrant, now = new Date()) {
  return {
    id: grant.grant_id, scope: grant.scope, description: grant.label,
    created_at: grant.created_at, expires_at: grant.expires_at,
    status: grant.status === "revoked" || grant.revoked_at ? "revoked" as const :
      Date.parse(grant.expires_at) <= now.getTime() ? "expired" as const : "active" as const
  };
}

export async function listSharedProofLinks(input: Authority, now = new Date()) {
  const parent = await manager(input, now);
  return (await listProofGrants(parent.order_number))
    .filter((grant) => grant.kind === "delegated" && grant.parent_grant_id === parent.grant_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((grant) => publicSharedLink(grant, now));
}

export async function createSharedProofLink(input: Authority & {
  csrf: string; idempotency_key: unknown; scope: unknown; days: unknown; description: unknown;
}, now = new Date()) {
  const parent = await manager(input, now);
  if (!validateProofCsrf(input.session, input.csrf)) throw new ProofAccessDeniedError();
  if (typeof input.idempotency_key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.idempotency_key) ||
      (input.scope !== "view" && input.scope !== "review") || ![1, 3, 7, 14].includes(input.days as number) ||
      typeof input.description !== "string" || input.description.length > 100 || /[\u0000-\u001f\u007f]/.test(input.description)) {
    throw new ProofShareError(400, "Choose link access, an expiry, and a description of up to 100 characters.");
  }
  if (input.scope === "review" && !getProofRuntimeConfig().feature_flags.approve) {
    throw new ProofShareError(403, "Review access is not currently available.");
  }
  const identity = JSON.stringify(["vornan-proof-share-v1", parent.grant_id, input.session.session_id, input.idempotency_key]);
  const grantId = `pshare_${hash(identity)}`;
  // Recover the identical secret after response loss within this session. Never store it.
  const token = createHmac("sha256", Buffer.from(input.csrf, "base64url")).update(identity).digest("base64url");
  const requestHash = hash(JSON.stringify([parent.order_number, input.scope, input.days, input.description.trim()]));
  const result = (grant: ProofAccessGrant) => ({
    link: publicSharedLink(grant, now),
    access_url: `${getProofRuntimeConfig().access.public_base_url}/#/access/${token}`
  });
  const replay = (existing: ProofAccessGrant) => {
    if (existing.kind !== "delegated" || existing.parent_grant_id !== parent.grant_id ||
        existing.created_by_session_id !== input.session.session_id || existing.share_request_hash !== requestHash ||
        existing.token_hash !== hash(token)) throw new ProofShareError(409, "This link request has changed. Check the saved links before starting again.", "request_conflict");
    if (!active(existing, now) || Date.parse(existing.expires_at) > Date.parse(parent.expires_at) ||
        JSON.stringify(existing.capability) !== JSON.stringify(parent.capability)) {
      throw new ProofShareError(410, "This link is no longer active. Create a new link.");
    }
    return result(existing);
  };
  const existing = await getProofGrantForOrder(parent.order_number, grantId);
  if (existing) return replay(existing);
  if ((parent.share_created_count ?? 0) >= 100) throw new ProofShareError(429, "The shared-link limit has been reached for this access.");
  if (parent.share_last_created_at && now.getTime() - Date.parse(parent.share_last_created_at) < 5_000) {
    throw new ProofShareError(429, "Please wait a few seconds before creating another link.");
  }
  const deadline = activationDeadline(now, true);
  const expires = Math.min(now.getTime() + Number(input.days) * 86_400_000, Date.parse(parent.expires_at),
    deadline?.getTime() ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(expires) || expires <= now.getTime()) throw new ProofAccessDeniedError();
  const child: ProofAccessGrant = {
    kind: "delegated", parent_grant_id: parent.grant_id, created_by_session_id: input.session.session_id,
    share_request_hash: requestHash, grant_id: grantId, order_number: parent.order_number,
    scope: input.scope, label: input.description.trim() || null, status: "active", token_hash: hash(token),
    created_at: now.toISOString(), expires_at: new Date(expires).toISOString(), expires_at_epoch: Math.floor(expires / 1000),
    exchanged_at: null, revoked_at: null, last_used_at: null, capability: parent.capability
  };
  if (!await createDelegatedProofGrant(parent, child, auditFor(child, input.session, now))) {
    // A duplicate create may win; a concurrent revocation must never resurrect the parent.
    await manager(input, now);
    const winner = await getProofGrantForOrder(parent.order_number, grantId);
    if (winner) return replay(winner);
    throw new ProofShareError(409, "Access changed while creating this link. Try again.");
  }
  // Confirm parent is still valid before disclosing the newly-created link.
  await manager(input, now);
  return result(child);
}

export async function revokeSharedProofLink(input: Authority & { id: string }, now = new Date()) {
  const parent = await manager(input, now);
  for (let attempt = 0; attempt < 3; attempt++) {
    const child = await getProofGrantForOrder(parent.order_number, input.id);
    if (!child || child.kind !== "delegated" || child.parent_grant_id !== parent.grant_id) throw new ProofAccessDeniedError();
    if (child.status === "revoked") return publicSharedLink(child, now);
    const revoked = { ...child, status: "revoked" as const, revoked_at: now.toISOString() };
    if (!await replaceProofGrant(child, revoked, auditFor(revoked, input.session, now))) continue;
    return publicSharedLink(revoked, now);
  }
  throw new ProofShareError(409, "This link changed. Refresh the list and try again.");
}

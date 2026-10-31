import { createHash } from "node:crypto";
import type { ProofAccessGrant, ProofAccessSession } from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";

/** Off by default. Each activation is an exact durable Lift customer + order pair. */
export function proofSharingScopeAllowed(grant: ProofAccessGrant) {
  const runtime = getProofRuntimeConfig();
  const pair = `${grant.capability?.proof_customer_id}:${grant.order_number}`;
  const scopes = process.env.PATHFINDER_PROOF_SHARING_SCOPES ?? "";
  return runtime.feature_flags.public_read &&
    process.env.PATHFINDER_PROOF_ENABLE_SHARING === "true" &&
    /^\d{1,20}:A\d{7,8}(,\d{1,20}:A\d{7,8}){0,24}$/.test(scopes) && scopes.split(",").includes(pair);
}

/** A public consistency marker, not an access credential. The session cookie still authenticates. */
export function proofShareContext(session: ProofAccessSession) {
  return createHash("sha256").update(JSON.stringify(["proof-share-context-v1", session.order_number, session.grant_id, session.session_id])).digest("hex");
}

export function proofShareManagementAllowed(grant: ProofAccessGrant, now = new Date()) {
  return proofSharingScopeAllowed(grant) && !grant.kind && !grant.parent_grant_id && !grant.status_origin &&
    grant.scope === "review" && grant.capability?.access_mode === "review" &&
    grant.status === "active" && !grant.revoked_at && Date.parse(grant.expires_at) > now.getTime();
}

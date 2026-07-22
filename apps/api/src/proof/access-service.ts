import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  normalizeLiftOrderNumber,
  type ProofAccessGrant,
  type ProofAccessSession,
  type ProofGrantScope
} from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { recordProofAuditEvent, type ProofAuditContext } from "./audit-service.js";
import {
  claimProofGrant,
  getProofGrantById,
  getProofGrantByTokenHash,
  getProofOrder,
  getProofSessionByHash,
  listProofParticipants,
  listProofGrants,
  persistProofGrant,
  persistProofSession
} from "./store.js";

export class ProofAccessDeniedError extends Error {
  constructor() {
    super("This proof access link is invalid or has expired.");
    this.name = "ProofAccessDeniedError";
  }
}

export class ProofAccessFeatureDisabledError extends Error {
  constructor(feature: "grant creation" | "proof link email" | "public read") {
    super(`Vornan Proof ${feature} is disabled.`);
    this.name = "ProofAccessFeatureDisabledError";
  }
}

export class ProofAccessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofAccessValidationError";
  }
}

export class ProofGrantCohortDeniedError extends Error {
  constructor() {
    super("Proof access is outside the configured read-only grant cohort.");
    this.name = "ProofGrantCohortDeniedError";
  }
}

export class ProofOrderNotSynchronizedError extends Error {
  constructor(orderNumber: string) {
    super(`Proof order ${orderNumber} must be synchronized before access can be granted.`);
    this.name = "ProofOrderNotSynchronizedError";
  }
}

export interface PublicProofGrant {
  grant_id: string;
  order_number: string;
  scope: ProofGrantScope;
  label: string | null;
  status: ProofAccessGrant["status"];
  created_at: string;
  expires_at: string;
  exchanged_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  participant_count: number;
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateProofCsrf(session: ProofAccessSession, rawCsrf: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawCsrf) || !/^[a-f0-9]{64}$/.test(session.csrf_hash ?? "")) {
    return false;
  }
  const candidate = Buffer.from(hashSecret(rawCsrf), "hex");
  const expected = Buffer.from(session.csrf_hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function addMilliseconds(now: Date, milliseconds: number) {
  return new Date(now.getTime() + milliseconds);
}

function activationDeadline(now: Date, publicRequest = false) {
  const configured = getProofRuntimeConfig().access.read_only_activation_expires_at;
  const deadline = configured ? new Date(configured) : null;
  if (!deadline || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= now.getTime()) {
    if (publicRequest) throw new ProofAccessDeniedError();
    throw new ProofAccessValidationError("The read-only Proof activation window is not configured or has expired.");
  }
  return deadline;
}

function activeGrant(grant: ProofAccessGrant | null, now: Date) {
  return Boolean(grant && grant.status === "active" && !grant.revoked_at && Date.parse(grant.expires_at) > now.getTime());
}

export async function validateProofGrantAccessUrl(grantId: string, accessUrl: string, now = new Date()) {
  const config = getProofRuntimeConfig();
  let parsed: URL;
  let publicBase: URL;
  try {
    parsed = new URL(accessUrl);
    publicBase = new URL(config.access.public_base_url);
  } catch {
    throw new ProofAccessValidationError("Proof access link must be a valid URL.");
  }

  const rawToken = parsed.hash.match(/^#\/access\/([A-Za-z0-9_-]{43})$/)?.[1];
  const expectedPath = publicBase.pathname.endsWith("/") ? publicBase.pathname : `${publicBase.pathname}/`;
  if (
    !rawToken ||
    parsed.origin !== publicBase.origin ||
    parsed.pathname !== expectedPath ||
    parsed.search ||
    parsed.username ||
    parsed.password
  ) {
    throw new ProofAccessValidationError("Proof access link does not match the configured Vornan Proof origin.");
  }

  const [grantById, grantByToken] = await Promise.all([
    getProofGrantById(grantId),
    getProofGrantByTokenHash(hashSecret(rawToken))
  ]);
  if (!grantById) {
    return null;
  }
  if (
    !grantByToken ||
    grantByToken.grant_id !== grantById.grant_id ||
    !activeGrant(grantById, now) ||
    grantById.exchanged_at
  ) {
    throw new ProofAccessValidationError("Proof access link does not match an unused active grant.");
  }
  return grantById;
}

export function publicProofGrant(grant: ProofAccessGrant, participantCount = 0): PublicProofGrant {
  const { token_hash: _tokenHash, expires_at_epoch: _expiresEpoch, ...safe } = grant;
  return { ...safe, participant_count: participantCount };
}

export async function createProofGrant(input: {
  order_number: string;
  label?: string | null;
  scope?: ProofGrantScope;
  expires_at?: string | null;
  now?: Date;
  audit_context?: ProofAuditContext;
}) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.grant_creation) {
    throw new ProofAccessFeatureDisabledError("grant creation");
  }
  const orderNumber = normalizeLiftOrderNumber(input.order_number);
  const order = await getProofOrder(orderNumber);
  if (!order) {
    throw new ProofOrderNotSynchronizedError(orderNumber);
  }
  if (!order.customer_id || !config.access.grant_allowed_customer_ids.includes(order.customer_id)) {
    throw new ProofGrantCohortDeniedError();
  }
  if (input.scope && input.scope !== "view") {
    throw new ProofAccessValidationError("Only view-scoped proof grants are available while Lift writes are disabled.");
  }
  const now = input.now ?? new Date();
  const deadline = activationDeadline(now);
  const expiresAt = input.expires_at
    ? new Date(input.expires_at)
    : addMilliseconds(now, config.access.grant_ttl_days * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new ProofAccessValidationError("Proof access expiry must be a valid future timestamp.");
  }
  if (input.expires_at && expiresAt.getTime() > deadline.getTime()) {
    throw new ProofAccessValidationError("Proof access expiry cannot exceed the read-only activation window.");
  }
  const boundedExpiresAt = expiresAt.getTime() > deadline.getTime() ? deadline : expiresAt;
  const rawToken = randomBytes(32).toString("base64url");
  const grant: ProofAccessGrant = {
    grant_id: `pgrant_${randomUUID()}`,
    order_number: orderNumber,
    scope: "view",
    label: input.label?.trim() || null,
    status: "active",
    token_hash: hashSecret(rawToken),
    created_at: now.toISOString(),
    expires_at: boundedExpiresAt.toISOString(),
    expires_at_epoch: Math.floor(boundedExpiresAt.getTime() / 1000),
    exchanged_at: null,
    revoked_at: null,
    last_used_at: null
  };
  await persistProofGrant(grant);
  await recordProofAuditEvent({
    action: "proof.grant_created",
    order_number: grant.order_number,
    grant_id: grant.grant_id,
    metadata: { grant_scope: grant.scope, grant_status: grant.status },
    context: input.audit_context,
    occurred_at: now.toISOString()
  });
  return {
    grant: publicProofGrant(grant),
    access_url: `${config.access.public_base_url}/#/access/${rawToken}`
  };
}

export async function listOrderProofGrants(orderNumber: string) {
  const grants = (await listProofGrants(normalizeLiftOrderNumber(orderNumber)))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  return Promise.all(
    grants.map(async (grant) => publicProofGrant(grant, (await listProofParticipants(grant.grant_id)).length))
  );
}

export async function revokeProofGrant(grantId: string, now = new Date(), auditContext?: ProofAuditContext) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.grant_creation) {
    throw new ProofAccessFeatureDisabledError("grant creation");
  }
  const grant = await getProofGrantById(grantId);
  if (!grant) {
    return null;
  }
  const revoked = {
    ...grant,
    status: "revoked" as const,
    revoked_at: grant.revoked_at ?? now.toISOString()
  };
  await persistProofGrant(revoked);
  await recordProofAuditEvent({
    action: "proof.grant_revoked",
    order_number: revoked.order_number,
    grant_id: revoked.grant_id,
    metadata: { grant_scope: revoked.scope, grant_status: revoked.status },
    context: auditContext,
    occurred_at: now.toISOString()
  });
  return publicProofGrant(revoked);
}

export async function updateProofGrant(
  grantId: string,
  input: { action?: "update" | "revoke" | "regenerate"; label?: string | null; expires_at?: string | null },
  now = new Date(),
  auditContext?: ProofAuditContext
) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.grant_creation) {
    throw new ProofAccessFeatureDisabledError("grant creation");
  }
  if (input.action && !["update", "revoke", "regenerate"].includes(input.action)) {
    throw new ProofAccessValidationError("Proof grant action must be update, revoke, or regenerate.");
  }
  const grant = await getProofGrantById(grantId);
  if (!grant) {
    return null;
  }
  if (input.action === "revoke") {
    return { grant: await revokeProofGrant(grantId, now, auditContext), access_url: null };
  }
  const deadline = activationDeadline(now);
  if (input.action === "regenerate") {
    await revokeProofGrant(grantId, now, auditContext);
    const regenerated = await createProofGrant({
      order_number: grant.order_number,
      label: input.label === undefined ? grant.label : input.label,
      expires_at: input.expires_at ?? null,
      now,
      audit_context: auditContext
    });
    await recordProofAuditEvent({
      action: "proof.grant_regenerated",
      order_number: grant.order_number,
      grant_id: regenerated.grant.grant_id,
      metadata: { grant_scope: regenerated.grant.scope, grant_status: regenerated.grant.status },
      context: auditContext,
      occurred_at: now.toISOString()
    });
    return regenerated;
  }
  let expiresAt = grant.expires_at;
  let expiresEpoch = grant.expires_at_epoch;
  if (input.expires_at !== undefined && input.expires_at !== null) {
    const parsed = new Date(input.expires_at);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
      throw new ProofAccessValidationError("Proof access expiry must be a valid future timestamp.");
    }
    if (parsed.getTime() > deadline.getTime()) {
      throw new ProofAccessValidationError("Proof access expiry cannot exceed the read-only activation window.");
    }
    expiresAt = parsed.toISOString();
    expiresEpoch = Math.floor(parsed.getTime() / 1000);
  }
  const updated: ProofAccessGrant = {
    ...grant,
    label: input.label === undefined ? grant.label : input.label?.trim() || null,
    expires_at: expiresAt,
    expires_at_epoch: expiresEpoch
  };
  await persistProofGrant(updated);
  await recordProofAuditEvent({
    action: "proof.grant_updated",
    order_number: updated.order_number,
    grant_id: updated.grant_id,
    metadata: { grant_scope: updated.scope, grant_status: updated.status },
    context: auditContext,
    occurred_at: now.toISOString()
  });
  return { grant: publicProofGrant(updated), access_url: null };
}

export async function exchangeProofToken(rawToken: string, now = new Date()) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.public_read) {
    throw new ProofAccessFeatureDisabledError("public read");
  }
  const deadline = activationDeadline(now, true);
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    throw new ProofAccessDeniedError();
  }
  const grant = await getProofGrantByTokenHash(hashSecret(rawToken));
  if (!grant || !activeGrant(grant, now) || grant.exchanged_at) {
    throw new ProofAccessDeniedError();
  }
  const claimed = await claimProofGrant(grant, now.toISOString());
  if (!claimed) {
    throw new ProofAccessDeniedError();
  }
  const rawSession = randomBytes(32).toString("base64url");
  const rawCsrf = randomBytes(32).toString("base64url");
  const requestedSessionExpiry = addMilliseconds(now, config.access.session_ttl_minutes * 60 * 1000);
  const expiresAt = requestedSessionExpiry.getTime() > deadline.getTime() ? deadline : requestedSessionExpiry;
  const session: ProofAccessSession = {
    session_id: `psession_${randomUUID()}`,
    session_hash: hashSecret(rawSession),
    grant_id: claimed.grant_id,
    order_number: claimed.order_number,
    scope: claimed.scope,
    csrf_hash: hashSecret(rawCsrf),
    participant_id: null,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    expires_at_epoch: Math.floor(expiresAt.getTime() / 1000),
    last_seen_at: now.toISOString(),
    ended_at: null
  };
  await persistProofSession(session);
  await recordProofAuditEvent({
    action: "proof.session_exchanged",
    order_number: session.order_number,
    grant_id: session.grant_id,
    metadata: { grant_scope: session.scope },
    context: {
      actor_type: "customer_session",
      actor_id: session.session_id,
      correlation_id: session.session_id,
      source: "public_api"
    },
    occurred_at: now.toISOString()
  });
  return { raw_session: rawSession, raw_csrf: rawCsrf, session };
}

export async function validateProofSession(rawSession: string, now = new Date()) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.public_read || !/^[A-Za-z0-9_-]{43}$/.test(rawSession)) {
    throw new ProofAccessDeniedError();
  }
  activationDeadline(now, true);
  const session = await getProofSessionByHash(hashSecret(rawSession));
  if (!session || session.ended_at || Date.parse(session.expires_at) <= now.getTime()) {
    throw new ProofAccessDeniedError();
  }
  const grant = await getProofGrantById(session.grant_id);
  if (!grant || !activeGrant(grant, now) || grant.order_number !== session.order_number || grant.scope !== session.scope) {
    throw new ProofAccessDeniedError();
  }
  return { session, grant };
}

export async function getProofSessionForLogout(rawSession: string) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.public_read || !/^[A-Za-z0-9_-]{43}$/.test(rawSession)) {
    throw new ProofAccessDeniedError();
  }
  const session = await getProofSessionByHash(hashSecret(rawSession));
  if (!session) {
    throw new ProofAccessDeniedError();
  }
  return session;
}

export async function endProofSession(rawSession: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawSession)) {
    return;
  }
  const session = await getProofSessionByHash(hashSecret(rawSession));
  if (session && !session.ended_at) {
    const ended = { ...session, ended_at: now.toISOString(), last_seen_at: now.toISOString() };
    await persistProofSession(ended);
    await recordProofAuditEvent({
      action: "proof.session_ended",
      order_number: ended.order_number,
      grant_id: ended.grant_id,
      metadata: { grant_scope: ended.scope },
      context: {
        actor_type: "customer_session",
        actor_id: ended.session_id,
        correlation_id: ended.session_id,
        source: "public_api"
      },
      occurred_at: now.toISOString()
    });
  }
}

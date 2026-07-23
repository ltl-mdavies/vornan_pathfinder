import { createHash, randomBytes } from "node:crypto";
import {
  readTargetSecrets,
  writeTargetSecrets,
  type TargetEnvironmentProofingApiSecrets,
  type TargetProofingApiAuditEvent
} from "./secrets-store.js";

const maxBaseUrlLength = 2_048;
const maxIdentifierLength = 256;
const maxSecretLength = 16_384;
const retainedAuditEvents = 25;

export interface TargetProofingApiConfiguration {
  base_url: string | null;
  company_id: string | null;
  client_id_configured: boolean;
  client_secret_configured: boolean;
  configured: boolean;
  updated_at: string | null;
  audit_events: TargetProofingApiAuditEvent[];
}

export interface SaveTargetProofingApiInput {
  base_url?: unknown;
  company_id?: unknown;
  client_id?: unknown;
  client_secret?: unknown;
}

export class TargetProofingApiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetProofingApiValidationError";
  }
}

function boundedText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") {
    throw new TargetProofingApiValidationError(`${label} is required.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TargetProofingApiValidationError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalCredential(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return boundedText(value, label, maximum);
}

function optionalIdentifier(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeProofingApiIdentifier(value, label);
}

export function normalizeProofingApiBaseUrl(value: unknown) {
  const raw = boundedText(value, "Proofing API base URL", maxBaseUrlLength);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TargetProofingApiValidationError("Proofing API base URL must be a valid HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new TargetProofingApiValidationError(
      "Proofing API base URL must use HTTPS without credentials, query parameters, or fragments."
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeProofingApiIdentifier(value: unknown, label: string) {
  const normalized = boundedText(value, label, maxIdentifierLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new TargetProofingApiValidationError(
      `${label} may contain only letters, numbers, periods, underscores, colons, and hyphens.`
    );
  }
  return normalized;
}

function opaqueActorId(value: string) {
  const normalized = value.trim() || "unknown";
  return `admin_${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

function auditEvent(action: TargetProofingApiAuditEvent["action"], actorId: string, occurredAt: string) {
  return {
    event_id: `target-proofing-${randomBytes(12).toString("hex")}`,
    action,
    actor_id: opaqueActorId(actorId),
    occurred_at: occurredAt
  } satisfies TargetProofingApiAuditEvent;
}

function publicConfiguration(value: TargetEnvironmentProofingApiSecrets | undefined): TargetProofingApiConfiguration {
  const clientIdConfigured = Boolean(value?.client_id);
  const clientSecretConfigured = Boolean(value?.client_secret);
  return {
    base_url: value?.base_url || null,
    company_id: value?.company_id || null,
    client_id_configured: clientIdConfigured,
    client_secret_configured: clientSecretConfigured,
    configured: clientIdConfigured && clientSecretConfigured,
    updated_at: value?.updated_at || null,
    audit_events: [...(value?.audit_events ?? [])]
  };
}

export async function readTargetEnvironmentProofingApi(targetId: string, environmentId: string) {
  const targetSecrets = await readTargetSecrets(targetId);
  return publicConfiguration(targetSecrets.environments?.[environmentId]?.proofing_api);
}

export async function saveTargetEnvironmentProofingApi(
  targetId: string,
  environmentId: string,
  input: SaveTargetProofingApiInput,
  actorId: string,
  occurredAt = new Date().toISOString()
) {
  const baseUrl = normalizeProofingApiBaseUrl(input.base_url);
  const companyId = normalizeProofingApiIdentifier(input.company_id, "Proofing API company ID");
  const submittedClientId = optionalIdentifier(input.client_id, "Proofing API client ID");
  const submittedClientSecret = optionalCredential(input.client_secret, "Proofing API client secret", maxSecretLength);

  if (Boolean(submittedClientId) !== Boolean(submittedClientSecret)) {
    throw new TargetProofingApiValidationError(
      "Client ID and client secret must be supplied together when configuring or replacing credentials."
    );
  }

  const targetSecrets = await readTargetSecrets(targetId);
  const environments = { ...(targetSecrets.environments ?? {}) };
  const environmentSecrets = { ...(environments[environmentId] ?? {}) };
  const current = environmentSecrets.proofing_api;
  const hasCurrentCredentials = Boolean(current?.client_id && current?.client_secret);

  if (!hasCurrentCredentials && !submittedClientId) {
    throw new TargetProofingApiValidationError("Client ID and client secret are required for initial configuration.");
  }

  const action: TargetProofingApiAuditEvent["action"] =
    hasCurrentCredentials && submittedClientId ? "replaced" : "configured";
  const next: TargetEnvironmentProofingApiSecrets = {
    base_url: baseUrl,
    company_id: companyId,
    client_id: submittedClientId ?? current?.client_id,
    client_secret: submittedClientSecret ?? current?.client_secret,
    updated_at: occurredAt,
    updated_by: opaqueActorId(actorId),
    audit_events: [
      auditEvent(action, actorId, occurredAt),
      ...(current?.audit_events ?? [])
    ].slice(0, retainedAuditEvents)
  };

  environments[environmentId] = {
    ...environmentSecrets,
    proofing_api: next
  };
  await writeTargetSecrets(targetId, { ...targetSecrets, environments });
  return publicConfiguration(next);
}

export async function clearTargetEnvironmentProofingApi(
  targetId: string,
  environmentId: string,
  actorId: string,
  occurredAt = new Date().toISOString()
) {
  const targetSecrets = await readTargetSecrets(targetId);
  const environments = { ...(targetSecrets.environments ?? {}) };
  const environmentSecrets = { ...(environments[environmentId] ?? {}) };
  const current = environmentSecrets.proofing_api;

  if (!current?.client_id && !current?.client_secret && !current?.base_url && !current?.company_id) {
    return publicConfiguration(current);
  }

  const next: TargetEnvironmentProofingApiSecrets = {
    updated_at: occurredAt,
    updated_by: opaqueActorId(actorId),
    audit_events: [
      auditEvent("cleared", actorId, occurredAt),
      ...(current.audit_events ?? [])
    ].slice(0, retainedAuditEvents)
  };
  environments[environmentId] = {
    ...environmentSecrets,
    proofing_api: next
  };
  await writeTargetSecrets(targetId, { ...targetSecrets, environments });
  return publicConfiguration(next);
}

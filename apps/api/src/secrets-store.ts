import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import type { LiftTargetConfig } from "@pathfinder/lift-adapter";
import type { WrikeOAuthCredentials } from "@pathfinder/wrike-adapter";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPathfinderPersistenceRuntimeConfig } from "./runtime-config.js";
import type { TargetEnvironment } from "./store.js";

export interface TargetSecrets {
  environments?: Record<
    string,
    {
      credentials?: Partial<TargetEnvironment["credentials"]>;
      headers?: Record<string, string>;
      proofing_api?: TargetEnvironmentProofingApiSecrets;
    }
  >;
  lift?: {
    credentials?: Partial<LiftTargetConfig["credentials"]>;
  };
}

export interface TargetProofingApiAuditEvent {
  event_id: string;
  action: "configured" | "replaced" | "cleared";
  actor_id: string;
  occurred_at: string;
}

export interface TargetEnvironmentProofingApiSecrets {
  base_url?: string;
  company_id?: string;
  action_user_name?: string;
  client_id?: string;
  client_secret?: string;
  updated_at?: string;
  updated_by?: string;
  audit_events?: TargetProofingApiAuditEvent[];
}

export interface WrikeConnectorSecrets {
  oauth?: Partial<WrikeOAuthCredentials>;
  oauth_pending?: {
    state_hash: string;
    expires_at: string;
    redirect_uri: string;
  };
  health?: {
    status: "Connected" | "Error" | "Not tested";
    host: string | null;
    checked_at: string | null;
    identity_confirmed: boolean;
    message: string;
  };
}

export interface CustomerSourceConnectionSecrets {
  provider: "wrike";
  wrike?: WrikeConnectorSecrets;
}

interface LocalSecretsStore {
  version: 1;
  targets: Record<string, TargetSecrets>;
  connectors: {
    wrike?: WrikeConnectorSecrets;
    customers?: Record<string, Record<string, CustomerSourceConnectionSecrets>>;
  };
}

const secretsPath =
  process.env.PATHFINDER_LOCAL_SECRETS_PATH ??
  (process.env.PATHFINDER_RUNTIME === "lambda"
    ? "/tmp/pathfinder-secrets.local.json"
    : fileURLToPath(new URL("../../../data/pathfinder-secrets.local.json", import.meta.url)));
let secretsManagerClient: SecretsManagerClient | null = null;

function getSecretsManagerClient() {
  secretsManagerClient ??= new SecretsManagerClient({});
  return secretsManagerClient;
}

function normalizeSecretPrefix(prefix: string) {
  const trimmed = prefix.trim() || "/vornan/pathfinder/";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function targetSecretName(targetId: string) {
  const config = getPathfinderPersistenceRuntimeConfig();
  return `${normalizeSecretPrefix(config.secret_prefix)}targets/${targetId}`;
}

export function wrikeConnectorSecretName() {
  const config = getPathfinderPersistenceRuntimeConfig();
  return `${normalizeSecretPrefix(config.secret_prefix)}connectors/wrike`;
}

function secretSegment(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

export function customerSourceConnectionSecretName(customerId: string, connectionId: string) {
  const config = getPathfinderPersistenceRuntimeConfig();
  return `${normalizeSecretPrefix(config.secret_prefix)}customers/${secretSegment(customerId, "Customer ID")}/connections/${secretSegment(connectionId, "Connection ID")}`;
}

async function readLocalSecrets(): Promise<LocalSecretsStore> {
  try {
    const content = await readFile(secretsPath, "utf8");
    const parsed = JSON.parse(content) as LocalSecretsStore;
    return {
      version: 1,
      targets: parsed.targets ?? {},
      connectors: parsed.connectors ?? {}
    };
  } catch {
    return { version: 1, targets: {}, connectors: {} };
  }
}

async function writeLocalSecrets(secrets: LocalSecretsStore) {
  await mkdir(dirname(secretsPath), { recursive: true });
  await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, "utf8");
}

function normalizeTargetSecrets(value: unknown): TargetSecrets {
  if (!value || typeof value !== "object") {
    return {};
  }

  const parsed = value as TargetSecrets;
  return {
    environments: parsed.environments ?? {},
    lift: parsed.lift ?? {}
  };
}

function normalizeWrikeConnectorSecrets(value: unknown): WrikeConnectorSecrets {
  if (!value || typeof value !== "object") {
    return {};
  }

  const parsed = value as WrikeConnectorSecrets;
  return {
    oauth: parsed.oauth ?? {},
    oauth_pending: parsed.oauth_pending,
    health: parsed.health
  };
}

function normalizeCustomerSourceConnectionSecrets(value: unknown): CustomerSourceConnectionSecrets {
  if (!value || typeof value !== "object") {
    return { provider: "wrike", wrike: {} };
  }
  const parsed = value as CustomerSourceConnectionSecrets;
  return {
    provider: "wrike",
    wrike: normalizeWrikeConnectorSecrets(parsed.wrike)
  };
}

async function readSecretsManagerTargetSecrets(targetId: string): Promise<TargetSecrets> {
  const secretName = targetSecretName(targetId);

  try {
    const response = await getSecretsManagerClient().send(new GetSecretValueCommand({ SecretId: secretName }));
    if (!response.SecretString) {
      return {};
    }
    return normalizeTargetSecrets(JSON.parse(response.SecretString));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return {};
    }
    throw error;
  }
}

async function writeSecretsManagerTargetSecrets(targetId: string, targetSecrets: TargetSecrets) {
  const secretName = targetSecretName(targetId);
  const secretString = JSON.stringify(normalizeTargetSecrets(targetSecrets));

  try {
    await getSecretsManagerClient().send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretString
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
    await getSecretsManagerClient().send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretString,
        Description: `Pathfinder target credentials for ${targetId}`
      })
    );
  }
}

async function readSecretsManagerWrikeConnectorSecrets(): Promise<WrikeConnectorSecrets> {
  const secretName = wrikeConnectorSecretName();
  try {
    const response = await getSecretsManagerClient().send(new GetSecretValueCommand({ SecretId: secretName }));
    if (!response.SecretString) {
      return {};
    }
    return normalizeWrikeConnectorSecrets(JSON.parse(response.SecretString));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return {};
    }
    throw error;
  }
}

async function writeSecretsManagerWrikeConnectorSecrets(connectorSecrets: WrikeConnectorSecrets) {
  const secretName = wrikeConnectorSecretName();
  const secretString = JSON.stringify(normalizeWrikeConnectorSecrets(connectorSecrets));
  try {
    await getSecretsManagerClient().send(new PutSecretValueCommand({ SecretId: secretName, SecretString: secretString }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
    await getSecretsManagerClient().send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretString,
        Description: "Pathfinder Wrike OAuth connector credentials"
      })
    );
  }
}

async function readSecretsManagerCustomerSourceConnectionSecrets(customerId: string, connectionId: string) {
  const secretName = customerSourceConnectionSecretName(customerId, connectionId);
  try {
    const response = await getSecretsManagerClient().send(new GetSecretValueCommand({ SecretId: secretName }));
    if (!response.SecretString) {
      return normalizeCustomerSourceConnectionSecrets(undefined);
    }
    return normalizeCustomerSourceConnectionSecrets(JSON.parse(response.SecretString));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return normalizeCustomerSourceConnectionSecrets(undefined);
    }
    throw error;
  }
}

async function writeSecretsManagerCustomerSourceConnectionSecrets(
  customerId: string,
  connectionId: string,
  connectionSecrets: CustomerSourceConnectionSecrets
) {
  const secretName = customerSourceConnectionSecretName(customerId, connectionId);
  const secretString = JSON.stringify(normalizeCustomerSourceConnectionSecrets(connectionSecrets));
  try {
    await getSecretsManagerClient().send(new PutSecretValueCommand({ SecretId: secretName, SecretString: secretString }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
    await getSecretsManagerClient().send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretString,
        Description: `Pathfinder source connection ${connectionId} for customer ${customerId}`
      })
    );
  }
}

export async function readTargetSecrets(targetId: string): Promise<TargetSecrets> {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.secrets_driver === "secrets-manager") {
    return readSecretsManagerTargetSecrets(targetId);
  }

  const secrets = await readLocalSecrets();
  return secrets.targets[targetId] ?? {};
}

export async function writeTargetSecrets(targetId: string, targetSecrets: TargetSecrets) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.secrets_driver === "secrets-manager") {
    await writeSecretsManagerTargetSecrets(targetId, targetSecrets);
    return;
  }

  const secrets = await readLocalSecrets();
  secrets.targets[targetId] = targetSecrets;
  await writeLocalSecrets(secrets);
}
export async function readWrikeConnectorSecrets(): Promise<WrikeConnectorSecrets> {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.secrets_driver === "secrets-manager") {
    return readSecretsManagerWrikeConnectorSecrets();
  }

  const secrets = await readLocalSecrets();
  return secrets.connectors.wrike ?? {};
}

export async function writeWrikeConnectorSecrets(connectorSecrets: WrikeConnectorSecrets) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.secrets_driver === "secrets-manager") {
    await writeSecretsManagerWrikeConnectorSecrets(connectorSecrets);
    return;
  }

  const secrets = await readLocalSecrets();
  secrets.connectors.wrike = normalizeWrikeConnectorSecrets(connectorSecrets);
  await writeLocalSecrets(secrets);
}

export async function readCustomerSourceConnectionSecrets(customerId: string, connectionId: string) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.secrets_driver === "secrets-manager") {
    return readSecretsManagerCustomerSourceConnectionSecrets(customerId, connectionId);
  }

  const secrets = await readLocalSecrets();
  return normalizeCustomerSourceConnectionSecrets(
    secrets.connectors.customers?.[customerId]?.[connectionId]
  );
}

export async function writeCustomerSourceConnectionSecrets(
  customerId: string,
  connectionId: string,
  connectionSecrets: CustomerSourceConnectionSecrets
) {
  const normalized = normalizeCustomerSourceConnectionSecrets(connectionSecrets);
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.secrets_driver === "secrets-manager") {
    await writeSecretsManagerCustomerSourceConnectionSecrets(customerId, connectionId, normalized);
    return;
  }

  const secrets = await readLocalSecrets();
  secrets.connectors.customers ??= {};
  secrets.connectors.customers[customerId] ??= {};
  secrets.connectors.customers[customerId][connectionId] = normalized;
  await writeLocalSecrets(secrets);
}

import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import type { LiftTargetConfig } from "@pathfinder/lift-adapter";
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
    }
  >;
  lift?: {
    credentials?: Partial<LiftTargetConfig["credentials"]>;
  };
}

interface LocalSecretsStore {
  version: 1;
  targets: Record<string, TargetSecrets>;
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

async function readLocalSecrets(): Promise<LocalSecretsStore> {
  try {
    const content = await readFile(secretsPath, "utf8");
    const parsed = JSON.parse(content) as LocalSecretsStore;
    return {
      version: 1,
      targets: parsed.targets ?? {}
    };
  } catch {
    return { version: 1, targets: {} };
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

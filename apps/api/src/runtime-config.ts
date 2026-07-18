export type PathfinderStorageDriver = "local" | "dynamodb";
export type PathfinderSecretsDriver = "local" | "secrets-manager";

export interface PathfinderPersistenceRuntimeConfig {
  storage_driver: PathfinderStorageDriver;
  secrets_driver: PathfinderSecretsDriver;
  secret_prefix: string;
  storage_ready: boolean;
  secrets_ready: boolean;
}

function pickAllowedValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function getPathfinderPersistenceRuntimeConfig(): PathfinderPersistenceRuntimeConfig {
  const storageDriver = pickAllowedValue(
    process.env.PATHFINDER_STORAGE_DRIVER,
    ["local", "dynamodb"] as const,
    "local"
  );
  const secretsDriver = pickAllowedValue(
    process.env.PATHFINDER_SECRETS_DRIVER,
    ["local", "secrets-manager"] as const,
    "local"
  );

  return {
    storage_driver: storageDriver,
    secrets_driver: secretsDriver,
    secret_prefix: process.env.PATHFINDER_SECRET_PREFIX ?? "/vornan/pathfinder/",
    storage_ready: storageDriver === "local" || storageDriver === "dynamodb",
    secrets_ready: secretsDriver === "local" || secretsDriver === "secrets-manager"
  };
}

export function assertLocalStorageDriver() {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver !== "local") {
    throw new Error(
      `PATHFINDER_STORAGE_DRIVER=${config.storage_driver} is configured, but this operation requires the local storage adapter.`
    );
  }
}

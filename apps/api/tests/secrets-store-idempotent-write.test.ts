import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  LimitExceededException,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";

interface SecretVersion {
  secret_string: string;
  version_id: string;
}

interface SecretRecord {
  current_version_id: string;
  versions: Map<string, SecretVersion>;
}

type SecretCommand = GetSecretValueCommand | PutSecretValueCommand | CreateSecretCommand;

const originalSend = SecretsManagerClient.prototype.send;
const originalConsole = {
  error: console.error,
  log: console.log,
  warn: console.warn
};
const records = new Map<string, SecretRecord>();
const commands: SecretCommand[] = [];
const omitVersionId = new Set<string>();
let capturedConsole: string[] = [];
let createRace: { name: string; secret_string: string; version_id: string } | null = null;
let putFailure: Error | null = null;
let testDirectory = "";

let readCustomerSourceConnectionSecrets: typeof import("../src/secrets-store.ts")["readCustomerSourceConnectionSecrets"];
let readTargetSecrets: typeof import("../src/secrets-store.ts")["readTargetSecrets"];
let readWrikeConnectorSecrets: typeof import("../src/secrets-store.ts")["readWrikeConnectorSecrets"];
let writeCustomerSourceConnectionSecrets: typeof import("../src/secrets-store.ts")["writeCustomerSourceConnectionSecrets"];
let writeTargetSecrets: typeof import("../src/secrets-store.ts")["writeTargetSecrets"];
let writeWrikeConnectorSecrets: typeof import("../src/secrets-store.ts")["writeWrikeConnectorSecrets"];

const targetName = "/test/pathfinder/targets/target-a";
const wrikeName = "/test/pathfinder/connectors/wrike";
const customerName = "/test/pathfinder/customers/1249/connections/wrike-primary";

function notFound() {
  return new ResourceNotFoundException({ $metadata: {}, message: "Secret not found." });
}

function alreadyExists() {
  return new ResourceExistsException({ $metadata: {}, message: "Secret already exists." });
}

function seed(name: string, secretString: string, versionId: string) {
  records.set(name, {
    current_version_id: versionId,
    versions: new Map([[versionId, { secret_string: secretString, version_id: versionId }]])
  });
}

function commandCount(commandType: typeof GetSecretValueCommand | typeof PutSecretValueCommand | typeof CreateSecretCommand) {
  return commands.filter((command) => command instanceof commandType).length;
}

function putCommands() {
  return commands.filter((command): command is PutSecretValueCommand => command instanceof PutSecretValueCommand);
}

function secretRecord(name: string) {
  const record = records.get(name);
  assert.ok(record, `Expected secret record ${name}.`);
  return record;
}

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-secrets-idempotency-"));
  process.env.PATHFINDER_SECRETS_DRIVER = "secrets-manager";
  process.env.PATHFINDER_SECRET_PREFIX = "/test/pathfinder/";
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");

  SecretsManagerClient.prototype.send = (async (command: SecretCommand) => {
    commands.push(command);

    if (command instanceof GetSecretValueCommand) {
      const name = command.input.SecretId ?? "";
      const record = records.get(name);
      if (!record) {
        throw notFound();
      }
      const current = record.versions.get(record.current_version_id);
      assert.ok(current);
      return {
        SecretString: current.secret_string,
        VersionId: omitVersionId.has(name) ? undefined : current.version_id
      };
    }

    if (command instanceof CreateSecretCommand) {
      const name = command.input.Name ?? "";
      if (createRace?.name === name) {
        const raced = createRace;
        createRace = null;
        seed(raced.name, raced.secret_string, raced.version_id);
        throw alreadyExists();
      }
      if (records.has(name)) {
        throw alreadyExists();
      }
      const token = command.input.ClientRequestToken ?? "";
      const secretString = command.input.SecretString ?? "";
      records.set(name, {
        current_version_id: token,
        versions: new Map([[token, { secret_string: secretString, version_id: token }]])
      });
      return { VersionId: token };
    }

    if (putFailure) {
      const failure = putFailure;
      putFailure = null;
      throw failure;
    }
    const name = command.input.SecretId ?? "";
    const record = records.get(name);
    if (!record) {
      throw notFound();
    }
    const token = command.input.ClientRequestToken ?? "";
    const secretString = command.input.SecretString ?? "";
    const existing = record.versions.get(token);
    if (existing) {
      if (existing.secret_string !== secretString) {
        throw alreadyExists();
      }
      return { VersionId: token };
    }
    record.versions.set(token, { secret_string: secretString, version_id: token });
    record.current_version_id = token;
    return { VersionId: token };
  }) as typeof SecretsManagerClient.prototype.send;

  for (const method of ["error", "log", "warn"] as const) {
    console[method] = (...values: unknown[]) => {
      capturedConsole.push(values.map(String).join(" "));
    };
  }

  ({
    readCustomerSourceConnectionSecrets,
    readTargetSecrets,
    readWrikeConnectorSecrets,
    writeCustomerSourceConnectionSecrets,
    writeTargetSecrets,
    writeWrikeConnectorSecrets
  } = await import("../src/secrets-store.ts"));
});

beforeEach(() => {
  process.env.PATHFINDER_SECRETS_DRIVER = "secrets-manager";
  records.clear();
  omitVersionId.clear();
  commands.length = 0;
  capturedConsole = [];
  createRace = null;
  putFailure = null;
});

after(async () => {
  SecretsManagerClient.prototype.send = originalSend;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  await rm(testDirectory, { recursive: true, force: true });
});

test("canonical normalized equality makes target writes Get-only", async () => {
  seed(
    targetName,
    '{"lift":{"credentials":{"User":"import-user","Password":"import-secret"}},"environments":{"env-b":{"headers":{"Z":"2","A":"1"}}}}',
    "target-v1"
  );

  await writeTargetSecrets("target-a", {
    environments: {
      "env-b": {
        credentials: undefined,
        headers: { A: "1", Z: "2" }
      }
    },
    lift: {
      credentials: { Password: "import-secret", User: "import-user" }
    }
  });

  assert.equal(commandCount(GetSecretValueCommand), 1);
  assert.equal(commandCount(PutSecretValueCommand), 0);
  assert.equal(commandCount(CreateSecretCommand), 0);
});

test("real rotations produce one Put each and rotation back receives a new token", async () => {
  seed(wrikeName, '{"oauth":{"client_id":"client-a","client_secret":"secret-a"}}', "wrike-v1");

  await writeWrikeConnectorSecrets({ oauth: { client_id: "client-b", client_secret: "secret-b" } });
  await writeWrikeConnectorSecrets({ oauth: { client_id: "client-a", client_secret: "secret-a" } });
  await writeWrikeConnectorSecrets({ oauth: { client_id: "client-b", client_secret: "secret-b" } });

  const puts = putCommands();
  assert.equal(puts.length, 3);
  const tokens = puts.map((command) => command.input.ClientRequestToken);
  assert.equal(new Set(tokens).size, 3);
  for (const token of tokens) {
    assert.match(token ?? "", /^[a-f0-9]{64}$/);
    assert.equal(token?.includes("secret-"), false);
  }
  assert.equal(secretRecord(wrikeName).versions.size, 4);
});

test("missing VersionId falls back to canonical current content for the token", async () => {
  omitVersionId.add(targetName);
  const next = { lift: { credentials: { User: "next-user", Password: "next-secret" } } };
  seed(targetName, '{"lift":{"credentials":{"Password":"old-secret","User":"old-user"}},"environments":{}}', "first");
  await writeTargetSecrets("target-a", next);
  const firstToken = putCommands()[0]?.input.ClientRequestToken;

  records.clear();
  commands.length = 0;
  seed(targetName, '{"environments":{},"lift":{"credentials":{"User":"old-user","Password":"old-secret"}}}', "second");
  await writeTargetSecrets("target-a", next);
  const secondToken = putCommands()[0]?.input.ClientRequestToken;

  assert.match(firstToken ?? "", /^[a-f0-9]{64}$/);
  assert.equal(secondToken, firstToken);
});

test("a missing customer connection creates exactly one secret", async () => {
  await writeCustomerSourceConnectionSecrets("1249", "wrike-primary", {
    provider: "wrike",
    wrike: { oauth: { client_id: "customer-client", client_secret: "customer-secret" } }
  });

  assert.equal(commandCount(GetSecretValueCommand), 1);
  assert.equal(commandCount(CreateSecretCommand), 1);
  assert.equal(commandCount(PutSecretValueCommand), 0);
  assert.equal(secretRecord(customerName).versions.size, 1);
});

test("concurrent identical updates share a token and create one logical version", async () => {
  seed(targetName, '{"environments":{},"lift":{"credentials":{"User":"old"}}}', "target-old");
  const next = { lift: { credentials: { User: "next-user", Password: "next-secret" } } };

  await Promise.all([writeTargetSecrets("target-a", next), writeTargetSecrets("target-a", next)]);

  const puts = putCommands();
  assert.equal(puts.length, 2);
  assert.equal(puts[0]?.input.ClientRequestToken, puts[1]?.input.ClientRequestToken);
  assert.equal(secretRecord(targetName).versions.size, 2);
});

test("create-race reconciliation accepts identical content without a Put", async () => {
  createRace = {
    name: customerName,
    secret_string: '{"wrike":{"oauth":{"client_secret":"race-secret","client_id":"race-client"}},"provider":"wrike"}',
    version_id: "race-v1"
  };

  await writeCustomerSourceConnectionSecrets("1249", "wrike-primary", {
    provider: "wrike",
    wrike: { oauth: { client_id: "race-client", client_secret: "race-secret" } }
  });

  assert.equal(commandCount(CreateSecretCommand), 1);
  assert.equal(commandCount(GetSecretValueCommand), 2);
  assert.equal(commandCount(PutSecretValueCommand), 0);
});

test("create-race reconciliation performs one Put when concurrent content differs", async () => {
  createRace = {
    name: customerName,
    secret_string: '{"provider":"wrike","wrike":{"oauth":{"client_id":"other-client"}}}',
    version_id: "race-v1"
  };

  await writeCustomerSourceConnectionSecrets("1249", "wrike-primary", {
    provider: "wrike",
    wrike: { oauth: { client_id: "intended-client", client_secret: "intended-secret" } }
  });

  assert.equal(commandCount(CreateSecretCommand), 1);
  assert.equal(commandCount(GetSecretValueCommand), 2);
  assert.equal(commandCount(PutSecretValueCommand), 1);
  assert.equal(secretRecord(customerName).versions.size, 2);
});

test("LimitExceededException surfaces unchanged without retry, fallback, or leakage", async () => {
  const privateValue = "must-never-appear";
  seed(targetName, '{"environments":{},"lift":{}}', "target-v1");
  const limit = new LimitExceededException({ $metadata: {}, message: "Secret version quota exceeded." });
  putFailure = limit;

  await assert.rejects(
    writeTargetSecrets("target-a", {
      lift: { credentials: { User: "limit-user", Password: privateValue } }
    }),
    (error) => error === limit
  );

  assert.equal(commandCount(GetSecretValueCommand), 1);
  assert.equal(commandCount(PutSecretValueCommand), 1);
  assert.equal(commandCount(CreateSecretCommand), 0);
  assert.equal(capturedConsole.join(" ").includes(privateValue), false);
  assert.equal(String(limit).includes(privateValue), false);
});

test("target, shared Wrike, and customer connection tokens are isolated", async () => {
  seed(targetName, '{"environments":{},"lift":{}}', "shared-v1");
  seed(wrikeName, '{"oauth":{}}', "shared-v1");
  seed(customerName, '{"provider":"wrike","wrike":{"oauth":{}}}', "shared-v1");

  await writeTargetSecrets("target-a", { lift: { credentials: { User: "same", Password: "same-secret" } } });
  await writeWrikeConnectorSecrets({ oauth: { client_id: "same", client_secret: "same-secret" } });
  await writeCustomerSourceConnectionSecrets("1249", "wrike-primary", {
    provider: "wrike",
    wrike: { oauth: { client_id: "same", client_secret: "same-secret" } }
  });

  const puts = putCommands();
  assert.deepEqual(
    puts.map((command) => command.input.SecretId),
    [targetName, wrikeName, customerName]
  );
  assert.equal(new Set(puts.map((command) => command.input.ClientRequestToken)).size, 3);
});

test("local-file secret behavior remains available without Secrets Manager calls", async () => {
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  await writeTargetSecrets("local-target", { lift: { credentials: { User: "local-user" } } });
  await writeWrikeConnectorSecrets({ oauth: { client_id: "local-client" } });
  await writeCustomerSourceConnectionSecrets("1249", "local-connection", {
    provider: "wrike",
    wrike: { oauth: { client_secret: "local-secret" } }
  });

  assert.equal(commandCount(GetSecretValueCommand), 0);
  assert.equal(commandCount(PutSecretValueCommand), 0);
  assert.equal(commandCount(CreateSecretCommand), 0);
  assert.equal((await readTargetSecrets("local-target")).lift?.credentials?.User, "local-user");
  assert.equal((await readWrikeConnectorSecrets()).oauth?.client_id, "local-client");
  assert.equal(
    (await readCustomerSourceConnectionSecrets("1249", "local-connection")).wrike?.oauth?.client_secret,
    "local-secret"
  );
  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("local-secret"), true);
});

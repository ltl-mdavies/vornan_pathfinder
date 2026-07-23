import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import request from "supertest";

const targetId = "lift-standard-graphics";
const qaEnvironmentId = "env-lift-qa1";
const productionEnvironmentId = "env-lift-prod";
let testDirectory = "";
let app: typeof import("../src/server.ts")["app"];
let writeTargetSecrets: typeof import("../src/secrets-store.ts")["writeTargetSecrets"];

function endpoint(environmentId: string) {
  return `/api/targets/${targetId}/environments/${environmentId}/proofing-api`;
}

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-lift-proofing-credentials-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = join(testDirectory, "store.json");
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  process.env.PATHFINDER_REQUIRE_AUTH = "false";
  process.env.PATHFINDER_ENABLE_LIFT_SUBMIT = "false";

  ({ app } = await import("../src/server.ts"));
  ({ writeTargetSecrets } = await import("../src/secrets-store.ts"));
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("stores Proofing API credentials per target environment without exposing or replacing import credentials", async () => {
  await writeTargetSecrets(targetId, {
    environments: {
      [qaEnvironmentId]: {
        credentials: {
          User: "qa-import-user",
          Password: "qa-import-password"
        }
      },
      [productionEnvironmentId]: {
        credentials: {
          User: "production-import-user",
          Password: "production-import-password"
        }
      }
    }
  });

  const initial = await request(app).get(endpoint(qaEnvironmentId)).expect(200);
  assert.equal(initial.headers["cache-control"], "no-store");
  assert.deepEqual(initial.body, {
    base_url: null,
    company_id: null,
    client_id_configured: false,
    client_secret_configured: false,
    configured: false,
    updated_at: null,
    audit_events: []
  });

  const configured = await request(app)
    .put(endpoint(qaEnvironmentId))
    .send({
      base_url: "https://proofing.example.invalid/api/",
      company_id: "company-91",
      client_id: "qa-proofing-client",
      client_secret: "qa-proofing-secret"
    })
    .expect(200);

  assert.equal(configured.body.base_url, "https://proofing.example.invalid/api");
  assert.equal(configured.body.company_id, "company-91");
  assert.equal(configured.body.configured, true);
  assert.equal(configured.body.client_id_configured, true);
  assert.equal(configured.body.client_secret_configured, true);
  assert.equal(configured.body.audit_events.length, 1);
  assert.equal(configured.body.audit_events[0].action, "configured");
  assert.match(configured.body.audit_events[0].actor_id, /^admin_[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(configured.body).includes("qa-proofing-client"), false);
  assert.equal(JSON.stringify(configured.body).includes("qa-proofing-secret"), false);

  const storedAfterConfigure = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(storedAfterConfigure.includes("qa-proofing-client"), true);
  assert.equal(storedAfterConfigure.includes("qa-proofing-secret"), true);
  assert.equal(storedAfterConfigure.includes("qa-import-user"), true);
  assert.equal(storedAfterConfigure.includes("qa-import-password"), true);
  assert.equal(storedAfterConfigure.includes("production-import-password"), true);

  const production = await request(app).get(endpoint(productionEnvironmentId)).expect(200);
  assert.equal(production.body.configured, false);
  assert.equal(JSON.stringify(production.body).includes("qa-proofing"), false);
});

test("replaces only a complete credential pair, retains it for metadata-only saves, and clears one environment", async () => {
  const metadataOnly = await request(app)
    .put(endpoint(qaEnvironmentId))
    .send({
      base_url: "https://proofing.example.invalid/v2",
      company_id: "company-91"
    })
    .expect(200);
  assert.equal(metadataOnly.body.configured, true);
  assert.equal(metadataOnly.body.audit_events[0].action, "configured");

  const incompleteReplacement = await request(app)
    .put(endpoint(qaEnvironmentId))
    .send({
      base_url: "https://proofing.example.invalid/v2",
      company_id: "company-91",
      client_secret: "replacement-without-id"
    })
    .expect(400);
  assert.match(incompleteReplacement.body.error, /supplied together/i);
  assert.equal(JSON.stringify(incompleteReplacement.body).includes("replacement-without-id"), false);

  const replaced = await request(app)
    .put(endpoint(qaEnvironmentId))
    .send({
      base_url: "https://proofing.example.invalid/v2",
      company_id: "company-91",
      client_id: "replacement-client",
      client_secret: "replacement-secret"
    })
    .expect(200);
  assert.equal(replaced.body.audit_events[0].action, "replaced");
  assert.equal(replaced.body.audit_events.length, 3);
  assert.equal(JSON.stringify(replaced.body).includes("replacement-client"), false);
  assert.equal(JSON.stringify(replaced.body).includes("replacement-secret"), false);

  await request(app)
    .put(endpoint(productionEnvironmentId))
    .send({
      base_url: "https://proofing.example.invalid/production",
      company_id: "company-91",
      client_id: "production-proofing-client",
      client_secret: "production-proofing-secret"
    })
    .expect(200);

  const cleared = await request(app).delete(endpoint(qaEnvironmentId)).expect(200);
  assert.equal(cleared.body.configured, false);
  assert.equal(cleared.body.base_url, null);
  assert.equal(cleared.body.company_id, null);
  assert.equal(cleared.body.audit_events[0].action, "cleared");
  assert.equal(JSON.stringify(cleared.body).includes("replacement"), false);

  const productionStillConfigured = await request(app).get(endpoint(productionEnvironmentId)).expect(200);
  assert.equal(productionStillConfigured.body.configured, true);

  const storedAfterClear = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(storedAfterClear.includes("replacement-client"), false);
  assert.equal(storedAfterClear.includes("replacement-secret"), false);
  assert.equal(storedAfterClear.includes("production-proofing-client"), true);
  assert.equal(storedAfterClear.includes("production-proofing-secret"), true);
  assert.equal(storedAfterClear.includes("qa-import-password"), true);
  assert.equal(storedAfterClear.includes("production-import-password"), true);
});

test("rejects unsafe URLs, unbounded identifiers, unknown environments, and non-ERP targets", async () => {
  for (const baseUrl of [
    "http://proofing.example.invalid/api",
    "https://user:password@proofing.example.invalid/api",
    "https://proofing.example.invalid/api?secret=value",
    "not-a-url"
  ]) {
    const response = await request(app)
      .put(endpoint(qaEnvironmentId))
      .send({
        base_url: baseUrl,
        company_id: "company-91",
        client_id: "client",
        client_secret: "secret"
      })
      .expect(400);
    assert.equal(JSON.stringify(response.body).includes("secret=value"), false);
  }

  await request(app)
    .put(endpoint(qaEnvironmentId))
    .send({
      base_url: "https://proofing.example.invalid/api",
      company_id: "x".repeat(257),
      client_id: "client",
      client_secret: "secret"
    })
    .expect(400);

  await request(app).get(endpoint("unknown-environment")).expect(404);
  await request(app)
    .get("/api/targets/thinkdifferentprint-ecommerce/environments/env-thinkdifferentprint-sandbox/proofing-api")
    .expect(409);
});

test("keeps the credential routes behind the existing authenticated admin middleware", async () => {
  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const middlewareIndex = serverSource.indexOf('app.use("/api", requirePathfinderAuth)');
  const routeIndex = serverSource.indexOf('app.get("/api/targets/:targetId/environments/:environmentId/proofing-api"');
  assert.ok(middlewareIndex > -1);
  assert.ok(routeIndex > middlewareIndex);
});

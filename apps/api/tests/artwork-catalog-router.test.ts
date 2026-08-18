import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";
import request from "supertest";
import type { ArtworkCatalogCustomerAuthority } from "../src/artwork-catalog/contracts.ts";
import { createArtworkCatalogRouter } from "../src/artwork-catalog/router.ts";
import { createArtworkCatalogService } from "../src/artwork-catalog/service.ts";
import { InMemoryArtworkCatalogTestStore } from "../src/artwork-catalog/store.ts";

const productBody = {
  specification: {
    width: 60,
    height: 46,
    units: "in" as const,
    artwork_scale: { numerator: 1, denominator: 1 },
    target_dpi: 150
  }
};

function buildApp(options: {
  store?: InMemoryArtworkCatalogTestStore;
  authority?: ArtworkCatalogCustomerAuthority;
} = {}) {
  const store = options.store ?? new InMemoryArtworkCatalogTestStore();
  const authority = options.authority ?? {
    async authorize(input: { operator_uid: string; customer_id: string }) {
      return input.operator_uid === "operator-1249" && input.customer_id === "1249";
    }
  };
  let sequence = 0;
  const service = createArtworkCatalogService({
    authority,
    repository: store,
    clock: () => "2026-08-18T02:00:00.000Z",
    generate_id: (kind) => `${kind}-${++sequence}`
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const uid = req.header("x-test-operator");
    if (uid) res.locals.authUser = { uid, email: "must-not-be-persisted@example.invalid" };
    next();
  });
  app.use("/api", createArtworkCatalogRouter({ service }));
  return { app, store };
}

function operator(requestBuilder: request.Test) {
  return requestBuilder
    .set("x-test-operator", "operator-1249")
    .set("x-request-id", "router-request-1249");
}

test("keeps every route behind explicit operator and customer authority", async () => {
  const { app, store } = buildApp();
  const unauthenticated = await request(app)
    .get("/api/customers/1249/artwork-catalogs")
    .expect(401);
  assert.match(unauthenticated.headers["cache-control"], /no-store/);

  const denied = await operator(
    request(app).get("/api/customers/1250/artwork-catalogs")
  ).expect(403);
  assert.equal(denied.body.code, "forbidden");
  assert.deepEqual(await store.listCatalogs("1249"), []);
  assert.deepEqual(await store.listCatalogs("1250"), []);
});

test("creates and replays safe internal catalog and product DTOs", async () => {
  const { app, store } = buildApp();
  const invalidIdentity = await operator(
    request(app)
      .post("/api/customers/1249/artwork-catalogs")
      .set("idempotency-key", "invalid-body-1249")
      .send({ customer_id: "1250" })
  ).expect(400);
  assert.equal(invalidIdentity.body.code, "invalid_request");

  await operator(
    request(app).post("/api/customers/1249/artwork-catalogs").send({})
  ).expect(400);

  const created = await operator(
    request(app)
      .post("/api/customers/1249/artwork-catalogs")
      .set("idempotency-key", "router-catalog-1249")
      .send({})
  ).expect(201);
  assert.equal(created.body.disposition, "created");
  assert.equal(created.body.catalog.inspection_policy.mode, "disabled");
  assert.match(created.headers["cache-control"], /private/);
  assert.match(created.headers["cache-control"], /no-store/);

  const replayed = await operator(
    request(app)
      .post("/api/customers/1249/artwork-catalogs")
      .set("idempotency-key", "router-catalog-1249")
      .send({})
  ).expect(200);
  assert.equal(replayed.body.disposition, "replayed");
  assert.deepEqual(replayed.body.catalog, created.body.catalog);

  const catalogId = created.body.catalog.catalog_id as string;
  const product = await operator(
    request(app)
      .post(`/api/customers/1249/artwork-catalogs/${catalogId}/products`)
      .set("idempotency-key", "router-product-1249")
      .send(productBody)
  ).expect(201);
  assert.equal(product.body.product.specification.width, 60);
  assert.equal(product.body.product.specification.height, 46);

  const catalogs = await operator(
    request(app).get("/api/customers/1249/artwork-catalogs")
  ).expect(200);
  const products = await operator(
    request(app).get(`/api/customers/1249/artwork-catalogs/${catalogId}/products`)
  ).expect(200);
  assert.equal(catalogs.body.catalogs.length, 1);
  assert.equal(products.body.products.length, 1);
  assert.equal((await store.listAuditEvents("1249")).length, 2);

  const serialized = JSON.stringify({ created: created.body, product: product.body }).toLowerCase();
  for (const forbidden of [
    "must-not-be-persisted@example.invalid",
    "provider_key",
    "object_key",
    "object_version",
    "signed_url",
    "filename",
    "token",
    "native_report",
    "audit_event"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `route DTO exposed ${forbidden}`);
  }
  await request(app).get("/public/customers/1249/artwork-catalogs").expect(404);
});

test("isolates an allowed second customer from the 1249 catalog", async () => {
  const authority: ArtworkCatalogCustomerAuthority = {
    async authorize(input) {
      return input.operator_uid === "operator-1249" && ["1249", "1250"].includes(input.customer_id);
    }
  };
  const { app } = buildApp({ authority });
  const created = await operator(
    request(app)
      .post("/api/customers/1249/artwork-catalogs")
      .set("idempotency-key", "isolation-catalog-1249")
      .send({})
  ).expect(201);
  const otherCatalogs = await operator(
    request(app).get("/api/customers/1250/artwork-catalogs")
  ).expect(200);
  assert.deepEqual(otherCatalogs.body.catalogs, []);
  await operator(
    request(app)
      .post(`/api/customers/1250/artwork-catalogs/${created.body.catalog.catalog_id}/products`)
      .set("idempotency-key", "isolation-product-1250")
      .send(productBody)
  ).expect(404);
});

test("sanitizes persistence failures and atomically retains no entity or audit", async () => {
  const store = new InMemoryArtworkCatalogTestStore({
    before_commit: () => {
      throw new Error("secret-table-name and credential must not escape");
    }
  });
  const { app } = buildApp({ store });
  const response = await operator(
    request(app)
      .post("/api/customers/1249/artwork-catalogs")
      .set("idempotency-key", "router-rollback-1249")
      .send({})
  ).expect(500);
  assert.deepEqual(response.body, {
    error: "Artwork catalog persistence could not be confirmed.",
    code: "persistence_failed"
  });
  assert.equal(JSON.stringify(response.body).includes("secret"), false);
  assert.deepEqual(await store.listCatalogs("1249"), []);
  assert.deepEqual(await store.listAuditEvents("1249"), []);
});

test("remains unmounted and contains no durable, runtime, Proof, or provider coupling", async () => {
  const [serverSource, routerSource, storeSource, packageSource] = await Promise.all([
    readFile(new URL("../src/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/artwork-catalog/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/artwork-catalog/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(serverSource, /createArtworkCatalogRouter|artwork-catalog/);
  assert.doesNotMatch(routerSource, /process\.env|fetch\(|@aws-sdk|\.\/\.\.\/store|\.\/\.\.\/proof/);
  assert.doesNotMatch(
    storeSource,
    /process\.env|fetch\(|@aws-sdk|node:fs|\.\/\.\.\/store|\.\/\.\.\/proof/
  );
  const packageJson = JSON.parse(packageSource) as { dependencies: Record<string, string> };
  assert.equal(packageJson.dependencies["@pathfinder/artwork-catalog-domain"], "0.1.0");
  assert.equal(packageJson.dependencies["@pathfinder/artwork-inspection-contracts"], undefined);
});

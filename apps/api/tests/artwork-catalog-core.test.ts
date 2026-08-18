import assert from "node:assert/strict";
import test from "node:test";
import type { ArtworkCatalogCustomerAuthority } from "../src/artwork-catalog/contracts.ts";
import { createArtworkCatalogService } from "../src/artwork-catalog/service.ts";
import { InMemoryArtworkCatalogTestStore } from "../src/artwork-catalog/store.ts";

const productBody = Object.freeze({
  specification: Object.freeze({
    width: 144,
    height: 30,
    units: "in" as const,
    artwork_scale: Object.freeze({ numerator: 1, denominator: 1 }),
    target_dpi: 150
  })
});

function testAuthority(...allowedCustomerIds: string[]): ArtworkCatalogCustomerAuthority {
  const allowed = new Set(allowedCustomerIds);
  return {
    async authorize(input) {
      return input.operator_uid === "operator-1249" && allowed.has(input.customer_id);
    }
  };
}

function serviceFor(
  repository: InMemoryArtworkCatalogTestStore,
  authority: ArtworkCatalogCustomerAuthority = testAuthority("1249")
) {
  let sequence = 0;
  return createArtworkCatalogService({
    authority,
    repository,
    clock: () => "2026-08-18T01:00:00.000Z",
    generate_id: (kind) => `${kind}-${++sequence}`
  });
}

const context = Object.freeze({
  actor: Object.freeze({ operator_uid: "operator-1249" }),
  correlation_id: "request-1249"
});

test("persists an internal catalog with inspection disabled and an immutable product specification", async () => {
  const store = new InMemoryArtworkCatalogTestStore();
  const service = serviceFor(store);

  const createdCatalog = await service.createCatalog({
    customer_id: "1249",
    idempotency_key: "catalog-request-1249",
    body: {},
    context
  });
  const createdProduct = await service.createProduct({
    customer_id: "1249",
    catalog_id: createdCatalog.catalog.catalog_id,
    idempotency_key: "product-request-1249",
    body: productBody,
    context
  });

  assert.equal(createdCatalog.disposition, "created");
  assert.deepEqual(createdCatalog.catalog.inspection_policy.mode, "disabled");
  assert.equal(createdProduct.product.specification.width, 144);
  assert.equal(createdProduct.product.specification.height, 30);
  assert.equal(createdProduct.product.specification.target_dpi, 150);
  assert.deepEqual(createdProduct.product.specification.artwork_scale, {
    numerator: 1,
    denominator: 1
  });
  assert.equal(Object.isFrozen(createdCatalog.catalog), true);
  assert.equal(Object.isFrozen(createdProduct.product.specification.artwork_scale), true);

  const catalogs = await service.listCatalogs({ customer_id: "1249", context });
  const products = await service.listProducts({
    customer_id: "1249",
    catalog_id: createdCatalog.catalog.catalog_id,
    context
  });
  assert.deepEqual(catalogs, [createdCatalog.catalog]);
  assert.deepEqual(products, [createdProduct.product]);

  const serialized = JSON.stringify({ catalogs, products }).toLowerCase();
  for (const forbidden of [
    "provider_key",
    "object_key",
    "object_version",
    "signed_url",
    "filename",
    "token",
    "email",
    "native_report"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `DTO exposed ${forbidden}`);
  }
});

test("replays identical create commands without replacing records or appending audit", async () => {
  const store = new InMemoryArtworkCatalogTestStore();
  const service = serviceFor(store);
  const firstCatalog = await service.createCatalog({
    customer_id: "1249",
    idempotency_key: "catalog-idempotency-1249",
    body: {},
    context
  });
  const replayedCatalog = await service.createCatalog({
    customer_id: "1249",
    idempotency_key: "catalog-idempotency-1249",
    body: {},
    context
  });
  assert.equal(replayedCatalog.disposition, "replayed");
  assert.deepEqual(replayedCatalog.catalog, firstCatalog.catalog);

  const firstProduct = await service.createProduct({
    customer_id: "1249",
    catalog_id: firstCatalog.catalog.catalog_id,
    idempotency_key: "product-idempotency-1249",
    body: productBody,
    context
  });
  const replayedProduct = await service.createProduct({
    customer_id: "1249",
    catalog_id: firstCatalog.catalog.catalog_id,
    idempotency_key: "product-idempotency-1249",
    body: structuredClone(productBody),
    context
  });
  assert.equal(replayedProduct.disposition, "replayed");
  assert.deepEqual(replayedProduct.product, firstProduct.product);

  const audit = await store.listAuditEvents("1249");
  assert.equal(audit.length, 2);
  assert.deepEqual(
    audit.map((event) => event.action),
    ["artwork_catalog.created", "artwork_catalog.product_created"]
  );
  assert.equal(Object.isFrozen(audit), true);
  assert.equal(Object.isFrozen(audit[0]), true);
});

test("serializes simultaneous retries into one entity and one audit event", async () => {
  const store = new InMemoryArtworkCatalogTestStore({
    before_commit: async () => {
      await Promise.resolve();
    }
  });
  const service = serviceFor(store);
  const request = {
    customer_id: "1249",
    idempotency_key: "concurrent-catalog-1249",
    body: {},
    context
  };
  const results = await Promise.all([
    service.createCatalog(request),
    service.createCatalog(request)
  ]);
  assert.deepEqual(
    results.map((result) => result.disposition).sort(),
    ["created", "replayed"]
  );
  assert.deepEqual(results[0]?.catalog, results[1]?.catalog);
  assert.equal((await store.listCatalogs("1249")).length, 1);
  assert.equal((await store.listAuditEvents("1249")).length, 1);
});

test("conflicts when an idempotency key is reused with changed specification input", async () => {
  const store = new InMemoryArtworkCatalogTestStore();
  const service = serviceFor(store);
  const createdCatalog = await service.createCatalog({
    customer_id: "1249",
    idempotency_key: "catalog-conflict-1249",
    body: {},
    context
  });
  await service.createProduct({
    customer_id: "1249",
    catalog_id: createdCatalog.catalog.catalog_id,
    idempotency_key: "product-conflict-1249",
    body: productBody,
    context
  });
  await assert.rejects(
    () =>
      service.createProduct({
        customer_id: "1249",
        catalog_id: createdCatalog.catalog.catalog_id,
        idempotency_key: "product-conflict-1249",
        body: {
          specification: { ...productBody.specification, target_dpi: 72 }
        },
        context
      }),
    { code: "conflict" }
  );
  assert.equal((await store.listProducts("1249", createdCatalog.catalog.catalog_id)).length, 1);
  assert.equal((await store.listAuditEvents("1249")).length, 2);
});

test("fails tenant authority closed and never crosses a customer or catalog binding", async () => {
  let commitAttempts = 0;
  const store = new InMemoryArtworkCatalogTestStore({
    before_commit: () => {
      commitAttempts += 1;
    }
  });
  const service = serviceFor(store, testAuthority("1249", "1250"));
  const created = await service.createCatalog({
    customer_id: "1249",
    idempotency_key: "tenant-catalog-1249",
    body: {},
    context
  });
  assert.equal(commitAttempts, 1);
  assert.deepEqual(await service.listCatalogs({ customer_id: "1250", context }), []);
  await assert.rejects(
    () =>
      service.createProduct({
        customer_id: "1250",
        catalog_id: created.catalog.catalog_id,
        idempotency_key: "tenant-product-1250",
        body: productBody,
        context
      }),
    { code: "not_found" }
  );
  assert.equal(commitAttempts, 1);

  const deniedService = serviceFor(store, testAuthority("1249"));
  await assert.rejects(
    () => deniedService.listCatalogs({ customer_id: "1250", context }),
    { code: "forbidden" }
  );
  assert.equal(commitAttempts, 1);
  assert.equal((await store.listAuditEvents("1250")).length, 0);
});

test("rolls back entities and audit atomically when the persistence boundary fails", async () => {
  const store = new InMemoryArtworkCatalogTestStore({
    before_commit: () => {
      throw new Error("simulated secret persistence failure");
    }
  });
  const service = serviceFor(store);
  await assert.rejects(
    () =>
      service.createCatalog({
        customer_id: "1249",
        idempotency_key: "rollback-catalog-1249",
        body: {},
        context
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Artwork catalog persistence could not be confirmed." &&
      !error.message.includes("secret")
  );
  assert.deepEqual(await store.listCatalogs("1249"), []);
  assert.deepEqual(await store.listAuditEvents("1249"), []);
});

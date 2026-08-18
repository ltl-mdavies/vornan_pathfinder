import {
  ArtworkCatalogApplicationError,
  type ArtworkCatalogAuditEvent,
  type ArtworkCatalogIdempotencyBinding,
  type ArtworkCatalogMutationResult,
  type ArtworkCatalogProductRecord,
  type ArtworkCatalogRecord,
  type ArtworkCatalogRepository
} from "./contracts.js";

type CommitKind = "catalog" | "product";

interface StoredIdempotency {
  readonly kind: CommitKind;
  readonly input_fingerprint: string;
  readonly record_key: string;
}

type CreateCatalogInput = Parameters<ArtworkCatalogRepository["createCatalog"]>[0];
type CreateProductInput = Parameters<ArtworkCatalogRepository["createProduct"]>[0];

export interface InMemoryArtworkCatalogTestStoreOptions {
  readonly before_commit?: (input: {
    readonly kind: CommitKind;
    readonly audit_event: ArtworkCatalogAuditEvent;
  }) => void | Promise<void>;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function safeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function catalogKey(customerId: string, catalogId: string) {
  return `${customerId}\u0000${catalogId}`;
}

function productKey(customerId: string, catalogId: string, productId: string) {
  return `${customerId}\u0000${catalogId}\u0000${productId}`;
}

function idempotencyKey(binding: ArtworkCatalogIdempotencyBinding) {
  return `${binding.scope}\u0000${binding.key}`;
}

function requireBinding(binding: ArtworkCatalogIdempotencyBinding) {
  if (
    !/^[A-Za-z0-9_.:-]{1,320}$/.test(binding.scope) ||
    !/^[A-Za-z0-9_.:-]{8,160}$/.test(binding.key) ||
    !/^[a-f0-9]{64}$/.test(binding.input_fingerprint)
  ) {
    throw new ArtworkCatalogApplicationError("invalid_request", "The idempotency binding is invalid.");
  }
}

function assertAuditBinding(
  event: ArtworkCatalogAuditEvent,
  expected: {
    customer_id: string;
    catalog_id: string;
    catalog_product_id?: string | null;
  }
) {
  if (
    event.customer_id !== expected.customer_id ||
    event.catalog_id !== expected.catalog_id ||
    event.catalog_product_id !== (expected.catalog_product_id ?? null)
  ) {
    throw new ArtworkCatalogApplicationError("conflict", "The audit binding does not match the mutation.");
  }
}

export class InMemoryArtworkCatalogTestStore implements ArtworkCatalogRepository {
  readonly #catalogs = new Map<string, ArtworkCatalogRecord>();
  readonly #products = new Map<string, ArtworkCatalogProductRecord>();
  readonly #auditEvents: ArtworkCatalogAuditEvent[] = [];
  readonly #auditIds = new Set<string>();
  readonly #idempotency = new Map<string, StoredIdempotency>();
  readonly #options: InMemoryArtworkCatalogTestStoreOptions;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: InMemoryArtworkCatalogTestStoreOptions = {}) {
    this.#options = options;
  }

  #serializeMutation<T>(operation: () => Promise<T>) {
    const pending = this.#mutationTail.then(operation);
    this.#mutationTail = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  async #replay<T>(
    kind: CommitKind,
    binding: ArtworkCatalogIdempotencyBinding,
    records: Map<string, T>
  ): Promise<ArtworkCatalogMutationResult<T> | null> {
    requireBinding(binding);
    const stored = this.#idempotency.get(idempotencyKey(binding));
    if (!stored) return null;
    if (stored.kind !== kind || stored.input_fingerprint !== binding.input_fingerprint) {
      throw new ArtworkCatalogApplicationError(
        "conflict",
        "The idempotency key was already used for a different request."
      );
    }
    const record = records.get(stored.record_key);
    if (!record) {
      throw new ArtworkCatalogApplicationError(
        "persistence_failed",
        "The prior mutation could not be reconciled."
      );
    }
    return Object.freeze({ disposition: "replayed" as const, record: safeClone(record) });
  }

  async #beforeCommit(kind: CommitKind, auditEvent: ArtworkCatalogAuditEvent) {
    if (this.#auditIds.has(auditEvent.event_id)) {
      throw new ArtworkCatalogApplicationError("conflict", "The audit event already exists.");
    }
    await this.#options.before_commit?.({ kind, audit_event: safeClone(auditEvent) });
  }

  async createCatalog(input: CreateCatalogInput) {
    return this.#serializeMutation(() => this.#createCatalog(input));
  }

  async #createCatalog(
    input: CreateCatalogInput
  ): Promise<ArtworkCatalogMutationResult<ArtworkCatalogRecord>> {
    const replay = await this.#replay("catalog", input.idempotency, this.#catalogs);
    if (replay) return replay;

    const { catalog, disabled_policy: policy } = input.record;
    if (
      catalog.customer_id !== policy.customer_id ||
      catalog.catalog_id !== policy.catalog_id ||
      policy.mode !== "disabled" ||
      policy.provider_key !== null
    ) {
      throw new ArtworkCatalogApplicationError("conflict", "The disabled policy binding is invalid.");
    }
    assertAuditBinding(input.audit_event, {
      customer_id: catalog.customer_id,
      catalog_id: catalog.catalog_id
    });
    if (input.audit_event.inspection_policy_revision_id !== policy.policy_revision_id) {
      throw new ArtworkCatalogApplicationError("conflict", "The policy audit binding is invalid.");
    }

    const key = catalogKey(catalog.customer_id, catalog.catalog_id);
    if (this.#catalogs.has(key)) {
      throw new ArtworkCatalogApplicationError("conflict", "The catalog already exists.");
    }
    await this.#beforeCommit("catalog", input.audit_event);

    const record = safeClone(input.record);
    const auditEvent = safeClone(input.audit_event);
    this.#catalogs.set(key, record);
    this.#auditEvents.push(auditEvent);
    this.#auditIds.add(auditEvent.event_id);
    this.#idempotency.set(idempotencyKey(input.idempotency), {
      kind: "catalog",
      input_fingerprint: input.idempotency.input_fingerprint,
      record_key: key
    });
    return Object.freeze({ disposition: "created" as const, record: safeClone(record) });
  }

  async getCatalog(customerId: string, catalogId: string) {
    const record = this.#catalogs.get(catalogKey(customerId, catalogId));
    return record ? safeClone(record) : null;
  }

  async listCatalogs(customerId: string) {
    return Object.freeze(
      [...this.#catalogs.values()]
        .filter((record) => record.catalog.customer_id === customerId)
        .sort((left, right) =>
          left.catalog.catalog_id.localeCompare(right.catalog.catalog_id)
        )
        .map(safeClone)
    );
  }

  async createProduct(input: CreateProductInput) {
    return this.#serializeMutation(() => this.#createProduct(input));
  }

  async #createProduct(
    input: CreateProductInput
  ): Promise<ArtworkCatalogMutationResult<ArtworkCatalogProductRecord>> {
    const replay = await this.#replay("product", input.idempotency, this.#products);
    if (replay) return replay;

    const { product, revision, specification } = input.record;
    if (
      product.customer_id !== revision.customer_id ||
      product.customer_id !== specification.customer_id ||
      product.catalog_id !== revision.catalog_id ||
      product.catalog_product_id !== revision.catalog_product_id ||
      revision.specification_revision_id !== specification.specification_revision_id
    ) {
      throw new ArtworkCatalogApplicationError("conflict", "The product revision binding is invalid.");
    }
    const owningCatalog = await this.getCatalog(product.customer_id, product.catalog_id);
    if (!owningCatalog) {
      throw new ArtworkCatalogApplicationError("not_found", "The artwork catalog was not found.");
    }
    assertAuditBinding(input.audit_event, {
      customer_id: product.customer_id,
      catalog_id: product.catalog_id,
      catalog_product_id: product.catalog_product_id
    });
    if (
      input.audit_event.catalog_product_revision_id !== revision.catalog_product_revision_id ||
      input.audit_event.specification_revision_id !== specification.specification_revision_id
    ) {
      throw new ArtworkCatalogApplicationError("conflict", "The product audit binding is invalid.");
    }

    const key = productKey(product.customer_id, product.catalog_id, product.catalog_product_id);
    if (this.#products.has(key)) {
      throw new ArtworkCatalogApplicationError("conflict", "The catalog product already exists.");
    }
    await this.#beforeCommit("product", input.audit_event);

    const record = safeClone(input.record);
    const auditEvent = safeClone(input.audit_event);
    this.#products.set(key, record);
    this.#auditEvents.push(auditEvent);
    this.#auditIds.add(auditEvent.event_id);
    this.#idempotency.set(idempotencyKey(input.idempotency), {
      kind: "product",
      input_fingerprint: input.idempotency.input_fingerprint,
      record_key: key
    });
    return Object.freeze({ disposition: "created" as const, record: safeClone(record) });
  }

  async listProducts(customerId: string, catalogId: string) {
    return Object.freeze(
      [...this.#products.values()]
        .filter(
          (record) =>
            record.product.customer_id === customerId && record.product.catalog_id === catalogId
        )
        .sort((left, right) =>
          left.product.catalog_product_id.localeCompare(right.product.catalog_product_id)
        )
        .map(safeClone)
    );
  }

  async listAuditEvents(customerId: string) {
    return Object.freeze(
      this.#auditEvents
        .filter((event) => event.customer_id === customerId)
        .map(safeClone)
    );
  }
}

import { createHash } from "node:crypto";
import {
  ArtworkCatalogDomainError,
  createCatalogProduct,
  createCatalogProductRevision,
  createCustomerCatalog,
  createInspectionPolicyRevision,
  createProductSpecificationRevision
} from "@pathfinder/artwork-catalog-domain";
import { authorizeArtworkCatalogCustomer } from "./authority.js";
import { createArtworkCatalogAuditEvent } from "./audit.js";
import {
  ArtworkCatalogApplicationError,
  type ArtworkCatalogCustomerAuthority,
  type ArtworkCatalogDto,
  type ArtworkCatalogProductDto,
  type ArtworkCatalogProductRecord,
  type ArtworkCatalogRecord,
  type ArtworkCatalogRepository,
  type ArtworkCatalogRequestContext,
  type CreateArtworkCatalogProductBody
} from "./contracts.js";

export type ArtworkCatalogGeneratedIdKind =
  | "catalog"
  | "inspection_policy_revision"
  | "catalog_product"
  | "catalog_product_revision"
  | "specification_revision"
  | "audit_event"
  | "correlation";

export interface ArtworkCatalogServiceDependencies {
  readonly authority: ArtworkCatalogCustomerAuthority;
  readonly repository: ArtworkCatalogRepository;
  readonly clock: () => string;
  readonly generate_id: (kind: ArtworkCatalogGeneratedIdKind) => string;
}

const ID_PREFIX: Readonly<Record<ArtworkCatalogGeneratedIdKind, string>> = {
  catalog: "acat_",
  inspection_policy_revision: "apolicy_",
  catalog_product: "aproduct_",
  catalog_product_revision: "aproductrev_",
  specification_revision: "aspec_",
  audit_event: "aaudit_",
  correlation: "acorr_"
};

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtworkCatalogApplicationError("invalid_request", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(record).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new ArtworkCatalogApplicationError("invalid_request", `${label} contains unsupported fields.`);
  }
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ArtworkCatalogApplicationError("invalid_request", `${label} must be a positive number.`);
  }
  return value;
}

function parseCreateCatalogBody(value: unknown) {
  const record = value === undefined ? {} : exactObject(value, "The catalog request");
  exactKeys(record, [], "The catalog request");
  return Object.freeze({});
}

function parseProductBody(value: unknown): CreateArtworkCatalogProductBody {
  const body = exactObject(value, "The product request");
  exactKeys(body, ["specification"], "The product request");
  const specification = exactObject(body.specification, "The specification");
  exactKeys(
    specification,
    ["artwork_scale", "height", "target_dpi", "units", "width"],
    "The specification"
  );
  const scale = exactObject(specification.artwork_scale, "The artwork scale");
  exactKeys(scale, ["denominator", "numerator"], "The artwork scale");
  const units = specification.units;
  if (units !== "in" && units !== "mm" && units !== "cm") {
    throw new ArtworkCatalogApplicationError("invalid_request", "The specification units are unsupported.");
  }
  return Object.freeze({
    specification: Object.freeze({
      width: finiteNumber(specification.width, "width"),
      height: finiteNumber(specification.height, "height"),
      units,
      artwork_scale: Object.freeze({
        numerator: finiteNumber(scale.numerator, "artwork_scale.numerator"),
        denominator: finiteNumber(scale.denominator, "artwork_scale.denominator")
      }),
      target_dpi: finiteNumber(specification.target_dpi, "target_dpi")
    })
  });
}

function idempotencyKey(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(normalized)) {
    throw new ArtworkCatalogApplicationError(
      "invalid_request",
      "A bounded Idempotency-Key header is required."
    );
  }
  return normalized;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireTimestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new ArtworkCatalogApplicationError("persistence_failed", "The server clock is invalid.");
  }
  return new Date(value).toISOString();
}

function generatedId(
  dependencies: ArtworkCatalogServiceDependencies,
  kind: ArtworkCatalogGeneratedIdKind
) {
  const suffix = dependencies.generate_id(kind).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(suffix)) {
    throw new ArtworkCatalogApplicationError("persistence_failed", "The server identifier source is invalid.");
  }
  return `${ID_PREFIX[kind]}${suffix}`;
}

function correlationId(
  dependencies: ArtworkCatalogServiceDependencies,
  context: ArtworkCatalogRequestContext
) {
  return context.correlation_id?.trim() || generatedId(dependencies, "correlation");
}

function catalogDto(record: ArtworkCatalogRecord): ArtworkCatalogDto {
  const { catalog, disabled_policy: policy } = record;
  if (
    catalog.customer_id !== policy.customer_id ||
    catalog.catalog_id !== policy.catalog_id ||
    policy.mode !== "disabled" ||
    policy.provider_key !== null
  ) {
    throw new ArtworkCatalogApplicationError("conflict", "The catalog policy binding is invalid.");
  }
  return Object.freeze({
    customer_id: catalog.customer_id,
    catalog_id: catalog.catalog_id,
    created_at: catalog.created_at,
    inspection_policy: Object.freeze({
      policy_revision_id: policy.policy_revision_id,
      mode: "disabled" as const
    })
  });
}

function productDto(record: ArtworkCatalogProductRecord): ArtworkCatalogProductDto {
  const { product, revision, specification } = record;
  if (
    product.customer_id !== revision.customer_id ||
    product.customer_id !== specification.customer_id ||
    product.catalog_id !== revision.catalog_id ||
    product.catalog_product_id !== revision.catalog_product_id ||
    revision.specification_revision_id !== specification.specification_revision_id
  ) {
    throw new ArtworkCatalogApplicationError("conflict", "The product binding is invalid.");
  }
  return Object.freeze({
    customer_id: product.customer_id,
    catalog_id: product.catalog_id,
    catalog_product_id: product.catalog_product_id,
    catalog_product_revision_id: revision.catalog_product_revision_id,
    specification: Object.freeze({
      specification_revision_id: specification.specification_revision_id,
      width: specification.width,
      height: specification.height,
      units: specification.units,
      artwork_scale: Object.freeze({ ...specification.artwork_scale }),
      target_dpi: specification.target_dpi
    }),
    created_at: product.created_at
  });
}

async function repositoryCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ArtworkCatalogApplicationError) throw error;
    throw new ArtworkCatalogApplicationError(
      "persistence_failed",
      "Artwork catalog persistence could not be confirmed."
    );
  }
}

function domainCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ArtworkCatalogDomainError) {
      throw new ArtworkCatalogApplicationError(
        error.code === "binding_mismatch" ? "conflict" : "invalid_request",
        "The artwork catalog request is invalid."
      );
    }
    throw error;
  }
}

export function createArtworkCatalogService(dependencies: ArtworkCatalogServiceDependencies) {
  const authorize = (customerId: string, context: ArtworkCatalogRequestContext) =>
    authorizeArtworkCatalogCustomer(dependencies.authority, context.actor, customerId);

  return Object.freeze({
    async createCatalog(input: {
      customer_id: string;
      idempotency_key: string;
      body: unknown;
      context: ArtworkCatalogRequestContext;
    }) {
      const customerId = await authorize(input.customer_id, input.context);
      const key = idempotencyKey(input.idempotency_key);
      const body = parseCreateCatalogBody(input.body);
      const occurredAt = requireTimestamp(dependencies.clock());
      const catalog = domainCall(() =>
        createCustomerCatalog({
          customer_id: customerId,
          catalog_id: generatedId(dependencies, "catalog"),
          created_at: occurredAt
        })
      );
      const disabledPolicy = domainCall(() =>
        createInspectionPolicyRevision({
          catalog,
          policy_revision_id: generatedId(dependencies, "inspection_policy_revision"),
          mode: "disabled",
          provider_key: null,
          created_at: occurredAt
        })
      );
      const auditEvent = createArtworkCatalogAuditEvent({
        event_id: generatedId(dependencies, "audit_event"),
        occurred_at: occurredAt,
        action: "artwork_catalog.created",
        customer_id: customerId,
        catalog_id: catalog.catalog_id,
        inspection_policy_revision_id: disabledPolicy.policy_revision_id,
        actor_id: input.context.actor.operator_uid,
        correlation_id: correlationId(dependencies, input.context)
      });
      const result = await repositoryCall(() =>
        dependencies.repository.createCatalog({
          record: { catalog, disabled_policy: disabledPolicy },
          audit_event: auditEvent,
          idempotency: {
            scope: `${customerId}:catalog:create`,
            key,
            input_fingerprint: fingerprint(body)
          }
        })
      );
      return Object.freeze({ disposition: result.disposition, catalog: catalogDto(result.record) });
    },

    async listCatalogs(input: {
      customer_id: string;
      context: ArtworkCatalogRequestContext;
    }) {
      const customerId = await authorize(input.customer_id, input.context);
      const records = await repositoryCall(() => dependencies.repository.listCatalogs(customerId));
      const catalogs = records.map((record) => {
        if (record.catalog.customer_id !== customerId) {
          throw new ArtworkCatalogApplicationError("conflict", "The catalog tenant binding is invalid.");
        }
        return catalogDto(record);
      });
      return Object.freeze(catalogs);
    },

    async createProduct(input: {
      customer_id: string;
      catalog_id: string;
      idempotency_key: string;
      body: unknown;
      context: ArtworkCatalogRequestContext;
    }) {
      const customerId = await authorize(input.customer_id, input.context);
      const key = idempotencyKey(input.idempotency_key);
      const body = parseProductBody(input.body);
      const catalogRecord = await repositoryCall(() =>
        dependencies.repository.getCatalog(customerId, input.catalog_id)
      );
      if (!catalogRecord) {
        throw new ArtworkCatalogApplicationError("not_found", "The artwork catalog was not found.");
      }
      const catalog = catalogDto(catalogRecord);
      if (catalog.customer_id !== customerId || catalog.catalog_id !== input.catalog_id) {
        throw new ArtworkCatalogApplicationError("conflict", "The catalog tenant binding is invalid.");
      }

      const occurredAt = requireTimestamp(dependencies.clock());
      const specification = domainCall(() =>
        createProductSpecificationRevision({
          customer_id: customerId,
          specification_revision_id: generatedId(dependencies, "specification_revision"),
          ...body.specification,
          created_at: occurredAt
        })
      );
      const product = domainCall(() =>
        createCatalogProduct({
          catalog: catalogRecord.catalog,
          catalog_product_id: generatedId(dependencies, "catalog_product"),
          created_at: occurredAt
        })
      );
      const revision = domainCall(() =>
        createCatalogProductRevision({
          product,
          specification,
          catalog_product_revision_id: generatedId(dependencies, "catalog_product_revision"),
          created_at: occurredAt
        })
      );
      const auditEvent = createArtworkCatalogAuditEvent({
        event_id: generatedId(dependencies, "audit_event"),
        occurred_at: occurredAt,
        action: "artwork_catalog.product_created",
        customer_id: customerId,
        catalog_id: input.catalog_id,
        catalog_product_id: product.catalog_product_id,
        catalog_product_revision_id: revision.catalog_product_revision_id,
        specification_revision_id: specification.specification_revision_id,
        actor_id: input.context.actor.operator_uid,
        correlation_id: correlationId(dependencies, input.context)
      });
      const result = await repositoryCall(() =>
        dependencies.repository.createProduct({
          record: { product, revision, specification },
          audit_event: auditEvent,
          idempotency: {
            scope: `${customerId}:${input.catalog_id}:product:create`,
            key,
            input_fingerprint: fingerprint(body)
          }
        })
      );
      return Object.freeze({ disposition: result.disposition, product: productDto(result.record) });
    },

    async listProducts(input: {
      customer_id: string;
      catalog_id: string;
      context: ArtworkCatalogRequestContext;
    }) {
      const customerId = await authorize(input.customer_id, input.context);
      const catalogRecord = await repositoryCall(() =>
        dependencies.repository.getCatalog(customerId, input.catalog_id)
      );
      if (!catalogRecord) {
        throw new ArtworkCatalogApplicationError("not_found", "The artwork catalog was not found.");
      }
      catalogDto(catalogRecord);
      const records = await repositoryCall(() =>
        dependencies.repository.listProducts(customerId, input.catalog_id)
      );
      return Object.freeze(
        records.map((record) => {
          if (
            record.product.customer_id !== customerId ||
            record.product.catalog_id !== input.catalog_id
          ) {
            throw new ArtworkCatalogApplicationError("conflict", "The product tenant binding is invalid.");
          }
          return productDto(record);
        })
      );
    }
  });
}

export type ArtworkCatalogService = ReturnType<typeof createArtworkCatalogService>;

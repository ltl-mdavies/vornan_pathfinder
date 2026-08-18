import type {
  CatalogProduct,
  CatalogProductRevision,
  CustomerCatalog,
  InspectionPolicyRevision,
  ProductSpecificationRevision
} from "@pathfinder/artwork-catalog-domain";

export interface ArtworkCatalogActor {
  readonly operator_uid: string;
}

export interface ArtworkCatalogRequestContext {
  readonly actor: ArtworkCatalogActor;
  readonly correlation_id?: string;
}

export interface ArtworkCatalogCustomerAuthority {
  authorize(input: {
    readonly operator_uid: string;
    readonly customer_id: string;
  }): Promise<boolean>;
}

export type ArtworkCatalogAuditAction =
  | "artwork_catalog.created"
  | "artwork_catalog.product_created";

export interface ArtworkCatalogAuditEvent {
  readonly event_id: string;
  readonly occurred_at: string;
  readonly action: ArtworkCatalogAuditAction;
  readonly outcome: "succeeded";
  readonly customer_id: string;
  readonly catalog_id: string;
  readonly catalog_product_id: string | null;
  readonly catalog_product_revision_id: string | null;
  readonly specification_revision_id: string | null;
  readonly inspection_policy_revision_id: string | null;
  readonly actor_type: "operator";
  readonly actor_id: string;
  readonly correlation_id: string;
}

export interface ArtworkCatalogRecord {
  readonly catalog: CustomerCatalog;
  readonly disabled_policy: InspectionPolicyRevision;
}

export interface ArtworkCatalogProductRecord {
  readonly product: CatalogProduct;
  readonly revision: CatalogProductRevision;
  readonly specification: ProductSpecificationRevision;
}

export interface ArtworkCatalogIdempotencyBinding {
  readonly scope: string;
  readonly key: string;
  readonly input_fingerprint: string;
}

export interface ArtworkCatalogMutationResult<T> {
  readonly disposition: "created" | "replayed";
  readonly record: T;
}

export interface ArtworkCatalogRepository {
  createCatalog(input: {
    readonly record: ArtworkCatalogRecord;
    readonly audit_event: ArtworkCatalogAuditEvent;
    readonly idempotency: ArtworkCatalogIdempotencyBinding;
  }): Promise<ArtworkCatalogMutationResult<ArtworkCatalogRecord>>;

  getCatalog(customerId: string, catalogId: string): Promise<ArtworkCatalogRecord | null>;

  listCatalogs(customerId: string): Promise<readonly ArtworkCatalogRecord[]>;

  createProduct(input: {
    readonly record: ArtworkCatalogProductRecord;
    readonly audit_event: ArtworkCatalogAuditEvent;
    readonly idempotency: ArtworkCatalogIdempotencyBinding;
  }): Promise<ArtworkCatalogMutationResult<ArtworkCatalogProductRecord>>;

  listProducts(customerId: string, catalogId: string): Promise<readonly ArtworkCatalogProductRecord[]>;

  listAuditEvents(customerId: string): Promise<readonly ArtworkCatalogAuditEvent[]>;
}

export interface ArtworkCatalogDto {
  readonly customer_id: string;
  readonly catalog_id: string;
  readonly created_at: string;
  readonly inspection_policy: {
    readonly policy_revision_id: string;
    readonly mode: "disabled";
  };
}

export interface ArtworkCatalogProductDto {
  readonly customer_id: string;
  readonly catalog_id: string;
  readonly catalog_product_id: string;
  readonly catalog_product_revision_id: string;
  readonly specification: {
    readonly specification_revision_id: string;
    readonly width: number;
    readonly height: number;
    readonly units: "in" | "mm" | "cm";
    readonly artwork_scale: {
      readonly numerator: number;
      readonly denominator: number;
    };
    readonly target_dpi: number;
  };
  readonly created_at: string;
}

export interface CreateArtworkCatalogProductBody {
  readonly specification: {
    readonly width: number;
    readonly height: number;
    readonly units: "in" | "mm" | "cm";
    readonly artwork_scale: {
      readonly numerator: number;
      readonly denominator: number;
    };
    readonly target_dpi: number;
  };
}

export type ArtworkCatalogApplicationErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "persistence_failed";

export class ArtworkCatalogApplicationError extends Error {
  constructor(
    readonly code: ArtworkCatalogApplicationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ArtworkCatalogApplicationError";
  }
}

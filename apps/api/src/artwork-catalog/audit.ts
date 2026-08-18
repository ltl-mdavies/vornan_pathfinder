import {
  ArtworkCatalogApplicationError,
  type ArtworkCatalogAuditAction,
  type ArtworkCatalogAuditEvent
} from "./contracts.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,160}$/;

function safeIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new ArtworkCatalogApplicationError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function safeTimestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new ArtworkCatalogApplicationError("invalid_request", "The audit timestamp is invalid.");
  }
  return new Date(value).toISOString();
}

export function createArtworkCatalogAuditEvent(input: {
  readonly event_id: string;
  readonly occurred_at: string;
  readonly action: ArtworkCatalogAuditAction;
  readonly customer_id: string;
  readonly catalog_id: string;
  readonly catalog_product_id?: string | null;
  readonly catalog_product_revision_id?: string | null;
  readonly specification_revision_id?: string | null;
  readonly inspection_policy_revision_id?: string | null;
  readonly actor_id: string;
  readonly correlation_id: string;
}): ArtworkCatalogAuditEvent {
  const optionalIdentifier = (value: string | null | undefined, label: string) =>
    value === null || value === undefined ? null : safeIdentifier(value, label);
  return Object.freeze({
    event_id: safeIdentifier(input.event_id, "event_id"),
    occurred_at: safeTimestamp(input.occurred_at),
    action: input.action,
    outcome: "succeeded" as const,
    customer_id: safeIdentifier(input.customer_id, "customer_id"),
    catalog_id: safeIdentifier(input.catalog_id, "catalog_id"),
    catalog_product_id: optionalIdentifier(input.catalog_product_id, "catalog_product_id"),
    catalog_product_revision_id: optionalIdentifier(
      input.catalog_product_revision_id,
      "catalog_product_revision_id"
    ),
    specification_revision_id: optionalIdentifier(
      input.specification_revision_id,
      "specification_revision_id"
    ),
    inspection_policy_revision_id: optionalIdentifier(
      input.inspection_policy_revision_id,
      "inspection_policy_revision_id"
    ),
    actor_type: "operator" as const,
    actor_id: safeIdentifier(input.actor_id, "actor_id"),
    correlation_id: safeIdentifier(input.correlation_id, "correlation_id")
  });
}

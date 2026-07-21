import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  enrichLiftCustomers,
  parseLiftCustomerCsv,
  parseLiftCustomerStatusJson,
  type LiftCustomer,
  type LiftCustomerDirectory
} from "@pathfinder/customer-directory";
import {
  canonicalFieldRegistry,
  canonicalRegistryMetadata,
  sampleCanonicalOrder,
  validateCanonicalOrder,
  type CanonicalFieldDataType,
  type CanonicalFieldDefinition,
  type CanonicalFieldSection,
  type ValidationMessage
} from "@pathfinder/canonical";
import {
  applyValueNormalizationToLiftPayload,
  buildLiftPackageDetailsUrl,
  buildLiftOrderLookupUrl,
  buildLiftProofReportUrl,
  buildLiftSubmitRequest,
  generateLiftPayload,
  maskLiftSubmitRequest,
  submitLiftOrder,
  validateLiftPayload,
  type LiftOrderPayload,
  type LiftSubmitMockScenario,
  type LiftSubmitRequest,
  type LiftSubmitTransportMode,
  type LiftTargetConfig
} from "@pathfinder/lift-adapter";
import {
  buildOrderRollupShipmentSummary,
  matchLiftLineRecord,
  normalizeLiftOrderLookupPayload,
  toCustomerSafeOrderRollupDestination,
  toCustomerSafeOrderRollupPackage
} from "@pathfinder/order-rollup";
import {
  toCustomerSafeOrderRollupProof,
  toOrderRollupProofProjection,
  type ProofOrder
} from "@pathfinder/proof-domain";
import {
  appendOrderNameRetrySuffix,
  applyOrderNameResolution,
  createDefaultOrderNameResolutionConfig,
  mapSourceRowsToCanonicalOrder,
  normalizeOrderNameResolutionConfig,
  sampleSourceGrid,
  validateOrderNameResolution,
  type FieldMapping,
  type ParsedSourceRow,
  type ParsedWorkbookSheet,
  type SourceGrid
} from "@pathfinder/templates";
import {
  archiveImportMethod,
  addCanonicalRegistryCustomField,
  bulkUpsertProductMappings,
  createDefaultProductResolutionConfig,
  deleteTarget,
  deleteCatalogPreset,
  deleteCanonicalRegistryCustomField,
  getCanonicalRegistryGovernance,
  getCanonicalRegistryOverrides,
  getCanonicalRegistryUsageByPath,
  getOrCreateWorkspace,
  getTarget,
  listProductMappings,
  listCatalogPresets,
  listLiftUnitCatalog,
  listJobs,
  listSubmitAttemptsForJob,
  listTargets,
  getJob,
  getOrderStatusToken,
  getPublicOrderStatusSnapshot,
  getSubmitAttemptByIdempotencyKey,
  maskTargetConfig,
  persistOrderStatusToken,
  persistJobSnapshot,
  persistPreviewJob,
  persistPublicOrderStatusSnapshot,
  persistSubmitAttempt,
  reservePathfinderOrderNumber,
  updateProductMapping,
  upsertCatalogPreset,
  updateImportMethod,
  updateCanonicalRegistryFieldOverride,
  updateOutputRoute,
  updateStatusAccessPolicy,
  updateTarget,
  TargetInUseError,
  TargetNotFoundError,
  renameCanonicalRegistryCustomField,
  upsertLiftProductCatalog,
  type CustomerProductMapping,
  type LiftCatalogPreset,
  type CanonicalFieldOverride,
  type CanonicalFieldUsageSummary,
  type ImportMethod,
  type LiftUnitCatalogItem,
  type OutputRoute,
  type ProductMappingStatus,
  type ProductResolutionConfig,
  type ProductResolutionResult,
  type ProcessingJobPreview,
  type PathfinderCustomerWorkspace,
  type PublicOrderStatusSnapshot,
  type StatusAccessPolicy,
  type SubmitCertificationActionKey,
  type SubmitCertification,
  type SubmitCertificationItem,
  type SubmitAttempt,
  type SubmitAttemptStatus,
  type SubmitProfile,
  type TargetConfig,
  type TargetEnvironment
} from "./store.js";
import { getPathfinderPersistenceRuntimeConfig } from "./runtime-config.js";
import {
  buildStatusLinkEmail,
  getEmailRuntimeConfig,
  maskEmailAddress,
  sendTransactionalEmail,
  type TransactionalEmailResult
} from "./email.js";
import { createProofAdminRouter } from "./proof/router.js";
import { getProofRuntimeConfig } from "./proof/runtime-config.js";
import { getProofOrder } from "./proof/store.js";
import { BoundedSnapshotCache } from "./order-snapshot-cache.js";

export const app = express();
const port = Number(process.env.PORT || 3000);
const liftCustomerListEndpoint =
  process.env.LIFT_CUSTOMER_LIST_URL ??
  "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerContactLIst/LTL-Customer-List?offset=0";
const liftCustomerStatusEndpoint =
  process.env.LIFT_CUSTOMER_STATUS_URL ??
  "https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerStatusJSON/CustomerStatusJSON?";
const liftProductCatalogBaseUrl =
  process.env.LIFT_PRODUCT_CATALOG_BASE_URL ?? "https://ltlco.lifterp.com/ords/api/lift/erp";
const publicStatusBaseUrl = process.env.PATHFINDER_PUBLIC_STATUS_BASE_URL ?? "https://status.vornan.co";
const publicStatusTokenDays = Number(process.env.PATHFINDER_PUBLIC_STATUS_TOKEN_DAYS ?? 30);
const maxPublicStatusOrdersPerRequest = 10;
const publicStatusReturnLink =
  process.env.PATHFINDER_PUBLIC_STATUS_RETURN_LINK === "true" &&
  process.env.PATHFINDER_STATUS_EMAIL_DEBUG_RETURN_LINK === "true" &&
  process.env.PATHFINDER_RUNTIME !== "lambda";
const publicStatusRateLimitWindowMs = Number(process.env.PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);
const publicStatusRateLimitMax = Number(process.env.PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_MAX ?? 5);
const publicStatusCooldownMs = Number(process.env.PATHFINDER_PUBLIC_STATUS_COOLDOWN_MS ?? 60 * 1000);
const publicStatusRateLimitPepper =
  process.env.PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_PEPPER ??
  process.env.FIREBASE_PROJECT_ID ??
  "pathfinder-public-status";
const publicStatusEmailMatchRequired = process.env.PATHFINDER_PUBLIC_STATUS_EMAIL_MATCH_REQUIRED !== "false";
const globalStatusAccessDomains = (process.env.PATHFINDER_PUBLIC_STATUS_GLOBAL_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const allowedCorsOrigins = (process.env.PATHFINDER_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const requireFirebaseAuth = process.env.PATHFINDER_REQUIRE_AUTH === "true";
const allowedEmailDomains = (process.env.PATHFINDER_ALLOWED_EMAIL_DOMAINS ?? "ltlco.com,vornan.co")
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const externalLiftSubmitEnabled = process.env.PATHFINDER_ENABLE_LIFT_SUBMIT === "true";
const liftSubmitTransportMode: LiftSubmitTransportMode =
  process.env.PATHFINDER_LIFT_TRANSPORT_MODE === "live"
    ? "live"
    : process.env.PATHFINDER_LIFT_TRANSPORT_MODE === "mock"
      ? "mock"
      : "dry_run";
const liftMockScenario: LiftSubmitMockScenario =
  process.env.PATHFINDER_LIFT_MOCK_SCENARIO === "auth_error" ||
  process.env.PATHFINDER_LIFT_MOCK_SCENARIO === "product_error" ||
  process.env.PATHFINDER_LIFT_MOCK_SCENARIO === "payload_error" ||
  process.env.PATHFINDER_LIFT_MOCK_SCENARIO === "duplicate_ext_id" ||
  process.env.PATHFINDER_LIFT_MOCK_SCENARIO === "duplicate_order_name" ||
  process.env.PATHFINDER_LIFT_MOCK_SCENARIO === "endpoint_error"
    ? process.env.PATHFINDER_LIFT_MOCK_SCENARIO
    : "accepted";
const liveCustomerSubmitAllowed = process.env.PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT === "true";
const localCustomerSeedUrl = process.env.PATHFINDER_CUSTOMER_SEED_FILE
  ? pathToFileURL(process.env.PATHFINDER_CUSTOMER_SEED_FILE)
  : new URL("../../../data/lift-customers.sample.csv", import.meta.url);
const publicStatusRateLimits = new Map<string, { count: number; resetAt: number; lastAt: number }>();

app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(cors({ origin: allowedCorsOrigins }));
app.use(express.json({ limit: "10mb" }));

async function readLocalCustomerSeed(): Promise<LiftCustomerDirectory> {
  const csv = await readFile(localCustomerSeedUrl, "utf8");
  return {
    customers: parseLiftCustomerCsv(csv),
    source: "local-seed",
    endpoint_url: liftCustomerListEndpoint,
    status_endpoint_url: liftCustomerStatusEndpoint,
    loaded_at: new Date().toISOString()
  };
}

async function findLiftCustomer(liftCustomerId: string) {
  const directory = await readLocalCustomerSeed();
  return (
    directory.customers.find((customer) => customer.lift_customer_id === liftCustomerId) ?? {
      lift_customer_id: liftCustomerId,
      customer_name: `Lift Customer ${liftCustomerId}`,
      customer_number: null,
      customer_type: null,
      customer_status: "Regular",
      sales_rep: null,
      default_invoice_email_address: null,
      created_date: null,
      crm_id: null,
      terms: null,
      terms_status: null,
      credit_limit: null,
      credit_hold: null,
      unpaid_total: null,
      available_credit: null
    }
  );
}

function valueAsString(value: unknown, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized.length ? normalized : fallback;
}

function normalizeProductKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function mappingIdFromKey(key: string) {
  return `product_${normalizeProductKey(key).toLowerCase() || "unmapped"}`;
}

function rowValue(row: ParsedSourceRow, column: string) {
  return row.values[column];
}

function productDimensionValue(row: ParsedSourceRow, dimension: "width" | "height") {
  const columns =
    dimension === "width"
      ? ["Final Size Width", "Final Width", "Width"]
      : ["Final Size Height", "Final Size Length", "Final Height", "Height", "Length"];

  return columns.map((column) => valueAsString(rowValue(row, column))).find(Boolean) ?? null;
}

function buildCompositeValue(row: ParsedSourceRow, columns: string[]) {
  return columns.map((column) => valueAsString(rowValue(row, column))).filter(Boolean).join("__");
}

function buildDisplayLabel(row: ParsedSourceRow, config: ProductResolutionConfig) {
  return (
    valueAsString(rowValue(row, "DESCRIPTION")) ||
    valueAsString(rowValue(row, config.source_column)) ||
    buildCompositeValue(row, config.composite_columns) ||
    `Row ${row.row_number}`
  );
}

function productKeyForRow(row: ParsedSourceRow, config: ProductResolutionConfig) {
  if (config.strategy === "direct_lift_unit_number") {
    return valueAsString(rowValue(row, config.direct_unit_number_column ?? config.source_column));
  }

  if (config.strategy === "composite_key") {
    return normalizeProductKey(buildCompositeValue(row, config.composite_columns));
  }

  const derived = normalizeProductKey(valueAsString(rowValue(row, config.source_column)));
  if (derived) {
    return `${config.prefix ?? ""}${derived}${config.suffix ?? ""}`;
  }

  return "";
}

function liftProductValue(value: unknown) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function liftProductNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function liftProductValues(value: unknown) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(liftProductValue).filter((item): item is string => Boolean(item))));
  }
  const normalized = liftProductValue(value);
  return normalized ? [normalized] : [];
}

function normalizeLiftProductPayloadItem(
  item: Record<string, unknown>,
  context: {
    targetId: string;
    environmentId?: string;
    companyId?: string | null;
  }
): LiftUnitCatalogItem {
  const productId = liftProductValue(item.productId ?? item.product_id);
  const liftedUnitNumbers = liftProductValues(item.unitNumbers ?? item.unit_numbers);
  const unitNumber = liftProductValue(item.unitNumber ?? item.unit_number) ?? liftedUnitNumbers[0] ?? null;
  const unitNumbers = Array.from(new Set([...(unitNumber ? [unitNumber] : []), ...liftedUnitNumbers]));
  const catalogId = liftProductValue(item.catalogId ?? item.catalog_id);
  const productName = liftProductValue(item.productName ?? item.product_name) ?? productId ?? unitNumber ?? "Unnamed Lift product";
  return {
    catalog_item_id: [
      context.targetId,
      context.companyId ?? "91",
      context.environmentId ?? "any-env",
      productId ? `product-${productId}` : unitNumber ? `unit-${unitNumber}` : `catalog-${catalogId ?? "unknown"}`,
      productName
    ]
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    product_id: productId,
    unit_number: unitNumber,
    unit_numbers: unitNumbers,
    product_name: productName,
    company_id: context.companyId ?? "91",
    target_id: context.targetId,
    environment_id: context.environmentId ?? null,
    catalog_id: catalogId,
    catalog_name: liftProductValue(item.catalogName ?? item.catalog_name),
    accounting_item_code: liftProductValue(item.accountingItemCode ?? item.accounting_item_code),
    product_type: liftProductValue(item.productType ?? item.product_type),
    parent_product_id: liftProductValue(item.parentProductId ?? item.parent_product_id),
    unit_price: liftProductNumber(item.unitPrice ?? item.unit_price),
    quantity: liftProductNumber(item.quantity),
    attribute_1: liftProductNumber(item.attribute1 ?? item.attribute_1),
    attribute_2: liftProductNumber(item.attribute2 ?? item.attribute_2),
    material_id: liftProductValue(item.materialId ?? item.material_id),
    storage_type_id: liftProductValue(item.storageTypeId ?? item.storage_type_id),
    warehouse_location_id: liftProductValue(item.warehouseLocationId ?? item.warehouse_location_id),
    image_url: liftProductValue(item.imageUrl ?? item.image_url),
    status: liftProductValue(item.status) === "I" ? "Inactive" : "Active",
    category: liftProductValue(item.catalogName ?? item.catalog_name ?? item.productType ?? item.product_type),
    description: liftProductValue(item.productDescription ?? item.product_description),
    raw_payload: item,
    source: "Lift import",
    updated_at: new Date().toISOString()
  };
}

function normalizeLiftProductPayloadItems(
  item: Record<string, unknown>,
  context: {
    targetId: string;
    environmentId?: string;
    companyId?: string | null;
  }
) {
  const parent = normalizeLiftProductPayloadItem(item, context);
  const components = Array.isArray(item.components)
    ? item.components.map((component) =>
        normalizeLiftProductPayloadItem(
          {
            ...(component as Record<string, unknown>),
            parentProductId:
              (component as Record<string, unknown>).parentProductId ??
              (component as Record<string, unknown>).parent_product_id ??
              parent.product_id
          },
          context
        )
      )
    : [];

  return [parent, ...components];
}

function liftProductQueryParams(reqQuery: Record<string, unknown>) {
  const allowedParams = new Map([
    ["product_id", "product_id"],
    ["product_name", "product_name"],
    ["catalog_id", "catalog_id"],
    ["catalog_name", "catalog_name"],
    ["accounting_item_code", "accounting_item_code"],
    ["product_type", "product_type"],
    ["parent_product_id", "parent_product_id"],
    ["status", "status"],
    ["fetchSize", "fetchSize"],
    ["fetch_size", "fetchSize"],
    ["limit", "fetchSize"],
    ["fetchOffset", "fetchOffset"],
    ["fetch_offset", "fetchOffset"],
    ["offset", "fetchOffset"]
  ]);
  const params = new URLSearchParams();

  allowedParams.forEach((liftKey, key) => {
    const value = reqQuery[key];
    if (typeof value === "string" && value.trim()) {
      const normalizedValue =
        liftKey === "status" && value.trim() === "Active"
          ? "A"
          : liftKey === "status" && value.trim() === "Inactive"
            ? "I"
            : value.trim();
      params.set(liftKey, normalizedValue);
    }
  });

  return params;
}

async function fetchLiftProductsFromTarget(target: TargetConfig, route: OutputRoute, query: Record<string, unknown>) {
  const environment =
    target.environments.find((candidate) => candidate.environment_id === route.environment_id) ??
    target.environments.find((candidate) => candidate.name === target.lift.active_environment);
  const user = environment?.credentials.User ?? target.lift.credentials.User;
  const password = environment?.credentials.Password ?? target.lift.credentials.Password;

  if (!user || !password || password === "********") {
    throw new Error("Lift product catalog refresh requires saved import credentials for the selected environment.");
  }

  const url = new URL(`${liftProductCatalogBaseUrl.replace(/\/+$/, "")}/api/v1/product-management/products`);
  const params = liftProductQueryParams(query);
  params.forEach((value, key) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
    }
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Lift product catalog refresh failed (${response.status}).`);
  }

  if (!Array.isArray(body)) {
    throw new Error("Lift product catalog response was not an array.");
  }

  return body.flatMap((item) =>
    normalizeLiftProductPayloadItems(item as Record<string, unknown>, {
      targetId: target.target_id,
      environmentId: environment?.environment_id,
      companyId: route.company_id ?? environment?.headers.Company ?? target.lift.headers.Company
    })
  );
}

async function fetchLiftOrderLookup(args: {
  target: TargetConfig;
  route: OutputRoute;
  orderNumber: string;
}) {
  const environment = routeEnvironmentForTarget(args.target, args.route);
  const lookupUrl = buildLiftOrderLookupUrl(args.route.order_lookup_url, args.orderNumber);

  if (!lookupUrl) {
    throw new Error("This output route does not have a valid Lift order lookup URL for the selected order number.");
  }

  const user = environment?.credentials.User ?? args.target.lift.credentials.User;
  const password = environment?.credentials.Password ?? args.target.lift.credentials.Password;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (user && password && password !== "********") {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }

  const response = await fetch(lookupUrl, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();

  return {
    order_number: args.orderNumber,
    lookup_url: lookupUrl,
    http_status: response.status,
    ok: response.ok,
    payload: body,
    fetched_at: new Date().toISOString()
  };
}

function normalizeProofReportPayload(payload: unknown) {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { rowset?: unknown }).rowset)
      ? ((payload as { rowset: unknown[] }).rowset)
      : [];
  const proofGroups = new Map<string, {
    order_number: string | null;
    order_line_id: string | number | null;
    line_number: string | number | null;
    line_step_number: string | number | null;
    product_name: string | null;
    attachment_id: string | number | null;
    creation_date: string | null;
    proof_filename: string | null;
    proof_link_low: string | null;
    proof_link_high: string | null;
    proof_approval_status: string | null;
    proof_approved_by: string | null;
    proof_approved_date: string | null;
    comments: Array<{
      proof_comment: string | null;
      comment_ts: string | null;
      comment_attachment: unknown;
    }>;
    detailed_report: unknown;
  }>();

  rows.forEach((row) => {
    if (!row || typeof row !== "object") {
      return;
    }

    const record = row as Record<string, unknown>;
    const key = [
      record.ORDER_NUMBER,
      record.ORDER_LINE_ID,
      record.ATTACHMENT_ID,
      record.PROOF_FILENAME
    ]
      .map((value) => (value == null ? "" : String(value)))
      .join("|");
    const existing = proofGroups.get(key);
    const comment = {
      proof_comment: typeof record.PROOF_COMMENT === "string" ? record.PROOF_COMMENT : null,
      comment_ts: typeof record.COMMENT_TS === "string" ? record.COMMENT_TS : null,
      comment_attachment: record.COMMENT_ATTACHMENT ?? null
    };

    if (existing) {
      if (comment.proof_comment || comment.comment_ts || comment.comment_attachment) {
        existing.comments.push(comment);
      }
      return;
    }

    proofGroups.set(key, {
      order_number: record.ORDER_NUMBER == null ? null : String(record.ORDER_NUMBER),
      order_line_id: (record.ORDER_LINE_ID as string | number | null | undefined) ?? null,
      line_number: (record.LINE_NUMBER as string | number | null | undefined) ?? null,
      line_step_number: (record.LINE_STEP_NUMBER as string | number | null | undefined) ?? null,
      product_name: typeof record.PRODUCT_NAME === "string" ? record.PRODUCT_NAME : null,
      attachment_id: (record.ATTACHMENT_ID as string | number | null | undefined) ?? null,
      creation_date: typeof record.CREATION_DATE === "string" ? record.CREATION_DATE : null,
      proof_filename: typeof record.PROOF_FILENAME === "string" ? record.PROOF_FILENAME : null,
      proof_link_low: typeof record.PROOF_LINK_LOW === "string" ? record.PROOF_LINK_LOW : null,
      proof_link_high: typeof record.PROOF_LINK_HIGH === "string" ? record.PROOF_LINK_HIGH : null,
      proof_approval_status: typeof record.PROOF_APPROVAL_STATUS === "string" ? record.PROOF_APPROVAL_STATUS : null,
      proof_approved_by: typeof record.PROOF_APPROVED_BY === "string" ? record.PROOF_APPROVED_BY : null,
      proof_approved_date: typeof record.PROOF_APPROVED_DATE === "string" ? record.PROOF_APPROVED_DATE : null,
      comments: comment.proof_comment || comment.comment_ts || comment.comment_attachment ? [comment] : [],
      detailed_report: record.DETAILED_REPORT ?? null
    });
  });

  return Array.from(proofGroups.values()).sort((left, right) => {
    const leftLine = Number(left.line_number ?? 0);
    const rightLine = Number(right.line_number ?? 0);
    return leftLine - rightLine;
  });
}

async function fetchLiftProofReport(args: {
  target: TargetConfig;
  route: OutputRoute;
  orderNumber: string;
  orderLineId?: string | number | null;
}) {
  const environment = routeEnvironmentForTarget(args.target, args.route);
  const proofReportUrl = buildLiftProofReportUrl(args.route.proof_report_url, args.orderNumber, args.orderLineId);

  if (!proofReportUrl) {
    throw new Error("This output route does not have a valid Lift proof report URL for the selected order number.");
  }

  const user = environment?.credentials.User ?? args.target.lift.credentials.User;
  const password = environment?.credentials.Password ?? args.target.lift.credentials.Password;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (user && password && password !== "********") {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }

  const response = await fetch(proofReportUrl, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();

  return {
    order_number: args.orderNumber,
    proof_report_url: proofReportUrl,
    http_status: response.status,
    ok: response.ok,
    proofs: normalizeProofReportPayload(body),
    payload: body,
    fetched_at: new Date().toISOString()
  };
}

function packageDetailRows(payload: unknown) {
  return Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { rowset?: unknown }).rowset)
      ? ((payload as { rowset: unknown[] }).rowset)
      : [];
}

function redactPackageDetailRecord(record: Record<string, unknown>) {
  const { NEGOTIATED_RATE: _negotiatedRate, negotiated_rate: _negotiatedRateLower, ...safeRecord } = record;
  return safeRecord;
}

function normalizePackageDetailsPayload(payload: unknown) {
  const rows = packageDetailRows(payload);
  const packageGroups = new Map<string, {
    header_id: string | number | null;
    order_number: string | null;
    order_line_id: string | number | null;
    shipping_id: string | number | null;
    line_number: string | number | null;
    product: string | null;
    material: string | null;
    laminate: string | null;
    height: string | number | null;
    width: string | number | null;
    quantity: string | number | null;
    box_number: string | number | null;
    package_type: string | null;
    tracking_number: string | null;
    dimensions: {
      length: string | number | null;
      width: string | number | null;
      height: string | number | null;
      weight: string | number | null;
    };
    tracker_message: string | null;
    location_name: string | null;
    ship_method: string | null;
  }>();

  rows.forEach((row) => {
    if (!row || typeof row !== "object") {
      return;
    }

    const record = row as Record<string, unknown>;
    const key = [
      record.ORDER_NUMBER,
      record.ORDER_LINE_ID,
      record.SHIPPING_ID,
      record.BOX_NUMBER,
      record.PACKAGE_TRACKING_NUMBER
    ]
      .map((value) => (value == null ? "" : String(value)))
      .join("|");

    if (packageGroups.has(key)) {
      return;
    }

    packageGroups.set(key, {
      header_id: (record.HEADER_ID as string | number | null | undefined) ?? null,
      order_number: record.ORDER_NUMBER == null ? null : String(record.ORDER_NUMBER),
      order_line_id: (record.ORDER_LINE_ID as string | number | null | undefined) ?? null,
      shipping_id: (record.SHIPPING_ID as string | number | null | undefined) ?? null,
      line_number: (record.LINE_NUMBER as string | number | null | undefined) ?? null,
      product: typeof record.PRODUCT === "string" ? record.PRODUCT : null,
      material: typeof record.MATERIAL === "string" ? record.MATERIAL : null,
      laminate: typeof record.LAMINATE === "string" ? record.LAMINATE : null,
      height: (record.HEIGHT as string | number | null | undefined) ?? null,
      width: (record.WIDTH as string | number | null | undefined) ?? null,
      quantity: (record.QUANTITY as string | number | null | undefined) ?? null,
      box_number: (record.BOX_NUMBER as string | number | null | undefined) ?? null,
      package_type: typeof record.PACKAGE_TYPE === "string" ? record.PACKAGE_TYPE : null,
      tracking_number: typeof record.PACKAGE_TRACKING_NUMBER === "string" ? record.PACKAGE_TRACKING_NUMBER : null,
      dimensions: {
        length: (record.BOX_LENGTH as string | number | null | undefined) ?? null,
        width: (record.BOX_WIDTH as string | number | null | undefined) ?? null,
        height: (record.BOX_HEIGHT as string | number | null | undefined) ?? null,
        weight: (record.BOX_WEIGHT as string | number | null | undefined) ?? null
      },
      tracker_message: typeof record.TRACKER_MESSAGE === "string" ? record.TRACKER_MESSAGE : null,
      location_name: typeof record.LOCATION_NAME === "string" ? record.LOCATION_NAME : null,
      ship_method: typeof record.SHIP_METHOD === "string" ? record.SHIP_METHOD : null
    });
  });

  return Array.from(packageGroups.values()).sort((left, right) => {
    const leftLine = Number(left.line_number ?? 0);
    const rightLine = Number(right.line_number ?? 0);
    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }
    return Number(left.box_number ?? 0) - Number(right.box_number ?? 0);
  });
}

function redactPackageDetailsPayload(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.map((row) =>
      row && typeof row === "object" ? redactPackageDetailRecord(row as Record<string, unknown>) : row
    );
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { rowset?: unknown }).rowset)) {
    return {
      ...(payload as Record<string, unknown>),
      rowset: (payload as { rowset: unknown[] }).rowset.map((row) =>
        row && typeof row === "object" ? redactPackageDetailRecord(row as Record<string, unknown>) : row
      )
    };
  }

  return payload;
}

async function fetchLiftPackageDetails(args: {
  target: TargetConfig;
  route: OutputRoute;
  orderNumber: string;
  orderLineId?: string | number | null;
}) {
  const environment = routeEnvironmentForTarget(args.target, args.route);
  const packageDetailsUrl = buildLiftPackageDetailsUrl(args.route.package_details_url, args.orderNumber, args.orderLineId);

  if (!packageDetailsUrl) {
    throw new Error("This output route does not have a valid Lift package details URL for the selected order number.");
  }

  const user = environment?.credentials.User ?? args.target.lift.credentials.User;
  const password = environment?.credentials.Password ?? args.target.lift.credentials.Password;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (user && password && password !== "********") {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }

  const response = await fetch(packageDetailsUrl, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  const redactedPayload = redactPackageDetailsPayload(body);

  return {
    order_number: args.orderNumber,
    package_details_url: packageDetailsUrl,
    http_status: response.status,
    ok: response.ok,
    packages: normalizePackageDetailsPayload(redactedPayload),
    payload: redactedPayload,
    redacted_fields: ["NEGOTIATED_RATE"],
    fetched_at: new Date().toISOString()
  };
}

async function getJobLiftContext(customer: LiftCustomer, jobId: string) {
  const job = await getJob(customer, jobId);

  if (!job) {
    return {
      errorStatus: 404,
      error: "Preview job not found."
    } as const;
  }

  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes.find((candidate) => candidate.output_route_id === job.output_route_id);
  const target = route ? ((await getTarget(route.target_id, false)) as TargetConfig | null) : null;
  const attempts = await listSubmitAttemptsForJob(customer, jobId);
  const orderNumber =
    job.target_order_number ??
    attempts.find((attempt) => attempt.response.lift_order_id)?.response.lift_order_id ??
    null;

  if (!route || !target) {
    return {
      errorStatus: 409,
      error: "Job output route or target could not be found."
    } as const;
  }

  if (!orderNumber) {
    return {
      errorStatus: 409,
      error: "No Lift order number is available for this job yet."
    } as const;
  }

  return {
    job,
    workspace,
    route,
    target,
    attempts,
    orderNumber
  };
}

export function buildOrderSnapshot(args: {
  customer: LiftCustomer;
  job: ProcessingJobPreview;
  route: OutputRoute;
  target: TargetConfig;
  attempts: SubmitAttempt[];
  orderNumber: string;
  orderLookup: Awaited<ReturnType<typeof fetchLiftOrderLookup>> | null;
  proofReport: Awaited<ReturnType<typeof fetchLiftProofReport>> | null;
  proofOrder?: ProofOrder | null;
  packageDetails: Awaited<ReturnType<typeof fetchLiftPackageDetails>> | null;
  issues: Array<{ source: string; severity: "warning" | "error"; message: string }>;
}) {
  const proofProjection = args.proofOrder ? toOrderRollupProofProjection(args.proofOrder) : null;
  const proofs = proofProjection?.proofs ?? args.proofReport?.proofs ?? [];
  const packages = args.packageDetails?.packages ?? [];
  const liveOrder = normalizeLiftOrderLookupPayload(args.orderLookup?.payload ?? null);
  const submittedHeader = args.job.lift_payload.order;
  const resolvedHeader = {
    ...submittedHeader,
    po_number: liveOrder?.po_number ?? submittedHeader.po_number ?? null,
    contract_number: liveOrder?.contract_number ?? submittedHeader.contract_number ?? null,
    order_title: liveOrder?.order_title ?? submittedHeader.order_title ?? null,
    requested_ship_date: liveOrder?.requested_ship_date ?? submittedHeader.requested_ship_date ?? null,
    due_date: liveOrder?.due_date ?? submittedHeader.due_date ?? null,
    actual_ship_date: liveOrder?.actual_ship_date ?? null,
    shipping: liveOrder?.shipping ?? submittedHeader.shipping ?? null,
    field_sources: {
      po_number: liveOrder?.po_number ? "lift" : "submitted",
      contract_number: liveOrder?.contract_number ? "lift" : "submitted",
      order_title: liveOrder?.order_title ? "lift" : "submitted",
      requested_ship_date: liveOrder?.requested_ship_date ? "lift" : "submitted",
      due_date: liveOrder?.due_date ? "lift" : "submitted",
      actual_ship_date: "lift",
      shipping: liveOrder?.shipping ? "lift" : "submitted"
    } as const
  };
  const lineContexts = args.job.lift_payload.lines.map((line, index) => {
    const liveLine = liveOrder?.lines.find((candidate) => candidate.line_number === line.line_number) ?? null;
    return {
      index,
      line,
      liveLine,
      line_number: line.line_number ?? index + 1,
      order_line_id: liveLine?.order_line_id ?? null
    };
  });
  const lines = lineContexts.map(({ index, line, liveLine }) => {
    const lineProofs = proofs.filter((proof) => matchLiftLineRecord(lineContexts, proof)?.line.index === index);
    const linePackages = packages.filter((pkg) => matchLiftLineRecord(lineContexts, pkg)?.line.index === index);
    const latestProof = lineProofs[0];
    const latestProofState = latestProof && "proof_state" in latestProof ? latestProof.proof_state : null;
    return {
      line_number: line.line_number,
      order_line_id: liveLine?.order_line_id ?? lineProofs[0]?.order_line_id ?? linePackages[0]?.order_line_id ?? null,
      product_name: liveLine?.product_name ?? line.product_name,
      description: line.description,
      quantity: liveLine?.quantity ?? line.quantity,
      unit_number: liveLine?.unit_number ?? line.unit_number,
      product_id: line.product_id,
      material:
        liveLine?.material ??
        (line.production?.material == null ? null : String(line.production.material)),
      final_height: liveLine?.final_height ?? line.dimensions.final_height,
      final_width: liveLine?.final_width ?? line.dimensions.final_width,
      step: liveLine?.step ?? null,
      proof_count: lineProofs.length,
      package_count: linePackages.length,
      latest_proof_status: latestProof?.proof_approval_status ?? latestProofState ?? null,
      latest_tracking_message: linePackages[0]?.tracker_message ?? null,
      proofs: lineProofs,
      packages: linePackages
    };
  });

  return {
    snapshot_id: `snapshot-${args.job.job_id}`,
    order_number: args.orderNumber,
    source_order_id: args.job.lift_payload.order.ext_id,
    customer: {
      source_customer_id: args.job.source_customer_id,
      source_customer_name: args.job.source_customer_name,
      submit_customer_id: args.job.submit_customer_id,
      submit_customer_name: args.job.submit_customer_name
    },
    job: {
      job_id: args.job.job_id,
      state: args.job.state,
      import_method_name: args.job.import_method_name,
      source_file_name: args.job.source_file_name,
      created_at: args.job.created_at,
      updated_at: args.job.updated_at
    },
    route: {
      output_route_id: args.route.output_route_id,
      name: args.route.name,
      target: args.target.name,
      environment_id: args.route.environment_id,
      template: args.route.output_template
    },
    header: resolvedHeader,
    live_order: liveOrder,
    order_status: liveOrder?.status ?? null,
    proof_summary: proofProjection?.summary ?? null,
    shipment_summary: buildOrderRollupShipmentSummary(lines),
    lines,
    proofs,
    packages,
    submit_history: args.attempts,
    lookups: {
      order: args.orderLookup
        ? {
            ok: args.orderLookup.ok,
            http_status: args.orderLookup.http_status,
            fetched_at: args.orderLookup.fetched_at,
            payload: args.orderLookup.payload
          }
        : null,
      proofs: args.proofReport
        ? {
            ok: args.proofReport.ok,
            http_status: args.proofReport.http_status,
            fetched_at: args.proofReport.fetched_at
          }
        : null,
      packages: args.packageDetails
        ? {
            ok: args.packageDetails.ok,
            http_status: args.packageDetails.http_status,
            fetched_at: args.packageDetails.fetched_at,
            redacted_fields: args.packageDetails.redacted_fields
          }
        : null
    },
    visibility_policy: {
      audience: "internal",
      redacted_fields: ["NEGOTIATED_RATE"],
      public_status_ready: false
    },
    issues: args.issues,
    refreshed_at: new Date().toISOString()
  };
}

type InternalOrderSnapshot = ReturnType<typeof buildOrderSnapshot>;
type JobLiftContext = Awaited<ReturnType<typeof getJobLiftContext>>;
type JobLiftContextSuccess = Extract<JobLiftContext, { job: ProcessingJobPreview }>;
type JobLiftContextError = { error: string; errorStatus?: number };
type InternalOrderSnapshotResult =
  | { snapshot: InternalOrderSnapshot; context: JobLiftContextSuccess }
  | JobLiftContextError;

async function buildInternalOrderSnapshotForJob(
  customer: LiftCustomer,
  jobId: string
): Promise<InternalOrderSnapshotResult> {
  const context = await getJobLiftContext(customer, jobId);

  if (context.error) {
    return {
      error: context.error,
      errorStatus: context.errorStatus
    };
  }

  const issues: Array<{ source: string; severity: "warning" | "error"; message: string }> = [];
  const proofStorageEnabled = getProofRuntimeConfig().storage_driver !== "disabled";
  let proofOrder: ProofOrder | null = null;

  if (proofStorageEnabled) {
    try {
      proofOrder = await getProofOrder(context.orderNumber);
    } catch {
      issues.push({
        source: "proof_cache",
        severity: "warning",
        message: "The normalized Vornan Proof cache could not be read; the read-only Lift report fallback was used."
      });
    }
  }

  const [orderLookupResult, proofReportResult, packageDetailsResult] = await Promise.allSettled([
    context.route.order_lookup_url
      ? fetchLiftOrderLookup({
          target: context.target,
          route: context.route,
          orderNumber: context.orderNumber
        })
      : Promise.resolve(null),
    !proofOrder && context.route.proof_report_url
      ? fetchLiftProofReport({
          target: context.target,
          route: context.route,
          orderNumber: context.orderNumber
        })
      : Promise.resolve(null),
    context.route.package_details_url
      ? fetchLiftPackageDetails({
          target: context.target,
          route: context.route,
          orderNumber: context.orderNumber
        })
      : Promise.resolve(null)
  ]);

  if (!context.route.order_lookup_url) {
    issues.push({
      source: "order_lookup",
      severity: "warning",
      message: "Output route has no Lift order lookup URL configured."
    });
  }
  if (!proofOrder && !context.route.proof_report_url) {
    issues.push({
      source: "proof_report",
      severity: "warning",
      message: "Output route has no Lift proof report URL configured."
    });
  }
  if (!context.route.package_details_url) {
    issues.push({
      source: "package_details",
      severity: "warning",
      message: "Output route has no Lift package details URL configured."
    });
  }

  const orderLookup =
    orderLookupResult.status === "fulfilled"
      ? orderLookupResult.value
      : (issues.push({
          source: "order_lookup",
          severity: "error",
          message: orderLookupResult.reason instanceof Error ? orderLookupResult.reason.message : "Lift order lookup failed."
        }),
        null);
  const proofReport =
    proofReportResult.status === "fulfilled"
      ? proofReportResult.value
      : (issues.push({
          source: "proof_report",
          severity: "error",
          message: proofReportResult.reason instanceof Error ? proofReportResult.reason.message : "Lift proof report failed."
        }),
        null);
  const packageDetails =
    packageDetailsResult.status === "fulfilled"
      ? packageDetailsResult.value
      : (issues.push({
          source: "package_details",
          severity: "error",
          message:
            packageDetailsResult.reason instanceof Error
              ? packageDetailsResult.reason.message
              : "Lift package details failed."
        }),
        null);
  return {
    snapshot: buildOrderSnapshot({
      customer,
      job: context.job,
      route: context.route,
      target: context.target,
      attempts: context.attempts,
      orderNumber: context.orderNumber,
      orderLookup,
      proofReport,
      proofOrder,
      packageDetails,
      issues
    }),
    context
  };
}

export function publicOrderStatusSnapshotFromInternal(snapshot: InternalOrderSnapshot): PublicOrderStatusSnapshot {
  const publicLines = snapshot.lines.map((line) => ({
    ...line,
    proofs: line.proofs.map(toCustomerSafeOrderRollupProof),
    packages: line.packages.map(toCustomerSafeOrderRollupPackage)
  }));
  return {
    snapshot_id: snapshot.snapshot_id,
    order_key: `${snapshot.customer.submit_customer_name}:${snapshot.order_number}:${snapshot.job.job_id}`,
    order_number: snapshot.order_number,
    source_order_id: snapshot.source_order_id,
    customer: {
      source_customer_name: snapshot.customer.source_customer_name,
      submit_customer_name: snapshot.customer.submit_customer_name
    },
    job: snapshot.job,
    route: {
      name: snapshot.route.name,
      target: snapshot.route.target,
      template: snapshot.route.template
    },
    header: {
      ext_id: snapshot.header.ext_id,
      po_number: snapshot.header.po_number ?? null,
      contract_number: snapshot.header.contract_number ?? null,
      order_title: snapshot.header.order_title ?? null,
      requested_ship_date: snapshot.header.requested_ship_date ?? null,
      due_date: snapshot.header.due_date ?? null,
      actual_ship_date: snapshot.header.actual_ship_date ?? null,
      shipping: toCustomerSafeOrderRollupDestination(snapshot.header.shipping),
      field_sources: snapshot.header.field_sources
    },
    live_order: snapshot.live_order,
    order_status: snapshot.order_status,
    proof_summary: snapshot.proof_summary,
    shipment_summary: buildOrderRollupShipmentSummary(publicLines),
    lines: publicLines,
    lookups: {
      order: snapshot.lookups.order
        ? {
            ok: snapshot.lookups.order.ok,
            http_status: snapshot.lookups.order.http_status,
            fetched_at: snapshot.lookups.order.fetched_at
          }
        : null,
      proofs: snapshot.lookups.proofs,
      packages: snapshot.lookups.packages
    },
    issues: snapshot.issues,
    visibility_policy: {
      audience: "public_status",
      redacted_fields: [
        "NEGOTIATED_RATE",
        "package dimensions and weight",
        "internal shipment identifiers",
        "submit_history",
        "raw Lift lookup payloads"
      ],
      token_required: true
    },
    refreshed_at: snapshot.refreshed_at
  };
}

const orderSnapshotRefreshMinMs = Math.max(
  1_000,
  Number(process.env.PATHFINDER_ORDER_SNAPSHOT_REFRESH_MIN_MS ?? 15_000) || 15_000
);
const orderSnapshotResponseCache = new BoundedSnapshotCache<InternalOrderSnapshot>(orderSnapshotRefreshMinMs);

async function loadBoundedInternalOrderSnapshot(customer: LiftCustomer, jobId: string) {
  const cacheKey = `${customer.lift_customer_id}:${jobId}`;
  const cached = orderSnapshotResponseCache.getRecent(cacheKey);

  if (cached) {
    return {
      snapshot: cached.snapshot,
      refresh: {
        source: "recent_snapshot" as const,
        checked_at: cached.checked_at,
        next_refresh_at: cached.next_refresh_at
      }
    };
  }

  const result = await buildInternalOrderSnapshotForJob(customer, jobId);
  if ("error" in result) {
    return result;
  }

  const cachedAt = Date.now();
  const refreshWindow = orderSnapshotResponseCache.set(cacheKey, result.snapshot, cachedAt);

  return {
    snapshot: result.snapshot,
    refresh: {
      source: "lift" as const,
      checked_at: refreshWindow.checked_at,
      next_refresh_at: refreshWindow.next_refresh_at
    }
  };
}

function hashStatusToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPublicLogValue(value: unknown) {
  return createHmac("sha256", publicStatusRateLimitPepper)
    .update(valueAsString(value).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function publicStatusRequestIp(req: Request) {
  const forwardedFor = valueAsString(req.headers["x-forwarded-for"]).split(",")[0]?.trim();
  return forwardedFor || req.ip || "unknown";
}

function isPublicStatusRequestRateLimited(req: Request, email: string, orderNumbers: string[]) {
  const now = Date.now();
  const hashedIp = hashPublicLogValue(publicStatusRequestIp(req));
  const hashedEmail = hashPublicLogValue(email);
  const hashedOrders = orderNumbers.map((orderNumber) => hashPublicLogValue(orderNumber));
  const keys = [
    `ip:${hashedIp}`,
    `email:${hashedEmail}`,
    `request:${hashPublicLogValue(orderNumbers.join("|"))}:${hashedEmail}`,
    ...hashedOrders.flatMap((hashedOrder) => [`order:${hashedOrder}`, `pair:${hashedOrder}:${hashedEmail}`])
  ];

  for (const key of keys) {
    const current = publicStatusRateLimits.get(key);

    if (!current || current.resetAt <= now) {
      continue;
    }

    if (now - current.lastAt < publicStatusCooldownMs || current.count >= publicStatusRateLimitMax) {
      console.info("[pathfinder-status-link-rate-limited]", {
        key_type: key.split(":")[0],
        key_hash: key.split(":").slice(1).join(":"),
        reset_at: new Date(current.resetAt).toISOString()
      });
      return true;
    }
  }

  for (const key of keys) {
    const current = publicStatusRateLimits.get(key);

    if (!current || current.resetAt <= now) {
      publicStatusRateLimits.set(key, {
        count: 1,
        resetAt: now + publicStatusRateLimitWindowMs,
        lastAt: now
      });
      continue;
    }

    current.count += 1;
    current.lastAt = now;
  }

  return false;
}

function statusUrlForToken(token: string) {
  return `${publicStatusBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(token)}`;
}

function normalizeOrderLookupValue(value: unknown) {
  return valueAsString(value).toUpperCase().replace(/\s+/g, "");
}

function requestedPublicStatusOrderNumbers(body: unknown) {
  if (!body || typeof body !== "object") {
    return [];
  }

  const record = body as Record<string, unknown>;
  const values = Array.isArray(record.order_numbers) ? record.order_numbers : [record.order_number];
  const seen = new Set<string>();

  return values
    .map((value) => valueAsString(value).trim())
    .filter((value) => {
      const normalized = normalizeOrderLookupValue(value);
      if (!normalized || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function rawBodyOrderCandidates(rawBody: unknown) {
  if (!rawBody || typeof rawBody !== "object") {
    return [];
  }

  const record = rawBody as Record<string, unknown>;
  return [
    record.order_number,
    record.ORDER_NUMBER,
    record.orderNumber,
    record.lift_order_id,
    record.LIFT_ORDER_ID
  ];
}

function jobOrderLookupCandidates(job: ProcessingJobPreview, attempts: SubmitAttempt[]) {
  return [
    job.target_order_number,
    job.lift_payload.order.ext_id,
    job.canonical_order.order.external_order_id,
    job.canonical_order.source.source_record_id,
    job.submit_request_masked.headers.Ext_ID,
    ...attempts.flatMap((attempt) => [
      attempt.response.lift_order_id,
      attempt.ext_id,
      ...rawBodyOrderCandidates(attempt.response.raw_body)
    ])
  ].filter(Boolean);
}

function normalizeEmail(value: unknown) {
  return valueAsString(value).trim().toLowerCase();
}

const publicEmailDomains = new Set([
  "aol.com",
  "icloud.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "ymail.com"
]);

function emailDomain(value: unknown) {
  const email = normalizeEmail(value);
  const atIndex = email.lastIndexOf("@");
  const domain = atIndex >= 0 ? email.slice(atIndex + 1) : email;
  return domain.replace(/^\.+|\.+$/g, "");
}

function jobEmailCandidates(customer: LiftCustomer, job: ProcessingJobPreview) {
  const contacts = Array.isArray(job.canonical_order.contacts) ? job.canonical_order.contacts : [];
  return [
    customer.default_invoice_email_address,
    job.canonical_order.order.shipping?.email,
    job.lift_payload.order.shipping?.email,
    ...contacts.map((contact) => contact.email)
  ]
    .map(normalizeEmail)
    .filter(Boolean);
}

function approvedStatusAccessDomains(policy: StatusAccessPolicy | undefined) {
  return new Set(
    (policy?.approved_email_domains ?? [])
      .filter((domain) => domain.status === "Approved")
      .map((domain) => emailDomain(domain.domain))
      .filter((domain) => domain && !publicEmailDomains.has(domain))
  );
}

function globallyAllowedStatusAccessDomains() {
  return new Set(
    globalStatusAccessDomains
      .map((domain) => emailDomain(domain))
      .filter((domain) => domain && !publicEmailDomains.has(domain))
  );
}

function canSendPublicStatusLinkToEmail(
  workspace: PathfinderCustomerWorkspace,
  job: ProcessingJobPreview,
  email: string
) {
  const policy = workspace.status_access_policy;

  if (!policy?.allow_public_status_links) {
    return false;
  }

  const normalizedEmail = normalizeEmail(email);
  const domain = emailDomain(normalizedEmail);

  if (domain && globallyAllowedStatusAccessDomains().has(domain)) {
    return true;
  }

  if (policy.mode === "Invite only" || policy.mode === "Internal only") {
    return false;
  }

  const candidates = Array.from(new Set(jobEmailCandidates(workspace.customer, job)));

  if (candidates.length === 0) {
    return !publicStatusEmailMatchRequired && policy.mode === "Exact email or approved domain";
  }

  if (candidates.includes(normalizedEmail)) {
    return true;
  }

  if (policy.mode !== "Exact email or approved domain") {
    return false;
  }

  if (!domain || publicEmailDomains.has(domain)) {
    return false;
  }

  return approvedStatusAccessDomains(policy).has(domain);
}

async function findPathfinderJobByOrderNumber(orderNumber: string) {
  return (await findPathfinderJobsByOrderNumbers([orderNumber]))[0] ?? null;
}

async function findPathfinderJobsByOrderNumbers(orderNumbers: string[]) {
  const requestedOrderNumbers = new Set(orderNumbers.map(normalizeOrderLookupValue).filter(Boolean));
  const matches = new Map<
    string,
    {
      customer: LiftCustomer;
      workspace: PathfinderCustomerWorkspace;
      job: ProcessingJobPreview;
      attempts: SubmitAttempt[];
    }
  >();

  if (!requestedOrderNumbers.size) {
    return [];
  }

  const jobs = [...(await listJobs())].sort((first, second) => Date.parse(second.updated_at) - Date.parse(first.updated_at));

  for (const job of jobs) {
    if (matches.size === requestedOrderNumbers.size) {
      break;
    }

    const customer = await findLiftCustomer(job.customer_id);
    const workspace = await getOrCreateWorkspace(customer);
    const attempts = await listSubmitAttemptsForJob(customer, job.job_id);
    const matchedOrderNumber = jobOrderLookupCandidates(job, attempts)
      .map(normalizeOrderLookupValue)
      .find((candidate) => requestedOrderNumbers.has(candidate) && !matches.has(candidate));

    if (matchedOrderNumber) {
      matches.set(matchedOrderNumber, {
        customer,
        workspace,
        job,
        attempts
      });
    }
  }

  return orderNumbers
    .map((orderNumber) => matches.get(normalizeOrderLookupValue(orderNumber)))
    .filter((match): match is NonNullable<typeof match> => Boolean(match));
}

async function createPublicStatusLinkForJobs(args: {
  orders: Array<{ customer: LiftCustomer; jobId: string }>;
  createdByEmail?: string | null;
  requestedEmail?: string | null;
}) {
  const results: Array<Exclude<Awaited<ReturnType<typeof buildInternalOrderSnapshotForJob>>, { error: string }>> = [];
  let firstError: Awaited<ReturnType<typeof buildInternalOrderSnapshotForJob>> | null = null;
  const seenOrderKeys = new Set<string>();

  for (const order of args.orders) {
    const result = await buildInternalOrderSnapshotForJob(order.customer, order.jobId);

    if ("error" in result) {
      firstError ??= result;
      continue;
    }

    const orderKey = `${result.snapshot.customer.submit_customer_name}:${result.context.orderNumber}:${result.context.job.job_id}`;
    if (!seenOrderKeys.has(orderKey)) {
      seenOrderKeys.add(orderKey);
      results.push(result);
    }
  }

  if (!results.length) {
    return firstError ?? { error: "No order status snapshots could be created.", errorStatus: 404 };
  }

  const snapshots = results.map((result) => publicOrderStatusSnapshotFromInternal(result.snapshot));
  const snapshot = snapshots[0];
  const primaryResult = results[0];
  const rawToken = randomBytes(32).toString("base64url");
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, publicStatusTokenDays) * 24 * 60 * 60 * 1000);
  const emailMode = args.requestedEmail ? getEmailRuntimeConfig().mode : null;
  const tokenRecord = {
    token_hash: hashStatusToken(rawToken),
    order_key: snapshot.order_key,
    customer_id: primaryResult.context.job.customer_id,
    job_id: primaryResult.context.job.job_id,
    order_number: primaryResult.context.orderNumber,
    orders: results.map((result, index) => ({
      order_key: snapshots[index].order_key,
      customer_id: result.context.job.customer_id,
      job_id: result.context.job.job_id,
      order_number: result.context.orderNumber
    })),
    status: "Active" as const,
    created_at: nowIso,
    updated_at: nowIso,
    expires_at: expiresAt.toISOString(),
    expires_at_epoch: Math.floor(expiresAt.getTime() / 1000),
    created_by_email: args.createdByEmail ?? null,
    requested_email_hash: args.requestedEmail ? hashPublicLogValue(args.requestedEmail) : null,
    requested_email_masked: args.requestedEmail ? maskEmailAddress(args.requestedEmail) : null,
    email_delivery: emailMode
      ? {
          mode: emailMode,
          status: "Pending" as const,
          provider_message_id: null,
          error: null,
          updated_at: nowIso
        }
      : null
  };

  for (const statusSnapshot of snapshots) {
    await persistPublicOrderStatusSnapshot(statusSnapshot);
  }
  await persistOrderStatusToken(tokenRecord);

  return {
    status_url: statusUrlForToken(rawToken),
    token: rawToken,
    expires_at: tokenRecord.expires_at,
    token_record: tokenRecord,
    snapshot,
    snapshots,
    context: primaryResult.context,
    contexts: results.map((result) => result.context)
  };
}

async function createPublicStatusLinkForJob(args: {
  customer: LiftCustomer;
  jobId: string;
  createdByEmail?: string | null;
  requestedEmail?: string | null;
}) {
  return createPublicStatusLinkForJobs({
    orders: [{ customer: args.customer, jobId: args.jobId }],
    createdByEmail: args.createdByEmail,
    requestedEmail: args.requestedEmail
  });
}

async function sendPublicStatusLinkEmail(args: {
  email: string;
  orderNumbers: string[];
  customerNames?: string[];
  statusUrl: string;
  expiresAt: string;
}): Promise<TransactionalEmailResult> {
  const result = await sendTransactionalEmail(
    buildStatusLinkEmail({
      to: args.email,
      statusUrl: args.statusUrl,
      expiresAt: args.expiresAt,
      orderNumbers: args.orderNumbers,
      customerNames: args.customerNames
    })
  );

  console.info("[pathfinder-status-link-email]", {
    mode: result.mode,
    status: result.status,
    provider_message_id: result.provider_message_id ?? null,
    to: maskEmailAddress(args.email),
    order_count: args.orderNumbers.length,
    order_number_hashes: args.orderNumbers.map(hashPublicLogValue),
    expires_at: args.expiresAt
  });

  return result;
}

function synthesizeParsedRows(sourceGrid: SourceGrid): ParsedSourceRow[] {
  return sourceGrid.rows.map((values, index) => ({
    sheet_name: "Imported Grid",
    row_number: index + 2,
    row_type: "order",
    values
  }));
}

function sourceSheetsFromGrid(sourceGrid: SourceGrid): ParsedWorkbookSheet[] {
  return [
    {
      sheet_name: "Imported Grid",
      columns: sourceGrid.columns,
      order_row_count: sourceGrid.rows.length,
      reference_row_count: 0,
      parsed_rows: synthesizeParsedRows(sourceGrid)
    }
  ];
}

function buildMappingFromRow(
  row: ParsedSourceRow,
  config: ProductResolutionConfig,
  timestamp: string,
  route: OutputRoute
) {
  const customerProductKey = productKeyForRow(row, config);
  const sendsGeneratedIdentifier = config.mode === "send_derived_unit" || config.strategy === "direct_lift_unit_number";
  const sourceColumns =
    config.strategy === "composite_key"
      ? config.composite_columns
      : config.strategy === "direct_lift_unit_number"
        ? [config.direct_unit_number_column ?? config.source_column]
        : [config.source_column];

  return {
    mapping_id: mappingIdFromKey(customerProductKey),
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    customer_product_key: customerProductKey,
    display_label: buildDisplayLabel(row, config),
    source_columns: sourceColumns.filter(Boolean),
    product_identifier_type: route.product_identifier_type,
    product_identifier_value: sendsGeneratedIdentifier ? customerProductKey : null,
    lift_unit_number:
      route.product_identifier_type === "lift_unit_number" && sendsGeneratedIdentifier ? customerProductKey : null,
    lift_product_id:
      route.product_identifier_type === "lift_product_id" && sendsGeneratedIdentifier ? customerProductKey : null,
    product_name: valueAsString(rowValue(row, "DESCRIPTION")) || valueAsString(rowValue(row, "SIGN TYPE")) || null,
    status: ((config.mode === "send_derived_unit" || config.strategy === "direct_lift_unit_number") && customerProductKey
      ? "Mapped"
      : "Unmapped") as ProductMappingStatus,
    mapping_source: "Observed order",
    source_file_name: null,
    last_seen_examples: [
      {
        sheet_name: row.sheet_name,
        row_number: row.row_number,
        description: valueAsString(rowValue(row, "DESCRIPTION")) || null,
        sign_type: valueAsString(rowValue(row, "SIGN TYPE")) || null,
        media_type: valueAsString(rowValue(row, "Media Type")) || null,
        final_width: productDimensionValue(row, "width"),
        final_height: productDimensionValue(row, "height")
      }
    ],
    created_at: timestamp,
    updated_at: timestamp
  } satisfies CustomerProductMapping;
}

function resolvedIdentifierForRoute(mapping: CustomerProductMapping, route: OutputRoute) {
  if (route.product_identifier_type === "lift_product_id") {
    return (
      mapping.lift_product_id ??
      (mapping.product_identifier_type === "lift_product_id" ? mapping.product_identifier_value : null) ??
      null
    );
  }
  if (route.product_identifier_type === "lift_unit_number") {
    return (
      mapping.lift_unit_number ??
      (mapping.product_identifier_type === "lift_unit_number" ? mapping.product_identifier_value : null) ??
      null
    );
  }
  return mapping.product_identifier_type === route.product_identifier_type
    ? mapping.product_identifier_value ?? null
    : null;
}

function detectAmbiguousKeys(rows: ParsedSourceRow[], config: ProductResolutionConfig) {
  const signaturesByKey = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const key = productKeyForRow(row, config);
    const signature = buildCompositeValue(row, config.composite_columns);
    if (!key || !signature) {
      return;
    }
    const signatures = signaturesByKey.get(key) ?? new Set<string>();
    signatures.add(signature);
    signaturesByKey.set(key, signatures);
  });

  return new Set(
    Array.from(signaturesByKey.entries())
      .filter(([, signatures]) => signatures.size > 1)
      .map(([key]) => key)
  );
}

function resolveProducts(
  rows: ParsedSourceRow[],
  existingMappings: CustomerProductMapping[],
  config: ProductResolutionConfig,
  route: OutputRoute
) {
  const mappingsByKey = new Map(
    existingMappings
      .filter((mapping) => mapping.output_route_id === route.output_route_id)
      .map((mapping) => [mapping.customer_product_key, mapping])
  );
  const ambiguousKeys = config.strategy === "derived_key" ? detectAmbiguousKeys(rows, config) : new Set<string>();

  return rows.map((row, index) => {
    const key = productKeyForRow(row, config);
    const savedMapping = mappingsByKey.get(key);
    const fallbackMapping = buildMappingFromRow(row, config, new Date().toISOString(), route);
    const mapping = savedMapping ?? fallbackMapping;
    const directUnitNumber =
      config.strategy === "direct_lift_unit_number"
        ? valueAsString(rowValue(row, config.direct_unit_number_column ?? config.source_column))
        : key;
    let status: ProductMappingStatus = mapping.status;
    let resolvedProductIdentifier = resolvedIdentifierForRoute(mapping, route);
    let message = `Resolved to approved ${route.product_identifier_label}.`;

    if (config.strategy === "direct_lift_unit_number") {
      resolvedProductIdentifier = directUnitNumber;
      status = resolvedProductIdentifier ? "Mapped" : "Unmapped";
      message = resolvedProductIdentifier
        ? `Using source value as ${route.product_identifier_label}.`
        : "Source product identifier is blank.";
    } else if (config.mode === "send_derived_unit") {
      resolvedProductIdentifier = directUnitNumber;
      status = resolvedProductIdentifier ? "Mapped" : "Unmapped";
      message = resolvedProductIdentifier
        ? `Using generated value as ${route.product_identifier_label}.`
        : "Generated product identifier is blank.";
    } else if (ambiguousKeys.has(key) && !resolvedIdentifierForRoute(mapping, route)) {
      status = "Ambiguous";
      resolvedProductIdentifier = null;
      message = "Generated key matches multiple product signatures; use composite fallback or approve a mapping.";
    } else if (!resolvedIdentifierForRoute(mapping, route) || mapping.status !== "Mapped") {
      status = key ? "Unmapped" : "Unmapped";
      resolvedProductIdentifier = null;
      message = `Product key needs a ${route.product_identifier_label} mapping for this output route.`;
    }

    return {
      output_route_id: route.output_route_id,
      source_sheet_name: row.sheet_name,
      source_row_number: row.row_number,
      line_number: index + 1,
      strategy: config.strategy,
      mode: config.mode,
      customer_product_key: key,
      display_label: mapping.display_label,
      source_columns: mapping.source_columns,
      resolved_product_identifier: resolvedProductIdentifier,
      resolved_unit_number:
        route.product_identifier_type === "lift_unit_number"
          ? resolvedProductIdentifier
          : mapping.lift_unit_number ?? null,
      resolved_product_id:
        route.product_identifier_type === "lift_product_id"
          ? resolvedProductIdentifier
          : mapping.lift_product_id ?? null,
      product_name: mapping.product_name,
      status,
      message
    } satisfies ProductResolutionResult;
  });
}

function submitProfileForRoute(route: OutputRoute, requestedProfileId?: string): SubmitProfile {
  const enabledProfiles = route.submit_profiles.filter((profile) => profile.enabled);
  return (
    enabledProfiles.find((profile) => profile.profile_id === requestedProfileId) ??
    enabledProfiles.find((profile) => profile.mode === "sandbox_customer") ??
    enabledProfiles.find((profile) => profile.mode === "live_customer") ??
    route.submit_profiles[0]
  );
}

function submitCustomerForProfile(customer: LiftCustomer, profile: SubmitProfile) {
  if (profile.mode === "sandbox_customer" && profile.customer_override) {
    return {
      lift_customer_id: profile.customer_override.lift_customer_id,
      customer_name: profile.customer_override.customer_name
    };
  }

  return {
    lift_customer_id: customer.lift_customer_id,
    customer_name: customer.customer_name
  };
}

function routeEnvironmentForTarget(target: TargetConfig, route: OutputRoute) {
  return target.environments.find((candidate) => candidate.environment_id === route.environment_id) ?? null;
}

function submitProfileFromJob(route: OutputRoute, job: ProcessingJobPreview): SubmitProfile {
  const profile = route.submit_profiles.find((candidate) => candidate.profile_id === job.submit_profile_id);
  if (profile) {
    return profile;
  }

  return {
    profile_id: job.submit_profile_id,
    name: job.submit_profile_name,
    mode: job.submit_mode,
    enabled: true,
    customer_override: job.sandbox
      ? {
          lift_customer_id: job.submit_customer_id,
          customer_name: job.submit_customer_name
        }
      : null
  };
}

async function refreshJobSubmitCertification(customer: LiftCustomer, job: ProcessingJobPreview) {
  const workspace = await getOrCreateWorkspace(customer);
  const outputRoute = workspace.output_routes.find((route) => route.output_route_id === job.output_route_id);

  if (!outputRoute) {
    throw new Error("Preview job output route could not be found.");
  }

  const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig | null;
  if (!target) {
    throw new Error("Preview job target could not be found.");
  }

  const submitProfile = submitProfileFromJob(outputRoute, job);
  const routeEnvironment = routeEnvironmentForTarget(target, outputRoute);
  const unmaskedSubmitRequest = buildLiftSubmitRequest(job.lift_payload, liftConfigForRoute(target, outputRoute));
  const submitRequestMasked = maskLiftSubmitRequest(unmaskedSubmitRequest);
  const submitValidation = validateSubmitReadiness(unmaskedSubmitRequest, job.lift_payload, submitProfile, outputRoute);
  const liftPayloadValidation = job.lift_validation.filter((message) => !message.code.startsWith("SUBMIT-"));
  const certification = buildSubmitCertification({
    state: job.state,
    canonicalValidation: job.canonical_validation,
    liftValidation: liftPayloadValidation,
    submitValidation,
    unresolvedProducts: job.unresolved_products,
    request: unmaskedSubmitRequest,
    payload: job.lift_payload,
    profile: submitProfile,
    route: outputRoute,
    environment: routeEnvironment
  });

  return persistJobSnapshot(customer, {
    ...job,
    lift_validation: [...liftPayloadValidation, ...submitValidation],
    submit_certification: certification,
    submit_request_masked: submitRequestMasked
  });
}

function isPlaceholderSecret(value?: string | null) {
  if (!value) {
    return true;
  }
  return /TBD|SECRET|REFERENCE|^\*+$/i.test(value);
}

function environmentRoleKey(environmentName: string, role?: string): LiftTargetConfig["active_environment"] {
  const normalized = `${role ?? ""} ${environmentName}`.toUpperCase();
  return normalized.includes("PROD") ? "PROD" : "QA1";
}

function liftConfigForRoute(target: TargetConfig, route: OutputRoute): LiftTargetConfig {
  const environment =
    target.environments.find((candidate) => candidate.environment_id === route.environment_id) ??
    target.environments.find((candidate) => candidate.name === target.lift.active_environment) ??
    target.environments[0];
  const activeEnvironment = environment
    ? environmentRoleKey(environment.name, environment.role)
    : target.lift.active_environment;
  const endpointUrl = environment?.endpoint_url ?? target.lift.environments[activeEnvironment].endpoint_url;
  const companyId = route.company_id ?? environment?.headers.Company ?? target.lift.headers.Company;

  return {
    ...target.lift,
    active_environment: activeEnvironment,
    environments: {
      ...target.lift.environments,
      [activeEnvironment]: {
        endpoint_url: endpointUrl
      }
    },
    headers: {
      ...target.lift.headers,
      Company: companyId
    },
    credentials: {
      User: environment?.credentials.User ?? target.lift.credentials.User,
      Password: environment?.credentials.Password ?? target.lift.credentials.Password
    }
  };
}

function validateSubmitReadiness(
  request: LiftSubmitRequest,
  payload: LiftOrderPayload,
  profile: SubmitProfile,
  route: OutputRoute
): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  if (!request.endpoint_url?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-ENDPOINT",
      object: "submit.request",
      field: "endpoint_url",
      message: "Output route has no endpoint URL for the selected environment.",
      suggested_action: "Open Targets, choose the route target, and configure the selected environment endpoint."
    });
  }

  if (request.headers.Ext_ID !== payload.order.ext_id) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-EXT-ID",
      object: "submit.headers",
      field: "headers.Ext_ID",
      message: "Submit header Ext_ID must match body.order.ext_id.",
      suggested_action: "Map the header Ext_ID and body order.ext_id to the same canonical order field."
    });
  }

  if (!payload.order.order_title?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-ORDER-TITLE",
      object: "submit.body",
      field: "body.order.order_title",
      message: "Lift submit requires a resolved order title.",
      suggested_action: "Enable Order Name Resolution on the Import Method and generate a new preview job."
    });
  }

  if (!request.headers.Company?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-COMPANY",
      object: "submit.headers",
      field: "headers.Company",
      message: "Lift Company header is required for this output route.",
      suggested_action: "Set the route Company ID or environment Company header."
    });
  }

  if (!request.headers.User?.trim() || isPlaceholderSecret(request.headers.User)) {
    messages.push({
      severity: "WARNING",
      code: "SUBMIT-USER",
      object: "submit.headers",
      field: "headers.User",
      message: "Submit username is still a placeholder.",
      suggested_action: "Add the Lift import username before enabling real submission."
    });
  }

  if (!request.headers.Password?.trim() || isPlaceholderSecret(request.headers.Password)) {
    messages.push({
      severity: "WARNING",
      code: "SUBMIT-PASSWORD",
      object: "submit.headers",
      field: "headers.Password",
      message: "Submit password is still a placeholder or masked value.",
      suggested_action: "Add the Lift import password before enabling real submission."
    });
  }

  if (
    profile.mode === "sandbox_customer" &&
    profile.customer_override?.lift_customer_id &&
    payload.customer.lift_customer_id !== profile.customer_override.lift_customer_id
  ) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-CUSTOMER-MISMATCH",
      object: "submit.profile",
      field: "customer.lift_customer_id",
      message: "Lift payload customer does not match the selected sandbox submit profile.",
      suggested_action: "Regenerate the preview after choosing the correct submit profile."
    });
  }

  messages.push({
    severity: "PASS",
    code: profile.mode === "sandbox_customer" ? "SUBMIT-SANDBOX" : "SUBMIT-CUSTOMER",
    object: "submit.profile",
    field: "submit_profile",
    message:
      profile.mode === "sandbox_customer"
        ? `Sandbox submit will use ${profile.customer_override?.customer_name ?? "the sandbox customer"} while preserving the source customer in audit fields.`
        : "Submit preview will use the selected customer identity.",
    suggested_action:
      profile.mode === "sandbox_customer"
        ? "Use this for test orders even when targeting the production Lift endpoint."
        : "Use sandbox submit profile for non-customer-facing test orders."
  });

  messages.push({
    severity: "PASS",
    code: "SUBMIT-ROUTE",
    object: "submit.route",
    field: "output_route_id",
    message: `Submit preview uses output route ${route.name}.`
  });

  return messages;
}

function certificationItem(
  item_id: string,
  label: string,
  passed: boolean,
  blockedMessage: string,
  passedMessage: string,
  suggested_action?: string,
  action_key?: SubmitCertificationActionKey
): SubmitCertificationItem {
  return {
    item_id,
    label,
    status: passed ? "Passed" : "Blocked",
    blocking: !passed,
    message: passed ? passedMessage : blockedMessage,
    suggested_action: passed ? undefined : suggested_action,
    action_key: passed ? undefined : action_key
  };
}

function buildSubmitCertification(args: {
  state: ProcessingJobPreview["state"];
  canonicalValidation: ValidationMessage[];
  liftValidation: ValidationMessage[];
  submitValidation: ValidationMessage[];
  unresolvedProducts: CustomerProductMapping[];
  request: LiftSubmitRequest;
  payload: LiftOrderPayload;
  profile: SubmitProfile;
  route: OutputRoute;
  environment: TargetEnvironment | null;
}): SubmitCertification {
  const canonicalFailures = args.canonicalValidation.filter((message) => message.severity === "FAIL");
  const liftFailures = args.liftValidation.filter((message) => message.severity === "FAIL");
  const submitFailures = args.submitValidation.filter((message) => message.severity === "FAIL");
  const previewStateCanSubmit = args.state === "Ready" || args.state === "Submit Failed";
  const placeholderCredentialWarnings = args.submitValidation.filter((message) =>
    ["SUBMIT-USER", "SUBMIT-PASSWORD"].includes(message.code)
  );
  const sandboxSubmitAllowed = args.profile.mode === "sandbox_customer" || liveCustomerSubmitAllowed;
  const items: SubmitCertificationItem[] = [
    certificationItem(
      "preview-state",
      "Preview state",
      previewStateCanSubmit,
      `Preview is ${args.state}, not Ready.`,
      args.state === "Submit Failed"
        ? "The persisted preview remains eligible for an intentional retry."
        : "Preview job is Ready.",
      "Resolve blocking preview validation or product mapping issues.",
      args.unresolvedProducts.length ? "product-map" : "manual-import"
    ),
    certificationItem(
      "canonical-validation",
      "Canonical Order validation",
      canonicalFailures.length === 0,
      `${canonicalFailures.length} Canonical Order failure${canonicalFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Canonical Order has no blocking failures.",
      canonicalFailures[0]?.suggested_action,
      "field-mapping"
    ),
    certificationItem(
      "lift-validation",
      "Lift payload validation",
      liftFailures.length === 0,
      `${liftFailures.length} Lift payload failure${liftFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Lift payload has no blocking failures.",
      liftFailures[0]?.suggested_action,
      liftFailures.some((message) => message.code === "LIFT-UNIT") ? "product-map" : "manual-import"
    ),
    certificationItem(
      "submit-readiness",
      "Submit request validation",
      submitFailures.length === 0,
      `${submitFailures.length} submit request failure${submitFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Submit request has no blocking failures.",
      submitFailures[0]?.suggested_action,
      submitFailures.some((message) => message.code === "SUBMIT-CUSTOMER-MISMATCH") ? "manual-import" : "target-environments"
    ),
    certificationItem(
      "product-resolution",
      "Product resolution",
      args.unresolvedProducts.length === 0,
      `${args.unresolvedProducts.length} product key${args.unresolvedProducts.length === 1 ? "" : "s"} need mapping.`,
      "Every order line has an approved product identifier.",
      "Approve unresolved product keys in Output Product Map.",
      "product-map"
    ),
    certificationItem(
      "route-status",
      "Output route status",
      args.route.status === "Active",
      `Output route is ${args.route.status}.`,
      "Output route is Active.",
      "Set the route status to Active before submitting.",
      "target-output-routes"
    ),
    certificationItem(
      "environment-status",
      "Target environment status",
      args.environment?.status === "Active",
      args.environment
        ? `Target environment ${args.environment.name} is ${args.environment.status}.`
        : "Output route target environment could not be found.",
      args.environment ? `Target environment ${args.environment.name} is Active.` : "Target environment is Active.",
      "Set the selected Target Environment to Active before submitting.",
      "target-environments"
    ),
    certificationItem(
      "endpoint",
      "Endpoint configured",
      Boolean(args.request.endpoint_url?.trim()),
      "Selected route environment has no endpoint URL.",
      `Endpoint is ${args.request.endpoint_url}.`,
      "Configure the selected Target Environment endpoint.",
      "target-environments"
    ),
    certificationItem(
      "ext-id",
      "Ext_ID equality",
      args.request.headers.Ext_ID === args.payload.order.ext_id && Boolean(args.payload.order.ext_id?.trim()),
      "Header Ext_ID must match body.order.ext_id.",
      "Header Ext_ID matches body.order.ext_id.",
      "Map both values to the same canonical order id.",
      "target-output-templates"
    ),
    certificationItem(
      "company",
      "Company header",
      Boolean(args.request.headers.Company?.trim()),
      "Company header is missing.",
      `Company header is ${args.request.headers.Company}.`,
      "Set the route Company ID or environment Company header.",
      "target-output-routes"
    ),
    certificationItem(
      "credentials",
      "Lift credentials",
      placeholderCredentialWarnings.length === 0,
      "Lift import credentials are placeholders or masked values.",
      "Lift import credentials are configured.",
      "Enter the Lift import username and password in Target Environment settings.",
      "target-environments"
    ),
    {
      item_id: "submit-profile",
      label: "Submit profile",
      status: sandboxSubmitAllowed ? "Passed" : "Blocked",
      blocking: !sandboxSubmitAllowed,
      message:
        args.profile.mode === "sandbox_customer"
          ? `Sandbox profile selected: ${args.profile.customer_override?.customer_name ?? args.profile.name}.`
          : liveCustomerSubmitAllowed
            ? `Live customer profile selected: ${args.profile.name}; live customer submits are explicitly allowed.`
            : `Live customer profile selected: ${args.profile.name}. Sandbox submit is required by default.`,
      suggested_action:
        args.profile.mode === "sandbox_customer"
          ? "This is the preferred profile for first production-endpoint tests."
          : liveCustomerSubmitAllowed
            ? undefined
            : "Choose Sandbox · LTL Demo for first production-endpoint tests, or explicitly allow live customer submits.",
      action_key: args.profile.mode === "sandbox_customer" || liveCustomerSubmitAllowed ? undefined : "manual-import"
    },
    certificationItem(
      "submit-profile-enabled",
      "Submit profile enabled",
      args.profile.enabled,
      `Submit profile ${args.profile.name} is disabled on this output route.`,
      `Submit profile ${args.profile.name} is enabled.`,
      "Enable this submit profile on the Output Route or choose another profile.",
      "target-output-routes"
    ),
    {
      item_id: "lift-transport-mode",
      label: "Lift transport mode",
      status: liftSubmitTransportMode === "dry_run" ? "Blocked" : "Passed",
      blocking: liftSubmitTransportMode === "dry_run",
      message:
        liftSubmitTransportMode === "live"
          ? "Lift transport mode is live; Pathfinder will make the external POST when all other gates pass."
          : liftSubmitTransportMode === "mock"
            ? `Lift transport mode is mock; Pathfinder will simulate Lift response scenario ${liftMockScenario}.`
            : "Lift transport mode is dry_run; Pathfinder will record a dry run instead of calling Lift.",
      suggested_action:
        liftSubmitTransportMode === "dry_run"
          ? "Set PATHFINDER_LIFT_TRANSPORT_MODE=mock for submit rehearsal or live for the first real sandbox-lane submit."
          : undefined,
      action_key: liftSubmitTransportMode === "dry_run" ? "target-health" : undefined
    },
    {
      item_id: "external-submit-gate",
      label: "External submit feature gate",
      status: externalLiftSubmitEnabled ? "Passed" : "Blocked",
      blocking: !externalLiftSubmitEnabled,
      message: externalLiftSubmitEnabled
        ? "External Lift submit is enabled for this environment."
        : "External Lift submit is still disabled in Pathfinder.",
      suggested_action: externalLiftSubmitEnabled
        ? undefined
        : "Enable the explicit submit gate only after credentials and response handling are approved.",
      action_key: externalLiftSubmitEnabled ? undefined : "target-health"
    }
  ];
  const blockingCount = items.filter((item) => item.blocking).length;
  const canSubmit = blockingCount === 0;

  return {
    can_submit: canSubmit,
    external_submit_enabled: externalLiftSubmitEnabled,
    live_transport_enabled: liftSubmitTransportMode !== "dry_run",
    live_customer_submit_allowed: liveCustomerSubmitAllowed,
    summary: canSubmit
      ? "Certified for external Lift submit."
      : `${blockingCount} submit certification item${blockingCount === 1 ? "" : "s"} blocking external submit.`,
    items
  };
}

function submitIdempotencyKey(job: ProcessingJobPreview, requestedKey?: string) {
  if (requestedKey?.trim()) {
    return requestedKey.trim();
  }
  return [
    job.job_id,
    job.output_route_id,
    job.submit_profile_id,
    job.submit_request_masked.headers.Ext_ID,
    job.submit_request_masked.headers.Company
  ].join(":");
}

function createSubmitAttempt(args: {
  job: ProcessingJobPreview;
  idempotencyKey: string;
  state: SubmitAttemptStatus;
  blockingItems: SubmitCertificationItem[];
  message: string;
  certification?: SubmitCertification;
  response?: SubmitAttempt["response"];
  submitRequestMasked?: ProcessingJobPreview["submit_request_masked"];
}): SubmitAttempt {
  const timestamp = new Date().toISOString();
  const certification =
    args.certification ??
    args.job.submit_certification ??
    ({
      can_submit: false,
      external_submit_enabled: externalLiftSubmitEnabled,
      live_transport_enabled: liftSubmitTransportMode !== "dry_run",
      live_customer_submit_allowed: liveCustomerSubmitAllowed,
      summary: "Preview job has no submit certification.",
      items: []
    } satisfies SubmitCertification);

  return {
    attempt_id: `submit_${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`,
    idempotency_key: args.idempotencyKey,
    customer_id: args.job.customer_id,
    customer_name: args.job.customer_name,
    job_id: args.job.job_id,
    output_route_id: args.job.output_route_id,
    output_route_name: args.job.output_route_name,
    submit_profile_id: args.job.submit_profile_id,
    submit_profile_name: args.job.submit_profile_name,
    submit_mode: args.job.submit_mode,
    sandbox: args.job.sandbox,
    state: args.state,
    transport_mode: liftSubmitTransportMode,
    external_submit_enabled: externalLiftSubmitEnabled,
    endpoint_url: (args.submitRequestMasked ?? args.job.submit_request_masked).endpoint_url,
    ext_id: (args.submitRequestMasked ?? args.job.submit_request_masked).headers.Ext_ID,
    company_id: (args.submitRequestMasked ?? args.job.submit_request_masked).headers.Company,
    submit_request_masked: args.submitRequestMasked ?? args.job.submit_request_masked,
    certification,
    blocking_items: args.blockingItems,
    response: args.response ?? {
      status: "not_sent",
      http_status: null,
      lift_order_id: null,
      message: args.message,
      raw_body: null,
      received_at: timestamp
    },
    created_at: timestamp,
    updated_at: timestamp
  };
}

async function fetchLiftCustomerDirectory(): Promise<LiftCustomerDirectory> {
  const response = await fetch(liftCustomerListEndpoint, {
    headers: { Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Lift customer import failed with HTTP ${response.status}.`);
  }

  const csv = await response.text();
  const customers = parseLiftCustomerCsv(csv);
  let warning: string | undefined;
  let enrichedCustomers = customers;

  try {
    const statusResponse = await fetch(liftCustomerStatusEndpoint, {
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(10000)
    });

    if (!statusResponse.ok) {
      throw new Error(`Lift customer status import failed with HTTP ${statusResponse.status}.`);
    }

    const statusPayload = await statusResponse.json();
    enrichedCustomers = enrichLiftCustomers(customers, parseLiftCustomerStatusJson(statusPayload));
  } catch (error) {
    warning = error instanceof Error ? error.message : "Lift customer status import failed.";
  }

  return {
    customers: enrichedCustomers,
    source: "lift-endpoint",
    endpoint_url: liftCustomerListEndpoint,
    status_endpoint_url: liftCustomerStatusEndpoint,
    loaded_at: new Date().toISOString(),
    warning
  };
}

function firebaseAdminAuth() {
  if (!getApps().length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    initializeApp({
      credential: serviceAccountJson ? cert(JSON.parse(serviceAccountJson) as Record<string, string>) : applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  }
  return getAuth();
}

function bearerToken(req: Request) {
  const authorization = req.header("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function requirePathfinderAuth(req: Request, res: Response, next: NextFunction) {
  if (!requireFirebaseAuth) {
    next();
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Firebase bearer token." });
    return;
  }

  try {
    const decoded = await firebaseAdminAuth().verifyIdToken(token);
    const email = decoded.email?.toLowerCase() ?? "";
    const domain = email.includes("@") ? email.split("@").pop() ?? "" : "";

    if (!domain || !allowedEmailDomains.includes(domain)) {
      res.status(403).json({ error: "This Google account is not allowed to access Pathfinder." });
      return;
    }

    res.locals.authUser = {
      uid: decoded.uid,
      email,
      domain
    };
    next();
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? `Invalid Firebase token: ${error.message}` : "Invalid Firebase token."
    });
  }
}

app.get("/health", (_req, res) => {
  const persistence = getPathfinderPersistenceRuntimeConfig();
  let email: Record<string, unknown>;

  try {
    const emailConfig = getEmailRuntimeConfig();
    email = {
      mode: emailConfig.mode,
      ses_region: emailConfig.sesRegion,
      configuration_set_present: Boolean(emailConfig.sesConfigurationSet),
      global_status_access_domains_configured: globallyAllowedStatusAccessDomains().size,
      from_domain: emailConfig.from.includes("@") ? emailConfig.from.split("@").pop()?.replace(">", "") ?? null : null,
      status_reply_to_domain: emailConfig.statusReplyTo.includes("@")
        ? emailConfig.statusReplyTo.split("@").pop() ?? null
        : null
    };
  } catch (error) {
    email = {
      error: error instanceof Error ? error.message : "Email runtime configuration is invalid."
    };
  }

  res.json({
    ok: true,
    service: "pathfinder-api",
    version: "0.1.0",
    persistence,
    email
  });
});

app.get("/public/status/:token", async (req, res) => {
  try {
    const token = req.params.token?.trim();

    if (!token) {
      res.status(400).json({ error: "Missing status token." });
      return;
    }

    const tokenRecord = await getOrderStatusToken(hashStatusToken(token));

    if (!tokenRecord || tokenRecord.status !== "Active") {
      res.status(404).json({ error: "Order status link was not found." });
      return;
    }

    if (Date.parse(tokenRecord.expires_at) <= Date.now()) {
      res.status(410).json({ error: "Order status link has expired." });
      return;
    }

    const tokenOrders = tokenRecord.orders?.length
      ? tokenRecord.orders
      : [
          {
            order_key: tokenRecord.order_key,
            customer_id: tokenRecord.customer_id,
            job_id: tokenRecord.job_id,
            order_number: tokenRecord.order_number
          }
        ];
    const snapshots = (
      await Promise.all(
        Array.from(new Set(tokenOrders.map((order) => order.order_key))).map((orderKey) =>
          getPublicOrderStatusSnapshot(orderKey)
        )
      )
    ).filter((snapshot): snapshot is PublicOrderStatusSnapshot => snapshot != null);

    if (!snapshots.length) {
      res.status(404).json({ error: "Order status snapshots were not found." });
      return;
    }

    res.json({
      snapshot: snapshots[0],
      snapshots,
      link: {
        status: tokenRecord.status,
        expires_at: tokenRecord.expires_at,
        order_count: snapshots.length
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Order status lookup failed."
    });
  }
});

app.post("/public/status/request-link", async (req, res) => {
  const acceptedResponse = {
    status: "accepted",
    message: "If we can match this request, we will send a secure order status link."
  };

  try {
    const orderNumbers = requestedPublicStatusOrderNumbers(req.body);
    const email = valueAsString(req.body?.email).toLowerCase();

    if (
      !orderNumbers.length ||
      orderNumbers.length > maxPublicStatusOrdersPerRequest ||
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      res.status(400).json({
        error: `Enter one to ${maxPublicStatusOrdersPerRequest} order numbers and a valid email address.`
      });
      return;
    }

    if (isPublicStatusRequestRateLimited(req, email, orderNumbers)) {
      res.status(202).json(acceptedResponse);
      return;
    }

    const matches = await findPathfinderJobsByOrderNumbers(orderNumbers);
    const permittedMatches = matches.filter((match) => canSendPublicStatusLinkToEmail(match.workspace, match.job, email));
    let debugStatusUrl: string | undefined;

    if (permittedMatches.length) {
      const link = await createPublicStatusLinkForJobs({
        orders: permittedMatches.map((match) => ({ customer: match.customer, jobId: match.job.job_id })),
        createdByEmail: email,
        requestedEmail: email
      });

      if (!("error" in link)) {
        try {
          const delivery = await sendPublicStatusLinkEmail({
            email,
            orderNumbers: link.snapshots.map((snapshot) => snapshot.order_number),
            customerNames: link.snapshots.map((snapshot) => snapshot.customer.submit_customer_name),
            statusUrl: link.status_url,
            expiresAt: link.expires_at
          });
          await persistOrderStatusToken({
            ...link.token_record,
            email_delivery: {
              mode: delivery.mode,
              status: delivery.status === "sent" ? "Sent" : "Logged",
              provider_message_id: delivery.provider_message_id ?? null,
              error: null,
              updated_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          });
        } catch (error) {
          await persistOrderStatusToken({
            ...link.token_record,
            email_delivery: {
              mode: link.token_record.email_delivery?.mode ?? getEmailRuntimeConfig().mode,
              status: "Failed",
              provider_message_id: null,
              error: error instanceof Error ? error.message : "Status email delivery failed.",
              updated_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          });
          throw error;
        }
        debugStatusUrl = publicStatusReturnLink ? link.status_url : undefined;
      }
    }

    if (matches.length > permittedMatches.length) {
      console.info("[pathfinder-status-link-rejected]", {
        rejected_order_count: matches.length - permittedMatches.length,
        order_number_hashes: orderNumbers.map(hashPublicLogValue),
        requested_email: maskEmailAddress(email),
        reason: "email_not_associated_with_order"
      });
    }

    res.status(202).json({
      ...acceptedResponse,
      debug_status_url: debugStatusUrl
    });
  } catch (error) {
    console.error("[pathfinder-status-link-error]", {
      error: error instanceof Error ? error.message : "Order status request failed."
    });
    res.status(202).json(acceptedResponse);
  }
});

app.use("/api", requirePathfinderAuth);
app.use("/api/proof", createProofAdminRouter());

app.get("/api/submit-runtime", (_req, res) => {
  res.json({
    external_submit_enabled: externalLiftSubmitEnabled,
    transport_mode: liftSubmitTransportMode,
    live_transport_enabled: liftSubmitTransportMode !== "dry_run",
    live_customer_submit_allowed: liveCustomerSubmitAllowed
  });
});

app.get("/api/email/status", (_req, res) => {
  try {
    const config = getEmailRuntimeConfig();
    const fromDomain = config.from.includes("@") ? config.from.split("@").pop()?.replace(">", "") ?? null : null;
    const statusReplyToDomain = config.statusReplyTo.includes("@") ? config.statusReplyTo.split("@").pop() ?? null : null;
    const globalAllowedDomainCount = globallyAllowedStatusAccessDomains().size;
    const items = [
      {
        item_id: "mode",
        status: config.mode === "ses" ? "Ready" : "Warning",
        label: "Delivery mode",
        message:
          config.mode === "ses"
            ? "Status-link email is configured to send through Amazon SES."
            : "Status-link email is in log mode; links are logged instead of delivered."
      },
      {
        item_id: "sender",
        status: fromDomain === "notify.vornan.co" ? "Ready" : "Warning",
        label: "Sender domain",
        message: fromDomain ? `Sender domain is ${fromDomain}.` : "Sender domain could not be detected."
      },
      {
        item_id: "reply-to",
        status: statusReplyToDomain === "vornan.co" ? "Ready" : "Warning",
        label: "Status reply-to",
        message: `Status replies route to ${config.statusReplyTo}.`
      },
      {
        item_id: "ses-region",
        status: config.sesRegion ? "Ready" : "Blocked",
        label: "SES region",
        message: config.sesRegion ? `Amazon SES region is ${config.sesRegion}.` : "SES region is missing."
      },
      {
        item_id: "configuration-set",
        status: config.sesConfigurationSet ? "Ready" : "Warning",
        label: "SES events",
        message: config.sesConfigurationSet
          ? `SES configuration set ${config.sesConfigurationSet} is configured.`
          : "SES configuration set is not configured; provider event publishing may be limited."
      },
      {
        item_id: "global-status-domains",
        status: globalAllowedDomainCount > 0 ? "Ready" : "Warning",
        label: "Global status domains",
        message:
          globalAllowedDomainCount > 0
            ? `${globalAllowedDomainCount} trusted domain${globalAllowedDomainCount === 1 ? "" : "s"} can request status links across customers.`
            : "No global trusted domains are configured for cross-customer status lookup."
      }
    ];

    res.json({
      mode: config.mode,
      sender: {
        from: config.from,
        from_domain: fromDomain,
        status_reply_to: config.statusReplyTo,
        status_reply_to_domain: statusReplyToDomain
      },
      ses: {
        region: config.sesRegion,
        configuration_set: config.sesConfigurationSet ?? null
      },
      public_status_access: {
        global_allowed_domains_configured: globalAllowedDomainCount
      },
      readiness: {
        status: items.some((item) => item.status === "Blocked")
          ? "Blocked"
          : items.some((item) => item.status === "Warning")
            ? "Warning"
            : "Ready",
        items
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Email runtime configuration is invalid."
    });
  }
});

app.get("/api/sample-order", (_req, res) => {
  const canonicalValidation = validateCanonicalOrder(sampleCanonicalOrder);
  const liftPayload = generateLiftPayload(sampleCanonicalOrder, {
    jobId: "job_20260618_000001",
    canonicalOrderId: "co_20260618_000001"
  });
  const liftValidation = validateLiftPayload(liftPayload);
  const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload));

  res.json({
    canonicalOrder: sampleCanonicalOrder,
    canonicalValidation,
    liftPayload,
    liftValidation,
    submitRequest
  });
});

function applyCanonicalRegistryOverrides(
  overrides: Record<string, CanonicalFieldOverride>,
  usageByPath: Record<string, CanonicalFieldUsageSummary>
): Array<CanonicalFieldDefinition & { origin: "core" | "custom"; usage: CanonicalFieldUsageSummary }> {
  return canonicalFieldRegistry.map((field) => {
    const override = overrides[field.field_id];
    if (!override) {
      return {
        ...field,
        origin: "core",
        usage: usageByPath[field.path] ?? {
          import_method_mappings: 0,
          saved_mapping_templates: 0,
          output_template_mappings: 0,
          output_template_tokens: 0,
          value_rules: 0,
          total: 0
        }
      };
    }

    return {
      ...field,
      label: override.label ?? field.label,
      aliases: override.aliases ?? field.aliases,
      status: override.status ?? field.status,
      description: override.description ?? field.description,
      origin: "core",
      usage: usageByPath[field.path] ?? {
        import_method_mappings: 0,
        saved_mapping_templates: 0,
        output_template_mappings: 0,
        output_template_tokens: 0,
        value_rules: 0,
        total: 0
      }
    };
  });
}

async function buildCanonicalRegistryResponse() {
  const registry = await getCanonicalRegistryOverrides();
  const governance = await getCanonicalRegistryGovernance();
  const usageByPath = await getCanonicalRegistryUsageByPath();
  const baseFields = applyCanonicalRegistryOverrides(registry.overrides, usageByPath);
  const fieldMap = new Map(baseFields.map((field) => [field.field_id, field]));
  registry.custom_fields.forEach((field) => {
    const override = registry.overrides[field.field_id];
    fieldMap.set(field.field_id, {
      ...field,
      origin: "custom",
      usage: usageByPath[field.path] ?? {
        import_method_mappings: 0,
        saved_mapping_templates: 0,
        output_template_mappings: 0,
        output_template_tokens: 0,
        value_rules: 0,
        total: 0
      },
      ...(override
        ? {
            label: override.label ?? field.label,
            aliases: override.aliases ?? field.aliases,
            status: override.status ?? field.status,
            description: override.description ?? field.description
          }
        : {})
    });
  });
  const mergedFields = Array.from(fieldMap.values());

  return {
    ...canonicalRegistryMetadata,
    updated_at: registry.updated_at ?? canonicalRegistryMetadata.updated_at,
    fields: mergedFields,
    sections: Array.from(new Set(mergedFields.map((field) => field.section))),
    field_count: mergedFields.length,
    history: governance.history,
    snapshots: governance.snapshots.map(({ fields: _fields, ...snapshot }) => snapshot)
  };
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function canonicalRegistryCsv(
  fields: Array<CanonicalFieldDefinition & { origin?: "core" | "custom"; usage?: CanonicalFieldUsageSummary }>
) {
  const columns = [
    "path",
    "label",
    "section",
    "data_type",
    "required",
    "repeatable",
    "status",
    "origin",
    "aliases",
    "description",
    "usage_total"
  ];
  const rows = fields.map((field) => [
    field.path,
    field.label,
    field.section,
    field.data_type,
    field.required,
    field.repeatable,
    field.status,
    field.origin ?? "",
    field.aliases,
    field.description,
    field.usage?.total ?? ""
  ]);

  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function comparableCanonicalField(field: CanonicalFieldDefinition) {
  return {
    path: field.path,
    label: field.label,
    section: field.section,
    data_type: field.data_type,
    required: field.required,
    repeatable: field.repeatable,
    status: field.status,
    aliases: field.aliases ?? [],
    description: field.description ?? null
  };
}

function canonicalRegistrySnapshotDiff(snapshotFields: CanonicalFieldDefinition[], currentFields: CanonicalFieldDefinition[]) {
  const snapshotByPath = new Map(snapshotFields.map((field) => [field.path, field]));
  const currentByPath = new Map(currentFields.map((field) => [field.path, field]));
  const added = currentFields.filter((field) => !snapshotByPath.has(field.path));
  const removed = snapshotFields.filter((field) => !currentByPath.has(field.path));
  const changed = currentFields
    .filter((field) => {
      const previous = snapshotByPath.get(field.path);
      return previous && JSON.stringify(comparableCanonicalField(previous)) !== JSON.stringify(comparableCanonicalField(field));
    })
    .map((field) => ({
      path: field.path,
      before: comparableCanonicalField(snapshotByPath.get(field.path) as CanonicalFieldDefinition),
      after: comparableCanonicalField(field)
    }));

  return { added, removed, changed };
}

app.get("/api/canonical-registry", async (_req, res) => {
  res.json(await buildCanonicalRegistryResponse());
});

app.get("/api/canonical-registry/export", async (req, res) => {
  const registry = await buildCanonicalRegistryResponse();
  const format = req.query.format === "csv" ? "csv" : "json";

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="pathfinder-canonical-registry.csv"');
    res.send(canonicalRegistryCsv(registry.fields));
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="pathfinder-canonical-registry.json"');
  res.json(registry);
});

app.get("/api/canonical-registry/snapshots/:snapshotId", async (req, res) => {
  const governance = await getCanonicalRegistryGovernance();
  const snapshot = governance.snapshots.find((candidate) => candidate.snapshot_id === req.params.snapshotId);
  if (!snapshot) {
    res.status(404).json({ error: "Canonical registry snapshot not found." });
    return;
  }

  res.json({ snapshot });
});

app.get("/api/canonical-registry/snapshots/:snapshotId/export", async (req, res) => {
  const governance = await getCanonicalRegistryGovernance();
  const snapshot = governance.snapshots.find((candidate) => candidate.snapshot_id === req.params.snapshotId);
  if (!snapshot) {
    res.status(404).json({ error: "Canonical registry snapshot not found." });
    return;
  }

  const format = req.query.format === "csv" ? "csv" : "json";
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${snapshot.snapshot_id}.csv"`);
    res.send(canonicalRegistryCsv(snapshot.fields));
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${snapshot.snapshot_id}.json"`);
  res.json(snapshot);
});

app.get("/api/canonical-registry/snapshots/:snapshotId/compare", async (req, res) => {
  const governance = await getCanonicalRegistryGovernance();
  const snapshot = governance.snapshots.find((candidate) => candidate.snapshot_id === req.params.snapshotId);
  if (!snapshot) {
    res.status(404).json({ error: "Canonical registry snapshot not found." });
    return;
  }

  const current = await buildCanonicalRegistryResponse();
  const diff = canonicalRegistrySnapshotDiff(snapshot.fields, current.fields);
  res.json({
    snapshot_id: snapshot.snapshot_id,
    snapshot_version: snapshot.version,
    current_version: current.version,
    counts: {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length
    },
    diff
  });
});

app.put("/api/canonical-registry/fields/:fieldId", async (req, res) => {
  const registry = await getCanonicalRegistryOverrides();
  const field = [...canonicalFieldRegistry, ...registry.custom_fields].find(
    (candidate) => candidate.field_id === req.params.fieldId
  );
  if (!field) {
    res.status(404).json({ error: "Canonical field not found." });
    return;
  }

  const rawStatus = req.body?.status;
  if (rawStatus && !["Active", "Draft", "Deprecated"].includes(rawStatus)) {
    res.status(400).json({ error: "Status must be Active, Draft, or Deprecated." });
    return;
  }

  const rawAliases = req.body?.aliases;
  const aliases =
    Array.isArray(rawAliases)
      ? rawAliases.map((alias) => String(alias).trim()).filter(Boolean)
      : typeof rawAliases === "string"
        ? rawAliases.split(",").map((alias) => alias.trim()).filter(Boolean)
        : undefined;
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : field.label;
  const description =
    typeof req.body?.description === "string"
      ? req.body.description.trim() || null
      : undefined;

  if (!label) {
    res.status(400).json({ error: "Label is required." });
    return;
  }

  await updateCanonicalRegistryFieldOverride(field.field_id, {
    label,
    aliases,
    status: rawStatus,
    description
  });

  res.json(await buildCanonicalRegistryResponse());
});

app.patch("/api/canonical-registry/fields/:fieldId/path", async (req, res) => {
  const registry = await getCanonicalRegistryOverrides();
  const field = registry.custom_fields.find((candidate) => candidate.field_id === req.params.fieldId);
  const newPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";

  if (!field) {
    res.status(404).json({ error: "Only custom canonical fields can be renamed." });
    return;
  }
  if (!newPath) {
    res.status(400).json({ error: "New path is required." });
    return;
  }
  if (!/^[a-z][a-z0-9_]*(\[\])?(\.[a-z][a-z0-9_]*(\[\])?)*$/.test(newPath)) {
    res.status(400).json({ error: "Path must use dot notation, lowercase words, underscores, and optional [] arrays." });
    return;
  }
  if (newPath === field.path) {
    res.json(await buildCanonicalRegistryResponse());
    return;
  }

  const existingFields = [...canonicalFieldRegistry, ...registry.custom_fields];
  if (existingFields.some((candidate) => candidate.path === newPath && candidate.field_id !== field.field_id)) {
    res.status(409).json({ error: "A canonical field with this path already exists." });
    return;
  }

  const result = await renameCanonicalRegistryCustomField(field.field_id, newPath);
  if (!result) {
    res.status(404).json({ error: "Custom canonical field not found." });
    return;
  }

  res.json({
    ...(await buildCanonicalRegistryResponse()),
    migration: {
      old_path: result.old_path,
      new_path: result.new_path,
      usage: result.usage
    }
  });
});

app.post("/api/canonical-registry/fields", async (req, res) => {
  const allowedSections: CanonicalFieldSection[] = ["customer", "contacts", "source", "target", "order", "shipping", "lines"];
  const allowedDataTypes: CanonicalFieldDataType[] = ["string", "number", "integer", "boolean", "datetime", "url", "object"];
  const registry = await getCanonicalRegistryOverrides();
  const existingFields = [...canonicalFieldRegistry, ...registry.custom_fields];
  const path = typeof req.body?.path === "string" ? req.body.path.trim() : "";
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const section = req.body?.section as CanonicalFieldSection;
  const dataType = req.body?.data_type as CanonicalFieldDataType;
  const aliases =
    typeof req.body?.aliases === "string"
      ? req.body.aliases.split(",").map((alias: string) => alias.trim()).filter(Boolean)
      : Array.isArray(req.body?.aliases)
        ? req.body.aliases.map((alias: unknown) => String(alias).trim()).filter(Boolean)
        : [];
  const status = ["Active", "Draft", "Deprecated"].includes(req.body?.status) ? req.body.status : "Draft";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : undefined;

  if (!path || !label) {
    res.status(400).json({ error: "Path and label are required." });
    return;
  }
  if (!allowedSections.includes(section)) {
    res.status(400).json({ error: "Choose a valid canonical section." });
    return;
  }
  if (!allowedDataTypes.includes(dataType)) {
    res.status(400).json({ error: "Choose a valid data type." });
    return;
  }
  if (!/^[a-z][a-z0-9_]*(\[\])?(\.[a-z][a-z0-9_]*(\[\])?)*$/.test(path)) {
    res.status(400).json({ error: "Path must use dot notation, lowercase words, underscores, and optional [] arrays." });
    return;
  }
  if (existingFields.some((field) => field.path === path)) {
    res.status(409).json({ error: "A canonical field with this path already exists." });
    return;
  }

  await addCanonicalRegistryCustomField({
    path,
    label,
    section,
    data_type: dataType,
    required: Boolean(req.body?.required),
    repeatable: typeof req.body?.repeatable === "boolean" ? req.body.repeatable : path.includes("[]"),
    status,
    aliases,
    description
  });

  res.status(201).json(await buildCanonicalRegistryResponse());
});

app.delete("/api/canonical-registry/fields/:fieldId", async (req, res) => {
  const registry = await getCanonicalRegistryOverrides();
  const field = registry.custom_fields.find((candidate) => candidate.field_id === req.params.fieldId);

  if (!field) {
    res.status(404).json({ error: "Only custom canonical fields can be removed." });
    return;
  }

  const override = registry.overrides[field.field_id];
  const effectiveStatus = override?.status ?? field.status;
  if (effectiveStatus !== "Draft") {
    res.status(409).json({ error: "Only Draft custom fields can be removed. Deprecate active fields instead." });
    return;
  }

  const nextRegistry = await deleteCanonicalRegistryCustomField(field.field_id);
  if (!nextRegistry) {
    res.status(404).json({ error: "Custom canonical field not found." });
    return;
  }

  res.json(await buildCanonicalRegistryResponse());
});

app.get("/api/lift/customers", async (req, res) => {
  const shouldRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const directory = shouldRefresh ? await fetchLiftCustomerDirectory() : await readLocalCustomerSeed();
    res.json(directory);
  } catch (error) {
    const fallbackDirectory = await readLocalCustomerSeed();
    res.json({
      ...fallbackDirectory,
      warning: error instanceof Error ? error.message : "Lift customer import failed; served local seed instead."
    });
  }
});

app.get("/api/customers/:liftCustomerId/workspace", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await getOrCreateWorkspace(customer);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Workspace load failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/import-methods/:methodId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await updateImportMethod(customer, req.params.methodId, req.body as Partial<ImportMethod>);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Import method save failed."
    });
  }
});

app.delete("/api/customers/:liftCustomerId/import-methods/:methodId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await archiveImportMethod(customer, req.params.methodId);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Import method delete failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/output-routes/:routeId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await updateOutputRoute(customer, req.params.routeId, req.body as Partial<OutputRoute>);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Output route save failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/status-access-policy", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await updateStatusAccessPolicy(customer, req.body as Partial<StatusAccessPolicy>);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Status access policy save failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/product-mappings", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      product_mappings: await listProductMappings(customer)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Product mapping load failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/catalog-presets", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      catalog_presets: await listCatalogPresets(customer)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Catalog presets load failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/catalog-presets/:presetId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      catalog_presets: await upsertCatalogPreset(customer, {
        ...(req.body as Partial<LiftCatalogPreset>),
        preset_id: req.params.presetId
      })
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Catalog preset save failed."
    });
  }
});

app.delete("/api/customers/:liftCustomerId/catalog-presets/:presetId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      catalog_presets: await deleteCatalogPreset(customer, req.params.presetId)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Catalog preset delete failed."
    });
  }
});

app.get("/api/lift/unit-catalog", async (req, res) => {
  try {
    res.json({
      units: await listLiftUnitCatalog({
        target_id: req.query.target_id ? String(req.query.target_id) : undefined,
        environment_id: req.query.environment_id ? String(req.query.environment_id) : undefined,
        company_id: req.query.company_id ? String(req.query.company_id) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        product_id: req.query.product_id ? String(req.query.product_id) : undefined,
        catalog_id: req.query.catalog_id ? String(req.query.catalog_id) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        include_inactive: req.query.include_inactive === "1" || req.query.include_inactive === "true"
      })
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift unit catalog load failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/product-mappings/:mappingId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      product_mappings: await updateProductMapping(customer, req.params.mappingId, req.body as Partial<CustomerProductMapping>)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Product mapping save failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/product-mappings/bulk", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      product_mappings: await bulkUpsertProductMappings(customer, (req.body?.product_mappings ?? []) as CustomerProductMapping[])
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Bulk product mapping save failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/preview", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await getOrCreateWorkspace(customer);
    const sourceGrid = (req.body?.source_grid ?? sampleSourceGrid) as SourceGrid;
    const sourceSheets = (req.body?.source_sheets ?? sourceSheetsFromGrid(sourceGrid)) as ParsedWorkbookSheet[];
    const requestIncludedParsedRows = Array.isArray(req.body?.parsed_order_rows);
    const parsedOrderRows = (requestIncludedParsedRows
      ? ((req.body.parsed_order_rows as ParsedSourceRow[]) ?? [])
      : synthesizeParsedRows(sourceGrid)
    ).filter((row) => row.row_type === "order");
    const referenceRows = ((req.body?.reference_rows as ParsedSourceRow[] | undefined) ?? []) as ParsedSourceRow[];
    const sourceFileName = String(req.body?.source_file_name ?? "Sample workbook");
    const sheetName = req.body?.sheet_name ? String(req.body.sheet_name) : null;
    const requestedMethodId = String(req.body?.import_method_id ?? "manual-xlsx");
    const existingMethod =
      workspace.import_methods.find((method) => method.import_method_id === requestedMethodId) ??
      workspace.import_methods[0];
    const mappings = (req.body?.mappings ?? existingMethod?.mappings ?? []) as FieldMapping[];
    const method = {
      ...existingMethod,
      mappings,
      product_resolution_config: {
        ...createDefaultProductResolutionConfig(),
        ...(existingMethod?.product_resolution_config ?? {}),
        ...(req.body?.product_resolution_config ?? {})
      },
      order_name_resolution_config: normalizeOrderNameResolutionConfig(
        {
          ...(existingMethod?.order_name_resolution_config ?? {}),
          ...(req.body?.order_name_resolution_config ?? {})
        },
        existingMethod?.order_name_resolution_config ?? createDefaultOrderNameResolutionConfig()
      ),
      ext_id_strategy:
        req.body?.ext_id_strategy === "pathfinder_generated" || req.body?.ext_id_strategy === "customer_order_id"
          ? req.body.ext_id_strategy
          : existingMethod?.ext_id_strategy ?? "pathfinder_generated"
    };
    const outputRoute =
      workspace.output_routes.find((route) => route.output_route_id === method.output_route_id) ??
      workspace.output_routes.find((route) => route.output_route_id === workspace.primary_output_route_id) ??
      workspace.output_routes[0];
    if (!outputRoute) {
      throw new Error("No output route is configured for this customer.");
    }
    const submitProfile = submitProfileForRoute(outputRoute, req.body?.submit_profile_id ? String(req.body.submit_profile_id) : undefined);
    const submitCustomer = submitCustomerForProfile(customer, submitProfile);
    const orderRows = parsedOrderRows.length || requestIncludedParsedRows ? parsedOrderRows : synthesizeParsedRows(sourceGrid);
    const mappingRows = orderRows.map((row) => row.values);
    const existingProductMappings = await listProductMappings(customer);
    const productResolutionResults = resolveProducts(
      orderRows,
      existingProductMappings,
      method.product_resolution_config,
      outputRoute
    );
    const timestamp = new Date().toISOString();
    const compactTimestamp = timestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
    const idEntropy = randomBytes(3).toString("hex");
    const jobId = `job_${compactTimestamp}_${idEntropy}`;
    const canonicalOrderId = `co_${compactTimestamp}_${idEntropy}`;
    const seenMappings = productResolutionResults.map((result, index) => {
      const row = orderRows[index];
      const existing = existingProductMappings.find(
        (mapping) =>
          mapping.output_route_id === outputRoute.output_route_id &&
          mapping.customer_product_key === result.customer_product_key
      );
      const nextSeenExample = {
        sheet_name: result.source_sheet_name,
        row_number: result.source_row_number,
        description: valueAsString(rowValue(row, "DESCRIPTION")) || null,
        sign_type: valueAsString(rowValue(row, "SIGN TYPE")) || null,
        media_type: valueAsString(rowValue(row, "Media Type")) || null,
        final_width: productDimensionValue(row, "width"),
        final_height: productDimensionValue(row, "height")
      };
      return {
        ...(existing ?? buildMappingFromRow(row, method.product_resolution_config, timestamp, outputRoute)),
        output_route_id: outputRoute.output_route_id,
        target_id: outputRoute.target_id,
        target_template: outputRoute.output_template,
        product_identifier_type: outputRoute.product_identifier_type,
        product_identifier_value: result.resolved_product_identifier,
        status: result.status,
        lift_unit_number:
          outputRoute.product_identifier_type === "lift_unit_number"
            ? result.resolved_product_identifier
            : existing?.lift_unit_number ?? null,
        lift_product_id:
          outputRoute.product_identifier_type === "lift_product_id"
            ? result.resolved_product_identifier
            : existing?.lift_product_id ?? null,
        product_name: result.product_name,
        last_seen_examples: [
          nextSeenExample,
          ...(existing?.last_seen_examples ?? []).filter(
            (example) =>
              example.sheet_name !== nextSeenExample.sheet_name || example.row_number !== nextSeenExample.row_number
          )
        ].slice(0, 8),
        updated_at: timestamp
      } satisfies CustomerProductMapping;
    });
    const nextProductMappings = await bulkUpsertProductMappings(customer, seenMappings);
    const unresolvedProducts = nextProductMappings.filter(
      (mapping) =>
        mapping.output_route_id === outputRoute.output_route_id &&
        productResolutionResults.some((result) => result.customer_product_key === mapping.customer_product_key) &&
        mapping.status !== "Mapped"
    );
    const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig | null;
    if (!target) {
      throw new Error(`Output route target ${outputRoute.target_id} could not be found.`);
    }
    const mappedCanonicalOrder = mapSourceRowsToCanonicalOrder(mappingRows, mappings, {
      customerId: `lift:${customer.lift_customer_id}`,
      customerName: submitCustomer.customer_name,
      customerCrmId: customer.crm_id ?? null,
      destinationCustomerId: submitCustomer.lift_customer_id,
      sourceSystem: method.source === "XLSX" ? "Manual XLSX Upload" : method.source,
      sourceCustomer: customer.customer_name,
      sourceTemplate: method.name,
      targetSystem: target.template
    });
    const orderNameResolution = applyOrderNameResolution(
      mappedCanonicalOrder,
      method.order_name_resolution_config
    );
    const canonicalOrder = orderNameResolution.canonical_order;
    canonicalOrder.lines = canonicalOrder.lines.map((line, index) => ({
      ...line,
      unit_number:
        outputRoute.product_identifier_type === "lift_unit_number"
          ? productResolutionResults[index]?.resolved_product_identifier ?? ""
          : line.unit_number ?? "",
      product_id:
        outputRoute.product_identifier_type === "lift_product_id"
          ? productResolutionResults[index]?.resolved_product_identifier ?? line.product_id ?? null
          : line.product_id ?? null,
      product_name: productResolutionResults[index]?.product_name ?? line.product_name,
      customer_sku: productResolutionResults[index]?.customer_product_key ?? line.customer_sku
    }));
    const canonicalValidation = [
      ...validateCanonicalOrder(canonicalOrder, {
        product_identifier_type: outputRoute.product_identifier_type
      }),
      ...validateOrderNameResolution(orderNameResolution.result, method.order_name_resolution_config)
    ];
    const pathfinderOrderId = await reservePathfinderOrderNumber();
    const rawLiftPayload = generateLiftPayload(canonicalOrder, {
      jobId,
      canonicalOrderId,
      pathfinderOrderId,
      extIdStrategy: method.ext_id_strategy
    });
    const normalizedLift = applyValueNormalizationToLiftPayload(rawLiftPayload, outputRoute.value_normalization_rules);
    const liftPayload = normalizedLift.payload;
    const baseLiftValidation = validateLiftPayload(liftPayload, {
      product_identifier_type: outputRoute.product_identifier_type,
      product_identifier_label: outputRoute.product_identifier_label
    });
    const liftValidation = [
      ...(normalizedLift.validation.length
        ? baseLiftValidation.filter((message) => message.severity !== "PASS")
        : baseLiftValidation),
      ...normalizedLift.validation
    ];
    const routeLiftConfig = liftConfigForRoute(target, outputRoute);
    const routeEnvironment = routeEnvironmentForTarget(target, outputRoute);
    const unmaskedSubmitRequest = buildLiftSubmitRequest(liftPayload, routeLiftConfig);
    const submitValidation = validateSubmitReadiness(unmaskedSubmitRequest, liftPayload, submitProfile, outputRoute);
    const submitRequest = maskLiftSubmitRequest(unmaskedSubmitRequest);
    const allMessages = [...canonicalValidation, ...liftValidation, ...submitValidation];
    const jobState: ProcessingJobPreview["state"] = unresolvedProducts.length
      ? "Needs Mapping"
      : allMessages.some((message) => message.severity === "FAIL")
        ? "Failed"
        : "Ready";
    const submitCertification = buildSubmitCertification({
      state: jobState,
      canonicalValidation,
      liftValidation,
      submitValidation,
      unresolvedProducts,
      request: unmaskedSubmitRequest,
      payload: liftPayload,
      profile: submitProfile,
      route: outputRoute,
      environment: routeEnvironment
    });
    const job: ProcessingJobPreview = {
      job_id: jobId,
      pathfinder_order_id: pathfinderOrderId,
      customer_id: customer.lift_customer_id,
      customer_name: customer.customer_name,
      source_customer_id: customer.lift_customer_id,
      source_customer_name: customer.customer_name,
      submit_customer_id: submitCustomer.lift_customer_id,
      submit_customer_name: submitCustomer.customer_name,
      submit_profile_id: submitProfile.profile_id,
      submit_profile_name: submitProfile.name,
      submit_mode: submitProfile.mode,
      sandbox: submitProfile.mode === "sandbox_customer",
      import_method_id: method.import_method_id,
      import_method_name: method.name,
      output_route_id: outputRoute.output_route_id,
      output_route_name: outputRoute.name,
      target_order_number: null,
      target_order_lookup_url: null,
      state: jobState,
      source_file_name: sourceFileName,
      sheet_name: sheetName,
      source_grid: sourceGrid,
      source_sheets: sourceSheets,
      parsed_order_rows: orderRows,
      reference_rows: referenceRows,
      mappings,
      product_resolution_results: productResolutionResults,
      order_name_resolution_result: orderNameResolution.result,
      unresolved_products: unresolvedProducts,
      canonical_order: canonicalOrder,
      canonical_validation: canonicalValidation,
      lift_payload: liftPayload,
      lift_validation: [...liftValidation, ...submitValidation],
      submit_certification: submitCertification,
      submit_request_masked: submitRequest,
      created_at: timestamp,
      updated_at: timestamp
    };
    const nextWorkspace = await persistPreviewJob(customer, job, method);

    res.json({
      job,
      workspace: {
        ...nextWorkspace,
        primary_target: maskTargetConfig(target)
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Preview job failed."
    });
  }
});

app.get("/api/jobs", async (_req, res) => {
  res.json({
    jobs: await listJobs()
  });
});

app.get("/api/customers/:liftCustomerId/jobs/:jobId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    res.json({
      job,
      submit_attempts: await listSubmitAttemptsForJob(customer, req.params.jobId)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Job detail failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/jobs/:jobId/order-lookup", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const workspace = await getOrCreateWorkspace(customer);
    const route = workspace.output_routes.find((candidate) => candidate.output_route_id === job.output_route_id);
    const target = route ? ((await getTarget(route.target_id, false)) as TargetConfig | null) : null;
    const attempts = await listSubmitAttemptsForJob(customer, req.params.jobId);
    const orderNumber =
      job.target_order_number ??
      attempts.find((attempt) => attempt.response.lift_order_id)?.response.lift_order_id ??
      null;

    if (!route || !target) {
      res.status(409).json({
        error: "Job output route or target could not be found."
      });
      return;
    }

    if (!orderNumber) {
      res.status(409).json({
        error: "No Lift order number is available for this job yet."
      });
      return;
    }

    const lookup = await fetchLiftOrderLookup({
      target,
      route,
      orderNumber
    });

    res.status(lookup.ok ? 200 : 502).json({ lookup });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift order lookup failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/jobs/:jobId/proof-report", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const workspace = await getOrCreateWorkspace(customer);
    const route = workspace.output_routes.find((candidate) => candidate.output_route_id === job.output_route_id);
    const target = route ? ((await getTarget(route.target_id, false)) as TargetConfig | null) : null;
    const attempts = await listSubmitAttemptsForJob(customer, req.params.jobId);
    const orderNumber =
      job.target_order_number ??
      attempts.find((attempt) => attempt.response.lift_order_id)?.response.lift_order_id ??
      null;
    const orderLineId = typeof req.query.order_line_id === "string" ? req.query.order_line_id : null;

    if (!route || !target) {
      res.status(409).json({
        error: "Job output route or target could not be found."
      });
      return;
    }

    if (!orderNumber) {
      res.status(409).json({
        error: "No Lift order number is available for this job yet."
      });
      return;
    }

    const proofReport = await fetchLiftProofReport({
      target,
      route,
      orderNumber,
      orderLineId
    });

    res.status(proofReport.ok ? 200 : 502).json({ proof_report: proofReport });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift proof report lookup failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/jobs/:jobId/package-details", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const workspace = await getOrCreateWorkspace(customer);
    const route = workspace.output_routes.find((candidate) => candidate.output_route_id === job.output_route_id);
    const target = route ? ((await getTarget(route.target_id, false)) as TargetConfig | null) : null;
    const attempts = await listSubmitAttemptsForJob(customer, req.params.jobId);
    const orderNumber =
      job.target_order_number ??
      attempts.find((attempt) => attempt.response.lift_order_id)?.response.lift_order_id ??
      null;
    const orderLineId = typeof req.query.order_line_id === "string" ? req.query.order_line_id : null;

    if (!route || !target) {
      res.status(409).json({
        error: "Job output route or target could not be found."
      });
      return;
    }

    if (!orderNumber) {
      res.status(409).json({
        error: "No Lift order number is available for this job yet."
      });
      return;
    }

    const packageDetails = await fetchLiftPackageDetails({
      target,
      route,
      orderNumber,
      orderLineId
    });

    res.status(packageDetails.ok ? 200 : 502).json({ package_details: packageDetails });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift package details lookup failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/jobs/:jobId/order-snapshot", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const result = await loadBoundedInternalOrderSnapshot(customer, req.params.jobId);

    if ("error" in result) {
      res.status(result.errorStatus ?? 500).json({
        error: result.error
      });
      return;
    }

    res.json({ snapshot: result.snapshot, refresh: result.refresh });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Pathfinder order snapshot failed."
    });
  }
});

app.get("/api/order-status/lookup", async (req, res) => {
  try {
    const orderNumber = typeof req.query.order_number === "string" ? req.query.order_number : "";
    const match = await findPathfinderJobByOrderNumber(orderNumber);

    if (!match) {
      res.status(404).json({
        error: "No Pathfinder job matched that order number."
      });
      return;
    }

    const result = await buildInternalOrderSnapshotForJob(match.customer, match.job.job_id);

    if ("error" in result) {
      res.status(result.errorStatus ?? 500).json({
        error: result.error
      });
      return;
    }

    res.json({
      match: {
        customer_id: match.customer.lift_customer_id,
        customer_name: match.customer.customer_name,
        job_id: match.job.job_id,
        job_state: match.job.state,
        source_order_id: match.job.lift_payload.order.ext_id,
        target_order_number: result.context.orderNumber
      },
      snapshot: result.snapshot
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal order status lookup failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/:jobId/status-link", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const result = await createPublicStatusLinkForJob({
      customer,
      jobId: req.params.jobId,
      createdByEmail: typeof res.locals.authUser?.email === "string" ? res.locals.authUser.email : null
    });

    if ("error" in result) {
      res.status(result.errorStatus ?? 500).json({
        error: result.error
      });
      return;
    }

    res.status(201).json({
      status_url: result.status_url,
      token: result.token,
      expires_at: result.expires_at,
      snapshot: result.snapshot
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Could not create order status link."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/:jobId/certification", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const refreshedJob = await refreshJobSubmitCertification(customer, job);
    res.json({
      job: refreshedJob,
      certification: refreshedJob.submit_certification,
      submit_request_masked: refreshedJob.submit_request_masked
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Submit certification refresh failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/:jobId/submit", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const idempotencyKey = submitIdempotencyKey(job, req.header("Idempotency-Key") ?? req.body?.idempotency_key);
    const existingAttempt = await getSubmitAttemptByIdempotencyKey(customer, idempotencyKey);
    if (existingAttempt) {
      res.status(200).json({
        attempt: existingAttempt,
        reused: true,
        message: "Existing submit attempt returned for idempotency key."
      });
      return;
    }

    const workspace = await getOrCreateWorkspace(customer);
    const outputRoute = workspace.output_routes.find((route) => route.output_route_id === job.output_route_id);

    if (!outputRoute) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems: [],
          message: "Preview job output route could not be found."
        })
      );
      res.status(409).json({
        error: "Preview job output route could not be found.",
        attempt,
        certification: job.submit_certification
      });
      return;
    }

    const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig | null;
    if (!target) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems: [],
          message: "Preview job target could not be found."
        })
      );
      res.status(409).json({
        error: "Preview job target could not be found.",
        attempt,
        certification: job.submit_certification
      });
      return;
    }

    const submitProfile = submitProfileFromJob(outputRoute, job);
    const routeEnvironment = routeEnvironmentForTarget(target, outputRoute);
    const unmaskedSubmitRequest = buildLiftSubmitRequest(job.lift_payload, liftConfigForRoute(target, outputRoute));
    const submitRequestMasked = maskLiftSubmitRequest(unmaskedSubmitRequest);
    const submitValidation = validateSubmitReadiness(unmaskedSubmitRequest, job.lift_payload, submitProfile, outputRoute);
    const certification = buildSubmitCertification({
      state: job.state,
      canonicalValidation: job.canonical_validation,
      liftValidation: job.lift_validation,
      submitValidation,
      unresolvedProducts: job.unresolved_products,
      request: unmaskedSubmitRequest,
      payload: job.lift_payload,
      profile: submitProfile,
      route: outputRoute,
      environment: routeEnvironment
    });

    const blockingItems = certification.items.filter((item) => item.blocking);
    const nonGateBlockers = blockingItems.filter((item) => item.item_id !== "external-submit-gate");
    if (nonGateBlockers.length) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems,
          certification,
          submitRequestMasked,
          message: "Preview job is not certified for Lift submit."
        })
      );
      res.status(409).json({
        error: "Preview job is not certified for Lift submit.",
        attempt,
        certification,
        blocking_items: nonGateBlockers,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    if (!externalLiftSubmitEnabled) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Gate Locked",
          blockingItems,
          certification,
          submitRequestMasked,
          message: "External Lift submit is disabled by Pathfinder feature gate."
        })
      );
      res.status(423).json({
        error: "External Lift submit is disabled by Pathfinder feature gate.",
        attempt,
        certification,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    if (!certification.can_submit) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems,
          certification,
          submitRequestMasked,
          message: "Preview job is not certified for Lift submit."
        })
      );
      res.status(409).json({
        error: "Preview job is not certified for Lift submit.",
        attempt,
        certification,
        blocking_items: blockingItems,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    const transportResult = await submitLiftOrder(unmaskedSubmitRequest, {
      mode: liftSubmitTransportMode,
      mockScenario: liftMockScenario
    });
    const attemptState: SubmitAttemptStatus =
      transportResult.status === "accepted"
        ? "Submitted"
        : transportResult.status === "not_sent"
          ? "Dry Run"
          : "Failed";
    const attempt = await persistSubmitAttempt(
      customer,
      createSubmitAttempt({
        job,
        idempotencyKey,
        state: attemptState,
        blockingItems: [],
        certification,
        message: transportResult.message,
        response: transportResult,
        submitRequestMasked
      })
    );
    let submittedJob = await getJob(customer, job.job_id);

    if (
      transportResult.error_translation?.category === "duplicate_order_name" &&
      job.lift_payload.order.order_title
    ) {
      const attempts = await listSubmitAttemptsForJob(customer, job.job_id);
      const duplicateNameAttemptCount = attempts.filter(
        (candidate) => candidate.response.error_translation?.category === "duplicate_order_name"
      ).length;
      const nextOrderName = appendOrderNameRetrySuffix(
        job.lift_payload.order.order_title,
        duplicateNameAttemptCount
      );
      submittedJob = await persistJobSnapshot(customer, {
        ...(submittedJob ?? job),
        state: "Ready",
        canonical_order: {
          ...(submittedJob ?? job).canonical_order,
          order: {
            ...(submittedJob ?? job).canonical_order.order,
            order_title: nextOrderName
          }
        },
        order_name_resolution_result: (submittedJob ?? job).order_name_resolution_result
          ? {
              ...(submittedJob ?? job).order_name_resolution_result!,
              value: nextOrderName
            }
          : undefined,
        lift_payload: {
          ...(submittedJob ?? job).lift_payload,
          order: {
            ...(submittedJob ?? job).lift_payload.order,
            order_title: nextOrderName
          }
        },
        submit_request_masked: {
          ...(submittedJob ?? job).submit_request_masked,
          body: {
            ...(submittedJob ?? job).submit_request_masked.body,
            order: {
              ...(submittedJob ?? job).submit_request_masked.body.order,
              order_title: nextOrderName
            }
          }
        }
      });
    }

    if (transportResult.status === "rejected" || transportResult.status === "error") {
      res.status(502).json({
        error:
          transportResult.error_translation?.category === "duplicate_order_name" && submittedJob?.lift_payload.order.order_title
            ? `${transportResult.message} Next retry prepared as ${submittedJob.lift_payload.order.order_title}.`
            : transportResult.message,
        attempt,
        job: submittedJob ?? job,
        certification,
        transport_mode: liftSubmitTransportMode,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    res.status(202).json({
      attempt,
      job: submittedJob ?? job,
      certification,
      transport_mode: liftSubmitTransportMode,
      submit_request_masked: submitRequestMasked
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift submit failed."
    });
  }
});

app.get("/api/targets", async (_req, res) => {
  res.json({
    targets: await listTargets()
  });
});

app.put("/api/targets/:targetId", async (req, res) => {
  try {
    const target = await updateTarget(req.params.targetId, req.body as Partial<TargetConfig>);
    res.json(target);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Target save failed."
    });
  }
});

app.delete("/api/targets/:targetId", async (req, res) => {
  try {
    const targets = await deleteTarget(req.params.targetId);
    res.json({ targets });
  } catch (error) {
    const status = error instanceof TargetNotFoundError ? 404 : error instanceof TargetInUseError ? 409 : 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Target delete failed."
    });
  }
});

app.get("/api/lift/product-catalog", async (req, res) => {
  try {
    const targetId = req.query.target_id ? String(req.query.target_id) : undefined;
    const routeId = req.query.output_route_id ? String(req.query.output_route_id) : undefined;
    const companyId = req.query.company_id ? String(req.query.company_id) : undefined;
    const customerId = req.query.customer_id ? String(req.query.customer_id) : undefined;
    let refreshed = false;
    let refreshedCount = 0;
    let refreshError: string | null = null;

    if (req.query.refresh === "1" || req.query.refresh === "true") {
      if (!targetId || !routeId || !customerId) {
        throw new Error("Refresh requires target_id, output_route_id, and customer_id.");
      }
      const customer = await findLiftCustomer(customerId);
      const workspace = await getOrCreateWorkspace(customer);
      const route =
        workspace.output_routes.find((candidate) => candidate.output_route_id === routeId) ??
        workspace.output_routes.find((candidate) => candidate.output_route_id === workspace.primary_output_route_id) ??
        workspace.output_routes[0];
      const target = (await getTarget(targetId, false)) as TargetConfig | null;

      if (!route || !target) {
        throw new Error("Could not find the selected target or output route for product catalog refresh.");
      }

      try {
        const liftedProducts = await fetchLiftProductsFromTarget(target, route, req.query);
        await upsertLiftProductCatalog(liftedProducts);
        refreshed = true;
        refreshedCount = liftedProducts.length;
      } catch (error) {
        refreshError = error instanceof Error ? error.message : "Lift product catalog refresh failed.";
      }
    }

    const products = await listLiftUnitCatalog({
      target_id: targetId,
      environment_id: req.query.environment_id ? String(req.query.environment_id) : undefined,
      company_id: companyId,
      q: req.query.q ? String(req.query.q) : undefined,
      product_id: req.query.product_id ? String(req.query.product_id) : undefined,
      product_name: req.query.product_name ? String(req.query.product_name) : undefined,
      catalog_id: req.query.catalog_id ? String(req.query.catalog_id) : undefined,
      catalog_name: req.query.catalog_name ? String(req.query.catalog_name) : undefined,
      product_type: req.query.product_type ? String(req.query.product_type) : undefined,
      accounting_item_code: req.query.accounting_item_code ? String(req.query.accounting_item_code) : undefined,
      parent_product_id: req.query.parent_product_id ? String(req.query.parent_product_id) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      include_inactive: req.query.include_inactive === "1" || req.query.include_inactive === "true",
      fetch_size: req.query.fetchSize
        ? Number(req.query.fetchSize)
        : req.query.fetch_size
          ? Number(req.query.fetch_size)
          : undefined,
      fetch_offset: req.query.fetchOffset
        ? Number(req.query.fetchOffset)
        : req.query.fetch_offset
          ? Number(req.query.fetch_offset)
          : undefined
    });

    res.json({
      products,
      refreshed,
      refreshed_count: refreshedCount,
      refresh_error: refreshError,
      source: refreshed ? "lift-api" : "local-cache"
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift product catalog load failed."
    });
  }
});

app.post("/api/lift/preview", (req, res) => {
  const canonicalOrder = req.body?.canonicalOrder ?? sampleCanonicalOrder;
  const canonicalValidation = validateCanonicalOrder(canonicalOrder);
  const liftPayload = generateLiftPayload(canonicalOrder);
  const liftValidation = validateLiftPayload(liftPayload);
  const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload));

  res.json({
    canonicalValidation,
    liftValidation,
    liftPayload,
    submitRequest
  });
});

if (!process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.PATHFINDER_RUNTIME !== "lambda") {
  app.listen(port, () => {
    console.log(`Pathfinder API listening on http://127.0.0.1:${port}`);
  });
}

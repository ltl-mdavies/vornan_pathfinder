import { generateLiftPayload, validateLiftPayload, projectLiftEcommercePayload, LIFT_ECOMMERCE_TEMPLATE_ID } from '@pathfinder/lift-adapter';
import type { CanonicalJsonLine } from '@pathfinder/canonical';
import { sha256, stableJson } from './adapter.js';
import type { Receipt } from './local-store.js';
import { scopeKey, type WebhookScope } from '../webhooks/contract.js';

export type LiftPreviewReceipt = Pick<Receipt, 'identity' | 'adapted' | 'assets' | 'receipt_id' | 'revision' | 'fingerprint'>;
const previewScope = (r: LiftPreviewReceipt): WebhookScope => ({customer_id: r.identity.customer_id, integration_id: r.identity.integration_id, store: r.identity.store, environment: r.identity.environment});

export interface ProductSelector {
  store_product: string;
  store_variation_id: string;
  material_code: string;
  finish: string;
  cut_type: string;
  shape: string;
}
/** Trusted review input, never read from the partner payload. No endpoint or credentials are accepted. */
export interface LiftPreviewMapping {
  scope: WebhookScope;
  revision: string;
  review_reference: string;
  customer: { lift_customer_id: string; legal_name: 'Silicon Pasture' } | null;
  product_identifier: 'lift_unit_number' | 'lift_product_id';
  products: Array<{
    source: ProductSelector;
    target_id: string;
    production: { material: string; laminate: string; cut_type: string };
  }>;
}
export interface PreviewGap { code: string; field: string }
const selector = (line: CanonicalJsonLine): ProductSelector => ({
  store_product: line.source_line.store_product,
  store_variation_id: line.source_line.store_variation_id,
  material_code: String(line.production?.material_code ?? ''),
  finish: String(line.production?.finish ?? ''),
  cut_type: line.source_line.cut.type,
  shape: String(line.production?.shape ?? '')
});

function validateMapping(r: LiftPreviewReceipt, mapping: LiftPreviewMapping) {
  if (mapping.scope.environment !== 'test' || scopeKey(mapping.scope) !== scopeKey(previewScope(r))) {
    throw new Error('Lift preview mapping scope mismatch');
  }
  if (!mapping.revision.trim() || !mapping.review_reference.trim() ||
      !['lift_unit_number', 'lift_product_id'].includes(mapping.product_identifier)) {
    throw new Error('Invalid Lift preview mapping');
  }
  if (mapping.customer && (mapping.customer.legal_name !== 'Silicon Pasture' ||
      !/^[1-9]\d*$/.test(mapping.customer.lift_customer_id) || mapping.customer.lift_customer_id === '284619')) {
    throw new Error('Invalid or unrelated Lift customer mapping');
  }
  const keys = new Set<string>();
  for (const product of mapping.products) {
    const key = stableJson(product.source);
    if (keys.has(key) || Object.keys(product.source).sort().join(',') !==
        'cut_type,finish,material_code,shape,store_product,store_variation_id' ||
        Object.values(product.source).some(v => typeof v !== 'string' || !v.trim()) ||
        !product.target_id.trim() ||
        Object.keys(product.production).sort().join(',') !== 'cut_type,laminate,material' ||
        Object.values(product.production).some(v => typeof v !== 'string' || !v.trim())) {
      throw new Error('Invalid or ambiguous Lift product mapping');
    }
    keys.add(key);
  }
}

/** Pure, local review artifact. It cannot create a job, submit request, document grant or confirmation. */
export function buildJsonLiftPreview(receipt: LiftPreviewReceipt, mapping: LiftPreviewMapping) {
  validateMapping(receipt, mapping);
  const canonical = structuredClone(receipt.adapted.canonical);
  if (canonical.source.schema !== 'stickerpress.order.v1' ||
      canonical.customer.customer_id !== receipt.identity.customer_id ||
      canonical.source.integration_id !== receipt.identity.integration_id ||
      canonical.source.store !== receipt.identity.store) throw new Error('Receipt canonical identity mismatch');
  const gaps: PreviewGap[] = [];
  const gap = (code: string, field: string) => gaps.push({code, field});
  if (!mapping.customer) gap('LIFT_CUSTOMER_UNVERIFIED', 'customer.lift_customer_id');
  canonical.customer.destination_customer_id = mapping.customer?.lift_customer_id;
  // The review candidate deliberately has no source access URLs or local storage references.
  canonical.order.order_attachment = null;
  canonical.order.artwork_folder_url = null;
  canonical.order.reference_proof_url = null;
  const lines = canonical.lines.map((line, index) => {
    const source = structuredClone(line.source_line);
    const product = mapping.products.find(p => stableJson(p.source) === stableJson(selector(line)));
    if (!product) gap('LIFT_PRODUCT_MAPPING_UNRESOLVED', `lines[${index}]`);
    line.unit_number = mapping.product_identifier === 'lift_unit_number' ? product?.target_id ?? '' : '';
    line.product_id = mapping.product_identifier === 'lift_product_id' ? product?.target_id ?? null : null;
    const sourceProduction = structuredClone(line.production);
    line.production = product ? structuredClone(product.production) : {};
    line.artwork = {file_name: source.artwork.filename, checksum: source.artwork.artwork_sha256};
    const assets = receipt.assets.filter(a => a.external_line_id === source.external_line_id);
    const asset = assets.length === 1 ? assets[0] : undefined;
    const integrity = Boolean(asset && asset.sha256 === source.artwork.artwork_sha256 &&
      asset.sha256 === source.approval.artwork_sha256 && asset.bytes === source.artwork.bytes);
    if (!integrity) gap('APPROVED_ARTWORK_NOT_RETAINED', `lines[${index}].artwork`);
    const metadataPass = integrity && asset?.inspection === 'metadata_pass' &&
      asset.inspection_result?.sha256 === asset.sha256 && asset.inspection_result.verdict === 'pass';
    if (!metadataPass) gap('ARTWORK_METADATA_REVIEW_REQUIRED', `lines[${index}].artwork`);
    gap('ARTWORK_DELIVERY_UNCONFIGURED', `lines[${index}].artwork.file_url`);
    gap('PRODUCTION_EVIDENCE_DESTINATION_UNREVIEWED', `lines[${index}].source_line`);
    return {
      external_line_id: source.external_line_id,
      source_product: selector(receipt.adapted.canonical.lines[index]),
      target_mapping: product ? structuredClone(product) : null,
      production: sourceProduction,
      cut: source.cut,
      area: source.area,
      dimensions_unit: source.dimensions_unit,
      artwork: {
        filename: source.artwork.filename, format: source.artwork.format, pages: source.artwork.pages,
        page_in: source.artwork.page_in, trim_in: source.artwork.trim_in,
        sha256: source.artwork.artwork_sha256, bytes: source.artwork.bytes,
        approved_original_retained: integrity,
        inspection: metadataPass ? 'metadata_pass' : integrity && asset?.inspection === 'metadata_fail' && asset.inspection_result?.sha256 === asset.sha256 ? 'metadata_fail' : 'not_run',
        inspection_result: integrity && asset && asset.inspection_result?.sha256 === asset.sha256 ? structuredClone(asset.inspection_result) : null
      },
      approval: source.approval,
      preview: source.preview ? {format: source.preview.format, purpose: source.preview.purpose, reference_only: true} : null
    };
  });
  const candidate = projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID, generateLiftPayload(canonical, {
    jobId: 'job_preview_only', canonicalOrderId: 'co_preview_only', extIdStrategy: 'customer_order_id'
  }), receipt.adapted.canonical);
  if (candidate.order.ext_id !== receipt.adapted.canonical.order.external_order_id) throw new Error('EXT_ID changed');
  const validation = validateLiftPayload(candidate, {product_identifier_type: mapping.product_identifier});
  for (const finding of validation) if (finding.severity === 'FAIL') gap(finding.code, finding.field ?? '*');
  if (!canonical.order.ship_date) gap('TURNAROUND_POLICY_UNCONFIGURED', 'order.requested_ship_date');
  gap('SHIPPING_POLICY_UNREVIEWED', 'order.shipping');
  gap('TARGET_DATE_FORMAT_UNREVIEWED', 'order.requested_ship_date');
  if (canonical.order.shipping_policy.label_url) gap('PREPAID_LABEL_DELIVERY_UNCONFIGURED', 'order.shipping_policy.label_url');
  gap('ORDER_METADATA_DESTINATION_UNREVIEWED', 'order');
  const {label_url, ...shippingPolicy} = canonical.order.shipping_policy;
  const packet = {
    schema: 'pathfinder.json-lift-preview.v1' as const,
    review_only: true as const,
    output_template_id: LIFT_ECOMMERCE_TEMPLATE_ID,
    submission_allowed: false as const,
    scope: previewScope(receipt),
    receipt_id: receipt.receipt_id,
    order_revision: receipt.revision + 1,
    business_fingerprint: receipt.fingerprint,
    mapping_revision: mapping.revision,
    mapping_review_reference: mapping.review_reference,
    mapping_sha256: sha256(stableJson(mapping)),
    candidate,
    evidence: {
      source: {schema: canonical.source.schema, created_at: canonical.source.created_at, store: canonical.source.store},
      order: {order_type_name: canonical.order.order_type_name, market: canonical.order.market, priority: canonical.order.priority},
      shipping: {...shippingPolicy, prepaid_label_supplied: Boolean(label_url), return_address_configured: false},
      lines
    },
    gaps,
    release_gates: ['AUTHORITATIVE_CUSTOMER_AND_PRODUCT_VERIFICATION', 'PRODUCTION_POLICY_APPROVAL',
      'REVIEWED_DOCUMENT_PUBLICATION', 'AUTHORITATIVE_JOB_SUBMIT_BINDING', 'SANCTIONED_TARGET_TEST', 'EXPLICIT_ACTIVATION']
  };
  return {...packet, preview_sha256: sha256(stableJson(packet))};
}

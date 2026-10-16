import assert from 'node:assert/strict';
import { generateLiftPayload, prepareLiftEcommercePayload, LIFT_ECOMMERCE_TEMPLATE_ID } from '@pathfinder/lift-adapter';
import type { OutputTemplate, OutputRoute, CustomerProductMapping, TargetConfig } from '../store.js';
import { createLiftEcommerceOutputTemplate } from '../lift-output-templates.js';
import type { LiftPreviewReceipt } from './lift-preview.js';

export const stickerPressLiftRouteId = 'route-ltl-lift-91-ecomm-orders';
export const stickerPressProductKey = 'STICKERPRESS_STICKER';

/** Explicit configuration operation. Does not persist, activate, or submit anything. */
export function createStickerPressLiftConfiguration(base: OutputTemplate, referenceRoute: OutputRoute,
  timestamp = new Date().toISOString()) {
  assert.equal(referenceRoute.company_id, '91');
  assert.equal(referenceRoute.target_id, 'lift-standard-graphics');
  assert.equal(referenceRoute.output_template_id, base.output_template_id);
  const template = createLiftEcommerceOutputTemplate(base, timestamp);
  template.name = 'Lift Ecomm Orders';
  // High End Work may intentionally use the contract as its PO. Andy supplies a distinct PO.
  template.canonical_mappings = template.canonical_mappings.map(m => m.sourceColumn === 'body:order.po_number'
    ? {...m, targetField: 'order.po_number'} : m);
  const body = JSON.parse(template.body_template);
  body.order.po_number = '{{order.po_number}}';
  template.body_template = JSON.stringify(body, null, 2);
  // Persisted route data can include a customer key outside the public route type.
  // Never carry the reference customer's ownership into the new customer route.
  const {customer_id: _referenceCustomer, ...connectionRoute} = structuredClone(referenceRoute) as OutputRoute & {customer_id?: string};
  const route: OutputRoute = {...connectionRoute, output_route_id: stickerPressLiftRouteId,
    name: 'Larger Than Life · Lift / 91 · Ecomm Orders', output_template_id: template.output_template_id,
    output_template: template.name, product_identifier_type: 'lift_product_id', product_identifier_label: 'Lift product_id',
    status: 'Draft', updated_at: timestamp};
  const product: CustomerProductMapping = {
    mapping_id: 'mapping-stickerpress-sticker-374549', output_route_id: route.output_route_id,
    target_id: route.target_id, target_template: template.name, source_scope_id: null,
    customer_product_key: stickerPressProductKey, display_label: 'All Sticker Press order lines', source_columns: [],
    product_identifier_type: 'lift_product_id', product_identifier_value: '374549', lift_product_id: '374549',
    lift_unit_number: null, product_name: 'Sticker Press Sticker', status: 'Mapped',
    replacement_version_id: null, last_seen_examples: [], created_at: timestamp, updated_at: timestamp
  };
  return {template, route, product};
}

/** Trusted, customer-scoped single-product binding for receipt previews, independent of source SKU/variation.
 * The sandbox receipt-to-job bridge must explicitly use this binding before submission is enabled.
 */
export function buildStickerPressConfiguredPreview(receipt: LiftPreviewReceipt,
  config: {template: OutputTemplate; route: OutputRoute; product: CustomerProductMapping;
    order_date_format: TargetConfig['lift']['order_date_format']}) {
  assert.equal(receipt.identity.customer_id, '174094');
  assert.equal(receipt.identity.integration_id, 'stickerpress-sandbox');
  assert.equal(receipt.identity.store, 'ltlco');
  assert.equal(receipt.identity.environment, 'test');
  assert.equal(receipt.adapted.canonical.source.schema, 'stickerpress.order.v1');
  assert.equal(receipt.adapted.canonical.customer.customer_id, receipt.identity.customer_id);
  assert.equal(receipt.adapted.canonical.source.integration_id, receipt.identity.integration_id);
  assert.equal(config.template.output_template_id, LIFT_ECOMMERCE_TEMPLATE_ID);
  assert.equal(config.route.output_template_id, config.template.output_template_id);
  assert.equal(config.route.output_route_id, stickerPressLiftRouteId);
  assert.equal(config.route.company_id, '91');
  assert.equal(config.route.product_identifier_type, 'lift_product_id');
  assert.equal(config.product.output_route_id, config.route.output_route_id);
  assert.equal(config.product.target_id, config.route.target_id);
  assert.equal(config.product.customer_product_key, stickerPressProductKey);
  assert.equal(config.product.status, 'Mapped');
  assert.equal(config.product.lift_product_id, '374549');
  assert.equal(config.product.product_identifier_value, '374549');
  const canonical = structuredClone(receipt.adapted.canonical);
  canonical.customer.destination_customer_id = '174094';
  canonical.order.order_attachment = null;
  canonical.order.artwork_folder_url = null;
  canonical.order.reference_proof_url = null;
  for (const line of canonical.lines) {
    line.product_id = config.product.lift_product_id;
    line.unit_number = '';
    line.description ??= line.product_name;
    line.product_name = config.product.product_name!;
    line.production = {...line.production, laminate: line.production?.laminate ?? line.production?.finish ?? null};
    line.artwork = {file_name: line.source_line.artwork.filename, checksum: line.source_line.artwork.artwork_sha256};
    delete line.document_delivery;
  }
  const result = prepareLiftEcommercePayload({template_id: config.template.output_template_id,
    base: generateLiftPayload(canonical, {jobId: 'job_preview_only', canonicalOrderId: 'co_preview_only', extIdStrategy: 'customer_order_id'}),
    canonical, source: canonical, order_mappings: config.template.canonical_mappings,
    order_date_format: config.order_date_format, validation_options: {product_identifier_type: 'lift_product_id'}});
  return {review_only: true as const, submission_allowed: false as const, receipt_id: receipt.receipt_id,
    output_route_id: config.route.output_route_id, output_template_id: config.template.output_template_id,
    pending: ['RETAINED_ARTWORK_PUBLICATION', 'RECEIPT_TO_JOB_BINDING', 'CONTROLLED_LIFT_IMPORT_TEST'], ...result};
}

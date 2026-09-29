import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { CanonicalJsonOrder } from '@pathfinder/canonical';
import type { IntakeOwner } from '../intake-assurance.js';

export interface IntegrationIdentity {
  customer_id: string; customer_name: string; integration_id: string;
  store: string; environment: 'test'; schema: string;
}
export interface FieldIssue {
  issue_id: string; code: string; field: string; external_line_id?: string;
  message: string; corrective_action: string; owner: IntakeOwner; retryable?: boolean;
}
export class IntakeError extends Error {
  constructor(public status: number, public code: string, public issues: FieldIssue[] = []) { super(code); }
}
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export interface AdaptedOrder {
  canonical: CanonicalJsonOrder;
  /** Protected original submission evidence, never returned in status or logs. */
  evidence: Record<string, unknown>;
  fingerprint: string;
}
export interface JsonOrderAdapter {
  schema: string;
  validate(payload: unknown, identity: IntegrationIdentity): AdaptedOrder;
}
/** Syntax gate only. Network/DNS/redirect validation belongs to a separately reviewed fetcher. */
export function safeSourceUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      (!url.port || url.port === '443') && !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
      url.hostname.includes('.') && !/(^|\.)(localhost|local|internal)$/.test(url.hostname);
  } catch { return false; }
}
const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,19) === v.slice(0,19);
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const string = (v: unknown) => typeof v === 'string' && v.length <= 10000;
const identifier = (v: unknown) => string(v) && (v as string).length <= 200 && (v as string).trim() === v && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v as string);
const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
type ObjectValue = Record<string, any>;

export const stickerPressV1: JsonOrderAdapter = {
  schema: 'stickerpress.order.v1',
  validate(payload, identity) {
    const issues: FieldIssue[] = [];
    const issue = (field: string, code = 'INVALID_FIELD', line?: string) => issues.push({
      issue_id: `iss_${sha256(`${field}:${code}`).slice(0,24)}`, code, field, ...(line ? {external_line_id: line} : {}),
      message: 'The field is missing, invalid, or unsupported by this adapter version.',
      corrective_action: 'Correct this field using the agreed schema and retry the same order identity.', owner: 'customer'
    });
    const object = (value: unknown, path: string, keys: string[]): ObjectValue => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { issue(path); return {}; }
      for (const key of Object.keys(value)) if (!keys.includes(key)) issue(`${path ? path + '.' : ''}${key}`, 'UNSUPPORTED_FIELD');
      return value as ObjectValue;
    };
    const check = (ok: boolean, path: string, code?: string, line?: string) => { if (!ok) issue(path, code, line); };
    const p = object(payload, '', ['schema','submitted_at','account','order','ship_to','shipping','lines']);
    check(p.schema === this.schema && p.schema === identity.schema, 'schema', 'UNSUPPORTED_SCHEMA');
    check(timestamp(p.submitted_at), 'submitted_at');
    const account = object(p.account, 'account', ['customer','store']);
    check(string(account.customer) && !!account.customer, 'account.customer');
    check(account.store === identity.store, 'account.store', 'STORE_SCOPE_MISMATCH');
    const order = object(p.order, 'order', ['order_number','order_title','po_number','order_type_name','market','creation_date','requested_ship_date','priority','notes']);
    check(identifier(order.order_number), 'order.order_number');
    check(timestamp(order.creation_date), 'order.creation_date');
    for (const k of ['order_title','order_type_name','market','priority']) check(string(order[k]) && !!order[k], `order.${k}`);
    for (const k of ['po_number','notes']) check(order[k] == null || string(order[k]), `order.${k}`);
    check(order.requested_ship_date == null || order.requested_ship_date === '' || date(order.requested_ship_date), 'order.requested_ship_date');
    const ship = object(p.ship_to, 'ship_to', ['name','company','line1','line2','city','state','postal_code','country','phone','email']);
    for (const k of ['name','line1','city','state','postal_code','country']) check(string(ship[k]) && !!ship[k].trim(), `ship_to.${k}`);
    for (const k of ['company','line2','phone','email']) check(ship[k] == null || string(ship[k]), `ship_to.${k}`);
    const shipping = object(p.shipping, 'shipping', ['mode','blind_ship','ship_from_name','label_url']);
    check(shipping.mode === 'supplier_ships', 'shipping.mode');
    check(typeof shipping.blind_ship === 'boolean', 'shipping.blind_ship');
    check(string(shipping.ship_from_name) && !!shipping.ship_from_name, 'shipping.ship_from_name');
    check(shipping.label_url == null || safeSourceUrl(shipping.label_url), 'shipping.label_url');
    check(Array.isArray(p.lines) && p.lines.length > 0 && p.lines.length <= 100, 'lines');
    const ids = new Set<string>(); const numbers = new Set<number>();
    const lines = (Array.isArray(p.lines) ? p.lines.slice(0,100) : []).map((value: unknown, index: number) => {
      const path = `lines[${index}]`;
      const l = object(value, path, ['line_number','external_line_id','product_name','store_product','store_variation_id','customer_sku','shape','print_w_in','print_h_in','quantity','material','material_code','finish','cut','bleed_in','artwork','preview','approval','area_sq_in','note']);
      const chk = (ok: boolean, field: string, code?: string) => check(ok, `${path}.${field}`, code, identifier(l.external_line_id) ? l.external_line_id : undefined);
      chk(identifier(l.external_line_id) && !ids.has(l.external_line_id), 'external_line_id'); ids.add(l.external_line_id);
      chk(Number.isSafeInteger(l.line_number) && l.line_number > 0 && !numbers.has(l.line_number), 'line_number'); numbers.add(l.line_number);
      for (const k of ['store_product','store_variation_id']) chk(identifier(l[k]), k);
      chk(string(l.product_name) && !!l.product_name, 'product_name');
      for (const k of ['note','customer_sku']) chk(l[k] == null || string(l[k]), k);
      for (const k of ['print_w_in','print_h_in','quantity','area_sq_in']) chk(positive(l[k]), k);
      chk(Number.isSafeInteger(l.quantity), 'quantity');
      chk(['circle','oval','square','rectangle','rounded_rect','diecut'].includes(l.shape), 'shape');
      chk(l.material_code === 'white_bopp', 'material_code', 'UNSUPPORTED_MATERIAL');
      chk(l.material === 'White BOPP', 'material'); chk(l.finish === 'gloss', 'finish'); chk(l.bleed_in === 0.125, 'bleed_in');
      const cut = object(l.cut, `${path}.cut`, ['type','method','spot_name','layer_name','in_file']);
      chk(cut.type === 'thru_cut', 'cut.type'); chk(['shape','contour'].includes(cut.method), 'cut.method');
      for (const k of ['spot_name','layer_name']) chk(cut[k] === 'Laser - Thru Cut', `cut.${k}`);
      chk(cut.in_file === true, 'cut.in_file');
      const art = object(l.artwork, `${path}.artwork`, ['filename','format','pages','page_in','trim_in','download_url','artwork_expires_at','artwork_sha256','bytes']);
      chk(string(art.filename) && /^[^/\\\x00-\x1f]+\.pdf$/i.test(art.filename), 'artwork.filename');
      chk(art.format === 'pdf', 'artwork.format'); chk(art.pages === 1, 'artwork.pages');
      chk(Number.isSafeInteger(art.bytes) && art.bytes > 0 && art.bytes <= 25 * 1024 * 1024, 'artwork.bytes');
      chk(hash(art.artwork_sha256), 'artwork.artwork_sha256'); chk(timestamp(art.artwork_expires_at), 'artwork.artwork_expires_at');
      chk(safeSourceUrl(art.download_url), 'artwork.download_url');
      for (const k of ['page_in','trim_in']) {
        const box = object(art[k], `${path}.artwork.${k}`, ['w','h']);
        for (const axis of ['w','h']) chk(positive(box[axis]), `artwork.${k}.${axis}`);
      }
      if (art.trim_in && art.page_in) {
        chk(Math.abs(art.trim_in.w - l.print_w_in) < 1e-9 && Math.abs(art.trim_in.h - l.print_h_in) < 1e-9, 'artwork.trim_in', 'DECLARED_GEOMETRY_MISMATCH');
        chk(Math.abs(art.page_in.w - art.trim_in.w - 2 * l.bleed_in) < 1e-9 && Math.abs(art.page_in.h - art.trim_in.h - 2 * l.bleed_in) < 1e-9, 'artwork.page_in', 'DECLARED_GEOMETRY_MISMATCH');
      }
      // Declared area is rounded to hundredths; this is not a PDF/manufacturing tolerance.
      chk(Math.abs(l.area_sq_in - l.print_w_in * l.print_h_in * l.quantity) <= 0.011, 'area_sq_in', 'DECLARED_AREA_MISMATCH');
      const approval = object(l.approval, `${path}.approval`, ['approved_by','approved_at','artwork_sha256']);
      chk(['auto','operator','customer'].includes(approval.approved_by), 'approval.approved_by');
      chk(timestamp(approval.approved_at), 'approval.approved_at');
      chk(hash(approval.artwork_sha256) && approval.artwork_sha256 === art.artwork_sha256, 'approval.artwork_sha256', 'APPROVAL_HASH_MISMATCH');
      if (l.preview !== undefined) {
        const preview = object(l.preview, `${path}.preview`, ['url','format','expires_at','purpose']);
        chk(safeSourceUrl(preview.url), 'preview.url'); chk(['png','jpg','jpeg'].includes(preview.format), 'preview.format');
        chk(timestamp(preview.expires_at), 'preview.expires_at'); chk(preview.purpose === 'visual reference only', 'preview.purpose');
      }
      return l;
    });
    if (issues.length) throw new IntakeError(422, 'VALIDATION_FAILED', issues);
    const canonical: CanonicalJsonOrder = {
      customer: {customer_id: identity.customer_id, customer_name: identity.customer_name},
      source: {source_system: 'json', source_customer: identity.customer_id, source_record_id: order.order_number,
        source_template: this.schema, submitted_at: p.submitted_at, schema: this.schema, integration_id: identity.integration_id,
        store: account.store, created_at: order.creation_date},
      target: {target_system: 'review-only'},
      order: {external_order_id: `json_${sha256(stableJson([identity.customer_id, identity.integration_id, identity.store, order.order_number]))}`,
        po_number: order.po_number ?? null, order_title: order.order_title, order_note: order.notes ?? null,
        ship_date: order.requested_ship_date || null, order_type_name: order.order_type_name, market: order.market, priority: order.priority,
        shipping: {attention_to: ship.name, company: ship.company ?? null, address_1: ship.line1, address_2: ship.line2 ?? null,
          city: ship.city, state: ship.state, postal_code: ship.postal_code, country: ship.country, phone: ship.phone ?? null, email: ship.email ?? null},
        shipping_policy: {...shipping, label_url: shipping.label_url ?? null, label_precedence: 'prepaid_required_when_supplied', missing_ship_date: 'configured_turnaround'} as CanonicalJsonOrder['order']['shipping_policy']},
      lines: lines.map(l => ({line_number: l.line_number, line_kind: 'print', unit_number: '', customer_sku: l.customer_sku ?? null,
        product_name: l.product_name, quantity: l.quantity, line_note: l.note ?? null,
        dimensions: {final_width: l.print_w_in, final_height: l.print_h_in, bleed: l.bleed_in},
        artwork: {file_name: l.artwork.filename, file_url: l.artwork.download_url, checksum: l.artwork.artwork_sha256},
        production: {material: l.material, material_code: l.material_code, finish: l.finish, cut_type: l.cut.type, shape: l.shape},
        source_line: {external_line_id: l.external_line_id, store_product: l.store_product, store_variation_id: l.store_variation_id,
          artwork: l.artwork, approval: {...l.approval, provider: this.schema}, ...(l.preview ? {preview: l.preview} : {}), cut: l.cut,
          dimensions_unit: 'in', area: {value: l.area_sq_in, unit: 'sq_in', basis: 'bounding_box_times_quantity'}}}))
    };
    // Only explicitly named access metadata and submission time are refreshable. All approval/business fields remain in the digest.
    const business = structuredClone(p);
    delete business.submitted_at;
    for (const l of business.lines) {
      delete l.artwork.download_url; delete l.artwork.artwork_expires_at;
      if (l.preview) { delete l.preview.url; delete l.preview.expires_at; }
    }
    // A prepaid label has no content hash in v1: its URL is deliberately NOT refreshable.
    return {canonical, evidence: structuredClone(p), fingerprint: sha256(stableJson(business))};
  }
};

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stickerPressV1, sha256 } from '../src/json-intake/adapter.js';
import { buildJsonLiftPreview, type LiftPreviewMapping, type LiftPreviewReceipt } from '../src/json-intake/lift-preview.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json', import.meta.url), 'utf8'));
const identity = {customer_id: 'synthetic', customer_name: 'Sticker Press', integration_id: 'synthetic-json', store: 'ltlco', environment: 'test' as const, schema: 'stickerpress.order.v1'};
function receipt(payload = structuredClone(fixture)): LiftPreviewReceipt {
  const adapted = stickerPressV1.validate(payload, identity);
  return {identity, adapted, assets: [], receipt_id: `rcpt_${sha256('synthetic-preview')}`, revision: 0, fingerprint: adapted.fingerprint};
}
function mapping(r: LiftPreviewReceipt): LiftPreviewMapping {
  return {scope: {customer_id: identity.customer_id, integration_id: identity.integration_id, store: identity.store, environment: 'test'},
    revision: 'synthetic-v1', review_reference: 'synthetic-test-only', customer: null, product_identifier: 'lift_unit_number', products: []};
}
function resolved(r: LiftPreviewReceipt): LiftPreviewMapping {
  const m = mapping(r);m.customer = {lift_customer_id: '999999', legal_name: 'Silicon Pasture'};
  const selectors = buildJsonLiftPreview(r,m).evidence.lines.map(l=>l.source_product);
  m.products = [...new Map(selectors.map(s=>[JSON.stringify(s),s])).values()].map((s,i)=>({source:s,target_id:`SYNTHETIC-${i}`,production:{material:'Synthetic substrate',laminate:'Synthetic gloss',cut_type:'Synthetic thru cut'}}));
  return m;
}
test('unmapped four-line preview preserves evidence and fails closed without guessing customer or products',()=>{
  const r=receipt(), before=structuredClone(r), p=buildJsonLiftPreview(r,mapping(r));
  assert.deepEqual(r,before);assert.equal(p.submission_allowed,false);assert.equal(p.candidate.lines.length,4);
  assert.equal(p.candidate.customer.lift_customer_id,undefined);
  assert.ok(p.gaps.some(g=>g.code==='LIFT_CUSTOMER_UNVERIFIED'));
  assert.equal(p.gaps.filter(g=>g.code==='LIFT_PRODUCT_MAPPING_UNRESOLVED').length,4);
  assert.equal(p.candidate.order.ext_id,r.adapted.canonical.order.external_order_id);
  assert.equal(p.candidate.source.source_record_id,fixture.order.order_number);
  for(let i=0;i<4;i++){
    const line=p.candidate.lines[i],e=p.evidence.lines[i],source=fixture.lines[i];
    assert.equal(line.quantity,source.quantity);assert.equal(line.line_note,source.note);
    assert.equal(line.dimensions.final_width,source.print_w_in);assert.equal(line.dimensions.final_height,source.print_h_in);
    assert.deepEqual(e.cut,source.cut);assert.equal(e.approval.artwork_sha256,source.approval.artwork_sha256);
    assert.equal(e.area.value,source.area_sq_in);assert.equal(e.area.basis,'bounding_box_times_quantity');
    assert.equal(e.production?.finish,'gloss');assert.equal(line.artwork?.file_url,undefined);
    assert.equal(e.preview?.reference_only,true);
  }
  assert.equal(p.evidence.shipping.blind_ship,true);assert.equal(p.evidence.shipping.return_address_configured,false);
  assert.equal(p.evidence.shipping.prepaid_label_supplied,false);assert.equal(p.candidate.order.requested_ship_date,undefined);
  assert.equal(p.preview_sha256,buildJsonLiftPreview(r,mapping(r)).preview_sha256);
});
test('exact scoped mappings populate only the selected Lift identifier and reviewed production fields',()=>{
  const r=receipt(),m=resolved(r),p=buildJsonLiftPreview(r,m);
  assert.equal(p.candidate.customer.lift_customer_id,'999999');
  assert.ok(!p.gaps.some(g=>g.code==='LIFT_PRODUCT_MAPPING_UNRESOLVED'));
  assert.equal(p.candidate.lines[2].unit_number,p.candidate.lines[3].unit_number);
  assert.notEqual(p.candidate.lines[0].unit_number,p.candidate.lines[1].unit_number);
  assert.deepEqual(p.candidate.lines[0].production,m.products[0].production);
  assert.equal(p.evidence.lines[0].production?.material,'White BOPP');
  m.product_identifier='lift_product_id';const product=buildJsonLiftPreview(r,m);
  assert.equal(product.candidate.lines[0].product_id,m.products[0].target_id);assert.equal(product.candidate.lines[0].unit_number,'');
  assert.notEqual(product.preview_sha256,p.preview_sha256);assert.equal(product.submission_allowed,false);
  m.products[0].source.finish='matte';assert.ok(buildJsonLiftPreview(r,m).gaps.some(g=>g.code==='LIFT_PRODUCT_MAPPING_UNRESOLVED'));
});
test('cross-tenant, production, unrelated customer and ambiguous mapping configurations are rejected',()=>{
  const r=receipt();
  for(const edit of [
    (m:LiftPreviewMapping)=>m.scope.customer_id='other',
    (m:LiftPreviewMapping)=>m.scope.integration_id='other',
    (m:LiftPreviewMapping)=>m.scope.store='other',
    (m:LiftPreviewMapping)=>(m.scope as any).environment='production',
    (m:LiftPreviewMapping)=>m.customer!.lift_customer_id='284619',
    (m:LiftPreviewMapping)=>m.customer!.lift_customer_id='Silicon Pasture',
    (m:LiftPreviewMapping)=>m.products.push(structuredClone(m.products[0]))
  ]) {const m=resolved(r);edit(m);assert.throws(()=>buildJsonLiftPreview(r,m));}
});
test('access renewal never leaks URLs into preview and prepaid labels cannot turn into purchased shipping',()=>{
  const payload=structuredClone(fixture);payload.shipping.label_url='https://fixtures.example.invalid/label?secret=prepaid';payload.shipping.blind_ship=false;
  const r=receipt(payload);r.adapted.canonical.lines[0].source_line.artwork.download_url+='?secret=art';
  r.adapted.canonical.lines[0].source_line.preview!.url+='?secret=preview';
  const p=buildJsonLiftPreview(r,mapping(r)),raw=JSON.stringify(p);
  for(const forbidden of ['https://','download_url','label_url":','retained_ref','secret='])assert.ok(!raw.includes(forbidden));
  assert.equal(p.evidence.shipping.prepaid_label_supplied,true);assert.equal(p.evidence.shipping.blind_ship,false);
  assert.equal(p.evidence.shipping.label_precedence,'prepaid_required_when_supplied');
  assert.ok(p.gaps.some(g=>g.code==='PREPAID_LABEL_DELIVERY_UNCONFIGURED'));
});
test('retained evidence is line/hash/size bound and metadata flag alone cannot clear metadata review',()=>{
  const r=receipt(),source=r.adapted.canonical.lines[0].source_line;
  r.assets=[{external_line_id:source.external_line_id,sha256:source.artwork.artwork_sha256,bytes:source.artwork.bytes,retained_ref:'/private/synthetic.pdf',inspection:'metadata_pass'}];
  let p=buildJsonLiftPreview(r,resolved(r));assert.equal(p.evidence.lines[0].artwork.approved_original_retained,true);
  assert.ok(p.gaps.some(g=>g.code==='ARTWORK_METADATA_REVIEW_REQUIRED'&&g.field==='lines[0].artwork'));
  assert.ok(!JSON.stringify(p).includes('/private/'));
  assert.equal(p.evidence.lines[0].artwork.inspection,'not_run');
  r.assets[0].inspection_result={sha256:'0'.repeat(64),verdict:'pass'} as any;
  p=buildJsonLiftPreview(r,resolved(r));assert.equal(p.evidence.lines[0].artwork.inspection,'not_run');
  assert.equal(p.evidence.lines[0].artwork.inspection_result,null);
  r.assets[0].sha256='0'.repeat(64);p=buildJsonLiftPreview(r,resolved(r));assert.equal(p.evidence.lines[0].artwork.approved_original_retained,false);
  assert.equal(p.evidence.lines[0].artwork.inspection_result,null);assert.equal(p.submission_allowed,false);
});

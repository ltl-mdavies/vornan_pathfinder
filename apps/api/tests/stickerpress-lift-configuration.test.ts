import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSeedOutputTemplate} from '../src/lift-output-templates.js';
import {createStickerPressLiftConfiguration, buildStickerPressConfiguredPreview} from '../src/json-intake/stickerpress-lift-configuration.js';
import {stickerPressV1} from '../src/json-intake/adapter.js';
import type {OutputRoute} from '../src/store.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const route: OutputRoute={output_route_id:'old',name:'High End Work',target_id:'lift-standard-graphics',
  environment_id:'env-lift-prod',output_template_id:'template-lift-standard-graphics',target_system:'Lift ERP',
  destination_account_name:'Larger Than Life',destination_account_id:'91',company_id:'91',output_template:'Lift High End Work',
  product_identifier_type:'lift_product_id',product_identifier_label:'Lift product_id',submit_profiles:[],
  value_normalization_rules:[],status:'Active',updated_at:'2026-10-16T00:00:00Z'};
function setup(){
  const payload=structuredClone(fixture);
  payload.order.po_number='ANDY-PO';
  payload.lines.forEach((line:any)=>{line.material='White Bopp (Sticker)';line.finish='Gloss Laminate (.75 mil)';delete line.material_code;});
  const identity={customer_id:'174094',customer_name:'Silicone Pasture',integration_id:'stickerpress-sandbox',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
  const adapted=stickerPressV1.validate(payload,identity);
  const receipt={identity,adapted,receipt_id:'test-only',revision:1,fingerprint:adapted.fingerprint,assets:[]};
  const base=createSeedOutputTemplate();
  base.canonical_mappings.find(m=>m.sourceColumn==='body:order.po_number')!.targetField='order.contract_number';
  const config={...createStickerPressLiftConfiguration(base,route),order_date_format:'MM/DD/YYYY' as const};
  return {payload,receipt,base,config};
}
test('separate draft preserves the existing template and connection while correcting only its own PO mapping',()=>{
  const {base}=setup(),before=structuredClone({base,route});
  const config=createStickerPressLiftConfiguration(base,{...route,customer_id:'284619'} as OutputRoute);
  assert.deepEqual({base,route},before);
  assert.equal(config.template.name,'Lift Ecomm Orders');assert.equal(config.template.status,'Draft');
  assert.equal(config.route.status,'Draft');assert.equal(config.route.environment_id,route.environment_id);
  assert.deepEqual(config.route.submit_profiles,route.submit_profiles);
  assert.ok(!('customer_id' in config.route));
  assert.equal(config.template.canonical_mappings.find(m=>m.sourceColumn==='body:order.po_number')!.targetField,'order.po_number');
  assert.equal(base.canonical_mappings.find(m=>m.sourceColumn==='body:order.po_number')!.targetField,'order.contract_number');
});
test('every line maps to the single Lift product without source variation, material code, price or artwork mutation',()=>{
  const {receipt,config,payload}=setup(),before=structuredClone(receipt);
  const preview=buildStickerPressConfiguredPreview(receipt,config);
  assert.deepEqual(receipt,before);assert.equal(preview.submission_allowed,false);
  assert.equal(preview.payload.customer.lift_customer_id,'174094');assert.equal(preview.payload.order.po_number,'ANDY-PO');
  assert.equal(preview.payload.order.ext_id,receipt.adapted.canonical.order.external_order_id);
  preview.payload.lines.forEach((line:any,i)=>{
    assert.equal(line.product_id,'374549');assert.equal(line.product_name,'Sticker Press Sticker');
    assert.equal(line.description,payload.lines[i].product_name);assert.equal(line.external_line_id,payload.lines[i].external_line_id);
    assert.equal(line.quantity,payload.lines[i].quantity);assert.equal(line.production.material,payload.lines[i].material);
    assert.equal(line.production.laminate,payload.lines[i].finish);assert.equal(line.cut.shape,payload.lines[i].shape);
    assert.equal(line.cut.type,payload.lines[i].cut.type);assert.equal(line.artwork.checksum,payload.lines[i].artwork.artwork_sha256);
    assert.ok(!line.artwork.file_url);assert.equal(line.pricing.customer_price,null);
  });
  assert.ok(!JSON.stringify(preview).includes('download_url'));
  assert.equal(preview.validation.filter(v=>v.severity==='FAIL').length,0);
});
test('single product binding rejects other customers, integrations, environments, routes and mismatched products',()=>{
  for(const change of [
    (x:ReturnType<typeof setup>)=>{x.receipt.identity.customer_id='284619';},
    (x:ReturnType<typeof setup>)=>{x.receipt.identity.integration_id='other';},
    (x:ReturnType<typeof setup>)=>{x.receipt.identity.environment='production' as any;},
    (x:ReturnType<typeof setup>)=>{x.config.route.output_route_id='old';},
    (x:ReturnType<typeof setup>)=>{x.config.product.lift_product_id='999';}
  ]){const x=setup();change(x);assert.throws(()=>buildStickerPressConfiguredPreview(x.receipt,x.config));}
});

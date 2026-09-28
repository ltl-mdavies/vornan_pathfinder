import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonicalFieldRegistry, ecommerceOutputFields } from '@pathfinder/canonical';
import { generateLiftPayload, projectLiftEcommercePayload, LIFT_ECOMMERCE_TEMPLATE_ID } from '@pathfinder/lift-adapter';
import { createSeedOutputTemplate, createLiftEcommerceOutputTemplate } from '../src/lift-output-templates.js';
import { stickerPressV1 } from '../src/json-intake/adapter.js';
const timestamp='2026-09-28T00:00:00.000Z';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
function canonical() {return stickerPressV1.validate(fixture,{customer_id:'synthetic',customer_name:'Sticker Press',integration_id:'synthetic-json',store:'ltlco',environment:'test',schema:'stickerpress.order.v1'}).canonical;}

test('clone is a separate Draft with core mappings, neutral tokens and complete registered expansion',()=>{
  const base=createSeedOutputTemplate(timestamp),before=structuredClone(base),clone=createLiftEcommerceOutputTemplate(base,timestamp);
  assert.deepEqual(base,before);assert.equal(base.status,'Active');assert.equal(clone.status,'Draft');assert.equal(clone.name,'Lift E-commerce Orders');
  assert.equal(clone.output_template_id,LIFT_ECOMMERCE_TEMPLATE_ID);assert.equal(clone.destination_method,base.destination_method);
  const mapped=new Set(clone.canonical_mappings.map(m=>m.sourceColumn));
  for(const m of base.canonical_mappings)assert.ok(mapped.has(m.sourceColumn));
  assert.equal(new Set(clone.canonical_mappings.map(m=>m.sourceColumn)).size,clone.canonical_mappings.length);
  const registered=new Set(canonicalFieldRegistry.map(f=>f.path));
  assert.equal(registered.size,canonicalFieldRegistry.length);
  for(const [output,path] of ecommerceOutputFields) {assert.ok(registered.has(path));assert.ok(mapped.has(`body:${output}`));assert.equal(canonicalFieldRegistry.find(f=>f.path===path)?.required,false);}
  assert.ok(!clone.body_template.includes('Momentara'));assert.ok(!clone.header_template.includes('_TBD'));
  assert.equal(clone.canonical_mappings.find(m=>m.sourceColumn==='body:lines[].product_id')?.required,true);
  assert.equal(clone.canonical_mappings.find(m=>m.sourceColumn==='body:lines[].unit_number')?.required,false);
  assert.equal(JSON.parse(clone.header_template).Ext_ID,'{{order.external_order_id}}');
});
test('cloning preserves reviewed custom base output mappings and cannot repurpose a different template',()=>{
  const base=createSeedOutputTemplate(timestamp);const body=JSON.parse(base.body_template);body.order.FLEX_FIELD9='example';
  base.body_template=JSON.stringify(body);base.canonical_mappings.push({sourceColumn:'body:order.FLEX_FIELD9',targetField:'order.artwork_folder_url',required:false});
  const clone=createLiftEcommerceOutputTemplate(base,timestamp);assert.equal(JSON.parse(clone.body_template).order.FLEX_FIELD9,'{{order.artwork_folder_url}}');
  assert.throws(()=>createLiftEcommerceOutputTemplate({...base,output_template_id:'template-thinkdifferentprint-order'}));
});
test('explicit projection preserves all four lines, numeric and boolean values, approval and source/target distinctions',()=>{
  const source=canonical();source.order.shipping_policy.blind_ship=false;
  const base=generateLiftPayload(source),before=structuredClone(base);base.lines[0].production!.material='Reviewed target material';
  const result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,base,source) as any;
  assert.equal(result.order.shipping_policy.blind_ship,false);assert.equal(result.lines.length,4);
  assert.equal(result.lines[0].production.material,'Reviewed target material');assert.equal(result.lines[0].production.material_code,'white_bopp');
  assert.equal(result.lines[0].artwork.pages,1);assert.equal(result.lines[0].cut.in_file,true);
  assert.equal(result.lines[0].area.value,171.13);assert.equal(result.lines[0].area.basis,'bounding_box_times_quantity');
  assert.equal(result.lines[2].dimensions.final_height,0.978);assert.equal(result.lines[0].approval.artwork_sha256,source.lines[0].source_line.approval.artwork_sha256);
  assert.equal(result.lines[0].external_line_id,fixture.lines[0].external_line_id);
  assert.equal(result.lines[0].preview.file_url,undefined);assert.equal(result.order.shipping_policy.prepaid_label_url,undefined);
  assert.equal((before.lines[0] as any).cut,undefined);assert.equal((base.lines[0] as any).cut,undefined);
  assert.equal(generateLiftPayload(source).lines[0].production?.material,'White BOPP');
  assert.throws(()=>projectLiftEcommercePayload('template-lift-standard-graphics',base,source));
  const wrong=structuredClone(source);wrong.lines.reverse();assert.throws(()=>projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,base,wrong));
});
test('published document fields are separate from expiring source access URLs',()=>{
  const source=canonical();source.order.shipping_policy.label_url='https://source.invalid/label?private=1';
  source.order.document_delivery={prepaid_label_url:'https://example.invalid/reviewed-label.pdf'};
  source.lines[0].document_delivery={preview_url:'https://example.invalid/reviewed-preview.png'};
  const result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source) as any;
  assert.equal(result.order.shipping_policy.prepaid_label_url,source.order.document_delivery.prepaid_label_url);
  assert.equal(result.lines[0].preview.file_url,source.lines[0].document_delivery.preview_url);
  assert.ok(!JSON.stringify(result).includes('private=1'));
  assert.equal(result.order.shipping_policy.prepaid_label_supplied,true);
});

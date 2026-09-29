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
  source.lines[0].dimensions.live_height=1.5;source.lines[0].dimensions.live_width=1.6;source.lines[0].customer_sku='TEST-SKU';
  source.lines[0].production!.cut_complexity='1/8 inch radius corners';
  source.lines[0].production!.application_type='source-only';
  const base=generateLiftPayload(source),before=structuredClone(base);base.lines[0].production!.material='Reviewed target material';
  const result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,base,source) as any;
  assert.equal(result.order.shipping_policy.blind_ship,false);assert.equal(result.lines.length,4);
  assert.equal(result.lines[0].production.material,'Reviewed target material');assert.equal(result.lines[0].production.material_code,undefined);
  assert.equal(result.lines[0].production.laminate,'gloss');
  assert.equal(result.lines[0].cut.shape,'square');
  assert.equal(result.lines[0].production.cut_type,undefined);
  assert.equal(result.lines[0].cut.complexity,'1/8 inch radius corners');
  assert.equal(result.lines[0].customer_sku,'TEST-SKU');assert.equal(result.lines[0].sku,undefined);
  assert.equal(result.lines[0].product_id,null);assert.equal(result.lines[0].description,null);
  assert.equal(result.order.order_type_name,undefined);
  assert.equal(result.order.due_date,null);
  assert.equal(result.lines[0].dimensions.live_height,1.5);assert.equal(result.lines[0].dimensions.live_width,1.6);
  assert.deepEqual(Object.keys(result.lines[0].dimensions).slice(0,5),['final_height','final_width','live_height','live_width','bleed']);
  assert.deepEqual(Object.keys(result.lines[0].production).slice(0,3),['material','laminate','varnish']);
  assert.deepEqual(Object.keys(result.lines[0]).slice(0,4),['line_number','unit_number','product_id','customer_sku']);
  assert.equal(result.lines[0].production.shape,undefined);
  assert.equal(result.lines[0].production.application_type,undefined);
  assert.equal(source.lines[0].production!.application_type,'source-only');
  assert.equal(result.lines[0].artwork.pages,1);assert.equal(result.lines[0].cut.in_file,true);
  assert.equal(result.lines[0].area.unit,undefined);assert.equal(result.lines[0].dimensions.unit,undefined);
  assert.equal(result.lines[0].area.value,171.13);assert.equal(result.lines[0].area.basis,'bounding_box_times_quantity');
  assert.equal(result.lines[2].dimensions.final_height,0.978);assert.equal(result.lines[0].approval.artwork_sha256,undefined);
  assert.equal(result.lines[0].artwork.checksum,source.lines[0].source_line.approval.artwork_sha256);
  const mismatched=structuredClone(source);mismatched.lines[0].source_line.approval.artwork_sha256='0'.repeat(64);
  assert.throws(()=>projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,base,mismatched),/Approved artwork/);
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

test('standard ecommerce orders use High End Work dimensions/artwork without Andy evidence, with visible unmapped pricing',()=>{
  const source:any=canonical();delete source.order.shipping_policy;
  for(const line of source.lines)delete line.source_line;
  const base=generateLiftPayload(source),result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,base,source) as any;
  assert.deepEqual(result.lines[0].artwork,base.lines[0].artwork);
  assert.deepEqual(result.lines[0].dimensions,{...base.lines[0].dimensions,live_height:null,live_width:null});
  assert.deepEqual(result.customer,base.customer);
  assert.equal(result.order.pricing.currency,null);assert.equal(result.order.pricing.total,null);
  assert.equal(result.lines[0].pricing.customer_price,null);assert.equal(result.lines[0].approval,undefined);
  assert.equal(result.order.requested_ship_date,null);
  const invalid=structuredClone(fixture);delete invalid.lines[0].approval;
  assert.throws(()=>stickerPressV1.validate(invalid,{customer_id:'synthetic',customer_name:'Sticker Press',integration_id:'synthetic-json',store:'ltlco',environment:'test',schema:'stickerpress.order.v1'}));
});
test('billing, payment and decimal price precision survive projection without inventing totals or currency',()=>{
  const source=canonical();source.order.billing={first_name:'Test',last_name:'Buyer',address_2:null,country:'US',address_book_reference:'primary'};
  source.order.pricing={subtotal:'0.00000',shipping:'0',total:null};
  source.order.payment={method:'Use My Account',authorized_amount:null,charged_amount:'0.00'};
  source.order.coupons=[{code:'SYNTHETIC',amount:'0.00'}];
  source.lines[0].pricing={item_base_price:'0.08000',customer_price:'0.10900'};
  source.lines[0].proof_status='pending';source.order.due_date='2026-12-15';
  source.lines[0].sample=false;source.lines[1].sample=null;source.lines[0].production!.white_ink_required=false;
  const result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source) as any;
  assert.equal(result.order.pricing.currency,null);assert.equal(result.order.pricing.total,null);
  assert.equal(result.order.pricing.subtotal,'0.00000');assert.equal(result.order.pricing.shipping,'0');
  assert.equal(result.lines[0].pricing.customer_price,'0.10900');
  assert.equal(result.lines[0].pricing.item_base_price,'0.08000');
  assert.equal(result.lines[0].pricing.unit_price,undefined);assert.equal(result.lines[0].pricing.markup_price,undefined);assert.equal(result.lines[0].sample,false);
  assert.equal(result.lines[0].approval.proof_status,'pending');assert.equal(result.lines[0].proof_status,undefined);
  assert.equal(result.order.due_date,'2026-12-15');
  const orderKeys=Object.keys(result.order);assert.equal(orderKeys[orderKeys.indexOf('requested_ship_date')+1],'due_date');
  assert.equal(result.lines[1].sample,null);assert.equal(result.lines[2].sample,undefined);
  assert.equal(result.lines[0].production.white_ink_required,false);
  assert.deepEqual(result.order.billing,source.order.billing);assert.equal(result.order.billing.email,undefined);
  assert.deepEqual(result.order.payment,source.order.payment);assert.deepEqual(result.order.coupons,source.order.coupons);
});
test('roll diameter and label count enforce distinct measurement and quantity semantics',()=>{
  const source=canonical();source.lines[0].roll_finishing={specification:'max_roll_diameter',value:14,unwind_direction:'3-Right',spacing:0.125};
  source.lines[1].roll_finishing={specification:'max_labels_per_roll',value:500};
  let result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source) as any;
  assert.deepEqual(result.lines[0].roll_finishing,source.lines[0].roll_finishing);assert.deepEqual(result.lines[1].roll_finishing,source.lines[1].roll_finishing);
  source.lines[0].roll_finishing!.unit='in';source.lines[0].roll_finishing!.spacing_unit='in';
  result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source) as any;
  assert.equal(result.lines[0].roll_finishing.unit,undefined);assert.equal(result.lines[0].roll_finishing.spacing_unit,undefined);
  for(const roll of [
    {specification:'max_labels_per_roll',value:10.5,unit:'labels'},
    {specification:'max_labels_per_roll',value:10,unit:'in'},
    {specification:'max_roll_diameter',value:14,unit:'labels'},
    {specification:'max_roll_diameter',value:0,unit:'in'},
    {specification:'unknown',value:14,unit:'in'},
    {specification:'max_roll_diameter',value:14,unit:'mm',spacing:0.125},
    {specification:'max_roll_diameter',value:14,spacing:0.125,spacing_unit:'mm'}
  ]) {source.lines[0].roll_finishing=roll as any;assert.throws(()=>projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source));}
});
test('invalid money and unrecognized XML passthrough fields cannot silently enter the export',()=>{
  const source:any=canonical();source.lines[0].Product_Variation='excluded';source.lines[0].Non_variation_attributes='excluded';source.lines[0].login_link='excluded';
  source.lines[0].Custom_Area_Price='99';source.lines[0].Original_Price='99';
  const result=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source);
  for(const field of ['Product_Variation','Non_variation_attributes','login_link','Custom_Area_Price','Original_Price'])assert.ok(!JSON.stringify(result).includes(field));
  for(const value of [0.109,'1e3','-0.01','NaN','']){
    source.lines[0].pricing={customer_price:value};assert.throws(()=>projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source));
  }
});

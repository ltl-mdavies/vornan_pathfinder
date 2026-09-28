/** E-commerce output layout only. Source evidence and the High End Work contract are unchanged. */
export function organizeEcommerceLine(input: Record<string, any>): Record<string, any> {
  const line=structuredClone(input);
  line.customer_sku=line.customer_sku ?? line.sku ?? null;
  delete line.sku;
  line.product_id ??= null;
  line.description ??= null;
  if(Object.hasOwn(line,'proof_status')) {
    line.approval ??= {};
    line.approval.proof_status=line.proof_status;
    delete line.proof_status;
  }
  if(line.approval)delete line.approval.artwork_sha256;
  const production=line.production ?? {};
  const cut=line.cut ?? {};
  cut.type=production.cut_type ?? cut.type;
  if(!('shape' in cut))cut.shape=production.shape;
  if(!('complexity' in cut))cut.complexity=production.cut_complexity;
  if(!('die_reference' in cut))cut.die_reference=production.die_reference;
  production.laminate=production.laminate ?? production.finish ?? null;
  for(const key of ['cut_type','shape','cut_complexity','die_reference','corner_description','material_code','finish','application_type'])delete production[key];
  delete cut.corner_description;
  const ordered=(object:Record<string,any>,keys:string[])=>Object.fromEntries([
    ...keys.filter(k=>object[k]!==undefined).map(k=>[k,object[k]]),
    ...Object.entries(object).filter(([k,v])=>!keys.includes(k)&&v!==undefined)
  ]);
  if(line.roll_finishing) {delete line.roll_finishing.unit;delete line.roll_finishing.spacing_unit;}
  if(line.area)delete line.area.unit;
  if(line.pricing) {delete line.pricing.unit_price;delete line.pricing.markup_price;}
  const dimensions=line.dimensions ?? {};
  delete dimensions.unit;
  dimensions.live_height ??= null;dimensions.live_width ??= null;
  line.dimensions=ordered(dimensions,['final_height','final_width','live_height','live_width','bleed']);
  production.material ??= null;production.varnish ??= null;
  line.production=ordered(production,['material','laminate','varnish','coating','premask','ink','white_ink_required','orientation']);
  line.cut=ordered(cut,['type','shape','complexity','die_reference','method','spot_name','layer_name','in_file']);
  return ordered(line,['line_number','unit_number','product_id','customer_sku','product_name','description','quantity',
    'external_line_id','store_product','store_variation_id','dimensions','production','cut','roll_finishing',
    'artwork','approval','preview','area','pricing','sample','line_note']);
}

export function organizeEcommerceOrder(input:Record<string,unknown>):Record<string,unknown> {
  input={...input};
  delete input.order_type_name;
  input.requested_ship_date ??= null;
  input.due_date ??= null;
  const keys=['ext_id','order_title','po_number','contract_number','reference_number',
    'source_status','market','priority','requested_ship_date','due_date','order_note','account_rep','invoice_email',
    'billing','shipping','shipping_policy','order_attachment','artwork_folder_url','reference_proof_url','pricing','payment','coupons'];
  return Object.fromEntries([...keys.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]),
    ...Object.entries(input).filter(([k])=>!keys.includes(k))]);
}

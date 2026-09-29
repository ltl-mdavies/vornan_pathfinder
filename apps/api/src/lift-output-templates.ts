import { ecommerceOutputFields } from '@pathfinder/canonical';
import { LIFT_ECOMMERCE_TEMPLATE_ID, organizeEcommerceLine, organizeEcommerceOrder } from '@pathfinder/lift-adapter';
import type { OutputTemplate } from './store.js';

export function createSeedOutputTemplate(timestamp = new Date().toISOString()): OutputTemplate {
  return {
    output_template_id: "template-lift-standard-graphics",
    name: "Lift High End Work",
    destination_method: "HTTP POST",
    output_format: "JSON",
    body_template: JSON.stringify(
      {
        customer: {
          lift_customer_id: "LIFT_CUSTOMER_ID_TBD",
          customer_name: "Momentara",
          crm_id: "CRM-EXAMPLE-001"
        },
        contacts: [
          {
            first_name: "Jane",
            last_name: "Smith",
            title: "Marketing Manager",
            email: "jane.smith@example.com",
            mobile_phone: "555-555-0101",
            office_phone: "555-555-0100",
            home_phone: null,
            slack: "@jane.smith",
            fax: null
          }
        ],
        source: {
          platform: "Pathfinder",
          pathfinder_customer_id: "customer_momentara",
          source_system: "Manual Upload",
          source_customer: "Momentara",
          source_record_id: "AS360-30904511",
          source_record_url: null,
          source_template: "Momentara OOH Order Form",
          submitted_at: "2026-06-18T14:32:00-04:00",
          pathfinder_job_id: "job_20260618_000001",
          pathfinder_canonical_order_id: "co_20260618_000001"
        },
        order: {
          ext_id: "AS360-30904511",
          po_number: "1122334455",
          contract_number: "1122334455",
          order_title: "Campaign",
          order_note: "Optional order-level production note.",
          requested_ship_date: "06/23/2026",
          due_date: "06/24/2026",
          order_attachment: "https://example.com/imports/momentara-order.xlsx",
          artwork_folder_url: "https://example.com/artwork/momentara-order",
          reference_proof_url: "https://go.vornan.co/d/example/reference-proof.pdf",
          shipping: {
            method: "UPS Ground",
            account_number: null,
            acct_billing_zip: "45202",
            acct_billing_country: "US",
            attention_to: "Jane Smith",
            company: "Example Company",
            address_1: "123 Main St",
            address_2: "Suite 200",
            city: "Cincinnati",
            state: "OH",
            postal_code: "45202",
            country: "US",
            phone: "555-555-0100",
            email: "jane.smith@example.com",
            instructions: "Deliver to receiving dock."
          }
        },
        lines: [
          {
            line_number: 1,
            unit_number: "2SHEET_46x60_48PT",
            customer_sku: "OOH-2SHEET-46X60",
            description: "2 Sheet Poster",
            product_id: "PROD-2SHEET-POSTER",
            product_name: "2 Sheet Poster",
            quantity: 1,
            artwork: {
              file_name: "momentara_campaign_art.pdf",
              file_url: "https://example.com/artwork/momentara_campaign_art.pdf",
              checksum: null
            },
            dimensions: {
              final_height: 46.2,
              final_width: 60.2,
              live_height: 43,
              live_width: 57,
              bleed: 0.125
            },
            production: {
              material: "15pt Styrene",
              laminate: "8520",
              coating: "N",
              premask: "N",
              ink: "4CP/0",
              cut_type: "Square Cut"
            },
            line_note: "Optional line-level production note."
          }
        ]
      },
      null,
      2
    ),
    header_template: JSON.stringify(
      {
        "Content-Type": "application/json",
        Ext_ID: "AS360-30904511",
        User: "LIFT_IMPORT_USERNAME_TBD",
        Password: "LIFT_IMPORT_PASSWORD_TBD",
        Company: "91"
      },
      null,
      2
    ),
    canonical_mappings: [
      { sourceColumn: "body:customer.lift_customer_id", targetField: "customer.lift_customer_id", required: true },
      { sourceColumn: "body:customer.customer_name", targetField: "customer.name", required: false },
      { sourceColumn: "body:customer.crm_id", targetField: "customer.crm_id", required: false },
      { sourceColumn: "body:contacts[].first_name", targetField: "contacts[].first_name", required: false },
      { sourceColumn: "body:contacts[].last_name", targetField: "contacts[].last_name", required: false },
      { sourceColumn: "body:contacts[].title", targetField: "contacts[].title", required: false },
      { sourceColumn: "body:contacts[].email", targetField: "contacts[].email", required: false },
      { sourceColumn: "body:contacts[].mobile_phone", targetField: "contacts[].mobile_phone", required: false },
      { sourceColumn: "body:contacts[].office_phone", targetField: "contacts[].office_phone", required: false },
      { sourceColumn: "body:contacts[].home_phone", targetField: "contacts[].home_phone", required: false },
      { sourceColumn: "body:contacts[].slack", targetField: "contacts[].slack", required: false },
      { sourceColumn: "body:contacts[].fax", targetField: "contacts[].fax", required: false },
      { sourceColumn: "body:source.pathfinder_customer_id", targetField: "customer.id", required: false },
      { sourceColumn: "body:source.source_customer", targetField: "source.source_customer", required: false },
      { sourceColumn: "body:source.source_record_id", targetField: "source.source_record_id", required: false },
      { sourceColumn: "body:source.source_record_url", targetField: "source.source_record_url", required: false },
      { sourceColumn: "body:source.source_template", targetField: "source.source_template", required: false },
      { sourceColumn: "body:source.submitted_at", targetField: "source.submitted_at", required: false },
      { sourceColumn: "body:source.pathfinder_job_id", targetField: "generated.pathfinder_job_id", required: false },
      { sourceColumn: "body:order.ext_id", targetField: "order.external_order_id", required: true },
      { sourceColumn: "body:order.po_number", targetField: "order.po_number", required: false },
      { sourceColumn: "body:order.contract_number", targetField: "order.contract_number", required: false },
      { sourceColumn: "body:order.order_title", targetField: "order.order_title", required: false },
      { sourceColumn: "body:order.order_note", targetField: "order.order_note", required: false },
      { sourceColumn: "body:order.requested_ship_date", targetField: "order.ship_date", required: false },
      { sourceColumn: "body:order.due_date", targetField: "order.due_date", required: false },
      { sourceColumn: "body:order.order_attachment", targetField: "order.order_attachment", required: false },
      { sourceColumn: "body:order.artwork_folder_url", targetField: "order.artwork_folder_url", required: false },
      { sourceColumn: "body:order.reference_proof_url", targetField: "order.reference_proof_url", required: false },
      { sourceColumn: "body:order.shipping.method", targetField: "order.shipping.method", required: false },
      { sourceColumn: "body:order.shipping.acct_billing_zip", targetField: "order.shipping.acct_billing_zip", required: false },
      { sourceColumn: "body:order.shipping.acct_billing_country", targetField: "order.shipping.acct_billing_country", required: false },
      { sourceColumn: "body:lines[].line_number", targetField: "lines[].line_number", required: false },
      { sourceColumn: "body:lines[].unit_number", targetField: "lines[].unit_number", required: true },
      { sourceColumn: "body:lines[].customer_sku", targetField: "lines[].customer_sku", required: false },
      { sourceColumn: "body:lines[].description", targetField: "lines[].description", required: false },
      { sourceColumn: "body:lines[].product_id", targetField: "lines[].product_id", required: false },
      { sourceColumn: "body:lines[].product_name", targetField: "lines[].product_name", required: false },
      { sourceColumn: "body:lines[].quantity", targetField: "lines[].quantity", required: true },
      { sourceColumn: "body:lines[].artwork.file_name", targetField: "lines[].artwork.file_name", required: false },
      { sourceColumn: "body:lines[].artwork.file_url", targetField: "lines[].artwork.file_url", required: false },
      { sourceColumn: "body:lines[].artwork.checksum", targetField: "lines[].artwork.checksum", required: false },
      { sourceColumn: "body:lines[].dimensions.final_height", targetField: "lines[].dimensions.final_height", required: false },
      { sourceColumn: "body:lines[].dimensions.final_width", targetField: "lines[].dimensions.final_width", required: false },
      { sourceColumn: "body:lines[].dimensions.live_height", targetField: "lines[].dimensions.live_height", required: false },
      { sourceColumn: "body:lines[].dimensions.live_width", targetField: "lines[].dimensions.live_width", required: false },
      { sourceColumn: "body:lines[].dimensions.bleed", targetField: "lines[].dimensions.bleed", required: false },
      { sourceColumn: "body:lines[].production.material", targetField: "lines[].production.material", required: false },
      { sourceColumn: "body:lines[].production.laminate", targetField: "lines[].production.laminate", required: false },
      { sourceColumn: "body:lines[].production.coating", targetField: "lines[].production.coating", required: false },
      { sourceColumn: "body:lines[].production.premask", targetField: "lines[].production.premask", required: false },
      { sourceColumn: "body:lines[].production.ink", targetField: "lines[].production.ink", required: false },
      { sourceColumn: "body:lines[].line_note", targetField: "lines[].line_note", required: false },
      { sourceColumn: "header:Ext_ID", targetField: "order.external_order_id", required: true },
      { sourceColumn: "header:User", targetField: "environment.credentials.User", required: true },
      { sourceColumn: "header:Password", targetField: "environment.credentials.Password", required: true },
      { sourceColumn: "header:Company", targetField: "environment.headers.Company", required: true }
    ],
    filename_format: "orders-%y-%m-%d-%h-%i-%s.json",
    status: "Active",
    updated_at: timestamp
  };
}


/** Explicit clone operation only. Never called by target reads, normalization, bootstrap or save. */
export function createLiftEcommerceOutputTemplate(base: OutputTemplate, timestamp = new Date().toISOString()): OutputTemplate {
  if (base.output_template_id !== 'template-lift-standard-graphics' || base.output_format !== 'JSON') {
    throw new Error('Clone the reviewed Lift High End Work JSON template');
  }
  const template = structuredClone(base);
  const body = JSON.parse(template.body_template);
  if (!body.order || !Array.isArray(body.lines) || body.lines.length !== 1) throw new Error('Unsupported base template structure');
  const aliases: Record<string,string> = {'customer.lift_customer_id':'customer.destination_customer_id','customer.name':'customer.customer_name','customer.id':'customer.customer_id'};
  template.canonical_mappings = template.canonical_mappings.map(m => ({...m,targetField:aliases[m.targetField] ?? m.targetField}));
  const set = (path:string, value:unknown) => {
    const parts=path.replace('lines[].','lines.0.').split('.');
    let current=body;
    for(const key of parts.slice(0,-1)) current=current[key] ??= {};
    current[parts.at(-1)!]=value;
  };
  // Preserve all original fields but replace sample customer/order values with canonical tokens.
  const walk = (value:Record<string,unknown>, prefix='') => {
    for(const [key,child] of Object.entries(value)) {
      const path=prefix ? `${prefix}.${key}` : key;
      if(Array.isArray(child)) {if(child[0]) walk(child[0] as Record<string,unknown>,`${path}[]`);}
      else if(child && typeof child==='object') walk(child as Record<string,unknown>,path);
      else {
        const mapping=template.canonical_mappings.find(m=>m.sourceColumn===`body:${path}`);
        if(path==='source.platform'){value[key]='Pathfinder';continue;}
        const canonical=mapping?.targetField ?? (path==='source.pathfinder_canonical_order_id'?'generated.pathfinder_canonical_order_id':path);
        value[key]=`{{${canonical}}}`;
        if(!mapping)template.canonical_mappings.push({sourceColumn:`body:${path}`,targetField:canonical,required:false});
      }
    }
  };
  walk(body);
  for(const [output,canonical] of ecommerceOutputFields) {
    set(output,`{{${canonical}}}`);
    template.canonical_mappings=template.canonical_mappings.filter(m=>m.sourceColumn!==`body:${output}`);
    template.canonical_mappings.push({sourceColumn:`body:${output}`,targetField:canonical,required:false});
  }
  body.order=organizeEcommerceOrder(body.order);
  body.lines=body.lines.map((line:Record<string,unknown>)=>organizeEcommerceLine(line));
  const moved:Record<string,string>={
    'body:lines[].sku':'body:lines[].customer_sku',
    'body:lines[].proof_status':'body:lines[].approval.proof_status',
    'body:lines[].production.cut_type':'body:lines[].cut.type',
    'body:lines[].production.shape':'body:lines[].cut.shape',
    'body:lines[].production.cut_complexity':'body:lines[].cut.complexity',
    'body:lines[].production.die_reference':'body:lines[].cut.die_reference'
  };
  const removed=new Set(['body:lines[].pricing.unit_price','body:lines[].pricing.markup_price','body:lines[].roll_finishing.unit','body:lines[].roll_finishing.spacing_unit','body:lines[].dimensions.unit','body:lines[].area.unit','body:lines[].production.application_type','body:lines[].approval.artwork_sha256','body:order.order_type_name','body:lines[].production.material_code','body:lines[].production.finish','body:lines[].production.corner_description']);
  template.canonical_mappings=Array.from(new Map(template.canonical_mappings.filter(m=>!removed.has(m.sourceColumn))
    .map(m=>{const mapping={...m,sourceColumn:moved[m.sourceColumn]??m.sourceColumn};return [mapping.sourceColumn,mapping] as const;})).values());
  const required = new Set(['body:lines[].product_id','body:lines[].line_number','body:lines[].artwork.file_name',
    'body:lines[].artwork.file_url','body:lines[].dimensions.final_height',
    'body:lines[].dimensions.final_width','body:lines[].dimensions.bleed','body:order.order_title']);
  template.canonical_mappings=template.canonical_mappings.map(m=>m.sourceColumn==='body:lines[].unit_number'?{...m,required:false}:required.has(m.sourceColumn)?{...m,required:true}:m);
  const headers=JSON.parse(template.header_template);
  for(const m of template.canonical_mappings.filter(m=>m.sourceColumn.startsWith('header:'))) headers[m.sourceColumn.slice(7)]=`{{${m.targetField}}}`;
  return {...template,output_template_id:LIFT_ECOMMERCE_TEMPLATE_ID,name:'Lift E-commerce Orders',status:'Draft',
    body_template:JSON.stringify(body,null,2),header_template:JSON.stringify(headers,null,2),updated_at:timestamp};
}

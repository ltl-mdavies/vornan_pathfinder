import { ecommerceOutputFields, type CanonicalJsonOrder } from '@pathfinder/canonical';
import type { LiftOrderPayload } from './index.js';
export const LIFT_ECOMMERCE_TEMPLATE_ID = 'template-lift-ecommerce-orders';

/** Dedicated opt-in projection; no generic runtime mapping behavior is changed. */
export function projectLiftEcommercePayload(templateId:string, base:LiftOrderPayload, source:CanonicalJsonOrder):LiftOrderPayload {
  if(templateId!==LIFT_ECOMMERCE_TEMPLATE_ID)throw new Error('E-commerce projection requires its explicit template');
  if(base.lines.length!==source.lines.length || base.order.ext_id!==source.order.external_order_id ||
    base.source.pathfinder_customer_id!==source.customer.customer_id || base.source.source_record_id!==source.source.source_record_id ||
    base.lines.some((line,i)=>line.line_number!==source.lines[i].line_number || line.quantity!==source.lines[i].quantity || line.artwork?.checksum!==source.lines[i].source_line.artwork.artwork_sha256)) {
    throw new Error('E-commerce source and target identity mismatch');
  }
  const result=structuredClone(base);
  source=structuredClone(source);
  source.order.shipping_policy.prepaid_label_supplied=Boolean(source.order.shipping_policy.label_url);
  const read=(obj:unknown,path:string):unknown=>path.split('.').reduce<unknown>((v,key)=>v && typeof v==='object'?(v as Record<string,unknown>)[key]:undefined,obj);
  const write=(obj:unknown,path:string,value:unknown)=>{
    const keys=path.split('.');let target=obj as Record<string,unknown>;
    for(const key of keys.slice(0,-1))target=(target[key]??={}) as Record<string,unknown>;
    target[keys.at(-1)!]=structuredClone(value);
  };
  for(const [output,canonical] of ecommerceOutputFields) {
    if(output.startsWith('lines[].'))source.lines.forEach((line,i)=>{
      const value=read(line,canonical.slice('lines[].'.length));
      if(value!==undefined)write(result.lines[i],output.slice('lines[].'.length),value);
    });
    else {const value=read(source,canonical);if(value!==undefined)write(result,output,value);}
  }
  // Source download/label/preview access URLs are never projected. Publication is a separate reviewed boundary.
  return result;
}

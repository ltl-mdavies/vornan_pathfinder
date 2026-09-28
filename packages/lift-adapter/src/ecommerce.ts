import { organizeEcommerceLine, organizeEcommerceOrder } from './ecommerce-layout.js';
import { ecommerceOutputFields, type CanonicalEcommerceOrder } from '@pathfinder/canonical';
import type { LiftOrderPayload } from './index.js';
export const LIFT_ECOMMERCE_TEMPLATE_ID = 'template-lift-ecommerce-orders';

/** Dedicated opt-in projection; no generic runtime mapping behavior is changed. */
export function projectLiftEcommercePayload(templateId:string, base:LiftOrderPayload, source:CanonicalEcommerceOrder):LiftOrderPayload {
  if(templateId!==LIFT_ECOMMERCE_TEMPLATE_ID)throw new Error('E-commerce projection requires its explicit template');
  if(base.lines.length!==source.lines.length || base.order.ext_id!==source.order.external_order_id ||
    base.source.pathfinder_customer_id!==source.customer.customer_id || base.source.source_record_id!==source.source.source_record_id ||
    base.lines.some((line,i)=>line.line_number!==source.lines[i].line_number || line.quantity!==source.lines[i].quantity || (source.lines[i].source_line?.artwork?.artwork_sha256 !== undefined && line.artwork?.checksum!==source.lines[i].source_line?.artwork?.artwork_sha256))) {
    throw new Error('E-commerce source and target identity mismatch');
  }
  validateEcommerceValues(source);
  const result=structuredClone(base);
  // Keep pricing sections visible even when the source has no pricing integration.
  result.order.pricing={currency:null,discount:null,subtotal:null,shipping:null,refund:null,tax:null,total:null};
  for(const line of result.lines) (line as unknown as Record<string,unknown>).pricing={unit_price:null,markup_price:null};
  source=structuredClone(source);
  if(source.order.shipping_policy)source.order.shipping_policy.prepaid_label_supplied=Boolean(source.order.shipping_policy.label_url);
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
  result.lines=result.lines.map((line,i)=>{
    // Preserve reviewed target laminate/cut values; use the source values only when unmapped.
    line.production ??= {};
    line.production.laminate ??= source.lines[i].production?.finish ?? null;
    line.production.cut_type ??= source.lines[i].source_line?.cut?.type ?? null;
    return organizeEcommerceLine(line) as typeof line;
  });
  result.order=organizeEcommerceOrder(result.order) as typeof result.order;
  // Source download/label/preview access URLs are never projected. Publication is a separate reviewed boundary.
  return result;
}

function validateEcommerceValues(source:CanonicalEcommerceOrder) {
  const money=(value:unknown)=>{
    if(value!==undefined && value!==null && (typeof value!=='string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)))throw new Error('E-commerce money must be a nonnegative decimal string or null');
  };
  const price=source.order.pricing;
  if(price?.currency!=null && !/^[A-Z]{3}$/.test(price.currency))throw new Error('Currency must be an explicit three-letter code');
  for(const key of ['discount','subtotal','shipping','refund','tax','total'] as const)money(price?.[key]);
  money(source.order.payment?.authorized_amount);money(source.order.payment?.charged_amount);
  for(const coupon of source.order.coupons??[]) {if(!coupon.code.trim())throw new Error('Coupon code required');money(coupon.amount);}
  for(const line of source.lines) {
    money(line.pricing?.unit_price);money(line.pricing?.markup_price);
    if(line.sample!=null && typeof line.sample!=='boolean')throw new Error('Sample must be boolean');
    if(line.production?.white_ink_required!=null && typeof line.production.white_ink_required!=='boolean')throw new Error('White ink must be boolean');
    const roll=line.roll_finishing;if(!roll)continue;
    if(!Number.isFinite(roll.value)||roll.value<=0)throw new Error('Roll specification value must be positive');
    if(roll.specification==='max_labels_per_roll') {
      if(!Number.isSafeInteger(roll.value)||roll.unit!=='labels')throw new Error('Max labels per roll requires an integer label quantity');
    } else if(roll.specification==='max_roll_diameter') {
      if(!['in','mm'].includes(roll.unit))throw new Error('Max roll diameter requires an explicit measurement unit');
    } else throw new Error('Unsupported finished roll specification');
    if(roll.spacing!=null && (!Number.isFinite(roll.spacing)||roll.spacing<0||!['in','mm'].includes(roll.spacing_unit??'')))throw new Error('Roll spacing requires a nonnegative measurement and unit');
  }
}

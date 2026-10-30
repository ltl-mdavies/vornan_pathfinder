import type {MaterialMappings} from './material-mapping.js';
import type {RecordedChangeReason} from './change-reasons.js';
import {whiteInkValue,shapeValue,spacingValue,radiusValue} from './production-fields.js';
import {artworkApprovalProblem,readArtworkVersion} from './artwork-approval.js';
import {dieDecisionProblem} from './die-matching.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type RawRow = Record<string, string>;
export type Customer = { id: string; name: string; source: string };
export type ItemData = {
  sourceId: string; sku: string; name: string; product: string;
  width: string; height: string; material: string; laminate: string; varnish: string;
  shape?: string; spacing?: string; cornerRadius?: string; whiteInk?: string; die?: string; cut: string; corners: string; unwind: string; rollMode: string; rollValue: string;
  price: string; approval: 'approved' | 'pending'; artwork: string; preview: string;
  artworkVersion?: string; artworkApproval?: string; artworkConfirmation?: string;
  dieDecision?: string; // Versioned internal decision evidence, serialized with item/history snapshots.
};
export type Revision = { changeReason?: RecordedChangeReason; at: string; reason: string; actor: string; before: ItemData; after: ItemData };
export type Item = { key: string; customerId: string; source: string; data: ItemData; sourceData: ItemData; raw: RawRow; revision: number; history: Revision[] };
export type Catalog = { version: 1; customer: Customer; revision: number; items: Item[]; receipts: Receipt[]; imports: { at: string; name: string; fingerprint: string; applied: number; exceptions: number; preview?: ImportPreview }[] };
export type Issue = { code: string; message: string; severity: 'error' | 'warning' };
export type PreviewRow = { row: number; key: string; data: ItemData; before?: ItemData; raw: RawRow; disposition: 'new' | 'changed' | 'unchanged' | 'conflict' | 'invalid'; issues: Issue[]; changes: (keyof ItemData)[] };
export type ImportPreview = { customerId: string; source: string; baseRevision: number; name: string; fingerprint: string; rows: PreviewRow[]; absent: Item[] };
export type PoLine = { row: number; sku: string; description: string; quantity: number; price: string; amount: string; width: string; height: string; uom: string };
export type PurchaseOrder = { number: string; customerName: string; lines: PoLine[]; filename: string; format: string; sourceText: string; header: Record<string,string>; issues: Issue[] };
export type ReconciledLine = PoLine & { item?: Item; issues: Issue[] };
export type Receipt = { number: string; fingerprint: string; files: string[]; recordedAt: string; catalogRevision: number; order: PurchaseOrder; lines: ReconciledLine[]; total: string; quantity: number };

export const TEMPLATE_HEADERS = ['Customer Number','Source ID','SKU','Name','Product','Width','Height','Material','Laminate','Varnish','White Ink Required','Die','Shape','Spacing (in)','Corner Radius','Cut Type','Corners','Unwind','Roll Mode','Roll Value','Unit Price','Approval','Artwork URL','Preview URL'];
export const fingerprint = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
export const emptyCatalog = (customer: Customer): Catalog => ({version:1, customer, revision:0, items:[], receipts:[], imports:[]});
export function text(value: unknown): string {
  const str = String(value ?? '').trim();
  // WooCommerce exports decimal literals as ="0.01234". Never evaluate formulas.
  return /^="[^"\r\n]*"$/.test(str) ? str.slice(2,-1) : str;
}
export function decimal(value: string): string {
  const str = text(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(str)) throw new Error('Use a non-negative decimal with up to six decimal places.');
  return str.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}
export const micros = (value: string) => { const [whole, frac=''] = decimal(value).split('.'); return BigInt(whole)*1000000n+BigInt(frac.padEnd(6,'0')); };
export const fromMicros = (value: bigint) => `${value/1000000n}.${(value%1000000n).toString().padStart(6,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
export const money = (value: string) => { try { return Number(decimal(value)).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}); } catch { return 'Unavailable'; } };
export function safeUrl(value: string): string {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function firstUrl(value: string) { return value.match(/https?:\/\/[^\s,;|]+/g)?.[0] ?? ''; }
const fields: Record<keyof ItemData, string[]> = {
  sourceId:['Source ID','Partner Configuration ID'], sku:['SKU','Reference Number'], name:['Name','Label Description','Partner Configuration Name'],
  product:['Product','Original Product'], width:['Width','Custom Width'], height:['Height','Custom Height'], material:['Material'],
  shape:['Shape'],spacing:['Spacing (in)','Spacing'],cornerRadius:['Corner Radius'],whiteInk:['White Ink Required','White Ink'],die:['Die'],laminate:['Laminate'],varnish:['Varnish'],cut:['Cut Type'],corners:['Corners','Cut Complexity'],unwind:['Unwind','Unwind Direction'],
  rollMode:['Roll Mode','Finished Roll Specs'],rollValue:['Roll Value','finished_roll_specs_value'],price:['Unit Price','Price'],
  approval:['Approval','Proof Approval Status'],artwork:['Artwork URL','Approved Art'],preview:['Preview URL','Uploaded Art'],dieDecision:[],artworkVersion:[],artworkApproval:[],artworkConfirmation:[]
};
export function normalizeRow(raw: RawRow): ItemData {
  const data = Object.fromEntries(Object.entries(fields).map(([key,aliases])=>[key, text(aliases.map(a=>raw[a]).find(v=>text(v)!==''))])) as ItemData;
  if(data.whiteInk)data.whiteInk=whiteInkValue(data.whiteInk);else delete data.whiteInk;
  if(!data.die)delete data.die;
  delete data.artworkVersion;delete data.artworkApproval;delete data.artworkConfirmation;
  delete data.dieDecision; // Import files cannot assert an internal die decision.
  if(data.shape)data.shape=shapeValue(data.shape);else delete data.shape;
  if(data.spacing)data.spacing=spacingValue(data.spacing);else delete data.spacing;
  if(data.cornerRadius)data.cornerRadius=radiusValue(data.cornerRadius);else delete data.cornerRadius;
  data.approval = data.approval.toLowerCase() as ItemData['approval'];
  try { data.price = decimal(data.price); } catch { /* validation reports it */ }
  data.preview = firstUrl(data.preview);
  return data;
}
export function validateItem(data: ItemData,mappings?:MaterialMappings): Issue[] {
  const issues: Issue[]=[];
  const add=(code:string,message:string,severity:Issue['severity']='error')=>issues.push({code,message,severity});
  if(data.artworkVersion&&!readArtworkVersion(data))add('artwork-version','Production file verification is invalid or stale. Verify the current file.');
  if(data.artworkApproval||data.artworkConfirmation){const problem=artworkApprovalProblem(data);if(problem)add('artwork-approval',problem);}
  const dieProblem=dieDecisionProblem(data,mappings);if(dieProblem)add('die-decision',dieProblem);
  if(data.spacing!==undefined&&data.spacing!==''&&(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(data.spacing)||!Number.isFinite(Number(data.spacing))))add('spacing','Enter non-negative spacing in inches, or leave it unspecified.');
  if(!data.sourceId) add('source_id','Add a stable source ID.');
  if(!data.sku) add('sku','Add a customer SKU.');
  if(!data.name) add('name','Add an item name.');
  if(!data.product) add('product','Add a product name.');
  for(const key of ['width','height'] as const) if(!/^\d+(?:\.\d+)?$/.test(data[key]) || Number(data[key])<=0) add(key,`Enter a positive ${key} in inches.`);
  try { decimal(data.price); } catch { add('price','Enter a unit price with up to six decimal places.'); }
  if(!['pending','approved'].includes(data.approval)) add('approval','Approval must be pending or approved.');
  if(data.artwork && !safeUrl(data.artwork)) add('artwork_url','Artwork must use an http or https URL.');
  if(data.preview && !safeUrl(data.preview)) add('preview_url','Preview must use an http or https URL.');
  if(!data.artwork) add('missing_artwork','Production artwork is missing; preview images are not print files.','warning');
  if(data.approval==='pending' && data.artwork) add('pending_file','Pending approval: confirm this is the file intended for the next order.','warning');
  if(data.rollMode==='Max Roll Diameter' && Number(data.rollValue)>100) add('roll_value','Check maximum roll diameter and units.','warning');
  return issues;
}
export function previewImport(catalog: Catalog, rawRows: {row:number;raw:RawRow}[], name: string): ImportPreview {
  if(!rawRows.length) throw new Error('No catalog rows found. Choose the catalog sheet or standard template.');
  if(rawRows.length>10000) throw new Error('Import at most 10,000 catalog rows per file.');
  const existing=new Map(catalog.items.map(i=>[i.key,i]));
  const rows:PreviewRow[]=rawRows.map(({row,raw})=>{
    const data=normalizeRow(raw); const key=JSON.stringify([catalog.customer.id,catalog.customer.source,data.sourceId]);
    const previous=existing.get(key); const issues=validateItem(data);
    if(text(raw['Customer Number']) && text(raw['Customer Number'])!==catalog.customer.id) issues.push({code:'customer',message:`Customer ${raw['Customer Number']} does not match selected customer ${catalog.customer.id}.`,severity:'error'});
    const changedSource=previous && JSON.stringify(previous.sourceData)!==JSON.stringify(data);
    const changes=(Object.keys(data) as (keyof ItemData)[]).filter(k=>previous && previous.data[k]!==data[k]);
    // Preserve operator changes when the upstream row has not changed. Conflicting source changes need explicit review.
    const localChanges=previous && JSON.stringify(previous.data)!==JSON.stringify(previous.sourceData);
    let disposition:PreviewRow['disposition']=!previous?'new':!changedSource?'unchanged':localChanges?'conflict':'changed';
    if(disposition==='conflict') issues.push({code:'local_conflict',message:'Source changed after an internal edit. Review both versions before replacing this item.',severity:'error'});
    if(raw['Price Override'] && text(raw['Price Override'])!=='' && data.price!==text(raw['Price Override'])) {
      try { if(decimal(raw['Price Override'])!==data.price) issues.push({code:'price_override',message:'Price and Price Override differ. Confirm which price to use.',severity:'error'}); } catch { issues.push({code:'price_override',message:'Price Override is not a valid decimal.',severity:'error'}); }
    }
    return {row,key,data,before:previous?structuredClone(previous.data):undefined,raw,disposition,issues,changes};
  });
  const sourceCounts=new Map<string,number>(),skuCounts=new Map<string,number>();
  rows.forEach(r=>{sourceCounts.set(r.key,(sourceCounts.get(r.key)??0)+1); if(r.data.sku)skuCounts.set(r.data.sku,(skuCounts.get(r.data.sku)??0)+1);});
  const incomingKeys=new Set(rows.map(r=>r.key));
  rows.forEach(r=>{
    if((sourceCounts.get(r.key)??0)>1)r.issues.push({code:'duplicate_source',message:'Source ID appears more than once in this file.',severity:'error'});
    if(r.data.sku && ((skuCounts.get(r.data.sku)??0)>1 || catalog.items.some(i=>!incomingKeys.has(i.key)&&i.data.sku===r.data.sku)))r.issues.push({code:'duplicate_sku',message:'Customer SKU is not unique. Resolve the duplicate before applying.',severity:'error'});
    if(r.issues.some(i=>i.severity==='error') && r.disposition!=='conflict')r.disposition='invalid';
  });
  return {customerId:catalog.customer.id,source:catalog.customer.source,baseRevision:catalog.revision,name,fingerprint:fingerprint(rawRows),rows,absent:catalog.items.filter(i=>!incomingKeys.has(i.key))};
}
export function applyImport(catalog: Catalog, preview: ImportPreview, at: string): Catalog {
  if(catalog.customer.id!==preview.customerId || catalog.customer.source!==preview.source || catalog.revision!==preview.baseRevision)throw new Error('The catalog changed. Preview this file again before applying.');
  const items=new Map(catalog.items.map(i=>[i.key,structuredClone(i)])); let applied=0;
  for(const row of preview.rows) {
    if(!['new','changed'].includes(row.disposition) || row.issues.some(i=>i.severity==='error'))continue;
    const old=items.get(row.key); applied++;
    items.set(row.key,{key:row.key,customerId:catalog.customer.id,source:catalog.customer.source,data:structuredClone(row.data),sourceData:structuredClone(row.data),raw:structuredClone(row.raw),revision:(old?.revision??0)+1,history:old?[...old.history,{at,actor:'Local operator',reason:`Import: ${preview.name}`,before:old.data,after:row.data}]:[]});
  }
  if(!applied)return catalog;
  return {...catalog,revision:catalog.revision+1,items:[...items.values()],imports:[...catalog.imports,{at,name:preview.name,fingerprint:preview.fingerprint,applied,exceptions:preview.rows.filter(r=>['invalid','conflict'].includes(r.disposition)).length,preview:structuredClone(preview)}]};
}
export function editItem(catalog:Catalog,key:string,data:ItemData,expectedRevision:number,reason:string,at:string,changeReason?:RecordedChangeReason,mappings?:MaterialMappings):Catalog {
  const item=catalog.items.find(i=>i.key===key); if(!item||item.revision!==expectedRevision)throw new Error('This item changed. Reopen it before saving.');
  if(data.approval==='approved'&&item.data.approval!==data.approval){const problem=artworkApprovalProblem(data,key);if(problem)throw new Error(problem);}
  if(data.artworkVersion||data.artworkApproval||data.artworkConfirmation){const problem=artworkApprovalProblem(data,key);if(problem&&(data.artworkApproval||data.artworkConfirmation))throw new Error(problem);}
  if(data.sourceId!==item.data.sourceId)throw new Error('Source identity cannot be changed.');
  if(!reason.trim())throw new Error('Add a reason for this change.');
  const errors=validateItem(data,mappings).filter(i=>i.severity==='error'); if(errors.length)throw new Error(errors[0].message);
  if(catalog.items.some(i=>i.key!==key&&i.data.sku===data.sku))throw new Error('This customer SKU already exists.');
  if(JSON.stringify(item.data)===JSON.stringify(data))return catalog;
  return {...catalog,revision:catalog.revision+1,items:catalog.items.map(i=>i.key!==key?i:{...i,data,revision:i.revision+1,history:[...i.history,{at,actor:'Local operator',reason:reason.trim(),...(changeReason?{changeReason:{...changeReason}}:{}),before:i.data,after:data}]})};
}
export function reconcilePo(catalog: Catalog, po: PurchaseOrder) {
  const lines:ReconciledLine[]=po.lines.map(line=>{
    const matches=catalog.items.filter(i=>i.data.sku===line.sku); const item=matches.length===1?matches[0]:undefined;
    const issues:Issue[]=[]; const add=(code:string,message:string,severity:Issue['severity']='error')=>issues.push({code,message,severity});
    if(!item)add('sku',matches.length?'SKU matches multiple items.':'SKU is not in this customer catalog.');
    if(!Number.isSafeInteger(line.quantity)||line.quantity<=0)add('quantity','Quantity must be a positive whole number.');
    if(line.uom.toUpperCase()!=='EACH')add('uom',`Review unit of measure: ${line.uom || 'missing'}.`);
    try {
      if(micros(line.price)*BigInt(line.quantity)!==micros(line.amount))add('amount','PO line amount does not equal quantity × unit price.');
      if(item && micros(line.price)!==micros(item.data.price))add('price','PO price differs from catalog price.');
    } catch { add('price','Invalid price or quantity.'); }
    if(item) {
      if(line.width && line.height && (Number(line.width)!==Number(item.data.width)||Number(line.height)!==Number(item.data.height)))add('dimensions',Number(line.width)===Number(item.data.height)&&Number(line.height)===Number(item.data.width)?'PO dimensions are reversed. Confirm orientation; no automatic rotation.':'PO dimensions differ from the catalog.');
      if(!item.data.artwork)add('artwork','Production artwork is missing.');
      if(item.data.approval==='pending')add('approval','Pending artwork will require Lift proof approval.','warning');
    }
    return {...line,item:item?structuredClone(item):undefined,issues};
  });
  const totalsValid=lines.length>0 && lines.every(l=>{try{return Number.isSafeInteger(l.quantity)&&l.quantity>0&&micros(l.price)*BigInt(l.quantity)===micros(l.amount);}catch{return false;}});
  const quantity=lines.reduce((s,l)=>s+l.quantity,0);
  const total=totalsValid?fromMicros(lines.reduce((s,l)=>s+micros(l.amount),0n)):'';
  // Ignore file format/order of rows for duplicate delivery, but retain multiplicity of repeated SKU lines.
  const signature=lines.map(l=>[l.sku,l.quantity,l.price,l.amount,l.width,l.height,l.uom]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const contentFingerprint=fingerprint([catalog.customer.id,po.number,po.header,signature]);
  const prior=catalog.receipts.filter(r=>r.number===po.number);
  const duplicate=prior.find(r=>r.fingerprint===contentFingerprint);
  return {lines,total,quantity,totalsValid,fingerprint:contentFingerprint,disposition:duplicate?'duplicate':prior.length?'amendment':'new',issues:po.issues,exceptionCount:lines.filter(l=>l.issues.some(i=>i.severity==='error')).length};
}
export function recordReceipt(catalog:Catalog,po:PurchaseOrder,at:string):Catalog {
  const result=reconcilePo(catalog,po);
  if(!po.number || !po.lines.length || po.issues.some(i=>i.severity==='error'))throw new Error('Resolve document parsing errors before recording the PO.');
  if(result.disposition==='amendment')throw new Error('This PO number has changed contents. Keep it in review; do not replace the existing receipt.');
  if(result.disposition==='duplicate')return {...catalog,revision:catalog.revision+1,receipts:catalog.receipts.map(r=>r.fingerprint===result.fingerprint?{...r,files:[...new Set([...r.files,po.filename])]}:r)};
  return {...catalog,revision:catalog.revision+1,receipts:[...catalog.receipts,{number:po.number,fingerprint:result.fingerprint,files:[po.filename],recordedAt:at,catalogRevision:catalog.revision,order:structuredClone(po),lines:result.lines,total:result.total,quantity:result.quantity}]};
}
export function filterItems(items: Item[], query:string, approval:string, product:string, art:string) {
  const words=query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(i=>(!approval||i.data.approval===approval)&&(!product||i.data.product===product)&&(!art||(art==='missing'?!i.data.artwork:!!i.data.artwork))&&words.every(w=>[i.data.sku,i.data.name,i.data.sourceId,i.data.material,i.data.product,i.data.width,i.data.height].join(' ').toLowerCase().includes(w)));
}
export function csvExport(rows: string[][]):string { return rows.map(row=>row.map(v=>`"${(/^[=+@\-\t\r]/.test(v)?"'":'')+v.replaceAll('"','""')}"`).join(',')).join('\r\n'); }

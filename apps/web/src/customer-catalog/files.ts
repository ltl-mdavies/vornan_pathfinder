import * as XLSX from 'xlsx';
import { decimal, micros, fromMicros, text, type PurchaseOrder, type PoLine, type RawRow } from './catalog';

export const MAX_FILE_SIZE=20*1024*1024;
export function checkFile(file:{name:string;size:number}) {
  if(!file.size || file.size>MAX_FILE_SIZE)throw new Error('Choose a non-empty file smaller than 20 MB.');
}
export function readWorkbook(bytes:ArrayBuffer|Uint8Array) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const options={cellFormula:false,cellHTML:false,cellStyles:false,sheetRows:10002};
  if(data[0]===0x50&&data[1]===0x4b)return XLSX.read(data,{...options,type:'array'});
  try{return XLSX.read(new TextDecoder('utf-8',{fatal:true}).decode(data),{...options,type:'string',raw:true});}
  catch{throw new Error('Use an XLSX workbook or a UTF-8 encoded CSV.');}
}
export function catalogRows(bytes:ArrayBuffer|Uint8Array,sheet?:string) {
  const book=readWorkbook(bytes);
  const name=sheet ?? (book.SheetNames.length===1?book.SheetNames[0]:'');
  if(!name || !book.Sheets[name])throw new Error('Select the sheet containing catalog rows.');
  const grid=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name],{header:1,defval:'',raw:true});
  const header=(grid[0]??[]).map(text);
  if(!header.includes('Source ID') && !header.includes('Partner Configuration ID'))throw new Error('Catalog header must include Source ID or Partner Configuration ID. Download the standard template.');
  const seen=new Set<string>();for(const h of header.filter(Boolean)){if(seen.has(h))throw new Error(`Duplicate column: ${h}`);seen.add(h);}
  return {sheet:name,sheets:book.SheetNames,rows:grid.slice(1).map((row,i)=>({row:i+2,raw:Object.fromEntries(header.map((h,j)=>[h,text(row[j])]).filter(([h])=>h)) as RawRow})).filter(r=>Object.values(r.raw).some(Boolean))};
}
const cleanNumber=(v:string)=>text(v).replaceAll(',','');
function price(value:string) {try{return decimal(cleanNumber(value));}catch{return cleanNumber(value);}}
function finishPo(po:PurchaseOrder):PurchaseOrder {
  if(!po.number)po.issues.push({code:'po_number',message:'PO number could not be read.',severity:'error'});
  if(!po.lines.length)po.issues.push({code:'po_lines',message:'No PO lines could be read. Use the standard PO CSV template.',severity:'error'});
  if(po.lines.length>10000)throw new Error('PO files may contain at most 10,000 lines.');
  return po;
}
export function parsePoWorkbook(bytes:ArrayBuffer|Uint8Array,filename:string):PurchaseOrder {
  const book=readWorkbook(bytes);
  if(book.SheetNames.length!==1)throw new Error('PO workbook must contain one sheet. Export the order sheet as CSV or XLSX.');
  const grid=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]],{header:1,defval:'',raw:true}).map(r=>r.map(text));
  const source=grid.map(r=>r.filter(Boolean).join(' ')).join('\n');
  const standard=grid[0]?.includes('SKU') && grid[0]?.includes('Quantity');
  const lines:PoLine[]=[]; const issues:PurchaseOrder['issues']=[];
  let number=source.match(/\bPO\d+\b/)?.[0]??''; let customerName='';
  if(standard){
    const header=grid[0];const val=(r:string[],h:string)=>r[header.indexOf(h)]??'';
    const numbers=new Set<string>();const customers=new Set<string>();
    grid.slice(1).forEach((r,i)=>{if(!r.some(Boolean))return;const n=val(r,'PO Number');numbers.add(n);customers.add(val(r,'Customer Name'));
      const quantity=Number(cleanNumber(val(r,'Quantity')));const unitPrice=price(val(r,'Unit Price'));let amount=val(r,'Line Total');
      if(!amount){try{amount=fromMicros(micros(unitPrice)*BigInt(quantity));}catch{amount='';}}
      lines.push({row:i+2,sku:val(r,'SKU'),description:val(r,'Description'),quantity,price:unitPrice,amount:price(amount),width:val(r,'Width'),height:val(r,'Height'),uom:val(r,'UOM')});
    });number=[...numbers][0]??'';customerName=[...customers][0]??'';
    if(numbers.size!==1||customers.size>1)issues.push({code:'mixed_po',message:'One PO number and customer per file are required.',severity:'error'});
  } else {throw new Error('Use the standard PO CSV/XLSX template.');}
  return finishPo({number,customerName,lines,filename,format:'Standard PO v1',sourceText:source,header:{},issues});
}
export async function parsePoFile(file:File):Promise<PurchaseOrder>{
 checkFile(file);if(file.name.toLowerCase().endsWith('.pdf'))throw new Error('Prepare this PO using the standard CSV/XLSX template.');
 return parsePoWorkbook(await file.arrayBuffer(),file.name);
}

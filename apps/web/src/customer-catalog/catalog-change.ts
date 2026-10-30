import type {Catalog} from './catalog';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Infer the existing UI action; the server reconstructs it from its own current records. */
export function catalogChange(before:Catalog,next:Catalog):Record<string,unknown>|null {
 if(same(before,next))return null;
 if(next.imports.length===before.imports.length+1){const last=next.imports.at(-1)!;if(!last.preview)throw new Error('Import source rows are missing. Preview the file again.');return {kind:'import',name:last.name,rows:last.preview.rows.map(r=>({row:r.row,raw:r.raw}))};}
 if(!same(before.receipts,next.receipts)){const changed=next.receipts.find(r=>!same(r,before.receipts.find(old=>old.number===r.number)));if(!changed)throw new Error('Receipt removal is not supported.');const prior=before.receipts.find(r=>r.number===changed.number);const filename=changed.files.find(f=>!prior?.files.includes(f))??changed.order.filename;return {kind:'record-po',po:{...changed.order,filename}};}
 const edits=next.items.filter(item=>!same(item,before.items.find(old=>old.key===item.key)));
 if(edits.length!==1||before.items.length!==next.items.length)throw new Error('Save one catalog operation at a time.');
 const item=edits[0],old=before.items.find(i=>i.key===item.key),reason=item.history.at(-1)?.changeReason;
 if(!old||!reason)throw new Error('Select a reason for this item update.');
 return {kind:'edit-item',itemKey:item.key,expectedItemRevision:old.revision,data:item.data,reasonId:reason.id,details:reason.details};
}

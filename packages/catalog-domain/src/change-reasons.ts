import type {MaterialMappings} from './material-mapping.js';
import {editItem,type Catalog,type ItemData} from './catalog.js';
export type ChangeReasonOption={id:string;label:string;active:boolean};
export type RecordedChangeReason={id:string;label:string;details:string};
export const DEFAULT_CHANGE_REASONS:readonly ChangeReasonOption[]=[
  {id:'customer-request',label:'Customer requested change',active:true},
  {id:'specification-correction',label:'Specification correction',active:true},
  {id:'production-requirement',label:'Production requirement',active:true},
  {id:'pricing-update',label:'Pricing update',active:true},
  {id:'catalog-cleanup',label:'Catalog cleanup',active:true},
  {id:'other',label:'Other',active:true},
];
export function validateChangeReasons(options:readonly ChangeReasonOption[]):ChangeReasonOption[]{
  const ids=new Set<string>(),labels=new Set<string>();
  const clean=options.map(option=>{
    if(!option.id?.trim()||ids.has(option.id))throw new Error('Each change reason needs a unique ID.');
    const label=option.label.trim();if(!label||label.length>100)throw new Error('Use a reason name between 1 and 100 characters.');
    if(labels.has(label.toLowerCase()))throw new Error('Each change reason needs a unique name.');
    if(typeof option.active!=='boolean')throw new Error('Choose whether each reason is active.');
    ids.add(option.id);labels.add(label.toLowerCase());return {...option,label};
  });
  if(!clean.some(option=>option.active))throw new Error('Keep at least one active change reason.');
  return clean;
}
export function recordChangeReason(options:readonly ChangeReasonOption[],id:string,details:string):RecordedChangeReason {
  const option=validateChangeReasons(options).find(option=>option.id===id&&option.active);
  if(!option)throw new Error('Select an active reason for this update.');
  if(details.trim().length>2000)throw new Error('Keep additional details under 2,000 characters.');
  return {id:option.id,label:option.label,details:details.trim()};
}
export function editItemWithReason(catalog:Catalog,key:string,data:ItemData,expectedRevision:number,id:string,details:string,options:readonly ChangeReasonOption[],at:string,mappings?:MaterialMappings):Catalog {
  const reason=recordChangeReason(options,id,details);
  return editItem(catalog,key,data,expectedRevision,reason.label,at,reason,mappings);
}

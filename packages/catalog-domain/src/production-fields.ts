import {artworkApprovalProblem} from './artwork-approval.js';
import type {Item, ItemData} from './catalog.js';
export type CutKind = 'die' | 'laser' | 'zund' | 'unknown';
export function cutKind(value:string):CutKind {
  const key=value.toLowerCase().replace(/[\s_-]/g,'');
  return ['die','diecut'].includes(key)?'die':['laser','lasercut'].includes(key)?'laser':['zund','zundcut'].includes(key)?'zund':'unknown';
}
export function whiteInkValue(value:string):string {
  const key=value.trim().toLowerCase();
  return ['yes','true','1'].includes(key)?'Yes':['no','false','0'].includes(key)?'No':value.trim();
}
export function shapeValue(value:string):string {
  const key=value.toLowerCase().replace(/\s/g,'');
  return key==='square/rectangle'?'Square/Rectangle':key==='circle/oval'?'Circle/Oval':['custom','contourcuttoshape'].includes(key)?'Custom':value.trim();
}
export function spacingValue(value:string):string {
  const clean=value.trim().replace(/(?:["″]|\s*in(?:ch(?:es)?)?)$/i,'').trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)?String(Number(clean)):value.trim();
}
export function radiusValue(value:string):string {
  const clean=value.trim().replace(/(?:["″]|\s*in(?:ch(?:es)?)?)$/i,'').trim();
  if(/^square$/i.test(clean))return 'Square';
  return ['1/16','1/8','1/4'].includes(clean)?clean:value.trim();
}
/** Generic records retain explicit saved production values; legacy defaults need a private migration. */
export function productionData(item:Item):ItemData {return {...item.data};}

export function cutComplexityOptions(shape:string) {
  switch(shapeValue(shape)) {
    case 'Square/Rectangle': return [{value:'Square Cut',label:'Square Corners'},{value:'1/16" Radius Corners',label:'1/16" Radius Corners'},{value:'1/8" Radius Corners',label:'1/8" Radius Corners'}];
    case 'Circle/Oval': return [{value:'Contour-Simple',label:'Contour Simple'}];
    case 'Custom': return [{value:'Contour-Complex',label:'Contour Complex'}];
    default: return [];
  }
}
export function resolvedCutComplexity(data:ItemData):string {
  const shape=shapeValue(data.shape??'');
  if(shape==='Square/Rectangle')return data.cornerRadius==='Square'?'Square Cut':['1/16','1/8'].includes(data.cornerRadius??'')?`${data.cornerRadius}" Radius Corners`:'';
  return cutComplexityOptions(shape)[0]?.value??'';
}
/** Keep the two geometry controls synchronized on explicit internal edits. */
export function updateCutGeometry(data:ItemData,key:'shape'|'cornerRadius'|'corners',value:string):ItemData {
  const next={...data,[key]:value};
  if(key==='corners'&&shapeValue(data.shape??'')==='Square/Rectangle')next.cornerRadius=value==='Square Cut'?'Square':value==='1/16" Radius Corners'?'1/16':value==='1/8" Radius Corners'?'1/8':'';
  return {...next,corners:resolvedCutComplexity(next)};
}
// A die applies only to Die Cut; complexity applies independently to every cut type.
export function activeCutDetails(data:ItemData) {
  return {die:cutKind(data.cut)==='die'?data.die??'':'',complexity:resolvedCutComplexity(data)};
}
export type DieChoice={id:string;label:string};
export function parseDieList(payload:unknown):{choices:DieChoice[];excluded:number} {
  if(!payload||typeof payload!=='object'||!('dies' in payload)||!Array.isArray(payload.dies)||!('ok' in payload)||payload.ok!==true)throw new Error('The die library returned an invalid response.');
  const choices:DieChoice[]=[];let excluded=0;const seen=new Set<string>();
  for(const row of payload.dies){
    if(!row||typeof row!=='object'||!/^\d+$/.test(String(row.die_id))||!Number.isFinite(Number(row.die_width))||Number(row.die_width)<=0||!Number.isFinite(Number(row.die_height))||Number(row.die_height)<=0||seen.has(String(row.die_id))){excluded++;continue;}
    seen.add(String(row.die_id));
    choices.push({id:`Die - ${row.die_id}`,label:[`Die - ${row.die_id}`,`${row.die_width} × ${row.die_height} in`,row.material,row.finishing,row.description].filter(v=>typeof v==='string'&&v.trim()).join(' · ')});
  }
  choices.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  return {choices,excluded};
}

// Local editor safeguard; production must enforce the same policy server-side.
export function validateInternalItemChanges(before:ItemData,after:ItemData,internalUser:boolean){
  if(!internalUser&&(['whiteInk','die','cut','corners','approval','dieDecision','artworkVersion','artworkApproval','artworkConfirmation'] as const).some(key=>(before[key]??'')!==(after[key]??'')))throw new Error('Production settings and print approval can only be changed by an internal user.');
  if(before.approval!==after.approval&&after.approval==='approved'&&!after.artwork)throw new Error('A production artwork file is required before approving for print.');
  if(before.artwork!==after.artwork)throw new Error('Use the artwork revision workflow to replace a production file.');
  if(after.approval==='approved'&&(before.approval!==after.approval||before.artworkApproval!==after.artworkApproval)){const problem=artworkApprovalProblem(after);if(problem)throw new Error(problem);}
}

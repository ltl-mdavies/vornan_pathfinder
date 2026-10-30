import {fingerprint,type ItemData} from './catalog.js';
import {resolveDieMaterial,type MaterialMappings} from './material-mapping.js';
import {cutKind,spacingValue} from './production-fields.js';

export type DieCandidate={id:string;tier:'exact'|'production_compatible'|'dimension_only'|'near';width:string;height:string;gap:string;shape:string;material:string;finishing:string};
export const dieTierLabel=(tier:DieCandidate['tier'])=>({exact:'Exact',production_compatible:'Production compatible',dimension_only:'Dimensions only',near:'Near match'})[tier];
export type DieMatchResult={candidates?:DieCandidate[];kind:'exact'|'none'|'review';message:string;ids:string[];signature:string;checkedAt:string};
export type DieDecision={actor?:string;responseFingerprint?:string;version:1;mode:'automatic'|'manual';signature:string;cut:string;die:string;reason:string;at:string;basis:string};
export function dieSpecification(data:ItemData,mappings?:MaterialMappings){
 const material=resolveDieMaterial(data.material,mappings);
 return {width_in:Number(data.width),height_in:Number(data.height),shape:data.shape??'',material:material?.libraryName??data.material.trim(),...(material?.linerType?{liner_type:material.linerType}:{}),laminate:data.laminate.trim(),varnish:data.varnish.trim(),corner_style:data.shape==='Square/Rectangle'?data.cornerRadius??'':'',spacing_in:Number(spacingValue(data.spacing?.trim()||'0.125')),unwind_direction:data.unwind.trim()};
}
export const dieSignature=(data:ItemData,mappings?:MaterialMappings)=>fingerprint(mappings?{specifications:dieSpecification(data,mappings),materialMapping:resolveDieMaterial(data.material,mappings)??null}:dieSpecification(data));
export function dieRequest(data:ItemData,mappings?:MaterialMappings){
 const p=dieSpecification(data,mappings);
 if(mappings&&!resolveDieMaterial(data.material,mappings))throw new Error('Confirm this material in Settings → Material mappings before checking dies.');
 if(!data.width.trim()||!data.height.trim()||!Number.isFinite(p.width_in)||!Number.isFinite(p.height_in)||p.width_in<=0||p.height_in<=0)throw new Error('Enter positive width and height to check dies.');
 if(!['Square/Rectangle','Circle/Oval','Custom'].includes(p.shape))throw new Error('Choose a shape to check dies.');
 if(p.shape==='Square/Rectangle'&&!['Square','1/16','1/8'].includes(p.corner_style))throw new Error('Choose a corner radius to check dies.');
 if(!p.material||(!p.laminate&&!p.varnish)||!p.unwind_direction)throw new Error('Complete material, finish and unwind before checking dies.');
 if(!Number.isFinite(p.spacing_in)||p.spacing_in<0)throw new Error('Enter valid spacing to check dies.');
 return {...p,corner_style:p.corner_style==='Square'?'Square':p.corner_style?`${p.corner_style}" Radius Corners`:''};
}
export function interpretDieMatch(payload:unknown,data:ItemData,at:string,mappings?:MaterialMappings):DieMatchResult{
 const p=payload as any;
 if(!p||p.ok!==true||!p.summary)throw new Error('Die matching returned an invalid response. Retry the check.');
 const groups=['exact','production_compatible','dimension_only','near'] as const;
 const candidates:DieCandidate[]=[];const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value):'';
 const ids:string[][]=[];const seen=new Set<string>();
 for(const group of groups){
  const rows=p[`${group}_matches`],count=p.summary[`${group}_count`];
  if(!Array.isArray(rows)||!Number.isSafeInteger(count)||count<0||count!==rows.length)throw new Error('Die matching returned incomplete results. Retry the check.');
  const groupIds:string[]=[];
  for(const row of rows){
   const id=String(row?.die_id??'');
   if(!/^\d+$/.test(id)||seen.has(id))throw new Error('Die matching returned ambiguous identities. Review the library.');
   seen.add(id);groupIds.push(`Die - ${id}`);
   candidates.push({id:`Die - ${id}`,tier:group,width:text(row.die_width),height:text(row.die_height),gap:text(row.die_gap_in),shape:text(row.shape),material:text(row.material),finishing:text(row.finishing)});
  }
  ids.push(groupIds);
 }
 const common={candidates,signature:dieSignature(data,mappings),checkedAt:at};
 if(data.shape==='Custom')return {...common,kind:'review',ids:ids.flat(),message:'Custom outline requires prepress review. No automatic assignment.'};
 if(ids[0].length===1){const candidate=candidates.find(c=>c.id===ids[0][0])!;const gap=Number(candidate.gap);if(!candidate.gap||!Number.isFinite(gap)||Math.abs(gap-dieSpecification(data,mappings).spacing_in)>0.000001)return {...common,kind:'review',ids:ids.flat(),message:'The API exact match has missing or different die spacing. Review the library gap before choosing an override.'};}
 if(ids[0].length===1)return {...common,kind:'exact',ids:ids[0],message:`Exact match · ${ids[0][0]}`};
 if(ids.flat().length===0)return {...common,kind:'none',ids:[],message:'No die candidates returned. Keep current cutting or explicitly choose Laser Cut.'};
 return {...common,kind:'review',ids:ids.flat(),message:ids[0].length>1?'Multiple exact dies · choose an internal manual override.':`${ids[1].length} production-compatible · ${ids[2].length} dimension-only · ${ids[3].length} near. Review before choosing a die.`};
}
export function readDieDecision(data:ItemData):DieDecision|null{
 if(!data.dieDecision)return null;
 try{const p=JSON.parse(data.dieDecision);return p.version===1&&['automatic','manual'].includes(p.mode)&&['signature','cut','die','reason','at','basis'].every(k=>typeof p[k]==='string')?p:null;}catch{return null;}
}
export function manualDieOverride(data:ItemData,reason:string,at:string,mappings?:MaterialMappings):ItemData{
 const cut=cutKind(data.cut),die=cut==='die'?data.die??'':'';
 return {...data,dieDecision:JSON.stringify({version:1,mode:'manual',signature:dieSignature(data,mappings),cut,die,reason,at,basis:'Internal selection'} satisfies DieDecision)};
}
export function applyAutomaticDie(data:ItemData,result:DieMatchResult,mappings?:MaterialMappings):ItemData{
 if(result.signature!==dieSignature(data,mappings))throw new Error('Specifications changed. Check dies again.');
 if(readDieDecision(data)?.mode==='manual')throw new Error('Manual override is preserved. Explicitly return to automatic matching first.');
 if(result.kind==='review')throw new Error('These candidates require an internal review.');
 const cut=result.kind==='exact'?'Diecut':'Laser',die=result.kind==='exact'?result.ids[0]:'';
 if(result.kind==='exact'&&(!/^Die - \d+$/.test(die)||result.ids.length!==1))throw new Error('One exact die is required.');
 return {...data,cut,die,dieDecision:JSON.stringify({version:1,mode:'automatic',signature:result.signature,cut:cutKind(cut),die,reason:'',at:result.checkedAt,basis:result.kind==='exact'?'Unique exact API match':'Confirmed empty API result'} satisfies DieDecision)};
}
export function dieDecisionProblem(data:ItemData,mappings?:MaterialMappings):string{
 if(!data.dieDecision)return '';
 const d=readDieDecision(data);
 if(!d)return 'Cutting decision evidence is invalid. Check dies or choose a manual override.';
 if(d.signature!==dieSignature(data,mappings)||d.cut!==cutKind(data.cut)||d.die!==(cutKind(data.cut)==='die'?data.die??'':''))return d.mode==='manual'?'Specifications changed. Review and confirm the manual override.':'Specifications changed. Wait for a fresh die check or choose a manual override.';
 if(d.mode==='manual'&&(!d.reason.trim()||d.reason.length>1000))return 'Enter a manual override reason of 1–1,000 characters.';
 if(d.cut==='unknown'||(d.cut==='die'&&!/^Die - \d+$/.test(d.die)))return 'Choose a cut type and, for Die Cut, a die.';
 return '';
}
export function dieDecisionLabel(value?:string){
 try{const d=JSON.parse(value??'');return `${d.mode==='manual'?'Manual override':'Automatic'} · ${d.die||d.cut}${d.reason?` · ${d.reason}`:''}${d.actor?` · ${d.actor}`:''}`;}catch{return 'No recorded cutting decision';}
}

/** A new library result is an opportunity, never permission to replace a saved Laser setup. */
export function laserDieOpportunity(data:ItemData,result:DieMatchResult|null,mappings?:MaterialMappings):string {
 if(cutKind(data.cut)!=='laser'||!result||result.signature!==dieSignature(data,mappings))return '';
 if(result.kind==='exact')return `Die available: ${result.ids[0]}. Review this opportunity before replacing Laser Cut; the saved cutting method is unchanged.`;
 if(result.ids.length)return 'Possible dies found for this Laser item. Compatibility requires review; the saved cutting method is unchanged.';
 return 'No die candidates returned by this check. The existing Laser cutting method is retained.';
}

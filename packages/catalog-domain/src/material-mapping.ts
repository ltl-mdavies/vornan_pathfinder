/** Runtime mapping values must come from an authorized server response; no bundled crosswalk. */
export type MappingCell={value:string;confirmed:boolean;evidence:string};
export type MappingRow={id:string;libraryName:MappingCell;ecommerceName:MappingCell;liftName:MappingCell;liftMaterialId:MappingCell;linerType?:string;note:string};
export type MaterialMappings=readonly MappingRow[];
const key=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
export function resolveConfirmedMaterial(value:string,rows:MaterialMappings){
 const matches=rows.filter(r=>[r.libraryName,r.ecommerceName,r.liftName,r.liftMaterialId].every(c=>c.confirmed&&!!c.value.trim())&&[r.libraryName.value,r.ecommerceName.value].some(v=>key(v)===key(value)));
 const values=matches.map(r=>({alias:r.ecommerceName.value,id:r.liftMaterialId.value,name:r.liftName.value,libraryId:r.id,libraryName:r.libraryName.value,linerType:r.linerType}));
 if(!values.length||new Set(values.map(v=>JSON.stringify([v.id,key(v.name),key(v.libraryName)]))).size!==1||!/^[1-9]\d*$/.test(values[0].id))return undefined;
 return values[0];
}
export function resolveDieMaterial(value:string,rows:MaterialMappings=[]){return resolveConfirmedMaterial(value,rows);}

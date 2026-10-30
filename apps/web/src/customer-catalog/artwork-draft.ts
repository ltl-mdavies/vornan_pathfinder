import type {ItemData} from './catalog';

// A resumable local draft, never a production artwork version or approval.
export type ArtworkDraft = {
  file: File | null;
  note: string;
  approval: ItemData['approval'];
  previewing: boolean;
  baseRevision: number;
  savedAt: string;
};
export type ArtworkDraftUpdate = {itemKey:string; draft:ArtworkDraft|null};
export function updateArtworkDrafts(current:Record<string,ArtworkDraft> = {}, update?:ArtworkDraftUpdate) {
  if (!update) return current;
  const next = {...current};
  if (update.draft) next[update.itemKey] = update.draft;
  else delete next[update.itemKey];
  return next;
}

// JSON would silently turn File into {}. Include bytes in local backups instead.
export async function backupArtworkDrafts(drafts:Record<string,ArtworkDraft> = {}) {
  return Object.fromEntries(await Promise.all(Object.entries(drafts).map(async ([key,draft])=>{
    const file=draft.file;
    let base64='';
    if(file){
      const bytes=new Uint8Array(await file.arrayBuffer());
      let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      base64=btoa(binary);
    }
    return [key,{...draft,file:file?{name:file.name,type:file.type,lastModified:file.lastModified,encoding:'base64',data:base64}:null}];
  })));
}

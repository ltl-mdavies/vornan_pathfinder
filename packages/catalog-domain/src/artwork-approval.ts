import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {Item,ItemData} from './catalog.js';
/** Legacy confirmation evidence is deliberately not interpreted by the generic pilot. */
export function readArtworkConfirmation(_data:ItemData,_itemKey?:string):null{return null;}
export type ArtworkVersion={schema:1;url:string;sha256:string;bytes:number;contentType:string;checkedAt:string};
export type ArtworkApproval={schema:1;itemKey:string;url:string;sha256:string;source:'internal';actor:string;at:string};
const maxBytes=50*1024*1024;
const date=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const digest=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function readArtworkVersion(data:ItemData):ArtworkVersion|null{
 try{const v=JSON.parse(data.artworkVersion??'');return v.schema===1&&v.url===data.artwork&&digest(v.sha256)&&Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=maxBytes&&['application/pdf','image/png','image/jpeg'].includes(v.contentType)&&date(v.checkedAt)?v:null;}catch{return null;}
}
export function readArtworkApproval(data:ItemData):ArtworkApproval|null{
 try{const a=JSON.parse(data.artworkApproval??'');return a.schema===1&&a.source==='internal'&&typeof a.itemKey==='string'&&!!a.itemKey&&typeof a.url==='string'&&digest(a.sha256)&&typeof a.actor==='string'&&!!a.actor.trim()&&date(a.at)?a:null;}catch{return null;}
}
export function artworkApprovalProblem(data:ItemData,itemKey?:string):string{
 const v=readArtworkVersion(data),a=readArtworkApproval(data);
 if(data.artworkVersion&&!v)return 'Production file verification is invalid or belongs to a different artwork reference. Verify the current file.';
 if(data.artworkApproval&&(!a||!v||a.url!==v.url||a.sha256!==v.sha256||(itemKey!==undefined&&a.itemKey!==itemKey)))return 'Print approval does not match this item and production file. Verify the file and approve it again.';
 if(data.artworkConfirmation&&!readArtworkConfirmation(data,itemKey))return 'Artwork confirmation no longer matches this approved item and production link.';
 if(data.approval!=='approved')return '';
 if(readArtworkConfirmation(data,itemKey))return '';
 if(!v)return 'Verify the production file before using Approved for print on an order.';
 if(!a)return 'The imported approval is not bound to this file. Confirm approval for the verified production file.';
 return '';
}
export function identifyArtwork(url:string,bytes:Uint8Array,at:string):ArtworkVersion{
 const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('A production HTTP(S) artwork reference is required.');
 if(!bytes.length||bytes.length>maxBytes)throw new Error('Production artwork must be non-empty and no larger than 50 MB.');
 if(!date(at))throw new Error('A valid verification time is required.');
 const pdf=bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70&&bytes[4]===45;
 const png=[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!pdf&&!png&&!jpeg)throw new Error('The production reference did not return a PDF, PNG or JPEG file.');
 return {schema:1,url,sha256:bytesToHex(sha256(bytes)),bytes:bytes.length,contentType:pdf?'application/pdf':png?'image/png':'image/jpeg',checkedAt:at};
}
export async function verifyProductionArtwork(url:string,signal:AbortSignal,verificationEndpoint?:string):Promise<ArtworkVersion>{
 if(verificationEndpoint){const endpoint=new URL(verificationEndpoint,window.location.origin);endpoint.searchParams.set("url",url);const r=await fetch(endpoint,{signal,credentials:"omit",cache:"no-store"});if(!r.ok)throw new Error("Production file verification is unavailable. Try again.");const v=await r.json();if(!readArtworkVersion({artwork:url,artworkVersion:JSON.stringify(v)} as ItemData))throw new Error("File verification returned invalid evidence.");return v;}
 const response=await fetch(url,{signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'});
 if(!response.ok||!response.body)throw new Error('Could not read the production file. Its approval is unchanged.');
 const declared=Number(response.headers.get('content-length'));if(declared>maxBytes){await response.body.cancel();throw new Error('Production artwork exceeds 50 MB.');}
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>maxBytes)throw new Error('Production artwork exceeds 50 MB.');chunks.push(next.value);}}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return identifyArtwork(url,bytes,new Date().toISOString());
}
export function attachArtworkVersion(data:ItemData,v:ArtworkVersion):ItemData{
 if(v.url!==data.artwork)throw new Error('Artwork reference changed during verification. Verify again.');
 const candidate={...data,artworkVersion:JSON.stringify(v)};if(!readArtworkVersion(candidate))throw new Error('Invalid production file verification.');
 const old=readArtworkVersion(data),approval=readArtworkApproval(data);
 const changed=old&&old.sha256!==v.sha256||approval&&(approval.url!==v.url||approval.sha256!==v.sha256);
 return {...candidate,...(changed?{approval:'pending' as const,artworkApproval:undefined,artworkConfirmation:undefined}:{})};
}
export function approveArtwork(data:ItemData,itemKey:string,at:string,internalUser:boolean):ItemData{
 if(!internalUser)throw new Error('Only internal users may approve production artwork.');
 const v=readArtworkVersion(data);if(!v||!itemKey||!date(at))throw new Error('Verify the production file before approving it.');
 return {...data,approval:'approved',artworkApproval:JSON.stringify({schema:1,itemKey,url:v.url,sha256:v.sha256,source:'internal',actor:'Local operator',at} satisfies ArtworkApproval)};
}
export function revokeArtworkApproval(data:ItemData):ItemData{return {...data,approval:'pending',artworkApproval:undefined,artworkConfirmation:undefined};}
export function artworkEvidenceLabel(value?:string):string{
 try{const v=JSON.parse(value??'');return `${v.source?'Internal approval':'Verified file'} · SHA-256 ${String(v.sha256).slice(0,12)}… · ${v.at??v.checkedAt}`;}catch{return 'Not recorded';}
}

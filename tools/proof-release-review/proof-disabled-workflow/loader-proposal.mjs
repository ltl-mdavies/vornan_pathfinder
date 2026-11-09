import {createHash} from 'node:crypto';

// Local integrity experiment only. No credentials, filesystem writes, AWS
// imports, runtime execution or authority. An injected reader is not trusted.
export const names=Object.freeze([
 'bindings.json',
 'original/proof-oidc-release-draft/release-plan.json',
 'original/proof-pdf6-candidate/freeze.json',
 'original/proof-pdf6-candidate/manifest.json',
 'validation-release-record.json',
]);
const fail=()=>{throw Error('Private validation inputs unavailable or invalid');};
const hash=b=>createHash('sha256').update(b).digest('hex');
// Four existing pinned sizes; R retains the runtime staging contract's limit
// until final T/I/W-bound bytes are frozen. Pins still require exact lengths.
const limits=Object.freeze(Object.fromEntries(names.map((name,i)=>[name,[760,2211,5114,183684,65536][i]])));
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===keys.sort().join();

export async function loadPrivateInputsForReview(manifest,readVersion){
 const loaded=new Map();
 try{
  if(!exact(manifest,['files'])||!Array.isArray(manifest.files)||manifest.files.length!==names.length||typeof readVersion!=='function')fail();
  const files=structuredClone(manifest.files);
  if(new Set(files.map(f=>f.name)).size!==names.length||files.some(f=>!names.includes(f.name)))fail();
  for(const f of files){
   if(!exact(f,['name','bucket','key','versionId','bytes','sha256'])||
      typeof f.bucket!=='string'||!/^[-a-z0-9]{3,63}$/.test(f.bucket)||
      typeof f.key!=='string'||!f.key||f.key.length>1024||f.key.split('/').some(p=>!p||p==='.'||p==='..')||
      typeof f.versionId!=='string'||!f.versionId||f.versionId==='null'||f.versionId.length>1024||
      !Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>limits[f.name]||!/^[a-f0-9]{64}$/.test(f.sha256))fail();
  }
  if(new Set(files.map(f=>JSON.stringify([f.bucket,f.key,f.versionId]))).size!==names.length)fail();
  for(const f of files){
   // Reviewed descriptor, not unbounded latest-object or archive extraction.
   // The future transport must enforce streaming limits and a whole-read deadline.
   const response=await readVersion(Object.freeze({...f}));
   if(!exact(response,['versionId','body'])||response.versionId!==f.versionId||!Buffer.isBuffer(response.body)||response.body.length!==f.bytes||hash(response.body)!==f.sha256)fail();
   loaded.set(f.name,Buffer.from(response.body));
  }
  return {status:'local-integrity-only',authenticatedAuthority:false,operationallyReady:false,files:loaded};
 }catch{for(const body of loaded.values())body.fill(0);loaded.clear();fail();}
}

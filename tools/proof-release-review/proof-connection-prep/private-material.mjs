import {bindings} from '../proof-config/bindings.mjs';
import{mkdtempSync,chmodSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import {readReleaseInput} from '../proof-config/release-inputs.mjs';
const plan=JSON.parse(readReleaseInput('proof-oidc-release-draft/release-plan.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
/** Local contract only. Caller supplies verified download bytes, not URLs. */
export async function withPrivateMaterial(options,consumer){
 if(Object.keys(options).some(k=>!['mode','commit','releaseId','bytesByKind'].includes(k)))throw Error('Extra artifact input rejected');
 const{mode,commit,releaseId,bytesByKind}=options;
 if(mode!=='local-review-only'||commit!==plan.candidateCommit||releaseId!==bindings.releaseId||!bytesByKind||Object.keys(bytesByKind).sort().join(',')!=='candidate,rollback,source')throw Error('Artifact binding rejected');
 for(const kind of ['source','candidate','rollback'])if(!Buffer.isBuffer(bytesByKind[kind])||bytesByKind[kind].length>(kind==='source'?64:32)*1024*1024||hash(bytesByKind[kind])!==plan[kind+'ArchiveSha256'])throw Error('Artifact integrity rejected');
 const directory=mkdtempSync(join(tmpdir(),'proof-private-handoff-'));chmodSync(directory,0o700);let active=true;
 try{
  for(const kind of ['source','candidate','rollback'])writeFileSync(join(directory,kind+'.tar.gz'),bytesByKind[kind],{flag:'wx',mode:0o600});
  return await consumer(Object.freeze({directory,read:kind=>{
   if(!active||!['source','candidate','rollback'].includes(kind))throw Error('Material unavailable');
   const bytes=readFileSync(join(directory,kind+'.tar.gz'));if(hash(bytes)!==plan[kind+'ArchiveSha256'])throw Error('Material changed');return bytes;
  }}));
 }finally{active=false;rmSync(directory,{recursive:true,force:true});}
}

import {mkdirSync,writeFileSync,lstatSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {names,loadPrivateInputsForReview} from './loader-proposal.mjs';
// Portable reviewed-reader binding; isolated trusted workspace is required.
import {readBoundedPinnedFile} from '../proof-config/release-inputs.mjs';
const fail=()=>{throw Error('Private runner placement rejected');};
function directory(path){
 if(!path.startsWith('/')||realpathSync(path)!==path)fail();
 for(let p=path;;p=dirname(p)){const s=lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory())fail();if(dirname(p)===p)break;}
}
// No runtime import or spawn. Only isolated local fixture workspaces authorized.
export async function placePrivateInputsForReview(workspace,manifest,loaded){
 const owned=[];
 try{
  directory(workspace);directory(join(workspace,'verifier','tools'));
  const roots=[join(workspace,'private'),join(workspace,'verifier','tools','private')];
  // lstat catches dangling links too; exclusive mkdir below also closes an
  // absent-path race. Existing directories are never reused or overwritten.
  for(const p of roots){try{lstatSync(p);fail();}catch(e){if(e.code!=='ENOENT')throw e;}}
  const checked=await loadPrivateInputsForReview(manifest,async d=>({versionId:d.versionId,body:loaded.files.get(d.name)}));
  for(const p of roots){mkdirSync(p,{mode:0o700});owned.push(p);}
  for(const name of names){
   const root=name===names[4]?roots[0]:roots[1];
   const file=join(root,name);mkdirSync(dirname(file),{recursive:true,mode:0o700});
   writeFileSync(file,checked.files.get(name),{flag:'wx',mode:0o600});
  }
  // Reuse the reviewed bounded, no-symlink descriptor reader. No child launch
  // can be described until every readback succeeds.
  for(const f of manifest.files){const root=f.name===names[4]?roots[0]:roots[1];readBoundedPinnedFile(root,f.name,{bytes:f.bytes,sha256:f.sha256});}
  return {status:'local-placement-readback-only',workspace,authenticatedAuthority:false,operationallyReady:false};
 }catch{
  for(const p of owned.reverse())rmSync(p,{recursive:true,force:true});
  fail();
 }
}

export function runtimeChildEnvironmentForReview(parent){
 // Allowlist, not AWS_* removal alone: drops HOME, profile paths, container
 // credential endpoints, NODE_OPTIONS, proxy/preload and all unrelated secrets.
 const keys=['GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_RUN_ATTEMPT','GITHUB_REF','GITHUB_API_URL','GITHUB_SERVER_URL','GITHUB_RUN_ID','GITHUB_REPOSITORY','GITHUB_SHA','GITHUB_WORKFLOW_SHA','GITHUB_WORKSPACE','GITHUB_JOB','GITHUB_WORKFLOW_REF','GITHUB_TOKEN'];
 const env=Object.fromEntries(keys.filter(k=>typeof parent[k]==='string').map(k=>[k,parent[k]]));
 return {...env,PATH:'/usr/bin:/bin',PROOF_REVIEW_PROFILE:'private',HOME:'/nonexistent',AWS_EC2_METADATA_DISABLED:'true'};
}

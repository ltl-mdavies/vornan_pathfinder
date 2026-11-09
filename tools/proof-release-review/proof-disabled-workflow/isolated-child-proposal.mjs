import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
import {placePrivateInputsForReview,runtimeChildEnvironmentForReview} from './runner-placement-proposal.mjs';
import {loadPrivateInputsForReview} from './loader-proposal.mjs';
import {readBoundedVersion} from './bounded-version-reader.mjs';

export async function bootstrapEntry(){throw Error('HOLD: real descriptor and approved workload identity are not bound');}

// Dependency seams support isolated review only. They cannot confer authority.
// External entry above stays held; this is the same orchestration intended for
// eventual separately reviewed binding, not a second test reconstruction.
export async function composeBootstrapForReview({workspace,manifest,environment={},sendVersion,spawnImpl,timeoutMs=5000}){
 if(typeof sendVersion!=='function'||typeof spawnImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('Bootstrap dependencies unavailable');
 const loaded=await loadPrivateInputsForReview(manifest,d=>readBoundedVersion(sendVersion,d));
 return placedChild(workspace,manifest,loaded,environment,timeoutMs,spawnImpl);
}

// LOCAL TEST COMPOSITION ONLY. No credentials accepted; never live authority.
// Runtime's existing validation contract/guards are unchanged.
export async function runIsolatedValidationForReview(workspace,manifest,loaded,parent={},timeoutMs=5000){
 if(parent.GITHUB_TOKEN!==undefined||parent.GITHUB_ACTIONS==='true'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('Local validation child rejected');
 return placedChild(workspace,manifest,loaded,parent,timeoutMs,spawn);
}

async function placedChild(workspace,manifest,loaded,parent,timeoutMs,spawnImpl){
 await placePrivateInputsForReview(workspace,manifest,loaded);
 try{
  const env=runtimeChildEnvironmentForReview(parent);
  const outcome=await new Promise((resolve,reject)=>{
   const child=spawnImpl(process.execPath,[join(workspace,'verifier/tools/proof-release-review/proof-disabled-workflow/runtime-validation-proposal.mjs')],{cwd:workspace,env,detached:true,stdio:['ignore','pipe','pipe']});
   let timer,failed=false,count=0;const chunks=[];
   const stop=()=>{failed=true;try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
   timer=setTimeout(stop,timeoutMs);
   child.stdout.on('data',b=>{count+=b.length;if(count>4096)stop();else chunks.push(b);});
   child.stderr.on('data',b=>{count+=b.length;if(count>4096)stop();});
   child.on('error',()=>{clearTimeout(timer);reject(Error('Local validation child unavailable'));});
   child.on('close',(code,signal)=>{
    clearTimeout(timer);
    if(failed||signal||![0,78].includes(code)){reject(Error('Local validation child unavailable'));return;}
    try{const r=JSON.parse(Buffer.concat(chunks).toString());
     if(r.authenticatedAuthority!==false||r.operationallyReady!==false||r.validationOnly!==true||!['blocked','snapshot-matches-NOT-AUTHORIZED'].includes(r.status)||(code===0)!==(r.status==='snapshot-matches-NOT-AUTHORIZED'))throw Error();
     resolve({status:r.status,exitCode:code,validationOnly:true,authenticatedAuthority:false,operationallyReady:false});
    }catch{reject(Error('Local validation child unavailable'));}
   });
  });
  return outcome;
 }finally{
  // Roots were absent and exclusively created by placement for this call.
  for(const root of ['private','verifier/tools/private'])rmSync(join(workspace,root),{recursive:true,force:true});
 }
}

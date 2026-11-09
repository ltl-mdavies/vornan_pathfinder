import {verifyOwner} from '../proof-supervised-release/human-verification.mjs';
import {context,digest} from '../proof-approval-lifecycle/lifecycle.mjs';
import {acquirePrivate} from '../proof-single-job-alternative/private-acquisition.mjs';
import {materialize} from '../proof-disabled-rehearsal/materialize.mjs';
import {guardedApprovalWrites} from '../proof-approval-lifecycle/guarded-writes.mjs';
import {publish} from '../proof-guarded-publisher/controller.mjs';
import {releaseRecord,reconcileReadOnly} from '../proof-guarded-publisher/recovery.mjs';
import {deadline} from '../proof-guarded-publisher/bounded-io.mjs';
import {sameRunAudit} from './same-run-audit.mjs';
export function auditLease(audit,input){
 const seen=new Set(),allowed=new Map(input.assets.map(a=>[a.key,a.sha256]));let active=null,stopped=false;
 return{async beforeWrite(key){if(stopped||active||seen.has(key)||!allowed.has(key))throw Error('Single-use write gate');const permit=Object.freeze({key});active=permit;seen.add(key);try{await audit.checkpoint({phase:'intent',key,sha256:allowed.get(key),condition:key==='index.html'?input.baseline.index.etag:'create-only'});if(stopped)throw Error();return permit;}catch{stopped=true;audit.stop();throw Error('Intent uncertain');}},
 async outcome(permit,status){if(stopped||active!==permit||!['confirmed','uncertain'].includes(status))throw Error('Outcome gate');try{await audit.checkpoint({phase:'outcome',key:permit.key,status});active=null;if(status==='uncertain'){stopped=true;audit.stop();}}catch{stopped=true;audit.stop();throw Error('Outcome uncertain');}},
 finish(){if(stopped||active)throw Error('No final handoff');stopped=true;return audit.finish();},stop(){stopped=true;audit.stop();},get stopped(){return stopped;}};
}
/** Disabled composition only; all clients injected, no production factory. */
export async function experimentalPublish({mode,authority,release,jobId,sdk,receipt,manifest,input,transport,start,reviewedStart}){
 if(mode!=='experimental-local-only')throw Error('Disabled');
 const verification=await verifyOwner({mode:'mock-only',authority,release,jobId,purpose:'publish'});
 const files=await acquirePrivate({mode:'mock-only',service:sdk,receipt},h=>materialize(h.read('candidate'),manifest));
 const candidate={...input,files};
 if(input.releaseId!==verification.context.releaseId||digest(input.record)!==verification.context.recordSha256||input.record.artifactSha256!==verification.context.artifactSha256||digest(input.assets)!==digest(input.record.assets)||digest(input.baseline)!==digest(input.record.baseline))throw Error('Publication binding');
 if(digest(input.record)!==digest(releaseRecord({releaseId:input.releaseId,assets:input.assets,baseline:input.baseline},input.record.rollbackAssets,input.record)))throw Error('Noncanonical record');
 const audit=await sameRunAudit({mode,transport,start,reviewedStart,contextDigest:digest(verification.context),invocation:release.runId+':'+release.attempt,maxCheckpoints:10}),lease=auditLease(audit,candidate);
 let result;
 try{result=await publish(candidate,guardedApprovalWrites(input.frontend,lease),{mode:'execute'});if(result.status!=='published'||lease.stopped){lease.stop();return{status:'uncertain',automaticRetry:false,handoffComplete:false,observed:result.status};}return{status:'publication-evidence-only',result,final:lease.finish(),handoffComplete:false,automaticRetry:false};}
 catch{lease.stop();return{status:'uncertain',automaticRetry:false,handoffComplete:false};}
}
export async function experimentalRecover({authority,release,jobId,records,frontend,gate,signal,ms=15000}){
 if(Object.keys(frontend).some(k=>!['kind','read','readConfig'].includes(k))||frontend.kind!=='synthetic'||records.kind!=='synthetic'||gate.kind!=='synthetic')throw Error('Read-only only');
 const v=await deadline(()=>verifyOwner({mode:'mock-only',authority,release,jobId,purpose:'reconcile-unknown'}),{signal,ms});
 const read=fn=>deadline(async s=>{const a=await gate.check({verificationRecordRef:v.privateRecordRef,signal:s});if(a?.allowed!==true||a.verificationRecordRef!==v.privateRecordRef)throw Error('Fresh recovery gate');return fn({signal:s,verificationRecordRef:v.privateRecordRef});},{signal,ms});
 const source=context({...v.context,kind:'publish',runId:v.context.sourceRunId,attempt:v.context.sourceAttempt}),r=await read(o=>records.load(o));
 if(digest(r)!==source.recordSha256||r.artifactSha256!==source.artifactSha256||r.releaseId!==source.releaseId||digest(r)!==digest(releaseRecord({releaseId:r.releaseId,assets:r.assets,baseline:r.baseline},r.rollbackAssets,r)))throw Error('Recovery binding');
 const result=await reconcileReadOnly(r,{read:k=>read(o=>frontend.read(k,o)),readConfig:()=>read(o=>frontend.readConfig(o))});
 return{status:result.status,scope:'entrypoint-and-distribution',automaticRetry:false,handoffComplete:false,auditChainVerified:false};
}

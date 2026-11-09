import {bindings} from '../proof-config/bindings.mjs';
import {bodyHash} from '../proof-supervised-release/anchored-storage.mjs';
import {digest} from '../proof-approval-lifecycle/lifecycle.mjs';
import {validVersionId} from './version-id.mjs';
const fail=()=>{throw Error('Experimental audit stopped; fresh read-only recovery required');};
/** NOT independent retention. No restart/resume. Local experiment only. */
export async function sameRunAudit({mode,transport,start,reviewedStart,contextDigest,invocation,maxCheckpoints=16}){
 if(mode!=='experimental-local-only'||transport?.kind!=='synthetic'||digest(start)!==digest(reviewedStart)||start?.sequence!==0||!/^\d+:\d+$/.test(invocation)||!/^[a-f0-9]{64}$/.test(contextDigest))fail();
 const prefix='proof/releases/proof-pdf6-be74e0055210/evidence/supervised/';
 if(!Number.isInteger(maxCheckpoints)||maxCheckpoints<1||maxCheckpoints>16)fail();
 if(start.key!==prefix+'anchor-000000.json'||!validVersionId(start.versionId))fail();
 const first=await transport.get(start.key);if(!first||!validVersionId(first.versionId)||first.versionId!==start.versionId||bodyHash(first.body)!==start.bodySha256)fail();
 let startRecord;try{startRecord=JSON.parse(first.body);}catch{fail();}
 if(startRecord?.schema!==1||startRecord.releaseId!==bindings.releaseId||startRecord.contextDigest!==contextDigest||startRecord.invocation!==invocation||startRecord.sequence!==0)fail();
 const key=(n,type)=>prefix+(type==='intent'?'transition-':'anchor-')+String(n).padStart(6,'0')+(type==='intent'?'.intent.json':'.json');
 let n=0,stopped=false,finished=false,current=structuredClone(start);
 // Exclusive claim persists even if execution dies before its first checkpoint.
 const claim={kind:'EXPERIMENTAL_SAME_RUN_AUDIT',invocation,contextDigest,start};
 const claimBody=Buffer.from(JSON.stringify(claim)),ack=await transport.create(key(1,'intent'),claimBody);
 if(!validVersionId(ack?.versionId))fail();
 const stored=await transport.get(key(1,'intent'));
 if(!stored||!validVersionId(stored.versionId)||stored.versionId!==ack.versionId||bodyHash(stored.body)!==bodyHash(claimBody))fail();
 async function checkpoint(record){if(stopped||finished||n===maxCheckpoints)fail();try{
  const next=n+1,body=Buffer.from(JSON.stringify({kind:claim.kind,invocation,contextDigest,sequence:next,prior:current,record}));
  const ack=await transport.create(key(next,'anchor'),body),read=await transport.get(key(next,'anchor'));
  if(!validVersionId(ack?.versionId)||!validVersionId(read?.versionId)||ack.versionId!==read.versionId||bodyHash(read.body)!==bodyHash(body))fail();
  current={key:key(next,'anchor'),sequence:next,versionId:read.versionId,bodySha256:bodyHash(body)};n=next;return structuredClone(current);
 }catch{stopped=true;fail();}}
 return Object.freeze({guarantee:'publisher-controlled-audit-not-independent-retention',checkpoint,
 finish(){if(stopped||finished||n===0)fail();finished=true;return{status:'publication-evidence-only',handoffComplete:false,requiresSeparateTechnicalReview:true,automaticRetry:false,invocation,contextDigest,start,final:structuredClone(current)};},stop(){stopped=true;}});
}

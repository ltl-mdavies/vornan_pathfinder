import {bindings} from '../proof-config/bindings.mjs';
import {randomUUID} from 'node:crypto';
import {context,digest} from '../proof-approval-lifecycle/lifecycle.mjs';
const fail=()=>{throw Error('Recorded owner verification required');};
/** A synthetic boundary for recorded human verification; NOT GitHub API provenance. */
export async function verifyOwner({mode,authority,release,jobId,purpose}){
 if(mode!=='mock-only'||authority?.kind!=='synthetic'||!['publish','inspect','reconcile-unknown'].includes(purpose)||typeof jobId!=='string'||!/^[1-9][0-9]*$/.test(jobId))fail();
 const c=context(release);
 if((purpose==='publish')!==(c.kind==='publish'))fail();
 const invocationId=randomUUID(),request={invocationId,contextDigest:digest(c),jobId,purpose};
 let d;try{d=structuredClone(await authority.review(request));}catch{fail();}
 if(!d||d.evidenceKind!=='recorded-human-verification'||d.ownerId!==bindings.ownerId||d.approved!==true||d.invocationId!==invocationId||d.contextDigest!==request.contextDigest||d.jobId!==jobId||d.purpose!==purpose||typeof d.privateRecordRef!=='string'||!/^owner-review-[a-zA-Z0-9_-]{1,100}$/.test(d.privateRecordRef))fail();
 return Object.freeze({context:c,...request,evidenceKind:d.evidenceKind,privateRecordRef:d.privateRecordRef,automatedGithubProvenance:false});
}

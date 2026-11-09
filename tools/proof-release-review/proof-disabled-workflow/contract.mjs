import {bindings} from '../proof-config/bindings.mjs';
import {readReleaseInput} from '../proof-config/release-inputs.mjs';
import {sha256} from '../proof-guarded-publisher/controller.mjs';
import {materialize} from '../proof-disabled-rehearsal/materialize.mjs';
import {validVersionId} from '../proof-disabled-sdk/version-id.mjs';
import {releaseRecord} from '../proof-guarded-publisher/recovery.mjs';
import {context,digest} from '../proof-approval-lifecycle/lifecycle.mjs';
const frozen=JSON.parse(readReleaseInput('proof-oidc-release-draft/release-plan.json'));
const manifest=JSON.parse(readReleaseInput('proof-pdf6-candidate/freeze.json')).assets;
const need=(ok,label)=>{if(!ok)throw Error('Offline contract rejected: '+label);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
// Shared by execution planning and fixed-scope review text; canonical shape alone
// must never authorize describing a different package as this reviewed release.
function candidateRecord(record){
 const canonical=releaseRecord(record,record.rollbackAssets,record);
 need(digest(record)===digest(canonical),'canonical release record');
 need(record.releaseId===bindings.releaseId&&record.artifactSha256===frozen.candidateArchiveSha256&&digest(record.assets)===digest(manifest.map(a=>({key:a.path,sha256:a.sha256})))&&record.sourceManifestSha256===sha256(readReleaseInput('proof-pdf6-candidate/manifest.json')),'record candidate binding');
 return canonical;
}
/** Pure offline contract. A valid receipt shape does NOT authenticate its author. */
export function validateOffline(input,archive,{now=Date.now(),proposedMaxReceiptLifetimeMs=null}={}){
 need(exact(input,['mode','repository','ref','commit','artifactSha256','runId','attempt','jobId','sourceRunId','sourceAttempt','recordSha256','sourceRecord','ownerReceipt']),'fields');
 need(['publish','recovery'].includes(input.mode),'mode');
 need(input.repository===frozen.repository&&input.ref===frozen.ref,'repository/ref');
 need(input.commit===frozen.candidateCommit&&input.artifactSha256===frozen.candidateArchiveSha256,'candidate');
 for(const key of ['runId','attempt','jobId'])need(typeof input[key]==='string'&&/^[1-9]\d*$/.test(input[key]),key);
 const c=context({kind:input.mode,runId:input.runId,attempt:input.attempt,sourceRunId:input.sourceRunId,sourceAttempt:input.sourceAttempt,commit:input.commit,artifactSha256:input.artifactSha256,releaseId:bindings.releaseId,recordSha256:input.recordSha256});
 const source=context({...c,kind:'publish',runId:c.sourceRunId,attempt:c.sourceAttempt});
 need(exact(input.sourceRecord,['source','record'])&&digest(input.sourceRecord.source)===digest(source),'source binding');
 const record=input.sourceRecord.record;
 candidateRecord(record);
 need(digest(record)===c.recordSha256,'canonical release record');
 const keys=invocationKeys(input),r=input.ownerReceipt;
 need(exact(r,['ownerId','decision','purpose','runId','attempt','jobId','sourceRunId','sourceAttempt','recordSha256','commit','artifactSha256','issuedAt','expiresAt','key','versionId','bodySha256']),'receipt fields');
 need(r.ownerId===bindings.ownerId&&r.decision==='approved'&&r.purpose===input.mode,'owner decision');
 for(const key of ['runId','attempt','jobId','sourceRunId','sourceAttempt','recordSha256','commit','artifactSha256'])need(r[key]===input[key],'receipt '+key);
 need(Number.isSafeInteger(now)&&Number.isSafeInteger(r.issuedAt)&&Number.isSafeInteger(r.expiresAt)&&r.issuedAt<=now&&r.expiresAt>now,'receipt freshness');
 if(proposedMaxReceiptLifetimeMs!==null){need(Number.isSafeInteger(proposedMaxReceiptLifetimeMs)&&proposedMaxReceiptLifetimeMs>0,'proposed lifetime');need(r.expiresAt-r.issuedAt<=proposedMaxReceiptLifetimeMs,'proposed lifetime exceeded');}
 need(r.key===keys.authority&&validVersionId(r.versionId)&&/^[a-f0-9]{64}$/.test(r.bodySha256),'private receipt reference');
 let files;
 if(input.mode==='publish'){need(Buffer.isBuffer(archive)&&sha256(archive)===frozen.candidateArchiveSha256,'archive digest');files=materialize(archive,manifest);need(sha256(files.get('index.html'))===frozen.candidateIndexSha256,'index digest');}
 else need(archive===undefined,'recovery must not acquire archive');
 const old=new Map(record.rollbackAssets.map(o=>[o.key,o.sha256]));
 const gates=['fresh-owner-run-stop','exact-artifact-hash','durable-intent-readback','live-config-function-versioning-index','fresh-owner-run-stop-immediately-before-write'];
 const writes=[];
 for(const a of manifest){if(a.path==='index.html')continue;if(old.has(a.path)){need(old.get(a.path)===a.sha256,'reusable asset collision');continue;}
  need(/^assets\/.+-[A-Za-z0-9_-]{8}\.(js|mjs|css)$/.test(a.path),'new asset');writes.push({operation:'PutObject',key:a.path,sha256:a.sha256,ifNoneMatch:'*',gates:[...gates],after:'durable-outcome-readback'});
 }
 need(writes.length===4,'four reviewed assets');
 const index=record.baseline.index;
 writes.push({operation:'PutObject',key:'index.html',sha256:frozen.candidateIndexSha256,ifMatch:index.etag,parentVersion:index.versionId,gates:[...gates],after:'durable-outcome-readback'});
 return{status:'offline-contract-valid-NOT-AUTHORIZED',mode:input.mode,operationallyReady:false,
  target:{account:frozen.account,region:frozen.region,bucket:frozen.frontendBucket,distribution:frozen.distribution},
  artifactSha256:frozen.candidateArchiveSha256,fileCount:files?.size??null,source,recordSha256:c.recordSha256,
  writes:input.mode==='publish'?writes:[],recoveryReads:['private-release-record','fresh-owner-run-receipt','distribution-config','LIVE-function','bucket-versioning','index.html'],
  authority:{retainedInitial:frozen.archivePrefix+'evidence/supervised/owner-review.json',freshInvocationKey:keys.authority,revalidate:'authenticated current decision required before every effect; retained object alone is not fresh proof',implemented:false},
  freshness:{proposedMaxReceiptLifetimeMs,approvedPolicy:false},
  finalReceipt:input.mode==='publish'?{bucket:frozen.archiveBucket,key:keys.final,condition:'create-only',readback:'exact version and SHA256',retention:'no automatic expiry',implemented:false}:null,
  maxAttempts:1,automaticRetry:false,automaticInvalidation:false,delete:false,
  unresolved:['authenticated owner/run provenance','durable private evidence adapter and approved exact final-receipt policy','official IAM/quota acceptance','renewed live baseline/rollback','approved source staging and operational wiring'],
  note:'Snapshot baseline only. Gates describe required order; live execution is unimplemented and unconditionally blocked.'};
}
export function invocationKeys(input){
 need(['publish','recovery'].includes(input.mode),'invocation mode');for(const k of ['runId','attempt','jobId'])need(typeof input[k]==='string'&&/^[1-9]\d{0,19}$/.test(input[k]),'bounded invocation');
 const prefix=frozen.archivePrefix+'evidence/supervised/invocations/'+input.mode+'-'+input.runId+'-'+input.attempt+'-'+input.jobId+'/';return{authority:prefix+'owner-review.json',final:prefix+'final.json'};
}
/** Exact resource-set delta for review, not an IAM policy or operational grant. */
export function resourceDelta(input){
 const keys=invocationKeys(input),arn=k=>'arn:aws:s3:::'+frozen.archiveBucket+'/'+k;
 for(const k of ['sourceRunId','sourceAttempt'])need(typeof input[k]==='string'&&/^[1-9]\d{0,19}$/.test(input[k]),'source resource');
 const source=arn(frozen.archivePrefix+'evidence/supervised/source-'+input.sourceRunId+'-'+input.sourceAttempt+'.json'),record=arn(frozen.archivePrefix+'release.json');
 return{status:'UNAPPLIED resource proposal',removeFreshUseOf:'arn:aws:s3:::'+frozen.archiveBucket+'/'+frozen.archivePrefix+'evidence/supervised/owner-review.json',
  authorityRecorder:{role:'archive',exclusive:input.mode==='publish'?[source,arn(keys.authority)]:[arn(keys.authority)],read:input.mode==='publish'?[source,arn(keys.authority)]:[arn(keys.authority)],provenanceImplemented:false},
  consumer:{role:input.mode==='publish'?'publisher':'recovery',read:input.mode==='publish'?[record,source,arn(keys.authority),arn(keys.final)]:[record,source,arn(keys.authority)],exclusive:input.mode==='publish'?[arn(keys.final)]:[],conditional:[]},
  restrictions:'Replace complete allow AND explicit-deny resource sets together. No policy has been changed; no wildcard expansion.'};
}
/** No injectable callbacks or boolean overrides can turn this into a publisher. */
export function operationalEntry(){throw Error('HOLD: live publisher and recovery wiring are not authorized or implemented');}

/** Proposed review text from existing canonical record, never release authority.
 * reviewedTooling is a caller expectation; provenance remains unimplemented.
 */
export function packageApprovalPreview(record,invocation,reviewedTooling,purpose='release'){
 need(['release','validation-only'].includes(purpose),'approval purpose');
 const r=candidateRecord(record);
 need(r.schema===2,'canonical tooling record required');
 need(reviewedTooling&&digest(r.tooling)===digest(reviewedTooling),'reviewed tooling mismatch');
 need(invocation?.attempt==='1'&&['publish','recovery'].includes(invocation.mode),'approval invocation');
 invocationKeys(invocation);
 const environment=invocation.mode==='publish'?'proof-release-owner':'proof-release-recovery';
 const recordSha256=digest(r);
 const statement=purpose==='validation-only'
  ?`Authorize read-only Proof validation of package ${recordSha256} for run ${invocation.runId}, attempt 1, job ${invocation.jobId}, environment ${environment}. No publication authorized.`
  :`Approve Proof package ${recordSha256} for ${invocation.mode} run ${invocation.runId}, attempt 1, job ${invocation.jobId}, environment ${environment}.`;
 return{status:'PROPOSED PREVIEW — NOT RELEASE CONSENT',recordSha256,statement,environment,environmentId:invocation.mode==='publish'?bindings.environments['proof-release-owner']:bindings.environments['proof-release-recovery'],authenticatedAuthority:false,operationallyReady:false,
  brief:{change:'Proof PDF library/rendering and load cleanup only.',scope:'No Pathfinder intake, API, Order Status or customer activation changes.',risk:'Live baseline, rollback and permission checks remain required.',recovery:'Stop on an uncertain write; separately reviewed read-only recovery, no blind retry.',toolingCommit:r.tooling.commit,artifactSha256:r.artifactSha256}};
}
export function matchProposedPackageComment({record,invocation,reviewedTooling,reviews,run,job,purpose='release',runtimeWorkflow}){
 const preview=packageApprovalPreview(record,invocation,reviewedTooling,purpose);
 need(runtimeWorkflow===undefined||purpose==='validation-only','runtime override forbidden for release');
 const workflow=runtimeWorkflow??record.tooling;
 need(/^[a-f0-9]{40}$/.test(workflow?.commit)&&workflow.workflowPath===record.tooling.workflowPath,'runtime workflow identity');
 need(run?.repository?.full_name===frozen.repository&&String(run.id)===invocation.runId&&run.run_attempt===1&&run.head_sha===workflow.commit&&run.path===workflow.workflowPath&&run.status==='in_progress'&&run.conclusion===null,'current tooling run required');
 need(String(job?.id)===invocation.jobId&&String(job.run_id)===invocation.runId&&job.run_attempt===1&&job.head_sha===workflow.commit&&job.status==='in_progress'&&job.conclusion===null,'current job required');
 need(Array.isArray(reviews)&&reviews.length===1,'unambiguous explicit review required');
 const review=reviews[0];
 need(review?.state==='approved'&&review.user?.id===bindings.ownerId&&review.user?.type==='User','explicit owner approval required');
 need(Array.isArray(review.environments)&&review.environments.length===1&&review.environments[0].id===preview.environmentId&&review.environments[0].name===preview.environment,'exact environment required');
 need(review.comment===preview.statement,'exact package comment required');
 return{status:'proposed-comment-matches-NOT-AUTHORIZED',recordSha256:preview.recordSha256,authenticatedAuthority:false,operationallyReady:false};
}

import {readReleaseInput,releaseInputNames} from '../proof-config/release-inputs.mjs';
import {bindings} from '../proof-config/bindings.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
import {validateOffline,operationalEntry,invocationKeys,resourceDelta,packageApprovalPreview,matchProposedPackageComment} from './contract.mjs';
import {retainOfflineApproval,retainOfflineFinal,retainReference,requireTrustedAuthority} from './evidence.mjs';
import {releaseRecord} from '../proof-guarded-publisher/recovery.mjs';import {digest} from '../proof-approval-lifecycle/lifecycle.mjs';import {sha256} from '../proof-guarded-publisher/controller.mjs';
const root=new URL('../',import.meta.url),plan=JSON.parse(readReleaseInput('proof-oidc-release-draft/release-plan.json')),archive=readReleaseInput('proof-clean-package-v1/candidate.tar.gz');
const now=1800000000000;
for(const fault of ['none','source-key','source-body','authority-key','authority-body','version','hash','bucket','lost-final'])test('isolated final composition '+fault,async()=>{
 const x=input(),objects=new Map();let writes=0,closed=false;
 const client={kind:'synthetic',close(){closed=true;},async put({key,body}){
  assert.equal(closed,false);if(objects.has(key))throw Error('exists');writes++;
  objects.set(key,{body:Buffer.from(body),versionId:'v'+writes});
  if(fault==='lost-final'&&writes===3)throw Error('lost acknowledgement');
  return{versionId:'v'+writes};
 },async get({Key}){const o=objects.get(Key);return{Body:o.body,VersionId:o.versionId,ContentLength:o.body.length};}};
 const sourceKey=plan.archivePrefix+'evidence/supervised/source-123-1.json';
 const source=await retainReference(client,plan.archiveBucket,sourceKey,fault==='source-body'?{}:x.sourceRecord);
 const authority=await retainReference(client,plan.archiveBucket,invocationKeys(x).authority,fault==='authority-body'?{}:x);
 if(fault==='source-key')source.key+='-other';if(fault==='authority-key')authority.key+='-other';
 if(fault==='version')authority.versionId='wrong';if(fault==='hash')source.bodySha256='0'.repeat(64);
 const options={client,bucket:fault==='bucket'?'other':plan.archiveBucket,input:x,archive,now,source,authority};
 if(fault==='none'){
  const result=await retainOfflineFinal(options);assert.equal(writes,3);
  for(const k of ['authenticatedAuthority','operationallyReady','handoffComplete','automaticRetry'])assert.equal(result[k],false);
  assert.equal(result.ref.key,invocationKeys(x).final);
  assert.throws(()=>operationalEntry(result),/HOLD/);assert.throws(()=>requireTrustedAuthority(result),/HOLD/);
 }else{await assert.rejects(()=>retainOfflineFinal(options));assert.equal(writes,fault==='lost-final'?3:2);assert.equal(closed,fault==='lost-final');}
});
// Synthetic tooling tuple only; no actual reviewed tooling pin is selected.
function proposedCommentFixture(){
 const original=input().sourceRecord.record;
 const tooling={repository:plan.repository,commit:'a'.repeat(40),workflowPath:'.github/workflows/proof-frontend.yml',workflowSha256:'b'.repeat(64),inventorySha256:'c'.repeat(64)};
 const record=releaseRecord(original,original.rollbackAssets,{...original,tooling});
 const invocation={mode:'publish',runId:'123',attempt:'1',jobId:'456'};
 const p=packageApprovalPreview(record,invocation,tooling);
 return{record,invocation,reviewedTooling:tooling,reviews:[{state:'approved',user:{id:bindings.ownerId,type:'User'},environments:[{id:p.environmentId,name:p.environment}],comment:p.statement}],run:{repository:{full_name:plan.repository},id:123,run_attempt:1,head_sha:tooling.commit,path:tooling.workflowPath,status:'in_progress',conclusion:null},job:{id:456,run_id:123,run_attempt:1,head_sha:tooling.commit,status:'in_progress',conclusion:null}};
}
test('proposed brief and exact statement derive from same canonical record; still no authority',()=>{
 const f=proposedCommentFixture(),p=packageApprovalPreview(f.record,f.invocation,f.reviewedTooling);
 assert.equal(p.recordSha256,digest(f.record));assert.ok(p.statement.includes(p.recordSha256));assert.equal(p.brief.artifactSha256,f.record.artifactSha256);
 assert.equal(matchProposedPackageComment(f).authenticatedAuthority,false);assert.equal(matchProposedPackageComment(f).operationallyReady,false);assert.throws(operationalEntry,/HOLD/);
 const x=input();x.sourceRecord.record=f.record;x.recordSha256=digest(f.record);x.sourceRecord.source.recordSha256=x.recordSha256;x.ownerReceipt.recordSha256=x.recordSha256;
 assert.equal(validateOffline(x,archive,{now}).operationallyReady,false);
});
for(const [label,change] of Object.entries({
 missingTooling:f=>delete f.record.tooling,toolingCommit:f=>f.record.tooling.commit='d'.repeat(40),workflowBytes:f=>f.record.tooling.workflowSha256='d'.repeat(64),inventory:f=>f.record.tooling.inventorySha256='d'.repeat(64),
 archive:f=>f.record.artifactSha256='d'.repeat(64),source:f=>f.record.sourceManifestSha256='d'.repeat(64),commentWhitespace:f=>f.reviews[0].comment+=' ',commentAbsent:f=>delete f.reviews[0].comment,ambiguous:f=>f.reviews.push(f.reviews[0]),missingReview:f=>f.reviews=[],
 owner:f=>f.reviews[0].user.id=1,environment:f=>f.reviews[0].environments[0].id=1,run:f=>f.run.id=124,attempt:f=>f.run.run_attempt=2,job:f=>f.job.id=457,cancellation:f=>f.run.conclusion='cancelled',wrongWorkflow:f=>f.run.path='.github/workflows/other.yml'
}))test('proposed comment rejects '+label,()=>{const f=proposedCommentFixture();change(f);assert.throws(()=>matchProposedPackageComment(f));});
test('validation consent and release consent cannot substitute for each other',()=>{
 const f=proposedCommentFixture(),validation=packageApprovalPreview(f.record,f.invocation,f.reviewedTooling,'validation-only');
 assert.ok(!validation.statement.includes('for publish'));assert.ok(validation.statement.endsWith('No publication authorized.'));
 assert.throws(()=>matchProposedPackageComment({...f,purpose:'validation-only'}));
 f.reviews[0].comment=validation.statement;
 assert.equal(matchProposedPackageComment({...f,purpose:'validation-only'}).authenticatedAuthority,false);
 assert.throws(()=>matchProposedPackageComment(f));
});
test('validation distinguishes launcher commit from verifier commit without changing release matching',()=>{
 const f=proposedCommentFixture(),runtimeWorkflow={commit:'e'.repeat(40),workflowPath:f.record.tooling.workflowPath};
 f.run.head_sha=runtimeWorkflow.commit;f.job.head_sha=runtimeWorkflow.commit;
 f.reviews[0].comment=packageApprovalPreview(f.record,f.invocation,f.reviewedTooling,'validation-only').statement;
 assert.equal(matchProposedPackageComment({...f,purpose:'validation-only',runtimeWorkflow}).operationallyReady,false);
 assert.throws(()=>matchProposedPackageComment({...f,runtimeWorkflow}));
 assert.throws(()=>matchProposedPackageComment({...f,purpose:'validation-only'}));
});
function isolatedRetention(){
 let writes=0,stored;
 return {get writes(){return writes;},client:{kind:'synthetic',close(){},async put({body}){writes++;stored=Buffer.from(body);return{versionId:'local-v1'};},async get(){return{VersionId:'local-v1',Body:stored,ContentLength:stored.length};}}};
}
for(const [label,change]of Object.entries({
 archive:r=>r.artifactSha256='e'.repeat(64),sourceManifest:r=>r.sourceManifestSha256='e'.repeat(64),release:r=>r.releaseId='other-reviewed-release',assetHash:r=>r.assets[0].sha256='e'.repeat(64),assetList:r=>r.assets.push({key:'assets/other-ABCDEFGH.js',sha256:'e'.repeat(64)})
}))for(const target of ['preview','matcher'])test('frozen binding rejects self-consistent '+label+' in '+target,()=>{
 const f=proposedCommentFixture();change(f.record);
 // Deliberately canonicalize and recompute consent text; stale comments are not
 // the reason this test must fail. Both paths must enforce the frozen package.
 f.record=releaseRecord(f.record,f.record.rollbackAssets,f.record);
 const i=f.invocation;
 f.reviews[0].comment=`Approve Proof package ${digest(f.record)} for ${i.mode} run ${i.runId}, attempt 1, job ${i.jobId}, environment proof-release-owner.`;
 assert.throws(()=>target==='preview'?packageApprovalPreview(f.record,i,f.reviewedTooling):matchProposedPackageComment(f),/record candidate binding/);
});
test('validated exact package is retained only as unauthenticated offline evidence',async()=>{
 const c=isolatedRetention(),r=await retainOfflineApproval({client:c.client,bucket:plan.archiveBucket,input:input(),archive,now});
 assert.equal(c.writes,1);assert.equal(r.integrityVerified,true);assert.equal(r.authenticatedAuthority,false);assert.equal(r.operationallyReady,false);
 assert.throws(requireTrustedAuthority,/HOLD/);assert.throws(operationalEntry,/HOLD/);
});
for(const [label,change]of Object.entries({
 archive:x=>x.artifactSha256='0'.repeat(64),sourceDigest:x=>x.recordSha256='0'.repeat(64),sourceRecord:x=>x.sourceRecord.record.target.bucket='other',run:x=>x.runId='124',attempt:x=>x.attempt='2',job:x=>x.jobId='457',owner:x=>x.ownerReceipt.ownerId=1,missingReview:x=>delete x.ownerReceipt,ambiguousReview:x=>x.ownerReceipt=[x.ownerReceipt,x.ownerReceipt],cancelled:x=>x.ownerReceipt.decision='cancelled',unreviewedTooling:x=>x.toolingSha256='0'.repeat(64),unreviewedEnvironment:x=>x.environment='other'
}))test('composition rejects '+label+' before retention',async()=>{
 const c=isolatedRetention(),x=input();change(x);
 await assert.rejects(()=>retainOfflineApproval({client:c.client,bucket:plan.archiveBucket,input:x,archive,now}));assert.equal(c.writes,0);
});
test('composition rejects altered bytes, other bucket, live client and recovery before retention',async()=>{
 const c=isolatedRetention(),bad=Buffer.from(archive);bad[100]^=1;
 for(const overrides of [{archive:bad},{bucket:'other'},{client:{...c.client,kind:'live'}},{input:input('recovery'),archive:undefined}]){
  await assert.rejects(()=>retainOfflineApproval({client:c.client,bucket:plan.archiveBucket,input:input(),archive,now,...overrides}));
 }
 assert.equal(c.writes,0);
});
function input(mode='publish'){
 const prior=JSON.parse(readReleaseInput('proof-release-prep/baseline-and-plan.json')),assets=JSON.parse(readReleaseInput('proof-pdf6-candidate/freeze.json')).assets.map(a=>({key:a.path,sha256:a.sha256})),i=prior.objects.find(o=>o.key==='index.html');
 const record=releaseRecord({releaseId:bindings.releaseId,assets,baseline:{index:{versionId:i.VersionId,etag:i.ETag,sha256:i.sha256,metadata:{contentType:i.ContentType,cacheControl:i.CacheControl??null,contentEncoding:i.ContentEncoding??null,serverSideEncryption:i.ServerSideEncryption}},configFingerprint:prior.distributionConfigSha256,configEtag:prior.distributionETag}},prior.objects.map(o=>({key:o.key,sha256:o.sha256})),{sourceManifestSha256:sha256(readReleaseInput('proof-pdf6-candidate/manifest.json')),artifactSha256:plan.candidateArchiveSha256});
 const binding={runId:mode==='publish'?'123':'789',attempt:'1',jobId:'456',sourceRunId:'123',sourceAttempt:'1',recordSha256:digest(record),commit:plan.candidateCommit,artifactSha256:plan.candidateArchiveSha256};
 const source={kind:'publish',runId:'123',attempt:'1',sourceRunId:'123',sourceAttempt:'1',commit:binding.commit,artifactSha256:binding.artifactSha256,releaseId:record.releaseId,recordSha256:binding.recordSha256};
 return{mode,repository:plan.repository,ref:plan.ref,...binding,sourceRecord:{source,record},ownerReceipt:{...binding,ownerId:bindings.ownerId,decision:'approved',purpose:mode,issuedAt:now-1000,expiresAt:now+1000,key:invocationKeys({mode,...binding}).authority,versionId:'test-version',bodySha256:'a'.repeat(64)}};
}
test('reviewed archive produces exact four conditional assets then index, never authority',()=>{
 const r=validateOffline(input(),archive,{now});assert.equal(r.fileCount,16);assert.equal(r.writes.length,5);assert.ok(r.writes.slice(0,4).every(w=>w.ifNoneMatch==='*'&&w.key.startsWith('assets/')));assert.equal(r.writes[4].key,'index.html');assert.ok(r.writes[4].ifMatch);assert.ok(r.writes[4].parentVersion);
 assert.deepEqual(r.target,{account:plan.account,region:plan.region,bucket:plan.frontendBucket,distribution:plan.distribution});assert.ok(r.writes.every(w=>w.gates[0]==='fresh-owner-run-stop'&&w.gates.at(-1)==='fresh-owner-run-stop-immediately-before-write'));assert.equal(r.operationallyReady,false);assert.equal(r.automaticRetry,false);assert.equal(r.delete,false);assert.equal(r.automaticInvalidation,false);assert.equal(r.finalReceipt.implemented,false);
});
test('separate recovery contract has no writes or archive dependency',()=>{const r=validateOffline(input('recovery'),undefined,{now});assert.deepEqual(r.writes,[]);assert.equal(r.fileCount,null);assert.equal(r.finalReceipt,null);assert.ok(r.recoveryReads.includes('index.html'));assert.equal(r.operationallyReady,false);assert.throws(()=>validateOffline(input('recovery'),archive,{now}));});
for(const [label,change]of Object.entries({
 repository:x=>x.repository='other/repo',ref:x=>x.ref='refs/heads/other',commit:x=>x.commit='a'.repeat(40),artifact:x=>x.artifactSha256='a'.repeat(64),run:x=>x.runId='999',attempt:x=>x.attempt='2',job:x=>x.jobId='789',owner:x=>x.ownerReceipt.ownerId=1,decision:x=>x.ownerReceipt.decision='denied',purpose:x=>x.ownerReceipt.purpose='recovery',expired:x=>x.ownerReceipt.expiresAt=now,future:x=>x.ownerReceipt.issuedAt=now+1,receiptKey:x=>x.ownerReceipt.key='elsewhere',version:x=>x.ownerReceipt.versionId='null',digest:x=>x.ownerReceipt.bodySha256='bad',extraTarget:x=>x.bucket='other',override:x=>x.execute=true,missingReceipt:x=>delete x.ownerReceipt,sourceRun:x=>x.sourceRunId='999',sourceAttempt:x=>x.sourceAttempt='2',recordHash:x=>x.recordSha256='a'.repeat(64),canonical:x=>x.sourceRecord.record.extra=true,sourceRecord:x=>x.sourceRecord.source.runId='999',retainedReceipt:x=>x.ownerReceipt.key=plan.archivePrefix+'evidence/supervised/owner-review.json'
}))test('rejects '+label,()=>{const x=input();change(x);assert.throws(()=>validateOffline(x,archive,{now}));});
test('changed archive cannot enter plan',()=>{const altered=Buffer.from(archive);altered[100]^=1;assert.throws(()=>validateOffline(input(),altered,{now}));});
test('operational entry rejects even complete fabricated affirmative evidence',()=>{assert.throws(()=>operationalEntry(input(),{approved:true,send(){throw Error('must not call');}}),/HOLD/);});
for(const mode of ['--publish','--recover','--execute','--offline-plan'])test('CLI fails closed '+mode,()=>{const r=spawnSync(process.execPath,[new URL('./cli.mjs',import.meta.url).pathname,mode],{encoding:'utf8'});assert.equal(r.status,78);assert.equal(r.stdout,'');assert.match(r.stderr,/No actions performed/);});
test('workflow remains disabled, permissionless and outside active workflows',()=>{const path=new URL('./frontend-only.yml.template',import.meta.url);assert.ok(!path.pathname.includes('/.github/'));const s=readFileSync(path,'utf8');assert.equal((s.match(/if: \$\{\{ false \}\}/g)||[]).length,2);assert.equal((s.match(/run: exit 78/g)||[]).length,2);assert.ok(!/id-token: write|aws |s3 sync|cloudformation|lambda|--delete|create-invalidation|curl |uses:/.test(s));});
test('freshness maximum is explicitly proposed configurable, not an owner-selected hour',()=>{const x=input();x.ownerReceipt.expiresAt=now+7200000;assert.equal(validateOffline(x,archive,{now}).freshness.proposedMaxReceiptLifetimeMs,null);assert.throws(()=>validateOffline(x,archive,{now,proposedMaxReceiptLifetimeMs:3600000}));assert.equal(validateOffline(x,archive,{now,proposedMaxReceiptLifetimeMs:10800000}).freshness.approvedPolicy,false);});
test('recovery requires distinct current run and exact immutable source record',()=>{const x=input('recovery');x.runId=x.sourceRunId;x.ownerReceipt.runId=x.runId;x.ownerReceipt.key=invocationKeys(x).authority;assert.throws(()=>validateOffline(x,undefined,{now}));const y=input('recovery');y.sourceRecord.record.target.bucket='other';y.recordSha256=digest(y.sourceRecord.record);y.ownerReceipt.recordSha256=y.recordSha256;y.sourceRecord.source.recordSha256=y.recordSha256;assert.throws(()=>validateOffline(y,undefined,{now}));});
test('publish and recovery cannot reuse retained or prior invocation authority',()=>{const p=input(),r=input('recovery');assert.notEqual(p.ownerReceipt.key,r.ownerReceipt.key);r.ownerReceipt.key=p.ownerReceipt.key;assert.throws(()=>validateOffline(r,undefined,{now}));});
test('bounded concrete role/resource delta aligns all offline reads and effects without widening recovery',()=>{
 const scopes=JSON.parse(readReleaseInput('proof-disabled-sdk/audit-policies-proposed/scope-review.json')).scopes;
 for(const mode of ['publish','recovery']){const x=input(mode),delta=resourceDelta(x),role=delta.consumer.role,s=structuredClone(scopes[role]);
  s.read=s.read.filter(k=>k!==delta.removeFreshUseOf);s.read=[...new Set([...s.read,...delta.consumer.read])];s.exclusive=[...new Set([...s.exclusive,...delta.consumer.exclusive])];
  assert.ok(delta.consumer.read.every(k=>s.read.includes(k)));assert.ok(!s.read.includes(delta.removeFreshUseOf));
  for(const list of [delta.authorityRecorder.exclusive,delta.authorityRecorder.read,delta.consumer.read,delta.consumer.exclusive])assert.ok(list.every(k=>!/[?*]/.test(k)&&k.startsWith('arn:aws:s3:::'+plan.archiveBucket+'/'+plan.archivePrefix)));
  const contract=validateOffline(x,mode==='publish'?archive:undefined,{now});
  if(mode==='recovery'){assert.deepEqual(s.exclusive,[]);assert.deepEqual(s.conditional,[]);assert.ok(!s.read.some(k=>k.includes('/artifacts/')));assert.deepEqual(contract.writes,[]);}
  else{assert.ok(s.exclusive.includes('arn:aws:s3:::'+contract.finalReceipt.bucket+'/'+contract.finalReceipt.key));for(const w of contract.writes){const arn='arn:aws:s3:::'+plan.frontendBucket+'/'+w.key;assert.ok((w.key==='index.html'?s.conditional:s.exclusive).includes(arn));}}
 }
 const x=input();x.runId='*';assert.throws(()=>resourceDelta(x));
});

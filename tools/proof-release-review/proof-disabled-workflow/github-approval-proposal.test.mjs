import test from 'node:test';
import assert from 'node:assert/strict';
import {bindings} from '../proof-config/bindings.mjs';
import {readReleaseInput} from '../proof-config/release-inputs.mjs';
import {sha256} from '../proof-guarded-publisher/controller.mjs';
import {releaseRecord} from '../proof-guarded-publisher/recovery.mjs';
import {packageApprovalPreview,operationalEntry} from './contract.mjs';
import {requireTrustedAuthority} from './evidence.mjs';
import {reviewGithubApprovalProposal} from './github-approval-proposal.mjs';
import {githubReadOnlyTransport} from './github-http-transport.mjs';
const read=n=>JSON.parse(readReleaseInput(n));
function fixture(mode='publish'){
 const plan=read('proof-oidc-release-draft/release-plan.json'),prior=read('proof-release-prep/baseline-and-plan.json');
 const assets=read('proof-pdf6-candidate/freeze.json').assets.map(a=>({key:a.path,sha256:a.sha256})),i=prior.objects.find(o=>o.key==='index.html');
 const tooling={repository:bindings.repository,commit:'a'.repeat(40),workflowPath:'.github/workflows/proof-fixture.yml',workflowSha256:'b'.repeat(64),inventorySha256:'c'.repeat(64)};
 const record=releaseRecord({releaseId:bindings.releaseId,assets,baseline:{index:{versionId:i.VersionId,etag:i.ETag,sha256:i.sha256,metadata:{contentType:i.ContentType,cacheControl:i.CacheControl??null,contentEncoding:i.ContentEncoding??null,serverSideEncryption:i.ServerSideEncryption}},configFingerprint:prior.distributionConfigSha256,configEtag:prior.distributionETag}},prior.objects.map(o=>({key:o.key,sha256:o.sha256})),{sourceManifestSha256:sha256(readReleaseInput('proof-pdf6-candidate/manifest.json')),artifactSha256:plan.candidateArchiveSha256,tooling});
 const invocation={mode,runId:'123',attempt:'1',jobId:'456'},preview=packageApprovalPreview(record,invocation,tooling);
 const run={repository:{full_name:bindings.repository},head_repository:{full_name:bindings.repository},event:'workflow_dispatch',id:123,run_attempt:1,head_sha:tooling.commit,path:tooling.workflowPath,head_branch:'main',status:'in_progress',conclusion:null};
 const job={id:456,run_id:123,run_attempt:1,head_sha:tooling.commit,name:'publish fixture',status:'in_progress',conclusion:null};
 const reviews=[{state:'approved',user:{id:bindings.ownerId,type:'User'},environments:[{id:preview.environmentId,name:preview.environment}],comment:preview.statement}];
 const environment={id:preview.environmentId,name:preview.environment,can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:bindings.ownerId}}]},{type:'branch_policy'}]};
 const policies={total_count:1,branch_policies:[{id:301,name:'main',type:'branch'}]};
 const calls=[];let mutate=()=>{},status=200;
 const options={record,invocation,reviewedTooling:tooling,jobName:job.name,credential:async()=> 'synthetic-only',fetchImpl:async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);assert.equal(opts.redirect,'manual');
  calls.push(url);let kind=url.includes('deployment-branch-policies')?'policies':url.includes('/environments/')?'environment':url.endsWith('/approvals')?'reviews':url.includes('/jobs?')?'jobs':'run';
  const data=structuredClone({policies,environment,reviews,jobs:{total_count:1,jobs:[job]},run}[kind]);
  mutate(kind,data,calls.filter(x=>x===url).length);
  return{url,redirected:false,status,headers:new Headers({'content-type':'application/json'}),body:new Response(JSON.stringify(data)).body};
 }};
 return{options,calls,run,job,reviews,environment,policies,mutate:f=>mutate=f,status:s=>status=s};
}
for(const mode of ['publish','recovery'])test(mode+' matching snapshots remain non-authorizing and cannot unlock either entry',async()=>{
 const f=fixture(mode),r=await reviewGithubApprovalProposal(f.options);
 assert.equal(r.status,'snapshot-matches-NOT-AUTHORIZED');assert.equal(r.authenticatedAuthority,false);assert.equal(r.operationallyReady,false);assert.equal(f.calls.length,12);
 assert.throws(()=>operationalEntry(r),/HOLD/);assert.throws(()=>requireTrustedAuthority(r),/HOLD/);
 assert.ok(!JSON.stringify(r).includes('synthetic-only'));assert.ok(!('approved' in r));
});
const faults={
 'environment ID':f=>f.environment.id++, 'admin bypass':f=>f.environment.can_admins_bypass=true,
 'branch mode':f=>f.environment.deployment_branch_policy.protected_branches=true,
 'missing required reviewer':f=>f.environment.protection_rules.shift(),
 'different required reviewer':f=>f.environment.protection_rules[0].reviewers[0].reviewer.id++,
 'multiple reviewers':f=>f.environment.protection_rules[0].reviewers.push(f.environment.protection_rules[0].reviewers[0]),
 'self-review policy drift':f=>f.environment.protection_rules[0].prevent_self_review=true,
 'unknown protection':f=>f.environment.protection_rules.push({type:'custom_rule'}),
 'nonzero timer':f=>f.environment.protection_rules.push({type:'wait_timer',wait_timer:1}),
 'tag policy':f=>f.policies.branch_policies[0].type='tag',
 'wildcard branch':f=>f.policies.branch_policies[0].name='*',
 'extra branch':f=>f.policies.total_count=2,
 'missing review':f=>f.reviews.splice(0),
 'ambiguous reviews':f=>f.reviews.push(f.reviews[0]),
 'review rejected':f=>f.reviews[0].state='rejected',
 'reviewer identity':f=>f.reviews[0].user.id++,
 'bot reviewer':f=>f.reviews[0].user.type='Bot',
 'comment differs':f=>f.reviews[0].comment+=' ',
 'review environment differs':f=>f.reviews[0].environments[0].id++,
 'run cancelled':f=>f.run.conclusion='cancelled',
 'run completed':f=>f.run.status='completed',
 'attempt drift':f=>f.run.run_attempt=2,
 'run source drift':f=>f.run.head_sha='d'.repeat(40),
 'workflow drift':f=>f.run.path='.github/workflows/other.yml',
 'branch drift':f=>f.run.head_branch='other',
 'fork source':f=>f.run.head_repository.full_name='other/repo',
 'unexpected trigger':f=>f.run.event='pull_request',
 'job cancelled':f=>f.job.conclusion='cancelled',
 'job identity':f=>f.job.id++,
 'job attempt missing':f=>delete f.job.run_attempt,
 'artifact changed':f=>f.options.record.artifactSha256='d'.repeat(64),
 'tooling changed':f=>f.options.reviewedTooling={...f.options.reviewedTooling,commit:'d'.repeat(40)},
};
for(const [name,change] of Object.entries(faults))test('reject '+name,async()=>{
 const f=fixture();change(f);const r=await reviewGithubApprovalProposal(f.options);
 assert.equal(r.status,'blocked');assert.equal(r.authenticatedAuthority,false);assert.equal(r.operationallyReady,false);
});
for(const status of [401,403,404,429,500])test('unavailable/auth failure '+status,async()=>{const f=fixture();f.status(status);assert.equal((await reviewGithubApprovalProposal(f.options)).status,'blocked');assert.equal(f.calls.length,1);});
test('second protections read detects change',async()=>{const f=fixture();f.mutate((kind,data,count)=>{if(kind==='environment'&&count===2)data.can_admins_bypass=true;});assert.equal((await reviewGithubApprovalProposal(f.options)).reason,'admin-bypass');});
test('second review read rejects new review',async()=>{const f=fixture();f.mutate((kind,data,count)=>{if(kind==='reviews'&&count===2)data.push(data[0]);});assert.equal((await reviewGithubApprovalProposal(f.options)).status,'blocked');});
test('same-valid policy replacement is still snapshot drift',async()=>{const f=fixture();f.mutate((kind,data,count)=>{if(kind==='policies'&&count===2)data.branch_policies[0].id++;});assert.equal((await reviewGithubApprovalProposal(f.options)).reason,'snapshot-changed');});
test('cancellation on final run read is rejected',async()=>{const f=fixture();f.mutate((kind,data,count)=>{if(kind==='run'&&count===4)data.conclusion='cancelled';});assert.equal((await reviewGithubApprovalProposal(f.options)).status,'blocked');});
test('ambiguous matching jobs rejected',async()=>{const f=fixture();f.mutate((kind,data)=>{if(kind==='jobs'){data.total_count=2;data.jobs.push({...data.jobs[0],id:457});}});assert.equal((await reviewGithubApprovalProposal(f.options)).status,'blocked');});
test('second job read detects cancellation',async()=>{const f=fixture();f.mutate((kind,data,count)=>{if(kind==='jobs'&&count===2)data.jobs[0].conclusion='cancelled';});assert.equal((await reviewGithubApprovalProposal(f.options)).status,'blocked');});
test('stale snapshot is rejected without widening time budget',async()=>{const f=fixture();let n=0;f.options.now=()=>n++*101;f.options.maxSnapshotAgeMs=100;assert.equal((await reviewGithubApprovalProposal(f.options)).reason,'snapshot-expired');});
test('backwards clock rejected',async()=>{const f=fixture();let n=100;f.options.now=()=>n--;assert.equal((await reviewGithubApprovalProposal(f.options)).reason,'snapshot-expired');});
test('aborted request performs no HTTP reads',async()=>{const f=fixture(),c=new AbortController();c.abort();f.options.signal=c.signal;assert.equal((await reviewGithubApprovalProposal(f.options)).reason,'request-aborted');assert.equal(f.calls.length,0);});
test('unavailable credential is redacted',async()=>{const f=fixture();f.options.credential=async()=>{throw Error('do-not-expose-credential');};const r=await reviewGithubApprovalProposal(f.options);assert.equal(r.status,'blocked');assert.ok(!JSON.stringify(r).includes('do-not-expose'));});
test('stalled credential ends at bounded deadline without HTTP',async()=>{const f=fixture();f.options.maxSnapshotAgeMs=100;f.options.credential=()=>new Promise(()=>{});assert.equal((await reviewGithubApprovalProposal(f.options)).status,'blocked');assert.equal(f.calls.length,0);});
test('caller affirmative flags cannot authorize execution',async()=>{const f=fixture();const r=await reviewGithubApprovalProposal({...f.options,approved:true,authenticatedAuthority:true,operationallyReady:true});assert.equal(r.authenticatedAuthority,false);assert.equal(r.operationallyReady,false);assert.throws(()=>operationalEntry(r),/HOLD/);});
for(const suffix of ['/environments/dev','/environments/proof-release-owner/secrets','/environments/proof-release-owner/deployment-branch-policies?per_page=100&page=2','/environments/proof-release-owner\n'])test('transport rejects unscoped protection route '+JSON.stringify(suffix),async()=>{
 let calls=0;const t=githubReadOnlyTransport({credential:async()=>{calls++;return 'fixture';},fetchImpl:async()=>{throw Error('must not fetch');}});
 await assert.rejects(()=>t.get('/repos/'+bindings.repository+suffix),/endpoint-not-allowed/);assert.equal(calls,0);
});

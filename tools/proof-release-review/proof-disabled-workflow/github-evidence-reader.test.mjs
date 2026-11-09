import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectGithubEvidence} from './github-evidence-reader.mjs';

const observed=JSON.parse(readFileSync(new URL('./github-observed-fixture.json',import.meta.url)));
const expected={repository:'example/proof-review',runId:'1001',attempt:'1',jobId:'1002',jobName:'validate',headSha:observed.run.head_sha,workflowPath:observed.run.path,environment:'proof-release-owner'};
// Positive reviews below are explicitly synthetic field-shape variants from the
// documented review-history example. No real approval has been observed.
const syntheticReview=()=>({state:'approved',user:{id:101},environments:[{id:201,name:'proof-release-owner'}]});
function transport(fixture,transform=()=>{}){
 const paths=[];let runReads=0;
 const get=async(path)=>{
  paths.push(path);
  assert.ok(path.startsWith('/repos/example/proof-review/actions/runs/1001'));
  let data;if(path.endsWith('/approvals'))data=fixture.reviews;
  else if(path.includes('/jobs?'))data=fixture.jobs;
  else {data=fixture.run;runReads++;}
  const r={status:200,headers:{},data:structuredClone(data)};
  await transform(r,path,runReads);return r;
 };return{get,paths};
}
async function inspect(fixture=observed,transform,overrides={}){
 const t=transport(structuredClone(fixture),transform);
 const result=await inspectGithubEvidence({get:t.get,expected,...overrides});
 assert.equal(result.authenticatedAuthority,false);assert.equal(result.operationallyReady,false);
 return{result,paths:t.paths};
}
test('observed historical run resolves numeric job but has no approval',async()=>{
 const {result,paths}=await inspect();assert.equal(result.reviewState,'missing-review');assert.equal(result.job.id,1002);assert.equal(paths.length,4);
 assert.ok(paths[1].includes('/attempts/1/jobs?per_page=100&page=1'));
});
for(const [label,change,want]of [
 ['run approval only',f=>f.reviews=[syntheticReview()],'run-scoped-approval-observed'],
 ['ambiguous',f=>f.reviews=[syntheticReview(),syntheticReview()],'ambiguous-review'],
 ['wrong owner',f=>{f.reviews=[syntheticReview()];f.reviews[0].user.id=1;},'wrong-reviewer'],
 ['wrong environment identity',f=>{f.reviews=[syntheticReview()];f.reviews[0].environments[0].id=1;},'environment-mismatch'],
 ['other environment',f=>{f.reviews=[syntheticReview()];f.reviews[0].environments=[{id:1,name:'other'}];},'missing-review'],
 ['rejected',f=>{f.reviews=[syntheticReview()];f.reviews[0].state='rejected';},'review-rejected'],
 ['unknown review state',f=>{f.reviews=[syntheticReview()];f.reviews[0].state='new-state';},'unsupported-review-state']
])test('synthetic review variant: '+label,async()=>{const f=structuredClone(observed);change(f);assert.equal((await inspect(f)).result.reviewState,want);});
for(const [label,change,want]of [
 ['wrong run',f=>f.run.id++,'run-mismatch'],['wrong repo',f=>f.run.repository.full_name='other/repo','run-mismatch'],
 ['rerun',f=>f.run.run_attempt=2,'attempt-changed'],['changed source',f=>f.run.head_sha='a'.repeat(40),'source-or-workflow-mismatch'],
 ['cancelled',f=>f.run.conclusion='cancelled','run-stopped'],['missing job',f=>{f.jobs.jobs=[];f.jobs.total_count=0;},'missing-job'],
 ['wrong numeric job',f=>f.jobs.jobs[0].id++,'job-mismatch'],['wrong job attempt',f=>f.jobs.jobs[0].run_attempt=2,'job-attempt-mismatch'],
 ['ambiguous name',f=>{f.jobs.jobs.push({...f.jobs.jobs[0],id:2});f.jobs.total_count=2;},'ambiguous-job'],
 ['duplicate job',f=>{f.jobs.jobs.push(f.jobs.jobs[0]);f.jobs.total_count=2;},'duplicate-or-invalid-jobs'],
 ['invalid reviews',f=>f.reviews={},'invalid-reviews'],['invalid review entry',f=>f.reviews=[{}],'invalid-review-entry']
])test('blocks '+label,async()=>{const f=structuredClone(observed);change(f);assert.equal((await inspect(f)).result.reason,want);});
for(const [status,want]of [[401,'unauthenticated-read'],[403,'forbidden-or-rate-limited'],[404,'not-found'],[429,'rate-limited'],[500,'read-failed'],[302,'read-failed']])test('HTTP '+status+' stops without retry',async()=>{
 const {result,paths}=await inspect(observed,r=>r.status=status);assert.equal(result.reason,want);assert.equal(paths.length,1);
});
test('transport errors are redacted',async()=>{const {result,paths}=await inspect(observed,()=>{throw Error('SECRET');});assert.equal(result.reason,'read-or-parse-failed');assert.equal(paths.length,1);assert.ok(!JSON.stringify(result).includes('SECRET'));});
test('timeout aborts and does not retry',async()=>{let calls=0,signal;const result=await inspectGithubEvidence({expected,timeoutMs:5,get:(_,{signal:s})=>{calls++;signal=s;return new Promise(()=>{});}});assert.equal(result.reason,'read-timeout');assert.equal(calls,1);assert.equal(signal.aborted,true);});
test('bounded pagination finds exact job on second page',async()=>{
 const {result,paths}=await inspect(observed,(r,path)=>{if(path.includes('/jobs?')){r.data.total_count=2;if(path.endsWith('page=1'))r.data.jobs=[{...r.data.jobs[0],name:'other',id:2}];}});
 assert.equal(result.job.id,1002);assert.equal(paths.filter(p=>p.includes('/jobs?')).length,2);
});
test('changing pagination total stops',async()=>{const {result}=await inspect(observed,(r,p)=>{if(p.includes('/jobs?'))r.data.total_count=p.endsWith('page=1')?2:3;});assert.equal(result.reason,'jobs-changed');});
test('empty incomplete page stops',async()=>{const {result}=await inspect(observed,(r,p)=>{if(p.includes('/jobs?'))r.data={jobs:[],total_count:1};});assert.equal(result.reason,'incomplete-jobs');});
test('review continuation is unsupported, not silently discarded or followed',async()=>{const {result,paths}=await inspect(observed,(r,p)=>{if(p.endsWith('/approvals'))r.headers.link='<https://other.invalid>; rel="next"';});assert.equal(result.reason,'unsupported-review-pagination');assert.ok(paths.every(p=>!p.includes('other.invalid')));});
test('second run read catches cancellation',async()=>{const {result}=await inspect(observed,(r,p,n)=>{if(!p.endsWith('/approvals')&&!p.includes('/jobs?')&&n===2)r.data.conclusion='cancelled';});assert.equal(result.reason,'run-stopped');});
test('second run read catches status drift',async()=>{const {result}=await inspect(observed,(r,p,n)=>{if(!p.endsWith('/approvals')&&!p.includes('/jobs?')&&n===2)r.data.status='in_progress';});assert.equal(result.reason,'run-changed-during-read');});
test('bad expectations cause no calls',async()=>{for(const change of [{runId:'../other'},{attempt:'2'},{environment:'dev'},{repository:'other/repo'}]){const {result,paths}=await inspect(observed,undefined,{expected:{...expected,...change}});assert.equal(result.reason,'invalid-expectation');assert.equal(paths.length,0);}});

import {bindings} from '../proof-config/bindings.mjs';
// Read-only metadata inspection, NOT an approval verifier or execution capability.
// Credentials and HTTP implementation are external. No token/env/SDK access here.
const repository=bindings.repository;
const environments=bindings.environments;
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&/^[1-9]\d*$/.test(x)&&Number.isSafeInteger(Number(x));
const numeric=x=>Number.isSafeInteger(x)&&x>0;
const stopped=x=>['cancelled','failure','timed_out','action_required','stale','skipped'].includes(x.conclusion);
const gaps=['authenticated transport wiring not accepted','review is run-scoped, not job/attempt attestation','exact archive and tooling consent separately required','snapshot does not guarantee ongoing revocation or atomicity'];
export async function inspectGithubEvidence({get,expected,timeoutMs=5000}){
 const base={operationallyReady:false,authenticatedAuthority:false,remaining:gaps};
 try{
  const e=structuredClone(expected);
  need(typeof get==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000,'invalid-reader');
  need(e?.repository===repository&&id(e.runId)&&e.attempt==='1'&&id(e.jobId)&&typeof e.jobName==='string'&&e.jobName.length>0&&e.jobName.length<200&&/^[a-f0-9]{40}$/.test(e.headSha)&&/^\.github\/workflows\/[a-zA-Z0-9._-]+\.ya?ml$/.test(e.workflowPath)&&Object.hasOwn(environments,e.environment),'invalid-expectation');
  const root='/repos/'+repository+'/actions/runs/'+e.runId;
  async function read(path){
   const abort=new AbortController();let timer;
   try{
    const r=await Promise.race([Promise.resolve().then(()=>get(path,{signal:abort.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Object.assign(new Error('timeout'),{code:'read-timeout'}));},timeoutMs);})]);
    need(r?.status===200,r?.status===401?'unauthenticated-read':r?.status===403?'forbidden-or-rate-limited':r?.status===404?'not-found':r?.status===429?'rate-limited':'read-failed');
    need(JSON.stringify(r.data)?.length<=1024*1024,'oversized-response');
    return structuredClone(r);
   }finally{clearTimeout(timer);}
  }
  function checkRun(r){
   need(r?.repository?.full_name===repository&&String(r.id)===e.runId&&numeric(r.id),'run-mismatch');
   need(r.run_attempt===Number(e.attempt),'attempt-changed');
   need(r.head_sha===e.headSha&&r.path===e.workflowPath,'source-or-workflow-mismatch');
   need(['completed','in_progress','queued','requested','waiting','pending'].includes(r.status),'unknown-run-state');
   need(!stopped(r),'run-stopped');
  }
  const first=(await read(root)).data;checkRun(first);
  const jobs=[];let total;
  for(let page=1;page<=10;page++){
   const r=(await read(root+'/attempts/'+e.attempt+'/jobs?per_page=100&page='+page)).data;
   need(Number.isSafeInteger(r?.total_count)&&r.total_count>=0&&r.total_count<=1000&&Array.isArray(r.jobs)&&r.jobs.length<=100,'invalid-jobs-page');
   if(total===undefined)total=r.total_count;need(total===r.total_count,'jobs-changed');
   jobs.push(...r.jobs);need(jobs.length<=total,'jobs-count-mismatch');
   if(jobs.length===total)break;
   need(r.jobs.length>0&&page<10,'incomplete-jobs');
  }
  need(new Set(jobs.map(j=>j?.id)).size===jobs.length&&jobs.every(j=>numeric(j?.id)),'duplicate-or-invalid-jobs');
  const matches=jobs.filter(j=>j.name===e.jobName);need(matches.length===1,matches.length?'ambiguous-job':'missing-job');
  const job=matches[0];need(String(job.id)===e.jobId&&String(job.run_id)===e.runId&&job.head_sha===e.headSha,'job-mismatch');
  if(job.run_attempt!==undefined)need(job.run_attempt===Number(e.attempt),'job-attempt-mismatch');
  need(!stopped(job),'job-stopped');
  const reviewsResponse=await read(root+'/approvals');
  // Review-history docs expose no page parameters. Never follow arbitrary links.
  need(!reviewsResponse.headers?.link&&!reviewsResponse.headers?.Link,'unsupported-review-pagination');
  const reviews=reviewsResponse.data;need(Array.isArray(reviews)&&reviews.length<=1000,'invalid-reviews');
  need(reviews.every(r=>typeof r?.state==='string'&&numeric(r.user?.id)&&Array.isArray(r.environments)&&r.environments.every(v=>numeric(v?.id)&&typeof v.name==='string')),'invalid-review-entry');
  const relevant=reviews.filter(r=>r.environments.some(v=>v.id===environments[e.environment]||v.name===e.environment));
  const last=(await read(root)).data;checkRun(last);
  need(first.status===last.status&&first.conclusion===last.conclusion,'run-changed-during-read');
  let reviewState='missing-review';
  if(relevant.length>1)reviewState='ambiguous-review';
  else if(relevant.length===1){
   const r=relevant[0];
   const envs=r.environments.filter(v=>v.id===environments[e.environment]||v.name===e.environment);
   if(envs.length!==1||envs[0].id!==environments[e.environment]||envs[0].name!==e.environment)reviewState='environment-mismatch';
   else if(r.user.id!==bindings.ownerId)reviewState='wrong-reviewer';
   else if(r.state==='approved')reviewState='run-scoped-approval-observed';
   else if(r.state==='rejected')reviewState='review-rejected';
   else reviewState='unsupported-review-state';
  }
  return {...base,status:'metadata-inspected',reviewState,run:{id:first.id,attempt:first.run_attempt,status:last.status,conclusion:last.conclusion},job:{id:job.id,name:job.name},environment:e.environment};
 }catch(error){
  // Never expose provider bodies, credentials, comments, or raw thrown messages.
  const codes=new Set(['invalid-reader','invalid-expectation','read-timeout','unauthenticated-read','forbidden-or-rate-limited','not-found','rate-limited','read-failed','oversized-response','run-mismatch','attempt-changed','source-or-workflow-mismatch','unknown-run-state','run-stopped','invalid-jobs-page','jobs-changed','jobs-count-mismatch','incomplete-jobs','duplicate-or-invalid-jobs','ambiguous-job','missing-job','job-mismatch','job-attempt-mismatch','job-stopped','unsupported-review-pagination','invalid-reviews','invalid-review-entry','run-changed-during-read']);
  return {...base,status:'blocked',reason:codes.has(error?.code)?error.code:'read-or-parse-failed'};
 }
}

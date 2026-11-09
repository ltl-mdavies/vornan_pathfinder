import {bindings} from '../proof-config/bindings.mjs';
import {digest} from '../proof-approval-lifecycle/lifecycle.mjs';
import {githubReadOnlyTransport} from './github-http-transport.mjs';
import {inspectGithubEvidence} from './github-evidence-reader.mjs';
import {packageApprovalPreview,matchProposedPackageComment} from './contract.mjs';

const base=Object.freeze({authenticatedAuthority:false,operationallyReady:false,
 provenance:'LOCAL PROPOSAL: credential, fetch implementation and expectations are externally supplied; not operational authority',
 remaining:['trusted runtime/credential and immutable expectations binding','real protected workflow approval semantics','private evidence finalization','live baseline/permissions and release QA','snapshot cannot guarantee ongoing revocation or atomicity']});
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
function protections(environment,policy,expected){
 need(environment?.id===bindings.environments[expected]&&environment.name===expected,'environment-identity');
 need(environment.can_admins_bypass===false,'admin-bypass');
 need(environment.deployment_branch_policy?.protected_branches===false&&environment.deployment_branch_policy?.custom_branch_policies===true,'branch-policy-mode');
 const rules=environment.protection_rules;
 need(Array.isArray(rules)&&rules.length>=2&&rules.length<=3&&rules.every(r=>['required_reviewers','branch_policy','wait_timer'].includes(r?.type)),'protection-rules');
 const reviewers=rules.filter(r=>r.type==='required_reviewers'),branches=rules.filter(r=>r.type==='branch_policy'),timers=rules.filter(r=>r.type==='wait_timer');
 need(reviewers.length===1&&branches.length===1&&timers.length<=1&&timers.every(t=>t.wait_timer===0),'protection-rules');
 const rule=reviewers[0];
 need(rule.prevent_self_review===false&&Array.isArray(rule.reviewers)&&rule.reviewers.length===1&&rule.reviewers[0].type==='User'&&rule.reviewers[0].reviewer?.id===bindings.ownerId,'required-reviewer');
 need(policy?.total_count===1&&Array.isArray(policy.branch_policies)&&policy.branch_policies.length===1&&policy.branch_policies[0].name==='main'&&policy.branch_policies[0].type==='branch'&&Number.isSafeInteger(policy.branch_policies[0].id)&&policy.branch_policies[0].id>0,'branch-rules');
 return {environment,policy};
}

/** Read-only composition. Even a fully matching response cannot unlock execution.
 * fetchImpl/clock injection supports isolated tests and is explicitly not trusted
 * provenance. No operational consumer accepts this result as a capability.
 */
export async function reviewGithubApprovalProposal({credential,fetchImpl=globalThis.fetch,record,invocation,reviewedTooling,jobName,purpose='release',runtimeWorkflow,signal,maxSnapshotAgeMs=10000,now=()=>performance.now()}={}){
 const controller=new AbortController();let timer;
 const externalAbort=()=>controller.abort();
 const allowedCodes=new Set(['invalid-proposal','snapshot-expired','request-aborted','environment-identity','admin-bypass','branch-policy-mode','protection-rules','required-reviewer','branch-rules','read-unavailable','unsupported-pagination','evidence-rejected','snapshot-changed','package-rejected']);
 try{
  need(Number.isSafeInteger(maxSnapshotAgeMs)&&maxSnapshotAgeMs>=100&&maxSnapshotAgeMs<=30000&&typeof now==='function','invalid-proposal');
  const started=now();need(Number.isFinite(started),'invalid-proposal');let lastTime=started;
  const input=structuredClone({record,invocation,reviewedTooling,jobName,purpose,runtimeWorkflow});
  let preview;try{preview=packageApprovalPreview(input.record,input.invocation,input.reviewedTooling,input.purpose);need(runtimeWorkflow===undefined||purpose==='validation-only','package-rejected');}catch{throw Object.assign(Error('package-rejected'),{code:'package-rejected'});}
  need(typeof jobName==='string'&&jobName.length>0&&jobName.length<200,'invalid-proposal');
  need(!signal?.aborted,'request-aborted');
  signal?.addEventListener('abort',externalAbort,{once:true});
  timer=setTimeout(()=>controller.abort(),maxSnapshotAgeMs);
  const transport=githubReadOnlyTransport({credential,fetchImpl,deadlineMs:Math.min(5000,maxSnapshotAgeMs)});
  const root='/repos/'+bindings.repository,runRoot=root+'/actions/runs/'+input.invocation.runId;
  const envRoot=root+'/environments/'+preview.environment;
  const workflow=input.runtimeWorkflow??input.reviewedTooling;
  const expected={repository:bindings.repository,runId:input.invocation.runId,attempt:input.invocation.attempt,jobId:input.invocation.jobId,jobName:input.jobName,headSha:workflow.commit,workflowPath:workflow.workflowPath,environment:preview.environment};
  function fresh(){const t=now();need(!controller.signal.aborted,'request-aborted');need(Number.isFinite(t)&&t>=lastTime&&t-started<=maxSnapshotAgeMs,'snapshot-expired');lastTime=t;return t;}
  async function read(path,options={}){
   fresh();const combined=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
   const r=await transport.get(path,{signal:combined});fresh();
   need(r.status===200,'read-unavailable');if(!path.includes('/attempts/1/jobs?'))need(!r.headers?.link,'unsupported-pagination');return r;
  }
  async function snapshot(){
   const environment=(await read(envRoot)).data;
   const policy=(await read(envRoot+'/deployment-branch-policies?per_page=100&page=1')).data;
   const protection=protections(environment,policy,preview.environment),captured=new Map();
   const inspection=await inspectGithubEvidence({get:async(path,options)=>{const r=await read(path,options);captured.set(path,structuredClone(r.data));return r;},expected,timeoutMs:Math.min(5000,maxSnapshotAgeMs)});
   need(inspection.status==='metadata-inspected'&&inspection.reviewState==='run-scoped-approval-observed','evidence-rejected');
   const run=captured.get(runRoot),reviews=captured.get(runRoot+'/approvals');
   const jobs=[...captured.entries()].filter(([p])=>p.includes('/attempts/1/jobs?')).flatMap(([,d])=>d.jobs);
   const job=jobs.find(j=>String(j.id)===input.invocation.jobId);
   need(run.head_branch==='main'&&run.event==='workflow_dispatch'&&run.head_repository?.full_name===bindings.repository,'evidence-rejected');
   try{matchProposedPackageComment({...input,reviews,run,job});}catch{throw Object.assign(Error('package-rejected'),{code:'package-rejected'});}
   return {protection,run,job,reviews};
  }
  // Two complete acquisitions: neither cached readback nor caller booleans count.
  const first=await snapshot(),last=await snapshot();const ended=fresh();
  need(digest(first)===digest(last),'snapshot-changed');
  return {...base,status:'snapshot-matches-NOT-AUTHORIZED',recordSha256:preview.recordSha256,environment:preview.environment,elapsedMs:ended-started};
 }catch(error){return {...base,status:'blocked',reason:allowedCodes.has(error?.code)?error.code:'read-or-verification-failed'};}
 finally{clearTimeout(timer);controller.abort();signal?.removeEventListener?.('abort',externalAbort);}
}

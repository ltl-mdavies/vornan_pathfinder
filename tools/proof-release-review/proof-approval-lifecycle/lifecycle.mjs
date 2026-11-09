import {bindings} from '../proof-config/bindings.mjs';
import {createHash} from 'node:crypto';
import {readReleaseInput} from '../proof-config/release-inputs.mjs';
const plan=JSON.parse(readReleaseInput('proof-oidc-release-draft/release-plan.json'));
const fail=()=>{throw Error('Approval lifecycle blocked; details redacted');};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const id=x=>typeof x==='string'&&/^[0-9]{1,20}$/.test(x)&&x!=='0';
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function context(input){
 const c=structuredClone(input),keys=['kind','runId','attempt','sourceRunId','sourceAttempt','commit','artifactSha256','releaseId','recordSha256'];
 if(!c||Object.keys(c).sort().join()!==keys.sort().join()||!['publish','recovery'].includes(c.kind)||![c.runId,c.attempt,c.sourceRunId,c.sourceAttempt].every(id)||c.commit!==plan.candidateCommit||c.artifactSha256!==plan.candidateArchiveSha256||c.releaseId!==bindings.releaseId||!hash(c.recordSha256))fail();
 if(c.kind==='publish'&&(c.sourceRunId!==c.runId||c.sourceAttempt!==c.attempt))fail();
 if(c.kind==='recovery'&&c.sourceRunId===c.runId)fail();
 return Object.freeze(c);
}
const executionKey=c=>'execution/'+c.kind+'/'+c.runId+'/'+c.attempt;
const effectKey=(c,target)=>'effect/'+c.releaseId+'/'+target;
export function approvalLifecycle({mode,authority,ledger,now=Date.now}){
 if(mode!=='mock-only'||authority?.kind!=='synthetic'||ledger?.kind!=='synthetic')fail();
 const read=async key=>{try{return await ledger.read(key);}catch{fail();}};
 const fresh=async(approvalId,c,expectedVersion)=>{
  let a;try{a=structuredClone(await authority.read(approvalId));}catch{fail();}
  if(!a||a.id!==approvalId||a.ownerId!==bindings.ownerId||a.status!=='approved'||a.revoked!==false||!Number.isFinite(a.expiresAt)||a.expiresAt<=now()||a.contextDigest!==digest(c)||a.environment!==(c.kind==='publish'?'proof-release-owner':'proof-release-recovery')||!Number.isSafeInteger(a.version)||a.version<1||expectedVersion!==undefined&&a.version!==expectedVersion)fail();
  return a;
 };
 const validatePair=async binding=>{
  const execution=await read(executionKey(binding.context)),approval=await read('approval/'+binding.approvalId);
  if(!execution||!approval||digest(execution)!==digest(binding)||digest(approval)!==digest(binding))fail();
 };
 const validateSource=async(c,expected)=>{
  const wanted=context({...c,kind:'publish',runId:c.sourceRunId,attempt:c.sourceAttempt});
  const source=await read(executionKey(wanted));
  if(!source||Object.keys(source).sort().join()!=='approvalId,context,contextDigest,version'||typeof source.approvalId!=='string'||!/^approval-[a-zA-Z0-9_-]{1,64}$/.test(source.approvalId)||!Number.isSafeInteger(source.version)||source.version<1||digest(context(source.context))!==digest(wanted)||source.contextDigest!==digest(wanted))fail();
  if(expected&&digest(source)!==digest(expected))fail();
  await validatePair(source);
  return structuredClone(source);
 };
 return Object.freeze({async consume(approvalId,input){
  if(typeof approvalId!=='string'||!/^approval-[a-zA-Z0-9_-]{1,64}$/.test(approvalId))fail();
  const c=context(input),a=await fresh(approvalId,c),binding={approvalId,version:a.version,context:c,contextDigest:digest(c)};
  const sourceBinding=c.kind==='recovery'?await validateSource(c):null;
  // Atomic across BOTH keys. A lost acknowledgement never yields a usable lease.
  try{await ledger.createAll([{key:'approval/'+approvalId,value:binding},{key:executionKey(c),value:binding}]);}catch{fail();}
  let active=true;
  const revalidate=async()=>{
   if(!active)fail();
   await fresh(approvalId,c,a.version);
   await validatePair(binding);
   if(sourceBinding)await validateSource(c,sourceBinding);
  };
  const permits=new Set();
  return Object.freeze({
   context:c,
   async beforeWrite(target){
    if(c.kind!=='publish'||typeof target!=='string'||!['assets/index-BLpayhdw.js','assets/pdf-w2Vx1rau.js','assets/pdf-worker-url-B-4I8zKO.js','assets/pdf.worker.min-CLrFZWeq.mjs','index.html'].includes(target))fail();
    await revalidate();
    const key=effectKey(c,target),intent={contextDigest:digest(c),approvalId,target,state:'intent'};
    try{await ledger.createAll([{key,value:intent}]);}catch{fail();}
    // Re-read authority after intent persistence before granting permission.
    await revalidate();
    const permit=Object.freeze({target});permits.add(permit);return permit;
   },
   async outcome(permit,state){
    if(!active||!permits.has(permit)||!['confirmed','uncertain'].includes(state))fail();
    permits.delete(permit);
    try{await ledger.createAll([{key:effectKey(c,permit.target)+'/outcome',value:{contextDigest:digest(c),state}}]);}catch{fail();}
   },
   async inspect(target){
    if(c.kind!=='recovery')fail();
    await revalidate();
    if(!['assets/index-BLpayhdw.js','assets/pdf-w2Vx1rau.js','assets/pdf-worker-url-B-4I8zKO.js','assets/pdf.worker.min-CLrFZWeq.mjs','index.html'].includes(target))fail();
    const intent=await read(effectKey(c,target)),outcome=await read(effectKey(c,target)+'/outcome');
    if(intent&&intent.contextDigest!==digest({...c,kind:'publish',runId:c.sourceRunId,attempt:c.sourceAttempt}))fail();
    if(outcome&&(!intent||outcome.contextDigest!==intent.contextDigest||!['confirmed','uncertain'].includes(outcome.state)))fail();
    return {intent:structuredClone(intent),outcome:structuredClone(outcome),automaticRetry:false};
   },
   close(){active=false;permits.clear();}
  });
 }});
}

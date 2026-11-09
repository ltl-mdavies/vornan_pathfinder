import {bindings} from '../proof-config/bindings.mjs';
import {context,digest} from '../proof-approval-lifecycle/lifecycle.mjs';
export const scope=bindings.control;
export const maxBytes=128*1024;
const releaseId=bindings.releaseId;
const targets=['assets/index-BLpayhdw.js','assets/pdf-w2Vx1rau.js','assets/pdf-worker-url-B-4I8zKO.js','assets/pdf.worker.min-CLrFZWeq.mjs','index.html'];
const fail=()=>{throw Error('Control CAS blocked; no retry');};
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.sort().join();
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function validateRecords(records){
 if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>256)fail();
 const sources=new Map();
 for(const [key,v]of Object.entries(records)){
  if(key.startsWith('approval/')||key.startsWith('execution/')){
   if(!keys(v,['approvalId','version','context','contextDigest'])||!/^approval-[a-zA-Z0-9_-]{1,64}$/.test(v.approvalId)||!Number.isSafeInteger(v.version)||v.version<1)fail();
   const c=context(v.context);if(v.contextDigest!==digest(c))fail();
   const ak='approval/'+v.approvalId,ek='execution/'+c.kind+'/'+c.runId+'/'+c.attempt;
   if(![ak,ek].includes(key)||!records[ak]||!records[ek]||digest(records[ak])!==digest(v)||digest(records[ek])!==digest(v))fail();
   if(c.kind==='publish')sources.set(v.contextDigest,v);
  }else if(!key.startsWith('effect/'+releaseId+'/'))fail();
 }
 for(const v of Object.values(records).filter(v=>v?.context?.kind==='recovery')){
  const c=v.context,source=records['execution/publish/'+c.sourceRunId+'/'+c.sourceAttempt];
  if(!source||source.contextDigest!==digest({...c,kind:'publish',runId:c.sourceRunId,attempt:c.sourceAttempt}))fail();
 }
 for(const [key,v]of Object.entries(records).filter(([k])=>k.startsWith('effect/'))){
  const suffix=key.slice(('effect/'+releaseId+'/').length),outcome=suffix.endsWith('/outcome'),target=outcome?suffix.slice(0,-8):suffix;
  if(!targets.includes(target))fail();
  if(outcome){
   const intent=records[key.slice(0,-8)];
   if(!keys(v,['contextDigest','state'])||!['confirmed','uncertain'].includes(v.state)||!intent||v.contextDigest!==intent.contextDigest)fail();
  }else{
   if(!keys(v,['contextDigest','approvalId','target','state'])||v.state!=='intent'||v.target!==target||sources.get(v.contextDigest)?.approvalId!==v.approvalId)fail();
  }
 }
}
function encode(state){
 const body=Buffer.from(JSON.stringify(state));if(body.length>maxBytes)fail();return body;
}
function decode(body){
 if(!Buffer.isBuffer(body)||body.length>maxBytes)fail();
 let s;try{s=JSON.parse(body);}catch{fail();}
 if(!keys(s,['schema','releaseId','revision','parentDigest','records'])||s.schema!==1||s.releaseId!==releaseId||!Number.isSafeInteger(s.revision)||s.revision<0||(s.revision===0?s.parentDigest!==null:!hash(s.parentDigest)))fail();
 validateRecords(s.records);if(s.revision===0&&Object.keys(s.records).length)fail();
 return s;
}
/** Fake storage only. No remote adapter, SDK or policy changes. */
export function controlCas({mode,storage}){
 if(mode!=='mock-only'||storage?.kind!=='synthetic')fail();
 let seen,poisoned=false;
 const read=async()=>{
  const r=await storage.get(scope);
  if(!r||typeof r.etag!=='string'||!r.etag||typeof r.versionId!=='string'||!r.versionId||r.versionId==='null')fail();
  const state=decode(r.body);
  if(seen){
   if(state.revision<seen.state.revision)fail();
   if(state.revision===seen.state.revision&&(digest(state)!==digest(seen.state)||r.versionId!==seen.versionId))fail();
   for(const [k,v]of Object.entries(seen.state.records))if(!state.records[k]||digest(state.records[k])!==digest(v))fail();
   if(state.revision===seen.state.revision+1&&state.parentDigest!==digest(seen.state))fail();
  }
  seen={state,etag:r.etag,versionId:r.versionId};return structuredClone(seen);
 };
 const create=async(entries)=>{
  if(poisoned)fail();
  const prior=await read();
  if(!Array.isArray(entries)||!entries.length||new Set(entries.map(e=>e.key)).size!==entries.length||entries.some(e=>!keys(e,['key','value'])||typeof e.key!=='string'||Object.hasOwn(prior.state.records,e.key)))fail();
  const records=structuredClone(prior.state.records);
  for(const e of entries)Object.defineProperty(records,e.key,{value:structuredClone(e.value),enumerable:true,writable:true,configurable:true});
  const next={schema:1,releaseId,revision:prior.state.revision+1,parentDigest:digest(prior.state),records};
  const body=encode(next);decode(body);
  try{
   const ack=await storage.put({...scope,body,ifMatch:prior.etag,encryption:'AES256'});
   const current=await read();
   if(!ack||ack.versionId!==current.versionId||digest(current.state)!==digest(next))fail();
  }catch{poisoned=true;fail();}
 };
 return Object.freeze({kind:'synthetic',
  async initialize(){
   if(poisoned)fail();
   const state={schema:1,releaseId,revision:0,parentDigest:null,records:{}};
   try{await storage.put({...scope,body:encode(state),ifNoneMatch:'*',encryption:'AES256'});await read();}
   catch{poisoned=true;fail();}
  },
  async read(key){try{return structuredClone((await read()).state.records[key]);}catch{fail();}},
  async createAll(entries){try{return await create(entries);}catch{fail();}}
 });
}

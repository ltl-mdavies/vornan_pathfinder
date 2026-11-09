import {createTransport,target} from '../proof-guarded-publisher/transport.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {sha256} from '../proof-guarded-publisher/controller.mjs';import {digest} from '../proof-approval-lifecycle/lifecycle.mjs';
import {deadline,cleanup} from '../proof-guarded-publisher/bounded-io.mjs';import {validVersionId} from './version-id.mjs';
/** Isolated SDK bridge only. No live factory, credentials, repair or retry. */
export async function isolatedFrontend({mode,bridge,gate,run,baseline,assets,releaseId,appendReceipt,fetchPublic,signal,ms=15000}){
 if(!['isolated-publisher','isolated-recovery'].includes(mode)||bridge.kind!=='isolated-sdk-bridge'||gate.kind!=='synthetic')throw Error('Isolated scope');
 if(!/^[1-9]\d*$/.test(run?.id)||!/^[1-9]\d*$/.test(run?.attempt)||!/^[a-f0-9]{40}$/.test(run?.commit)||!/^[a-f0-9]{64}$/.test(run?.artifactSha256)||!/^owner-review-[A-Za-z0-9_-]+$/.test(run?.verificationRecordRef))throw Error('Bound run required');
 const bound=structuredClone(run),expected=structuredClone(baseline),allowed=new Map(assets.map(a=>[a.key,a.sha256]));let stopped=false,t;
 async function authorize(parent=signal){await deadline(async s=>{const a=await gate.check({run:structuredClone(bound),signal:s});if(!a||a.allowed!==true||a.stopped||a.runId!==bound.id||a.attempt!==bound.attempt||a.commit!==bound.commit||a.artifactSha256!==bound.artifactSha256||a.verificationRecordRef!==bound.verificationRecordRef)throw Error('Authorization drift');},{signal:parent,ms});}
 const bucketInput={Bucket:target.bucket,ExpectedBucketOwner:target.account},operations=new AsyncLocalStorage();
 function guardedSend(c){
  const parents=[signal,c.abortSignal,operations.getStore()].filter(Boolean),parent=parents.length?AbortSignal.any(parents):undefined;
  return operations.run(parent,()=>sendWithinOperation({...c,abortSignal:parent}));
 }
 async function sendWithinOperation(c){
  if(c.operation==='GetObject'&&!allowed.has(c.input.Key))throw Error('Read artifact scope');
  const parent=c.abortSignal&&signal?AbortSignal.any([c.abortSignal,signal]):c.abortSignal??signal;
  await authorize(parent);const write=c.operation==='PutObject';if(write){
   if(mode!=='isolated-publisher'||stopped)throw Error('Writes disabled');
   const p=c.input;if(!allowed.has(p.Key)||sha256(p.Body)!==allowed.get(p.Key)||p.Metadata?.['release-id']!==releaseId)throw Error('Artifact scope');
   if(p.Key==='index.html'?p.IfMatch!==expected.index.etag||p.Metadata?.['parent-version']!==expected.index.versionId:p.IfNoneMatch!=='*')throw Error('Conditional scope');
   try{
    const config=await deadline(()=>t.readConfig(),{signal:parent,ms});if(config.fingerprint!==expected.configFingerprint||config.etag!==expected.configEtag)throw Error('Distribution drift');
    const versioning=await deadline(child=>bridge.send({service:'s3',operation:'GetBucketVersioning',input:bucketInput,region:target.region,maxAttempts:1,abortSignal:child}),{signal:parent,ms});if(versioning.Status!=='Enabled')throw Error('Versioning drift');
    const index=await deadline(()=>t.read('index.html'),{signal:parent,ms});if(!index||index.versionId!==expected.index.versionId||index.etag!==expected.index.etag||index.sha256!==expected.index.sha256||digest(index.metadata)!==digest(expected.index.metadata))throw Error('Index drift');
    // Immediate gate after asynchronous intent and all cross-service reads.
    await authorize(parent);if(stopped||parent?.aborted)throw Error('Stopped');
   }catch{stopped=true;throw Error('Prewrite guard blocked');}
  }
  try{const r=await deadline(child=>bridge.send({...c,abortSignal:child}),{signal:parent,ms,onLate:r=>{cleanup(r?.Body);cleanup(r?.FunctionCode);}});if(['GetObject','PutObject'].includes(c.operation)&&!validVersionId(r?.VersionId)){cleanup(r?.Body);throw Error('Invalid object identity');}return r;}catch(e){if(write)stopped=true;throw e;}
 }
 t=createTransport({mode:mode==='isolated-publisher'?'mock-only':'mock-read-only',send:guardedSend,appendReceipt,fetchPublic,signal,limits:{objectBytes:16*1024*1024,functionBytes:128*1024,ms}});
 await t.initialize();
 const readonly={kind:'synthetic',read:t.read,readConfig:async()=>{const v=await guardedSend({service:'s3',operation:'GetBucketVersioning',input:bucketInput,region:target.region,maxAttempts:1,abortSignal:signal});if(v.Status!=='Enabled')throw Error('Versioning drift');return t.readConfig();}};
 if(mode==='isolated-recovery')return Object.freeze(readonly);
 const write=fn=>async(...args)=>{try{return await fn(...args);}catch(e){stopped=true;throw e;}};
 return Object.freeze({...readonly,createOnly:write(t.createOnly),replaceIndex:write(t.replaceIndex),verifyPublic:t.verifyPublic,stop(){stopped=true;}});
}

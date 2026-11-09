import {createRequire} from 'node:module';import {readReleaseInput} from '../proof-config/release-inputs.mjs';
import {deadline,cleanup} from '../proof-guarded-publisher/bounded-io.mjs';
import {validVersionId} from './version-id.mjs';
import {invocationScopes} from '../proof-disabled-workflow/scopes.mjs';
const require=createRequire(new URL('../proof-tooling-deps/package.json',import.meta.url));
const {GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const plan=JSON.parse(readReleaseInput('proof-oidc-release-draft/release-plan.json')),delta=JSON.parse(readReleaseInput('proof-retention-transport/policy-delta.proposed.json'));
const strip=a=>a.split(plan.archiveBucket+'/')[1],readKeys=new Set(delta.publisher.addCurrentGetObject.map(strip)),createKeys=new Set(delta.publisher.addExclusivePutObject.map(strip));
readKeys.add(plan.archivePrefix+'release.json');for(const k of ['source','candidate','rollback'])readKeys.add(plan.archivePrefix+'artifacts/'+k+'-'+plan[k+'ArchiveSha256']+'.tar.gz');
const control=plan.archivePrefix+'control/authority.json';
/** Constructs actual SDK commands; never constructs clients or resolves credentials. */
export function disabledS3({mode,sender,gate,run,signal,ms=15000,invocations,role}){
 if(mode!=='isolated-handler-only'||sender?.kind!=='isolated-handler'||gate?.kind!=='synthetic'||run?.commit!==plan.candidateCommit||run.artifactSha256!==plan.candidateArchiveSha256||!/^\d+$/.test(run.id)||!/^\d+$/.test(run.attempt))throw Error('Disabled scope');
 const bound=structuredClone(run);let poisoned=false,closed=false;
 let reads=readKeys,creates=createKeys,conditionalControl=control;
 if(invocations){if(!['archive','publisher','recovery'].includes(role))throw Error('Invocation role');const expected=role==='recovery'?invocations.recovery:invocations.publish;if(run.id!==expected.runId||run.attempt!==expected.attempt)throw Error('Invocation binding');const scope=invocationScopes(invocations)[role],prefix='arn:aws:s3:::'+plan.archiveBucket+'/';reads=new Set(scope.read.filter(x=>x.startsWith(prefix)).map(x=>x.slice(prefix.length)));creates=new Set(scope.exclusive.filter(x=>x.startsWith(prefix)).map(x=>x.slice(prefix.length)));conditionalControl=null;}
 const authorize=s=>gate.check({run:structuredClone(bound),signal:s});
 async function send(command,write){
  if(closed||(write&&poisoned))throw Error('Stopped');
  try{return await deadline(async s=>{const a=await authorize(s);if(a?.allowed!==true||a.runId!==bound.id||a.attempt!==bound.attempt||a.commit!==bound.commit||a.artifactSha256!==bound.artifactSha256)throw Error('Run gate');if(s.aborted)throw Error('Cancelled');return sender.send(command,{abortSignal:s});},{signal,ms,onLate:r=>cleanup(r?.Body)});}
  catch{if(write)poisoned=true;throw Error(write?'Write uncertain; no retry':'Read blocked');}
 }
 return Object.freeze({kind:'synthetic',async get(request){
  if(Object.keys(request).some(k=>!['Bucket','Key'].includes(k))||request.Bucket!==plan.archiveBucket||!reads.has(request.Key))throw Error('Read scope');
  const r=await send(new GetObjectCommand(request),false);if(!validVersionId(r?.VersionId)||!Number.isSafeInteger(r.ContentLength)||r.ContentLength<0){cleanup(r?.Body);throw Error('Read identity');}return r;
 },async put({key,body,ifMatch}){
  if(!Buffer.isBuffer(body)||body.length>128*1024||!(creates.has(key)||key===conditionalControl))throw Error('Write scope');
  if(key===conditionalControl?typeof ifMatch!=='string'||!ifMatch||ifMatch.length>1024||/[\s*,\x00-\x1f\x7f]/.test(ifMatch):ifMatch!==undefined)throw Error('Precondition');
  const request={Bucket:plan.archiveBucket,Key:key,Body:body,ServerSideEncryption:'AES256',ContentType:'application/json',...(key===conditionalControl?{IfMatch:ifMatch}:{IfNoneMatch:'*'})};
  const r=await send(new PutObjectCommand(request),true);if(!validVersionId(r?.VersionId)){poisoned=true;throw Error('Write acknowledgement uncertain');}return{versionId:r.VersionId};
 },close(){closed=true;}});
}

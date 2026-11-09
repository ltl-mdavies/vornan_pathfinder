import {bindings} from '../proof-config/bindings.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sha256} from './controller.mjs';
import {target} from './transport.mjs';
const requireValue=(ok,msg)=>{if(!ok)throw Error(msg);};
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const text=s=>typeof s==='string'&&s.length>0&&s.length<=256&&!/[^\x20-\x7e]/.test(s);
function assets(a){requireValue(Array.isArray(a)&&a.length>0&&new Set(a.map(x=>x.key)).size===a.length,'Invalid assets');return a.map(x=>{requireValue(/^(index\.html|(?:assets|brand|fonts)\/[A-Za-z0-9_.-]+)$/.test(x.key)&&digest(x.sha256),'Invalid asset identity');return{key:x.key,sha256:x.sha256};});}
function toolingIdentity(t){
 requireValue(t&&Object.keys(t).sort().join(',')==='commit,inventorySha256,repository,workflowPath,workflowSha256','Invalid tooling fields');
 requireValue(t.repository===bindings.repository&&/^[a-f0-9]{40}$/.test(t.commit)&&/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(t.workflowPath)&&digest(t.workflowSha256)&&digest(t.inventorySha256),'Invalid tooling identity');
 return{repository:t.repository,commit:t.commit,workflowPath:t.workflowPath,workflowSha256:t.workflowSha256,inventorySha256:t.inventorySha256};
}
export function releaseRecord(input,rollbackAssets,identity){
 requireValue(/^[A-Za-z0-9_-]{8,100}$/.test(input.releaseId)&&digest(identity.sourceManifestSha256)&&digest(identity.artifactSha256),'Invalid release identity');
 const b=input.baseline,i=b.index,m=i.metadata;
 requireValue(text(i.versionId)&&text(i.etag)&&digest(i.sha256)&&digest(b.configFingerprint)&&text(b.configEtag),'Invalid baseline identity');
 requireValue(m&&/^text\/html(?:;\s*charset=utf-8)?$/i.test(m.contentType)&&m.serverSideEncryption==='AES256'&&[null,'gzip','br'].includes(m.contentEncoding)&&(m.cacheControl===null||text(m.cacheControl)),'Invalid baseline metadata');
 const candidate=assets(input.assets),prior=assets(rollbackAssets);
 requireValue(candidate.filter(x=>x.key==='index.html').length===1&&prior.filter(x=>x.key==='index.html').length===1&&prior.find(x=>x.key==='index.html').sha256===i.sha256,'Entrypoint identity mismatch');
 const tooling=identity.tooling===undefined?undefined:toolingIdentity(identity.tooling);
 return{schema:tooling?2:1,...(tooling?{tooling}:{}),releaseId:input.releaseId,target:{...target},sourceManifestSha256:identity.sourceManifestSha256,artifactSha256:identity.artifactSha256,baseline:{index:{versionId:i.versionId,etag:i.etag,sha256:i.sha256,metadata:{contentType:m.contentType,cacheControl:m.cacheControl,contentEncoding:m.contentEncoding,serverSideEncryption:m.serverSideEncryption}},configFingerprint:b.configFingerprint,configEtag:b.configEtag},parentVersion:i.versionId,assets:candidate,rollbackAssets:prior};
}
function saveOnce(file,value){let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
/** Local filesystem evidence only; no remote archive or production durability claim. */
export function createJournal(directory,record){
 requireValue(fs.statSync(directory).isDirectory(),'Journal directory required');
 const canonical=releaseRecord({releaseId:record.releaseId,assets:record.assets,baseline:record.baseline},record.rollbackAssets,record);
 const file=path.join(directory,'release.json'),raw=JSON.stringify(canonical);
 saveOnce(file,{sha256:sha256(Buffer.from(raw)),record:canonical});
 return openJournal(directory);
}
export function openJournal(directory){
 const envelope=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8'));
 requireValue(sha256(Buffer.from(JSON.stringify(envelope.record)))===envelope.sha256,'Recovery record integrity failure');
 const r=envelope.record,canonical=releaseRecord({releaseId:r.releaseId,assets:r.assets,baseline:r.baseline},r.rollbackAssets,r);
 requireValue(JSON.stringify(canonical)===JSON.stringify(r),'Noncanonical recovery record');
 return{record:canonical,appendReceipt:async e=>{
  requireValue(e.releaseId===r.releaseId&&['intent','response'].includes(e.phase)&&r.assets.some(a=>a.key===e.key),'Receipt outside release');
  const a=r.assets.find(a=>a.key===e.key);
  let entry={phase:e.phase,key:e.key,releaseId:r.releaseId,recoveryRecordSha256:envelope.sha256};
  if(e.phase==='intent'){requireValue(e.sha256===a.sha256&&e.condition===(e.key==='index.html'?r.baseline.index.etag:'create-only'),'Receipt identity mismatch');entry={...entry,sha256:e.sha256,condition:e.condition,parentVersion:r.parentVersion};}
  else{requireValue(text(e.versionId)&&text(e.etag),'Invalid response identity');entry={...entry,versionId:e.versionId,etag:e.etag};}
  // Exclusive per-key intent prevents a second write attempt even after process restart.
  saveOnce(path.join(directory,sha256(Buffer.from(e.key))+'.'+e.phase+'.json'),entry);
 }};
}
/** Caller must supply a freshly initialized read-only transport; this function never writes. */
export async function reconcileReadOnly(record,io){
 const config=await io.readConfig();if(config.fingerprint!==record.baseline.configFingerprint||config.etag!==record.baseline.configEtag)return{status:'configuration-drift',automaticRetry:false};
 const current=await io.read('index.html'),candidate=record.assets.find(a=>a.key==='index.html');
 if(current&&current.sha256===candidate.sha256&&current.releaseId===record.releaseId&&current.parentVersion===record.parentVersion)return{status:'publication-recovered',automaticRetry:false,receipt:{releaseId:record.releaseId,previous:record.baseline.index,published:current,configFingerprint:config.fingerprint,configEtag:config.etag}};
 return{status:current?.versionId===record.baseline.index.versionId&&current?.etag===record.baseline.index.etag&&current?.sha256===record.baseline.index.sha256?'unchanged-unconfirmed':'superseded-unconfirmed',automaticRetry:false};
}

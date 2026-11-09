import {createHash} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(message);};
const index='index.html';
function verifiedBytes(entry,files){const bytes=files.get(entry.key);if(!bytes||sha256(bytes)!==entry.sha256)fail('Artifact hash mismatch: '+entry.key);return bytes;}
const metadataKeys=['contentType','cacheControl','contentEncoding','serverSideEncryption'];
function validatedMetadata(value){
 if(!value||typeof value!=='object'||Object.keys(value).length!==metadataKeys.length||Object.keys(value).some(k=>!metadataKeys.includes(k)))fail('Invalid prior index metadata fields');
 if(typeof value.contentType!=='string'||!/^text\/html(?:;\s*charset=utf-8)?$/i.test(value.contentType))fail('Invalid prior content type');
 if(value.cacheControl!==null&&(typeof value.cacheControl!=='string'||!value.cacheControl.length||value.cacheControl.length>1024||/[^\x20-\x7e]/.test(value.cacheControl)))fail('Invalid prior cache metadata');
 if(![null,'gzip','br'].includes(value.contentEncoding))fail('Invalid prior content encoding');
 if(value.serverSideEncryption!=='AES256')fail('Unsupported prior encryption; separate review required');
 return Object.fromEntries(metadataKeys.map(k=>[k,value[k]]));
}
function sameMetadata(a,b){return JSON.stringify(validatedMetadata(a))===JSON.stringify(validatedMetadata(b));}
function sameRevision(a,b){return Boolean(a&&b&&a.versionId===b.versionId&&a.etag===b.etag&&a.sha256===b.sha256&&(!b.metadata||sameMetadata(a.metadata,b.metadata)));}
function validateAssets(assets,files){
 if(!Array.isArray(assets)||!assets.length||!(files instanceof Map))fail('Invalid artifact collection');
 if(assets.some(a=>!a||typeof a.key!=='string'||!/^([a-f0-9]{64})$/.test(a.sha256)||!/^(index\.html|(?:assets|brand|fonts)\/[A-Za-z0-9_.-]+)$/.test(a.key)))fail('Malformed artifact entry');
 if(new Set(assets.map(a=>a.key)).size!==assets.length)fail('Duplicate artifact key');
 if(assets.filter(a=>a.key===index).length!==1)fail('One index required');
 for(const a of assets)verifiedBytes(a,files);
}
async function guard(io,baseline){
 const config=await io.readConfig();if(config.fingerprint!==baseline.configFingerprint||config.etag!==baseline.configEtag)fail('Configuration drift');
 const current=await io.read(index);if(!sameRevision(current,baseline.index))fail('Entrypoint revision drift');
 return current;
}
function checkInput(input){
 if(!input.releaseId||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.releaseId))fail('Unique release ID required');
 validateAssets(input.assets,input.files);
 if(!input.baseline?.index?.versionId||!input.baseline.index.etag||!input.baseline.index.sha256||!input.baseline.configEtag||!input.baseline.configFingerprint)fail('Complete baseline required');
 validatedMetadata(input.baseline.index.metadata);
}
function matches(o,bytes){return Boolean(o&&o.sha256===sha256(bytes));}

/** Transport is injected. This module includes NO AWS adapter, CLI, rebuild, delete or invalidation. */
export async function publish(input,io,{mode='plan'}={}){
 checkInput(input);if(!['plan','execute'].includes(mode))fail('Invalid mode');
 await guard(io,input.baseline);
 const steps=[];
 for(const a of input.assets.filter(a=>a.key!==index)){
   const current=await io.read(a.key);
   if(current&&!matches(current,input.files.get(a.key)))fail('Existing key collision: '+a.key);
   if(!current&&!/^assets\/.+-[A-Za-z0-9_-]{8}\.(?:js|mjs|css)$/.test(a.key))fail('Missing reusable nonhashed asset: '+a.key);
   steps.push({key:a.key,action:current?'reuse':'create-only',sha256:a.sha256});
 }
 if(mode==='plan')return {mode,releaseId:input.releaseId,steps:[...steps,{key:index,action:'conditional-index-last'}],invalidation:'not implemented; separately approved release step'};
 // All collisions are checked before any write. Every create remains atomic against races.
 for(const step of steps){
   const bytes=input.files.get(step.key);
   if(step.action==='create-only'){
     try{await io.createOnly(step.key,bytes,{ifNoneMatch:'*',releaseId:input.releaseId,cacheControl:'public,max-age=31536000,immutable',contentType:step.key.endsWith('.css')?'text/css':'text/javascript',serverSideEncryption:'AES256'});}
     catch(error){
       const found=await io.read(step.key);
       if(!matches(found,bytes))return {status:'asset-write-unconfirmed',key:step.key,indexUntouched:true,error:String(error)};
       // A lost success or identical concurrent create is safe to reuse, not retry.
     }
   }
   if(!matches(await io.read(step.key),bytes))return {status:'asset-verification-failed',key:step.key,indexUntouched:true};
   if(!await io.verifyPublic(step.key,step.sha256))return {status:'public-asset-verification-failed',key:step.key,indexUntouched:true};
 }
 await guard(io,input.baseline);
 const candidate=input.assets.find(a=>a.key===index),bytes=verifiedBytes(candidate,input.files);
 let response;
 try{response=await io.replaceIndex(bytes,{ifMatch:input.baseline.index.etag,releaseId:input.releaseId,parentVersion:input.baseline.index.versionId,contentType:'text/html',cacheControl:'no-cache,no-store,must-revalidate',serverSideEncryption:'AES256'});}
 catch(error){return reconcileIndex(input,io,bytes,error);}
 const current=await io.read(index);
 if(!matches(current,bytes)||current.releaseId!==input.releaseId||current.parentVersion!==input.baseline.index.versionId||current.versionId!==response.versionId)return {status:'index-publication-unconfirmed',current,automaticRetry:false};
 return {status:'published',receipt:{releaseId:input.releaseId,previous:input.baseline.index,published:current,configFingerprint:input.baseline.configFingerprint,configEtag:input.baseline.configEtag},invalidation:'not performed'};
}
async function reconcileIndex(input,io,bytes,error){
 const current=await io.read(index);
 if(matches(current,bytes)&&current.releaseId===input.releaseId&&current.parentVersion===input.baseline.index.versionId)return {status:'published-response-reconciled',receipt:{releaseId:input.releaseId,previous:input.baseline.index,published:current,configFingerprint:input.baseline.configFingerprint,configEtag:input.baseline.configEtag},invalidation:'not performed'};
 return {status:sameRevision(current,input.baseline.index)?'index-write-unconfirmed-unchanged':'index-write-unconfirmed-superseded',current,error:String(error),automaticRetry:false};
}

/** Rollback never repairs dependencies implicitly and never overwrites a superseding revision. */
export async function rollback(receipt,rollbackAssets,files,io,{mode='plan',rollbackId}={}){
 if(!['plan','execute'].includes(mode))fail('Invalid mode');
 if(!rollbackId||!/^[a-zA-Z0-9_-]{8,100}$/.test(rollbackId)||rollbackId===receipt.releaseId)fail('Unique rollback ID required');
 validateAssets(rollbackAssets,files);
 const priorMetadata=validatedMetadata(receipt.previous?.metadata);
 const baseline={index:receipt.published,configFingerprint:receipt.configFingerprint,configEtag:receipt.configEtag};
 await guard(io,baseline);
 for(const a of rollbackAssets){const bytes=verifiedBytes(a,files);if(a.key!==index&&!matches(await io.read(a.key),bytes))fail('Rollback dependency missing or changed: '+a.key);}
 const entry=rollbackAssets.find(a=>a.key===index);if(!entry||entry.sha256!==receipt.previous.sha256)fail('Rollback entrypoint mismatch');
 const bytes=verifiedBytes(entry,files);if(mode==='plan')return {mode,action:'conditional-restore-index-only',rollbackId,restoreMetadata:priorMetadata};
 await guard(io,baseline);
 try{await io.replaceIndex(bytes,{ifMatch:receipt.published.etag,releaseId:rollbackId,parentVersion:receipt.published.versionId,...priorMetadata});}catch(error){
   const current=await io.read(index);
   return {status:matches(current,bytes)&&current.releaseId===rollbackId&&current.parentVersion===receipt.published.versionId&&sameMetadata(current.metadata,priorMetadata)?'rollback-response-reconciled':'rollback-unconfirmed',current,error:String(error),automaticRetry:false};
 }
 const current=await io.read(index);
 return {status:matches(current,bytes)&&current.releaseId===rollbackId&&current.parentVersion===receipt.published.versionId&&sameMetadata(current.metadata,priorMetadata)?'rolled-back':'rollback-unconfirmed',current,invalidation:'not performed',automaticRetry:false};
}

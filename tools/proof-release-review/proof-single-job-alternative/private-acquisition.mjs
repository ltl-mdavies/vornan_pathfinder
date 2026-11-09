import {bindings} from '../proof-config/bindings.mjs';
import {readReleaseInput} from '../proof-config/release-inputs.mjs';
import {createHash} from 'node:crypto';
import {withPrivateMaterial} from '../proof-connection-prep/private-material.mjs';
import {deadline,boundedBytes,cleanup} from '../proof-guarded-publisher/bounded-io.mjs';
const plan=JSON.parse(readReleaseInput('proof-oidc-release-draft/release-plan.json'));
const kinds=['source','candidate','rollback'];
// Synthetic contract only. No AWS SDK or network implementation.
export async function acquirePrivate(options,consumer){
 try{
  if(Object.keys(options).some(k=>!['mode','service','receipt','signal','ms'].includes(k)))throw Error();
  const {mode,service,receipt,signal,ms=15000}=options;
  if(mode!=='mock-only'||service?.kind!=='synthetic'||receipt?.commit!==plan.candidateCommit||Object.keys(receipt.objects||{}).sort().join(',')!=='candidate,rollback,source')throw Error();
  const bytesByKind={};
  for(const kind of kinds){
   const expected=receipt.objects[kind],sha=plan[kind+'ArchiveSha256'];
   if(typeof expected.version!=='string'||!expected.version||expected.version==='null'||!Number.isSafeInteger(expected.length)||expected.length<=0||expected.length>(kind==='source'?64:32)*1024*1024)throw Error();
   // Current GetObject only. Expected VersionId is checked on RESPONSE, never requested.
   const result=await deadline(child=>service.get({Bucket:plan.archiveBucket,Key:plan.archivePrefix+'artifacts/'+kind+'-'+sha+'.tar.gz'},{signal:child}),{signal,ms,onLate:r=>cleanup(r?.Body)});
   let bytes;
   try{
    if(result?.VersionId!==expected.version||result.ContentLength!==expected.length)throw Error();
    bytes=await boundedBytes(result.Body,{maxBytes:expected.length,contentLength:result.ContentLength,signal,ms});
   }finally{cleanup(result?.Body);}
   if(bytes.length!==expected.length||createHash('sha256').update(bytes).digest('hex')!==sha)throw Error();
   bytesByKind[kind]=bytes;
  }
  if(signal?.aborted)throw Error();
  return await withPrivateMaterial({mode:'local-review-only',commit:plan.candidateCommit,releaseId:bindings.releaseId,bytesByKind},consumer);
 }catch{throw Error('Private acquisition stopped; details redacted');}
}

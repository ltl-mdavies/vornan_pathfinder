import {bindings} from '../proof-config/bindings.mjs';
import {sha256} from './controller.mjs';
import {deadline,boundedBytes,cleanup} from './bounded-io.mjs';
export const target=bindings.target;
export const reviewedRewrite=bindings.reviewedRewrite;
const keyOk=k=>typeof k==='string'&&/^(index\.html|(?:assets|brand|fonts)\/[A-Za-z0-9_.-]+)$/.test(k);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
/** Local transport contract. No SDK client construction, credential lookup, CLI, or real connector. */
export function createTransport({send,fetchPublic,appendReceipt,signal,mode,limits={objectBytes:16*1024*1024,functionBytes:128*1024,ms:15000}}){
 requireValue(['mock-only','mock-read-only'].includes(mode),'Live connector not implemented');
 let ready=false;
 async function safeBoundary(label,fn){try{return await fn();}catch{throw Error(label+' failed; details redacted');}}
 function active(){if(signal?.aborted)throw Error('Operation cancelled; reconcile uncertain writes separately');}
 async function call(service,operation,input){active();try{return await deadline(child=>send({service,operation,input,region:target.region,maxAttempts:1,abortSignal:child}),{signal,ms:limits.ms,onLate:r=>{cleanup(r?.Body);cleanup(r?.FunctionCode);}});}catch(e){const error=Error('Transport request failed');error.status=e?.$metadata?.httpStatusCode;error.code=['NoSuchKey','NotFound','PreconditionFailed','AccessDenied'].includes(e?.name)?e.name:'TransportError';throw error;}}
 const bucketInput={Bucket:target.bucket,ExpectedBucketOwner:target.account};
 async function configuration(){
  const r=await call('cloudfront','GetDistributionConfig',{Id:target.distribution});
  const c=r.DistributionConfig;
  requireValue(c?.Aliases?.Items?.includes(new URL(target.origin).hostname)&&c.Origins?.Items?.some(o=>o.Id===bindings.originId&&o.DomainName===target.bucket+'.s3.us-east-1.amazonaws.com'),'Distribution target mismatch');
  const origin=c.Origins.Items.find(o=>o.Id===bindings.originId);
  requireValue(origin.OriginPath===''&&c.DefaultRootObject==='index.html','Origin path/root mismatch');
  let verifyRewrite=false;
  function webBehavior(b){requireValue(b?.TargetOriginId===bindings.originId,'Static routing mismatch');requireValue(b.LambdaFunctionAssociations?.Quantity===0,'Unreviewed Lambda association');const f=b.FunctionAssociations;requireValue(f&&f.Quantity===(f.Items??[]).length,'Invalid function inventory');if(f.Quantity===0)return;requireValue(f.Quantity===1&&f.Items[0].FunctionARN===reviewedRewrite.arn&&f.Items[0].EventType==='viewer-request','Unreviewed edge association');verifyRewrite=true;}
  webBehavior(c.DefaultCacheBehavior);
  requireValue(c.CacheBehaviors&&c.CacheBehaviors.Quantity===(c.CacheBehaviors.Items??[]).length,'Missing ordered behavior inventory');
  for(const b of c.CacheBehaviors.Items??[]){
   if(['/api/public/proof/*','/api/public/proof/detailed-reports/*/view'].includes(b.PathPattern))continue;
   webBehavior(b);
  }
  if(verifyRewrite){const f=await call('cloudfront','GetFunction',{Name:reviewedRewrite.name,Stage:reviewedRewrite.stage});const bytes=await boundedBytes(f.FunctionCode,{signal,ms:limits.ms,maxBytes:limits.functionBytes,contentLength:f.ContentLength});requireValue(f.ETag===reviewedRewrite.etag&&sha256(bytes)===reviewedRewrite.sha256,'Live rewrite identity drift');}
  requireValue(typeof r.ETag==='string'&&r.ETag.length>0,'Missing config ETag');
  return{etag:r.ETag,fingerprint:sha256(Buffer.from(JSON.stringify(c)))};
 }
 async function initialize(){
  const identity=await call('sts','GetCallerIdentity',{});requireValue(identity.Account===target.account,'Account mismatch');
  const versioning=await call('s3','GetBucketVersioning',bucketInput);requireValue(versioning.Status==='Enabled','Versioning required');
  await configuration();ready=true;
 }
 function checkedKey(k){requireValue(ready,'Initialize target first');requireValue(keyOk(k),'Invalid object key');active();}
 async function read(k){checkedKey(k);let r;try{r=await call('s3','GetObject',{...bucketInput,Key:k});}catch(e){if(e.status===404&&['NoSuchKey','NotFound'].includes(e.code))return null;throw e;}
  const bytes=await boundedBytes(r.Body,{signal,ms:limits.ms,maxBytes:limits.objectBytes,contentLength:r.ContentLength});
  requireValue(r.VersionId&&r.VersionId!=='null'&&r.ETag,'Unversioned object');
  return{versionId:r.VersionId,etag:r.ETag,sha256:sha256(bytes),releaseId:r.Metadata?.['release-id'],parentVersion:r.Metadata?.['parent-version'],metadata:{contentType:r.ContentType??null,cacheControl:r.CacheControl??null,contentEncoding:r.ContentEncoding??null,serverSideEncryption:r.ServerSideEncryption??null}};
 }
 async function put(k,bytes,opts,kind){requireValue(mode==='mock-only','Read-only reconciliation cannot write');checkedKey(k);requireValue(Buffer.isBuffer(bytes),'Buffer required');
  const allowed=['releaseId','parentVersion','contentType','cacheControl','contentEncoding','serverSideEncryption',kind==='asset'?'ifNoneMatch':'ifMatch'];
  requireValue(Object.keys(opts).every(k=>allowed.includes(k)),'Unexpected request option');
  requireValue(/^[A-Za-z0-9_-]{8,100}$/.test(opts.releaseId)&&opts.serverSideEncryption==='AES256','Invalid release metadata');
  requireValue(kind==='asset'?/^assets\/.+-[A-Za-z0-9_-]{8}\.(?:js|mjs|css)$/.test(k)&&opts.ifNoneMatch==='*':k==='index.html'&&typeof opts.ifMatch==='string'&&opts.ifMatch.length>0&&typeof opts.parentVersion==='string'&&opts.parentVersion.length>0,'Conditional request required');
  const input={...bucketInput,Key:k,Body:bytes,ServerSideEncryption:'AES256',ContentType:opts.contentType,Metadata:{'release-id':opts.releaseId,...(opts.parentVersion?{'parent-version':opts.parentVersion}:{})},...(kind==='asset'?{IfNoneMatch:'*'}:{IfMatch:opts.ifMatch})};
  if(opts.cacheControl!=null)input.CacheControl=opts.cacheControl;if(opts.contentEncoding!=null)input.ContentEncoding=opts.contentEncoding;
  // Receipt must be durably acknowledged before the request; failure prevents writes.
  await safeBoundary('Receipt acknowledgement',()=>appendReceipt({phase:'intent',key:k,releaseId:opts.releaseId,sha256:sha256(bytes),condition:kind==='asset'?'create-only':opts.ifMatch}));active();
  const r=await call('s3','PutObject',input);
  requireValue(r.VersionId&&r.VersionId!=='null'&&r.ETag,'Missing write revision; reconciliation required');
  await safeBoundary('Receipt acknowledgement',()=>appendReceipt({phase:'response',key:k,releaseId:opts.releaseId,versionId:r.VersionId,etag:r.ETag}));
  return{versionId:r.VersionId,etag:r.ETag};
 }
 return{initialize,read,readConfig:async()=>{requireValue(ready,'Initialize target first');return configuration();},createOnly:(k,b,o)=>put(k,b,o,'asset'),replaceIndex:(b,o)=>put('index.html',b,o,'index'),verifyPublic:async(k,hash)=>{checkedKey(k);const url=new URL('/'+k,target.origin);return safeBoundary('Public verification',async()=>{const r=await deadline(child=>fetchPublic(url.href,{redirect:'error',credentials:'omit',signal:child}),{signal,ms:limits.ms,onLate:r=>cleanup(r?.body)});try{requireValue(r.url===url.href&&!r.redirected,'Unexpected public response URL');const bytes=await boundedBytes(r.body,{signal,ms:limits.ms,maxBytes:limits.objectBytes,contentLength:r.headers?.get?.('content-length')});return r.status===200&&sha256(bytes)===hash;}finally{cleanup(r.body);}});}};
}

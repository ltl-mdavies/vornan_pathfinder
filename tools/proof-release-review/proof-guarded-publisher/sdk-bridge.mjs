import{Readable}from'node:stream';
import{target,reviewedRewrite}from'./transport.mjs';
import{deadline,boundedBytes,cleanup}from'./bounded-io.mjs';
export const publisherLimits=Object.freeze({assetBytes:16*1024*1024,sourceArchiveBytes:64*1024*1024,artifactArchiveBytes:32*1024*1024,journalBytes:1024*1024,functionBytes:128*1024,requestMs:15000,bodyMs:15000});
/** Actual SDK serialization with fake handler and synthetic credentials ONLY. No live factory. */
export function createSdkBridge({sdk,handler,mode,limits=publisherLimits}){
 if(mode!=='fake-handler-only'||typeof handler!=='function')throw Error('Fake handler required');
 for(const[k,v]of Object.entries(publisherLimits)){const n=limits[k];if(!Number.isSafeInteger(n)||n<=0||(k.endsWith('Ms')?n>60000:n>128*1024*1024))throw Error('Invalid publisher limit');}
 const services={s3:{Client:sdk.S3Client,endpoint:'https://s3.us-east-1.amazonaws.com',commands:{GetObject:sdk.GetObjectCommand,GetBucketVersioning:sdk.GetBucketVersioningCommand,PutObject:sdk.PutObjectCommand}},sts:{Client:sdk.STSClient,endpoint:'https://sts.us-east-1.amazonaws.com',commands:{GetCallerIdentity:sdk.GetCallerIdentityCommand}},cloudfront:{Client:sdk.CloudFrontClient,endpoint:'https://cloudfront.amazonaws.com',commands:{GetDistributionConfig:sdk.GetDistributionConfigCommand,GetFunction:sdk.GetFunctionCommand}}};
 const clients={};
 for(const[name,s]of Object.entries(services))clients[name]=new s.Client({region:target.region,endpoint:s.endpoint,maxAttempts:1,followRegionRedirects:false,forcePathStyle:true,credentials:{accessKeyId:'SYNTHETIC_TEST_KEY',secretAccessKey:'synthetic-test-secret-not-a-credential'},requestHandler:{handle:async(request,options)=>{
  if(request.protocol!=='https:'||request.hostname!==new URL(s.endpoint).hostname)throw Error('Endpoint rejected');
  const result=await handler(request,options);const response=result.response;
  // Bound before SDK deserialization (including non-streaming function/config responses).
  const maxBytes=name==='cloudfront'&&request.path.includes('/function/')?limits.functionBytes:limits.assetBytes;
  const bytes=await boundedBytes(response.body,{maxBytes,ms:limits.bodyMs,signal:options?.abortSignal,contentLength:response.headers?.['content-length']});
  return{response:{...response,body:Readable.from([bytes])}};
 },destroy(){}}});
 function validate(c){
  const s=services[c.service],p=c.input;if(!s?.commands[c.operation]||c.region!==target.region||c.maxAttempts!==1||!p)throw Error('Operation rejected');
  let allowed=[];
  if(c.service==='s3'){
   if(p.Bucket!==target.bucket||p.ExpectedBucketOwner!==target.account)throw Error('Target rejected');
   allowed=['Bucket','ExpectedBucketOwner'];
   if(c.operation!=='GetBucketVersioning'){if(!/^(index\.html|(?:assets|brand|fonts)\/[A-Za-z0-9_.-]+)$/.test(p.Key))throw Error('Key rejected');allowed.push('Key');}
   if(c.operation==='PutObject'){
    allowed.push('Body','ServerSideEncryption','ContentType','CacheControl','ContentEncoding','Metadata','IfMatch','IfNoneMatch');
    if(!Buffer.isBuffer(p.Body)||p.Body.length>limits.assetBytes||p.ServerSideEncryption!=='AES256')throw Error('Payload rejected');
    if(p.Key==='index.html'?!p.IfMatch||p.IfNoneMatch!==undefined:p.IfNoneMatch!=='*'||p.IfMatch!==undefined||!/^assets\/.+-[A-Za-z0-9_-]{8}\.(js|mjs|css)$/.test(p.Key))throw Error('Condition rejected');
   }
  }else if(c.service==='sts'){allowed=[];}
  else if(c.operation==='GetDistributionConfig'){allowed=['Id'];if(p.Id!==target.distribution)throw Error('Distribution rejected');}
  else{allowed=['Name','Stage'];if(p.Name!==reviewedRewrite.name||p.Stage!=='LIVE')throw Error('Function rejected');}
  if(Object.keys(p).some(k=>!allowed.includes(k)))throw Error('Extra input rejected');
 }
 return{send:async c=>{validate(c);try{return await deadline(signal=>clients[c.service].send(new services[c.service].commands[c.operation](c.input),{abortSignal:signal}),{ms:limits.requestMs,signal:c.abortSignal,onLate:r=>{cleanup(r?.Body);cleanup(r?.FunctionCode);}});}catch(e){const error=Error('SDK operation failed; details redacted');error.name=['NoSuchKey','NotFound','AccessDenied','PreconditionFailed'].includes(e?.name)?e.name:'TransportError';if(e?.$metadata?.httpStatusCode)error.$metadata={httpStatusCode:e.$metadata.httpStatusCode};throw error;}},destroy:()=>Object.values(clients).forEach(c=>c.destroy())};
}

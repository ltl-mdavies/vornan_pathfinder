// Local proposal. send is an isolated test seam, not authenticated authority.
export async function readBoundedVersion(send, descriptor, deadlineMs=5000){
 const controller=new AbortController();let body,timer,expired=false;
 const fail=()=>{throw Error('Private input read unavailable');};
 try{
  if(typeof send!=='function'||!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>5000||!Number.isSafeInteger(descriptor?.bytes)||descriptor.bytes<1||descriptor.bytes>183684)fail();
  const work=(async()=>{
   const response=await send({Bucket:descriptor.bucket,Key:descriptor.key,VersionId:descriptor.versionId},{abortSignal:controller.signal});
   body=response?.Body;
   if(expired){body?.destroy?.();fail();}
   if(response?.VersionId!==descriptor.versionId||response?.ContentLength!==descriptor.bytes||response?.DeleteMarker===true||typeof body?.[Symbol.asyncIterator]!=='function'||typeof body.destroy!=='function')fail();
   const chunks=[];let bytes=0,chunkCount=0,emptyCount=0;
   for await(const chunk of body){
    if(expired||!Buffer.isBuffer(chunk)||++chunkCount>4096)fail();
    if(chunk.length===0){if(++emptyCount>16)fail();continue;}
    emptyCount=0;
    bytes+=chunk.length;if(bytes>descriptor.bytes)fail();
    chunks.push(Buffer.from(chunk));
   }
   if(bytes!==descriptor.bytes)fail();
   return {versionId:response.VersionId,body:Buffer.concat(chunks,bytes)};
  })();
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();body?.destroy?.();reject(Error('deadline'));},deadlineMs);});
  return await Promise.race([work,deadline]);
 }catch{fail();}
 finally{clearTimeout(timer);controller.abort();body?.destroy?.();}
}

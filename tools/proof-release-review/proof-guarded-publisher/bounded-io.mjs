export function cleanup(body){try{const r=body?.destroy?body.destroy():body?.cancel?.();Promise.resolve(r).catch(()=>{});}catch{/* Cleanup must not leak errors or hang. */}}
export async function deadline(work,{signal,ms=15000,onLate=()=>{}}={}){
 if(!Number.isFinite(ms)||ms<=0||ms>60000)throw Error('Invalid deadline');
 const control=new AbortController();let timer,listener,settled=false;
 const stop=new Promise((_,reject)=>{listener=()=>{control.abort();reject(Error('Operation cancelled or timed out; outcome may be uncertain'));};if(signal?.aborted)listener();else signal?.addEventListener('abort',listener,{once:true});timer=setTimeout(listener,ms);});
 const task=Promise.resolve().then(()=>{if(control.signal.aborted)throw Error('Operation cancelled');return work(control.signal);});
 task.then(value=>{if(settled&&control.signal.aborted)onLate(value);},()=>{});
 try{return await Promise.race([task,stop]);}finally{settled=true;clearTimeout(timer);signal?.removeEventListener('abort',listener);}
}
export async function boundedBytes(body,{maxBytes=16*1024*1024,ms=15000,signal,contentLength}={}){
 let reader,iterator;const cancel=()=>{cleanup(body);try{Promise.resolve(reader?.cancel()).catch(()=>{});Promise.resolve(iterator?.return?.()).catch(()=>{});}catch{}};
 try{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('Invalid byte limit');
  if(contentLength!=null){if(!/^[0-9]+$/.test(String(contentLength))||!Number.isSafeInteger(Number(contentLength))||Number(contentLength)>maxBytes)throw Error('Invalid or excessive declared length');}
  return await deadline(async child=>{
   const chunks=[];let size=0,count=0;
   const accept=c=>{if(!(c instanceof Uint8Array))throw Error('Non-byte stream');size+=c.byteLength;if(size>maxBytes)throw Error('Byte limit exceeded');chunks.push(Buffer.from(c));};
   if(body instanceof Uint8Array){accept(body);return Buffer.concat(chunks);}
   if(body?.getReader){reader=body.getReader();iterator={next:()=>reader.read()};}
   else if(body?.[Symbol.asyncIterator])iterator=body[Symbol.asyncIterator]();
   else throw Error('Streaming body required');
   while(true){if(child.aborted)throw Error('Cancelled');if(++count>65536)throw Error('Chunk limit exceeded');const next=await iterator.next();if(next.done)break;accept(next.value);}
   return Buffer.concat(chunks);
  },{signal,ms});
 }catch{throw Error('Bounded body read failed; details redacted');}finally{cancel();}
}

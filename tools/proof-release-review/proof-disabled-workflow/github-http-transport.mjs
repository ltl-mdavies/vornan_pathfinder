import {bindings} from "../proof-config/bindings.mjs";
// GET-only transport. No credential discovery, persistence, logging or retries.
// Caller supplies an existing token provider. This does not authenticate consent.
const origin='https://api.github.com';
const route=new RegExp("^/repos/"+bindings.repository+"/actions/runs/([1-9]\\d{0,15})(?:/approvals|/attempts/1/jobs\\?per_page=100&page=([1-9]|10))?$");
const environmentRoute=new RegExp('^/repos/'+bindings.repository+'/environments/(proof-release-owner|proof-release-recovery)(?:/deployment-branch-policies\\?per_page=100&page=1)?$');
class BoundaryError extends Error {constructor(code){super(code);this.code=code;}}
const requireValue=(value,code)=>{if(!value)throw new BoundaryError(code);};
export function githubReadOnlyTransport({credential,fetchImpl=globalThis.fetch,deadlineMs=5000,maxBytes=1024*1024}={}){
 requireValue(typeof credential==='function'&&typeof fetchImpl==='function'&&Number.isSafeInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=30000&&Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=1024*1024,'invalid-transport-config');
 return Object.freeze({async get(path,{signal}={}){
  let timer,reader,response;const controller=new AbortController();
  const cancelBody=()=>{try{const p=reader?reader.cancel():response?.body?.cancel();Promise.resolve(p).catch(()=>{});}catch{}};
  let stop;
  const stopped=new Promise((_,reject)=>{stop=code=>{controller.abort();cancelBody();reject(new BoundaryError(code));};});
  const externalAbort=()=>stop('request-aborted');
  try{
   const match=typeof path==='string'&&route.exec(path);
   const environmentMatch=typeof path==='string'&&environmentRoute.exec(path);
   requireValue((match&&match[0]===path&&Number.isSafeInteger(Number(match[1])))||(environmentMatch&&environmentMatch[0]===path),'endpoint-not-allowed');
   requireValue(!signal||typeof signal.addEventListener==='function','invalid-signal');
   requireValue(!signal?.aborted,'request-aborted');
   signal?.addEventListener('abort',externalAbort,{once:true});
   timer=setTimeout(()=>stop('request-deadline'),deadlineMs);
   const operation=(async()=>{
    const token=await credential({signal:controller.signal});
    requireValue(!controller.signal.aborted,'request-aborted');
    requireValue(typeof token==='string'&&token.length>0&&token.length<=8192&&/^[\x21-\x7e]+$/.test(token),'credential-unavailable');
    const url=origin+path;
    response=await fetchImpl(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Vornan-Proof-ReadOnly-Review',Authorization:'Bearer '+token}});
    requireValue(!controller.signal.aborted,'request-aborted');
    requireValue(response?.redirected===false&&response.url===url,'unexpected-response-origin');
    requireValue(Number.isInteger(response.status)&&response.status>=200&&response.status<600,'invalid-http-status');
    requireValue(response.status<300||response.status>=400,'redirect-rejected');
    // Never parse or return error bodies, headers or provider error messages.
    if(response.status!==200){cancelBody();return {status:response.status,headers:{},data:null};}
    requireValue(/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(response.headers.get('content-type')??''),'unexpected-content-type');
    const length=response.headers.get('content-length');
    requireValue(length===null||(/^\d+$/.test(length)&&Number.isSafeInteger(Number(length))&&Number(length)<=maxBytes),'response-too-large');
    requireValue(response.body&&typeof response.body.getReader==='function','missing-body');
    reader=response.body.getReader();const chunks=[];let total=0;
    for(;;){
     const {done,value}=await reader.read();requireValue(!controller.signal.aborted,'request-aborted');
     if(done)break;
     requireValue(value instanceof Uint8Array,'invalid-body-chunk');
     total+=value.byteLength;requireValue(total<=maxBytes&&chunks.length<4096,'response-too-large');chunks.push(Buffer.from(value));
    }
    const bytes=Buffer.concat(chunks,total);
    let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new BoundaryError('invalid-json');}
    const link=response.headers.get('link');
    // Preserve presence only: reader refuses unsupported review continuations.
    return {status:200,headers:link?{link:'present'}:{},data};
   })().finally(()=>{if(controller.signal.aborted)cancelBody();});
   return await Promise.race([operation,stopped]);
  }catch(error){
   controller.abort();cancelBody();
   throw new BoundaryError(error instanceof BoundaryError?error.code:'transport-failed');
  }finally{clearTimeout(timer);signal?.removeEventListener?.('abort',externalAbort);}
 }});
}

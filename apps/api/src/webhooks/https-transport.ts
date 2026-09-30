import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkedAssetUrl, isPublicAddress, type ResolvedAddress } from '../json-intake/https-assets.js';
import type { LocalWebhookTransport } from './dispatch.js';

/** A trusted exact destination, never one taken from an order. No redirects or pooled sockets. */
export function createSandboxHttpsTransport(destination:string, dependencies:{
  resolve?:(host:string)=>Promise<ResolvedAddress[]>; request?:typeof request;
}={}):LocalWebhookTransport {
  const host=new URL(destination).hostname;
  const validate=(url:string)=>{
    if(url!==destination)throw new Error('WEBHOOK_DESTINATION_MISMATCH');
    checkedAssetUrl(url,new Set([host]));
  };
  validate(destination);
  return {kind:'sandbox-https',validate,async send(value,body,headers,signal){
    validate(value);
    if(body.length>256*1024)throw new Error('WEBHOOK_BODY_LIMIT');
    const url=new URL(value);
    const addresses=await (dependencies.resolve??(async host=>(await lookup(host,{all:true,verbatim:true})).map(a=>({address:a.address,family:a.family as 4|6}))))(host);
    // Dispatch's deadline also covers DNS. A late DNS response must never start a socket.
    if(signal.aborted)throw new Error('WEBHOOK_ABORTED');
    if(!addresses.length||addresses.length>32||addresses.some(a=>!isPublicAddress(a)))throw new Error('WEBHOOK_ADDRESS_REJECTED');
    const address=addresses[0];
    return new Promise((resolve,reject)=>{
      const req=(dependencies.request??request)(url,{
        method:'POST',agent:false,signal,family:address.family,servername:host,rejectUnauthorized:true,maxHeaderSize:8192,
        headers:{...headers,'Content-Length':String(body.length)},
        lookup:((_host:string,options:any,callback:any)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)) as import('node:net').LookupFunction
      },response=>{
        const remote=response.socket.remoteAddress,exact=new BlockList();exact.addAddress(address.address,address.family===4?'ipv4':'ipv6');
        if(!remote||!exact.check(remote,isIP(remote)===4?'ipv4':'ipv6')){
          response.destroy();reject(new Error('WEBHOOK_CONNECTION_REJECTED'));return;
        }
        const result={status:response.statusCode??0,retry_after:typeof response.headers['retry-after']==='string'?response.headers['retry-after']:undefined};
        response.destroy();resolve(result);
      });
      req.once('error',()=>reject(new Error('WEBHOOK_NETWORK_FAILURE')));req.end(body);
    });
  }};
}

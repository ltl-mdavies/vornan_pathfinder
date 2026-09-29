import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { AssetCheckError } from './asset-errors.js';

export interface AssetReadOptions { max_bytes: number; content_types: readonly string[] }
export interface AssetHostPolicy { allowed_hosts: readonly string[]; timeout_ms?: number; max_redirects?: number; max_bytes?: number }
export interface ResolvedAddress { address: string; family: 4 | 6 }
export interface PinnedResponse {
  status: number; headers: IncomingMessage['headers']; body: AsyncIterable<Uint8Array>;
  close(): void;
}
export interface HttpsAssetDependencies {
  resolve(host: string): Promise<ResolvedAddress[]>;
  exchange(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<PinnedResponse>;
}
const denied = new BlockList();
for (const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) denied.addSubnet(ip,prefix,'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
for (const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) denied.addSubnet(ip,prefix,'ipv6');
export function isPublicAddress(address: ResolvedAddress) {
  const family = isIP(address.address);
  return family === address.family && (family === 4 ? !denied.check(address.address,'ipv4') :
    family === 6 && globalV6.check(address.address,'ipv6') && !denied.check(address.address,'ipv6'));
}
/** Exact DNS hostnames only; payload cannot supply an allowlist or authorize another destination. */
export function checkedAssetUrl(input: string, hosts: ReadonlySet<string>) {
  let url: URL;
  try {url = new URL(input);} catch {throw new AssetCheckError('ASSET_URL_UNSUPPORTED');}
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') ||
    isIP(url.hostname.replace(/^\[|\]$/g,'')) || !hosts.has(url.hostname)) throw new AssetCheckError('ASSET_URL_UNSUPPORTED');
  return url;
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject) => {
    const abort = () => reject(new AssetCheckError('ASSET_FETCH_TIMEOUT',true,'internal'));
    if (signal.aborted) {abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** Node resolves exactly once via our pinned lookup, retains TLS hostname verification, and never pools sockets. */
export function createPinnedHttpsExchange(request: typeof httpsRequest = httpsRequest): HttpsAssetDependencies['exchange'] {
  return (url,address,signal) => new Promise((resolve,reject) => {
  const req = request(url, {
    method:'GET', agent:false, signal, family:address.family, servername:url.hostname,
    rejectUnauthorized:true, maxHeaderSize:16 * 1024,
    headers:{Accept:'application/pdf, image/png, image/jpeg', 'Accept-Encoding':'identity'},
    lookup:((_host: string,_options: unknown,callback: (...args: any[])=>void) => {
      // Node may request all addresses; this list still contains only our approved pinned destination.
      if ((_options as {all?:boolean})?.all) callback(null,[address]);
      else callback(null,address.address,address.family);
    }) as import('node:net').LookupFunction
  }, response => {
    const remote = response.socket.remoteAddress;
    const exact = new BlockList(); exact.addAddress(address.address,address.family === 4 ? 'ipv4' : 'ipv6');
    if (!remote || !exact.check(remote,isIP(remote) === 4 ? 'ipv4' : 'ipv6')) {
      response.destroy(); reject(new AssetCheckError('ASSET_CONNECTION_REJECTED'));return;
    }
    resolve({status:response.statusCode ?? 0,headers:response.headers,body:response,close:()=>response.destroy()});
  });
  req.once('error',()=>reject(new AssetCheckError(signal.aborted?'ASSET_FETCH_TIMEOUT':'ASSET_FETCH_FAILED',true,'internal')));
  req.end();
  });
}
export const exchangePinnedHttps = createPinnedHttpsExchange();
const defaults: HttpsAssetDependencies = {
  resolve: async host => (await lookup(host,{all:true,verbatim:true})).map(a=>({address:a.address,family:a.family as 4|6})),
  exchange:exchangePinnedHttps
};

/** Unwired capability. Construct only from trusted integration configuration, never payload hosts. */
export function createHttpsAssetReader(policy: AssetHostPolicy, dependencies: HttpsAssetDependencies = defaults) {
  const hosts = new Set(policy.allowed_hosts);
  if (!hosts.size || [...hosts].some(h => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(h) || !h.includes('.') || h.includes('..') || isIP(h))) throw new Error('Invalid asset host configuration');
  const timeout = policy.timeout_ms ?? 10_000, redirects = policy.max_redirects ?? 2, limit = policy.max_bytes ?? 25*1024*1024;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000 || !Number.isInteger(redirects) || redirects < 0 || redirects > 3 || !Number.isInteger(limit) || limit < 1 || limit > 25*1024*1024) throw new Error('Invalid asset bounds');
  return async (source: string, options: AssetReadOptions = {max_bytes:limit,content_types:['application/pdf']}) => {
    if (!Number.isSafeInteger(options.max_bytes) || options.max_bytes < 1 || !options.content_types.length) throw new Error('Invalid asset read bounds');
    const maxBytes = Math.min(limit,options.max_bytes);
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),timeout);
    let response: PinnedResponse | undefined;
    const close = () => response?.close(); controller.signal.addEventListener('abort',close);
    try {
      let url = checkedAssetUrl(source,hosts);
      for (let hop=0;;hop++) {
        const addresses = await bounded(dependencies.resolve(url.hostname),controller.signal);
        if (!addresses.length || addresses.length>32 || addresses.some(a=>!isPublicAddress(a))) throw new AssetCheckError('ASSET_PRIVATE_ADDRESS');
        const current: PinnedResponse = await bounded(dependencies.exchange(url,addresses[0],controller.signal).then(result=>{if(controller.signal.aborted)result.close();return result;}),controller.signal);
        response=current;
        if ([301,302,303,307,308].includes(current.status)) {
          if (hop>=redirects || typeof current.headers.location!=='string') throw new AssetCheckError('ASSET_REDIRECT_REJECTED');
          // Every hop is independently allowlisted and resolved; no original auth headers are forwarded.
          let next:string;try{next=new URL(current.headers.location,url).href;}catch{throw new AssetCheckError('ASSET_REDIRECT_REJECTED');}
          current.close(); response=undefined; url=checkedAssetUrl(next,hosts); continue;
        }
        if (current.status!==200) {
          const transient = [408,425,429].includes(current.status) || current.status>=500;
          throw new AssetCheckError(current.status===401 || current.status===403 ? 'ARTWORK_URL_EXPIRED' : transient ? 'ASSET_FETCH_FAILED' : 'ASSET_HTTP_REJECTED',transient,transient?'internal':'customer');
        }
        const contentType = String(current.headers['content-type']??'').split(';')[0].trim().toLowerCase();
        if (!options.content_types.includes(contentType)) throw new AssetCheckError('ASSET_CONTENT_TYPE_MISMATCH');
        const encoding = current.headers['content-encoding'];
        if (encoding && encoding!=='identity') throw new AssetCheckError('ASSET_ENCODING_UNSUPPORTED');
        const size = current.headers['content-length'];
        if (size!==undefined && (typeof size!=='string' || !/^\d+$/.test(size) || !Number.isSafeInteger(Number(size)) || Number(size)>maxBytes)) throw new AssetCheckError('ASSET_BYTE_LIMIT');
        const chunks: Buffer[]=[];let total=0;
        const iterator=current.body[Symbol.asyncIterator]();
        for (;;) {
          const chunk=await bounded(iterator.next(),controller.signal);if(chunk.done)break;
          total+=chunk.value.byteLength;if(total>maxBytes)throw new AssetCheckError('ASSET_BYTE_LIMIT');
          chunks.push(Buffer.from(chunk.value));
        }
        if (!total || (size!==undefined && Number(size)!==total)) throw new AssetCheckError('ASSET_LENGTH_MISMATCH');
        return Buffer.concat(chunks,total);
      }
    } catch(e) {
      if(e instanceof AssetCheckError)throw e;
      throw new AssetCheckError(controller.signal.aborted?'ASSET_FETCH_TIMEOUT':'ASSET_FETCH_FAILED',true,'internal');
    } finally {clearTimeout(timer);controller.signal.removeEventListener('abort',close);response?.close();}
  };
}

import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { deliveryHeaders,scopeKey,digest,type WebhookScope,type CommittedWebhookEvent } from './contract.js';
import type { WebhookOutbox,OutboxRecord,ReplayAudit } from './local-outbox.js';
export interface LocalEndpoint {
  id:string; revision:string; scope:WebhookScope; enabled:boolean;
  url:string; active_key_id:string;
}
export interface LocalWebhookTransport {
  kind:'loopback-test';
  send(url:string,body:Buffer,headers:Record<string,string>,signal:AbortSignal):Promise<{status:number;retry_after?:string}>;
}
export const retryOffsets=[0,60,300,900,3600,10800,21600,43200,64800,86400] as const;
const WINDOW=86400_000;
function loopbackUrl(value:string){
  const url=new URL(value);
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || url.username || url.password || url.hash)throw new Error('Only explicit IPv4 loopback test receivers are permitted');
  return url;
}
/** No external transport exists in this slice. Redirects are returned as failures, never followed. */
export const loopbackTransport:LocalWebhookTransport={kind:'loopback-test',send:(value,body,headers,signal)=>new Promise((resolve,reject)=>{
  const url=loopbackUrl(value);
  const req=request(url,{method:'POST',headers:{...headers,'Content-Length':String(body.length)},signal,agent:false,maxHeaderSize:8192},res=>{
    const result={status:res.statusCode??0,retry_after:typeof res.headers['retry-after']==='string'?res.headers['retry-after']:undefined};
    res.destroy();resolve(result);
  });req.once('error',()=>reject(new Error('WEBHOOK_NETWORK_FAILURE')));req.end(body);
})};
function retryAfter(value:string|undefined,now:number):number|null{
  if(!value || value.length>128)return null;
  if(/^\d+$/.test(value)){const seconds=Number(value);return Number.isFinite(seconds)?now+seconds*1000:null;}
  const parsed=Date.parse(value);return Number.isFinite(parsed)?Math.max(now,parsed):null;
}
export interface DispatchDependencies {
  outbox:WebhookOutbox; transport:LocalWebhookTransport;
  secret(scope:WebhookScope,keyId:string):Promise<string>;
  now?:()=>string;
  isCurrent?:(event:CommittedWebhookEvent)=>Promise<boolean>;
  timeout_ms?:number;
}
export async function dispatchWebhook(id:string,endpoint:LocalEndpoint,deps:DispatchDependencies){
  if(!endpoint.enabled)return 'disabled';
  loopbackUrl(endpoint.url);
  if(deps.transport.kind!=='loopback-test' || endpoint.scope.environment!=='test')throw new Error('Local webhook transport only');
  const now=deps.now??(()=>new Date().toISOString()),at=now(),ms=Date.parse(at);
  let r=await deps.outbox.get(id);if(!r)return 'missing';
  if(scopeKey(r.event.scope)!==scopeKey(endpoint.scope)||r.endpoint_id!==endpoint.id)throw new Error('Webhook endpoint scope mismatch');
  if(['delivered','paused','exhausted','suppressed'].includes(r.state))return r.state;
  if(r.state==='in_flight' && Date.parse(r.claim!.until)>ms)return 'busy';
  const stop=async(state:OutboxRecord['state'],code:string,attention=false)=>{
    const next={...r!,revision:r!.revision+1,state,code,endpoint_attention:attention,claim:null,next_attempt_at:null,updated_at:at};
    return await deps.outbox.cas(r!,next)?state:'conflict';
  };
  if(r.endpoint_revision!==endpoint.revision || r.destination_sha256!==digest(endpoint.url))return stop('paused','ENDPOINT_CONFIGURATION_CHANGED',true);
  if(r.state==='in_flight'){
    // HTTP outcome after a dead worker is uncertain. Only this webhook contract permits another delivery.
    const attempts=r.attempts.map((a,i)=>i===r!.attempts.length-1?{...a,outcome:'uncertain' as const,code:'WORKER_OUTCOME_UNKNOWN'}:a);
    const next={...r,revision:r.revision+1,state:'pending' as const,claim:null,attempts,updated_at:at,
      next_attempt_at:new Date(Math.max(ms,Date.parse(r.first_attempt_at!)+(retryOffsets[r.cycle_attempts]??86400)*1000)).toISOString()};
    if(!await deps.outbox.cas(r,next))return 'conflict';r=next;
  }
  if(r.first_attempt_at && (ms>Date.parse(r.first_attempt_at)+WINDOW || r.cycle_attempts>=10))return stop('exhausted','RETRY_WINDOW_EXHAUSTED');
  if(r.next_attempt_at && Date.parse(r.next_attempt_at)>ms)return 'not_due';
  if(r.event.envelope.event_type!=='order.received'){
    if(!deps.isCurrent)return stop('paused','SOURCE_RECHECK_REQUIRED');
    if(!await deps.isCurrent(r.event))return stop('suppressed','SOURCE_EVENT_SUPERSEDED');
  }
  // Secrets stay outside persistent state and callbacks. A key rotation may change headers, never event bytes.
  const secret=await deps.secret(endpoint.scope,endpoint.active_key_id);
  const sendAt=now(),sendMs=Date.parse(sendAt);
  if(r.first_attempt_at && sendMs>Date.parse(r.first_attempt_at)+WINDOW)return stop('exhausted','RETRY_WINDOW_EXHAUSTED');
  const timestamp=String(Math.floor(sendMs/1000)),number=r.attempts.length+1;
  const headers=deliveryHeaders(r.event,endpoint.active_key_id,secret,timestamp,number);
  const timeout=deps.timeout_ms??10000;if(!Number.isInteger(timeout)||timeout<1||timeout>10000)throw new Error('Invalid webhook timeout');
  const token=randomUUID();
  const claimed:OutboxRecord={...r,revision:r.revision+1,state:'in_flight',claim:{token,until:new Date(sendMs+15000).toISOString()},
    first_attempt_at:r.first_attempt_at??sendAt,cycle_attempts:r.cycle_attempts+1,next_attempt_at:null,updated_at:sendAt,
    attempts:[...r.attempts,{number,cycle:r.cycle,started_at:sendAt,key_id:endpoint.active_key_id,timestamp,outcome:'in_flight'}]};
  if(!await deps.outbox.cas(r,claimed))return 'conflict';r=claimed;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let result:{status:number;retry_after?:string}|null=null;
  try{
    result=await Promise.race([deps.transport.send(endpoint.url,Buffer.from(r.event.body),headers,controller.signal),new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(new Error('WEBHOOK_TIMEOUT'));},timeout);
    })]);
  }catch{/* Never persist receiver bodies, native network errors or secret-bearing URLs. */}
  finally{if(timer)clearTimeout(timer);controller.abort();}
  const current=await deps.outbox.get(id),finished=now(),finishedMs=Date.parse(finished);
  if(!current || current.revision!==r.revision || current.claim?.token!==token || Date.parse(current.claim.until)<=finishedMs)return 'stale';
  const status=result?.status;
  const delivered=status!==undefined && status>=200 && status<300;
  const retry=!result || status===408 || status===425 || status===429 || (status!==undefined&&status>=500&&status<=599);
  let state:OutboxRecord['state']=delivered?'delivered':retry?'pending':'paused';
  let code:string|null=delivered?null:!result?'DELIVERY_UNCERTAIN':retry?'HTTP_RETRYABLE':'HTTP_PERMANENT_FAILURE';
  let nextTime:number|null=null;
  if(retry){
    const nominal=Date.parse(r.first_attempt_at!)+(retryOffsets[r.cycle_attempts]??86400)*1000;
    nextTime=Math.max(finishedMs,nominal,retryAfter(result?.retry_after,finishedMs)??0);
    if(r.cycle_attempts>=10 || nextTime>Date.parse(r.first_attempt_at!)+WINDOW){state='exhausted';code='RETRY_WINDOW_EXHAUSTED';nextTime=null;}
  }
  const next:OutboxRecord={...r,revision:r.revision+1,state,code,claim:null,updated_at:finished,
    endpoint_attention:[401,403,404,410].includes(status??0),next_attempt_at:nextTime===null?null:new Date(nextTime).toISOString(),
    attempts:r.attempts.map((a,i)=>i===r!.attempts.length-1?{...a,outcome:delivered?'delivered':retry?'retryable':'paused',...(status!==undefined?{http_status:status}:{}),...(code?{code}:{})}:a)};
  return await deps.outbox.cas(r,next)?state:'stale';
}
/** Trusted local operator capability, intentionally not exposed on the partner router. Explicit replay starts an audited cycle. */
export async function replayWebhook(outbox:WebhookOutbox,id:string,endpoint:LocalEndpoint,request:Omit<ReplayAudit,'cycle'|'endpoint_revision'|'destination_sha256'>){
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(request.request_id)||!request.actor_id.trim()||!['endpoint_repaired','manual_retry'].includes(request.reason)||!Number.isFinite(Date.parse(request.at)))throw new Error('Invalid replay audit');
  loopbackUrl(endpoint.url);
  for(let i=0;i<10;i++){
    const r=await outbox.get(id);if(!r || scopeKey(r.event.scope)!==scopeKey(endpoint.scope)||r.endpoint_id!==endpoint.id)throw new Error('Webhook replay scope mismatch');
    const old=r.replays.find(a=>a.request_id===request.request_id);
    if(old){if(old.actor_id!==request.actor_id||old.reason!==request.reason||old.at!==request.at||old.endpoint_revision!==endpoint.revision||old.destination_sha256!==digest(endpoint.url))throw new Error('Replay audit identity conflict');return r;}
    if(r.destination_sha256!==digest(endpoint.url) && r.endpoint_revision===endpoint.revision)throw new Error('Destination changes require a new configuration revision');
    if(!['paused','exhausted'].includes(r.state))throw new Error('Webhook is not replay eligible');
    const next:OutboxRecord={...r,revision:r.revision+1,cycle:r.cycle+1,cycle_attempts:0,first_attempt_at:null,state:'pending',code:null,
      endpoint_revision:endpoint.revision,destination_sha256:digest(endpoint.url),endpoint_attention:false,next_attempt_at:request.at,updated_at:request.at,
      replays:[...r.replays,{...request,cycle:r.cycle+1,endpoint_revision:endpoint.revision,destination_sha256:digest(endpoint.url)}]};
    if(await outbox.cas(r,next))return next;
  }throw new Error('Replay conflict');
}
export async function webhookStatus(outbox:WebhookOutbox,scope:WebhookScope,receiptId:string){
  const deliveries=[];
  for await(const r of outbox.list(scope))if(r.event.envelope.receipt_id===receiptId)deliveries.push({event_id:r.event.envelope.event_id,
    event_type:r.event.envelope.event_type,order_revision:r.event.envelope.order_revision,state:r.state,attempt_count:r.attempts.length,
    cycle_attempt_count:r.cycle_attempts,next_attempt_at:r.next_attempt_at,code:r.code,endpoint_attention:r.endpoint_attention,
    support_action_required:['paused','exhausted'].includes(r.state)});
  return {deliveries};
}

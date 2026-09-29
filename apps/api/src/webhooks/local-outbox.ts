import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publishImmutable } from '../json-intake/local-store.js';
import { digest,scopeKey,type CommittedWebhookEvent,type WebhookScope } from './contract.js';

export interface DeliveryAttempt { number:number; cycle:number; started_at:string; key_id:string; timestamp:string; outcome:'in_flight'|'delivered'|'retryable'|'paused'|'uncertain'; http_status?:number; code?:string }
export interface ReplayAudit { request_id:string; actor_id:string; reason:'endpoint_repaired'|'manual_retry'; at:string; cycle:number; endpoint_revision:string; destination_sha256:string }
export interface OutboxRecord {
  version:1; revision:number; event:CommittedWebhookEvent;
  endpoint_id:string; endpoint_revision:string; destination_sha256:string;
  state:'pending'|'in_flight'|'delivered'|'paused'|'exhausted'|'suppressed'; code:string|null; endpoint_attention:boolean;
  next_attempt_at:string|null; first_attempt_at:string|null; updated_at:string;
  cycle:number; cycle_attempts:number; attempts:DeliveryAttempt[]; replays:ReplayAudit[];
  claim:{token:string;until:string}|null;
}
export interface WebhookOutbox {
  get(id:string):Promise<OutboxRecord|null>;
  enqueue(event:CommittedWebhookEvent, endpoint:{id:string;revision:string;url:string}):Promise<OutboxRecord>;
  cas(before:OutboxRecord,after:OutboxRecord):Promise<boolean>;
  list(scope:WebhookScope):AsyncIterable<OutboxRecord>;
}
const idValid=(id:string)=>/^evt_[a-f0-9]{64}$/.test(id);
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
export function validateOutbox(r:OutboxRecord) {
  if(r.version!==1 || !Number.isSafeInteger(r.revision) || r.revision<0 || !r.event ||
    !idValid(r.event.envelope.event_id) || digest(r.event.body)!==r.event.body_sha256 || JSON.stringify(JSON.parse(r.event.body))!==JSON.stringify(r.event.envelope) ||
    r.event.envelope.environment!==r.event.scope.environment || r.event.envelope.store!==r.event.scope.store ||
    !['pending','in_flight','delivered','paused','exhausted','suppressed'].includes(r.state) || !Number.isSafeInteger(r.cycle_attempts) || r.cycle_attempts<0 || r.cycle_attempts>10 ||
    r.attempts.filter(a=>a.cycle===r.cycle).length!==r.cycle_attempts || r.attempts.some((a,i)=>a.number!==i+1) ||
    (r.state==='in_flight')!==Boolean(r.claim))throw new Error('Corrupt webhook outbox');
  return r;
}
/** Local-only append-only CAS. It never connects to a provider or replaces the Intake Assurance delivery ledger. */
export class LocalWebhookOutbox implements WebhookOutbox {
  constructor(readonly root:string){if(process.env.PATHFINDER_RUNTIME==='lambda'||process.env.AWS_LAMBDA_FUNCTION_NAME)throw new Error('Local outbox forbidden in Lambda');}
  private folder(id:string){if(!idValid(id))throw new Error('Invalid webhook ID');return join(this.root,'webhook-outbox',id);}
  async get(id:string):Promise<OutboxRecord|null>{
    if(!idValid(id))return null;let names:string[];
    try{names=await readdir(this.folder(id));}catch(e){if(missing(e))return null;throw e;}
    const versions=names.filter(n=>/^\d+\.json$/.test(n)).map(n=>Number(n.slice(0,-5))).sort((a,b)=>a-b);
    if(!versions.length)return null;if(versions.some((n,i)=>n!==i))throw new Error('Corrupt outbox revision chain');
    const row=validateOutbox(JSON.parse(await readFile(join(this.folder(id),`${versions.at(-1)}.json`),'utf8')));
    if(row.revision!==versions.at(-1)||row.event.envelope.event_id!==id)throw new Error('Corrupt outbox identity');return row;
  }
  async enqueue(event:CommittedWebhookEvent,endpoint:{id:string;revision:string;url:string}){
    if(!endpoint.id || !endpoint.revision)throw new Error('Missing trusted endpoint binding');
    const row:OutboxRecord={version:1,revision:0,event:structuredClone(event),endpoint_id:endpoint.id,endpoint_revision:endpoint.revision,destination_sha256:digest(endpoint.url),
      state:'pending',code:null,endpoint_attention:false,next_attempt_at:event.envelope.occurred_at,first_attempt_at:null,
      updated_at:event.envelope.occurred_at,cycle:0,cycle_attempts:0,attempts:[],replays:[],claim:null};
    validateOutbox(row);
    if(await publishImmutable(join(this.folder(event.envelope.event_id),'0.json'),Buffer.from(JSON.stringify(row))))return row;
    const prior=await this.get(event.envelope.event_id);
    if(!prior || prior.event.body!==event.body || scopeKey(prior.event.scope)!==scopeKey(event.scope) || prior.endpoint_id!==endpoint.id)throw new Error('Webhook event identity conflict');
    return prior;
  }
  async cas(before:OutboxRecord,after:OutboxRecord){
    validateOutbox(after);
    if(after.revision!==before.revision+1 || JSON.stringify(after.event)!==JSON.stringify(before.event) || after.endpoint_id!==before.endpoint_id ||
      after.attempts.length<before.attempts.length || after.replays.length<before.replays.length ||
      before.replays.some((a,i)=>JSON.stringify(a)!==JSON.stringify(after.replays[i])) ||
      before.attempts.some((a,i)=>a.outcome!=='in_flight' && JSON.stringify(a)!==JSON.stringify(after.attempts[i])))throw new Error('Webhook immutable identity changed');
    return publishImmutable(join(this.folder(before.event.envelope.event_id),`${after.revision}.json`),Buffer.from(JSON.stringify(after)));
  }
  async *list(scope:WebhookScope){
    let ids:string[];try{ids=await readdir(join(this.root,'webhook-outbox'));}catch(e){if(missing(e))return;throw e;}
    for(const id of ids.filter(idValid)){const row=await this.get(id);if(row && scopeKey(row.event.scope)===scopeKey(scope))yield row;}
  }
}
/** Receiver dedup ledger retains authenticated IDs indefinitely locally (at least the draft's 90-day minimum). */
export class LocalWebhookInbox {
  constructor(readonly root:string){}
  async accept(scope:WebhookScope,eventId:string,raw:Buffer){
    if(!/^evt_[A-Za-z0-9_-]{1,128}$/.test(eventId))throw new Error('Invalid event identity');
    const folder=join(this.root,'webhook-inbox',digest(scopeKey(scope)));await mkdir(folder,{recursive:true,mode:0o700});
    const path=join(folder,`${eventId}.json`),hash=digest(raw);
    if(await publishImmutable(path,Buffer.from(JSON.stringify({event_id:eventId,body_sha256:hash,body:raw.toString('utf8')}))))return true;
    if(JSON.parse(await readFile(path,'utf8')).body_sha256!==hash)throw new Error('Webhook body conflict');return false;
  }
}

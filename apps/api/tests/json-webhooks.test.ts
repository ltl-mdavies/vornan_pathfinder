import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createJsonIntakeRouter } from '../src/json-intake/router.js';
import type { TestCredential } from '../src/json-intake/auth.js';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { committedEvent,signature,deliveryHeaders,verifyDelivery,scopeKey,digest,type WebhookScope } from '../src/webhooks/contract.js';
import { LocalWebhookOutbox,LocalWebhookInbox } from '../src/webhooks/local-outbox.js';
import { dispatchWebhook,loopbackTransport,replayWebhook,webhookStatus,retryOffsets,type LocalEndpoint,type DispatchDependencies } from '../src/webhooks/dispatch.js';
import { LocalReceiptStore } from '../src/json-intake/local-store.js';
import { JsonIntakeService,statusResponse } from '../src/json-intake/service.js';
import { stickerPressV1 } from '../src/json-intake/adapter.js';
import { materializeReceiptEvents,currentReceiptEvent,captureVerifiedConfirmation,receiptWebhookStatus,type ConfirmationEvidence } from '../src/json-intake/webhook-events.js';
import { createIntakeAttempt,transitionIntake,type IntakeAttempt,type IntakeLedger } from '../src/intake-assurance.js';
const start='2026-09-28T12:00:00.000Z',secret='synthetic-webhook-secret-independent-of-intake-auth';
const scope:WebhookScope={customer_id:'synthetic',integration_id:'synthetic-json',store:'ltlco',environment:'test'};
const endpoint:LocalEndpoint={id:'local-receiver',revision:'v1',scope,enabled:true,url:'http://127.0.0.1:45678/events',active_key_id:'synthetic-key-1'};
const event=()=>committedEvent(scope,'synthetic-order-received:v1',{event_type:'order.received',receipt_id:'rcpt_test',order_number:'ORDER-TEST',lift_order_number:null,occurred_at:start,order_revision:1,data:{intake_status:'received',line_count:1}});
const binding=(e=endpoint)=>({id:e.id,revision:e.revision,url:e.url});
async function harness(t:any){const root=await mkdtemp(join(tmpdir(),'json-webhooks-'));t.after(()=>rm(root,{recursive:true,force:true}));const outbox=new LocalWebhookOutbox(root);let time=start;const deps:DispatchDependencies={outbox,transport:{kind:'loopback-test',send:async()=>({status:204})},secret:async()=>secret,now:()=>time};return{root,outbox,deps,setTime:(t:string)=>time=t};}
function ledger(){const rows=new Map<string,IntakeAttempt>();const api:IntakeLedger={async reserve(s,d){const a=createIntakeAttempt(s,d),old=rows.get(a.attempt_id);if(!old)rows.set(a.attempt_id,a);return{attempt:old??a,created:!old};},async get(c,id){const a=rows.get(id);return a?.signal.customer_id===c?a:null;},async transition(c,id,e){const a=rows.get(id)!;assert.equal(a.signal.customer_id,c);const n=transitionIntake(a,e);rows.set(id,n);return n;}};return{api,rows};}
async function receiptHarness(t:any, mutate:(p:any)=>void=()=>{}){const h=await harness(t),store=new LocalReceiptStore(h.root),l=ledger();const service=new JsonIntakeService(store,l.api,[stickerPressV1],()=>start);const p=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));mutate(p);const {receipt}=await service.receive({...scope,customer_name:'Synthetic',schema:'stickerpress.order.v1'},p,Buffer.from(JSON.stringify(p)));return{...h,store,l,service,receipt,p};}

// Exact previously sent synthetic vector copied as literals; the private sent draft remains untouched.
const vectorBody=Buffer.from('{"schema_version":"pathfinder.webhook.v1","event_id":"evt_example_received_001","event_type":"order.received","environment":"test","receipt_id":"rcpt_example_factory_001","order_number":"SAMPLE-FACTORY-TEST","store":"ltlco","lift_order_number":null,"occurred_at":"2026-09-28T12:00:00.000Z","order_revision":1,"data":{"intake_status":"received","line_count":4,"status_url":"https://example.com/api/v1/intake/orders/rcpt_example_factory_001"}}');
test('sent HMAC vector matches exact raw bytes; receiver rejects mutation, wrong keys, stale timestamps and header mismatch',()=>{
  const key='stickerpress-example-secret-not-for-production',ts='1790596800';
  assert.equal(vectorBody.length,441);assert.equal(signature(key,ts,vectorBody),'v1=00c9e7d0a0f672633f5021eb3905d4d700608e9c7c95e66282344a089555690d');
  const headers={'x-pathfinder-timestamp':ts,'x-pathfinder-signature':signature(key,ts,vectorBody),'x-pathfinder-key-id':'old','x-pathfinder-event-id':'evt_example_received_001'};
  const keys=new Map([['old',key],['new','rotated-synthetic-secret']]);assert.equal(verifyDelivery(vectorBody,headers,keys,Number(ts),'ltlco').event_id,headers['x-pathfinder-event-id']);
  for(const [body,h,k,now,store] of [[Buffer.concat([vectorBody,Buffer.from('\n')]),headers,keys,Number(ts),'ltlco'],[vectorBody,{...headers,'x-pathfinder-event-id':'wrong'},keys,Number(ts),'ltlco'],[vectorBody,headers,new Map([['old','wrong']]),Number(ts),'ltlco'],[vectorBody,headers,keys,Number(ts)+301,'ltlco'],[vectorBody,headers,keys,Number(ts)-301,'ltlco'],[vectorBody,headers,keys,Number(ts),'other']] as const)assert.throws(()=>verifyDelivery(body,h,k,now,store));
});
test('concurrent materializers recover every committed revision without duplicate events or URL-refresh noise',async t=>{
  const h=await receiptHarness(t),r=h.receipt;const issue={issue_id:'iss_'+'a'.repeat(24),code:'ARTWORK_CHECKSUM_MISMATCH',field:'lines[0].artwork',external_line_id:h.p.lines[0].external_line_id,owner:'customer' as const,message:'never forward signed URL secret',corrective_action:'unsafe free text'};
  const failed={...r,revision:1,issues:[issue],asset_status:'action_required' as const,work:'complete' as const};await h.store.compareAndSet(r,failed);
  const refreshed={...failed,revision:2,adapted:structuredClone(failed.adapted)};refreshed.adapted.canonical.lines[0].source_line.artwork.download_url+='?signature=synthetic';await h.store.compareAndSet(failed,refreshed);
  const enqueue=h.outbox.enqueue.bind(h.outbox);let crash=true;
  h.outbox.enqueue=async()=>{throw Error('crash before insert');};
  await assert.rejects(materializeReceiptEvents(h.store,h.outbox,endpoint),/crash before/);
  h.outbox.enqueue=async(e,b)=>{const result=await enqueue(e,b);if(crash){crash=false;throw Error('crash after insert');}return result;};
  await assert.rejects(materializeReceiptEvents(h.store,h.outbox,endpoint),/crash/);
  await Promise.all(Array.from({length:5},()=>materializeReceiptEvents(h.store,h.outbox,endpoint)));
  const rows=[];for await(const row of h.outbox.list(scope))rows.push(row);assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.event.envelope.event_type).sort(),['order.action_required','order.received']);
  assert.ok(rows.every(r=>!r.event.body.includes('signature=')&&!r.event.body.includes('never forward')));
  await materializeReceiptEvents(h.store,h.outbox,{...endpoint,scope:{...scope,integration_id:'other'}});let others=0;for await(const _ of h.outbox.list({...scope,integration_id:'other'}))others++;assert.equal(others,0);
});
test('stable bytes and ID survive retries, re-signing and key rotation; duplicate claims dispatch once',async t=>{
  const h=await harness(t),row=await h.outbox.enqueue(event(),binding()),calls:{body:string;headers:Record<string,string>}[]=[];
  h.deps.transport.send=async(_url,body,headers)=>{calls.push({body:body.toString(),headers});return{status:503};};
  await Promise.all(Array.from({length:8},()=>dispatchWebhook(row.event.envelope.event_id,endpoint,h.deps)));assert.equal(calls.length,1);
  h.setTime('2026-09-28T12:01:00Z');await dispatchWebhook(row.event.envelope.event_id,{...endpoint,active_key_id:'synthetic-key-2'},h.deps);
  assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['X-Pathfinder-Event-Id'],calls[1].headers['X-Pathfinder-Event-Id']);assert.notEqual(calls[0].headers['X-Pathfinder-Timestamp'],calls[1].headers['X-Pathfinder-Timestamp']);assert.notEqual(calls[0].headers['X-Pathfinder-Signature'],calls[1].headers['X-Pathfinder-Signature']);
  assert.equal(calls[1].headers['X-Pathfinder-Key-Id'],'synthetic-key-2');
});
test('trusted endpoint scope/version and loopback-only transport cannot be selected or changed by payload',async t=>{
  const h=await harness(t),r=await h.outbox.enqueue(event(),binding());let calls=0;h.deps.transport.send=async()=>{calls++;return{status:204};};
  assert.equal(await dispatchWebhook(r.event.envelope.event_id,{...endpoint,enabled:false},h.deps),'disabled');
  await assert.rejects(dispatchWebhook(r.event.envelope.event_id,{...endpoint,url:'https://customer.example.com/callback'},h.deps),/loopback/);
  await assert.rejects(dispatchWebhook(r.event.envelope.event_id,{...endpoint,scope:{...scope,customer_id:'other'}},h.deps),/scope mismatch/);
  assert.equal(await dispatchWebhook(r.event.envelope.event_id,{...endpoint,url:'http://127.0.0.1:45679/events'},h.deps),'paused');assert.equal(calls,0);
  assert.equal((await h.outbox.get(r.event.envelope.event_id))?.code,'ENDPOINT_CONFIGURATION_CHANGED');
});
test('ten nominal offsets, retry-after bounds, permanent errors and exhaustion preserve diagnostics',async t=>{
  const h=await harness(t),r=await h.outbox.enqueue(event(),binding());h.deps.transport.send=async()=>({status:503});
  for(let i=0;i<10;i++){h.setTime(new Date(Date.parse(start)+retryOffsets[i]*1000).toISOString());await dispatchWebhook(r.event.envelope.event_id,endpoint,h.deps);}
  const end=(await h.outbox.get(r.event.envelope.event_id))!;assert.equal(end.state,'exhausted');assert.equal(end.attempts.length,10);
  for(const [status,retry_after,state] of [[429,'90000','exhausted'],[403,undefined,'paused'],[302,undefined,'paused'],[429,'120','pending']] as const){
    const e=committedEvent(scope,`http-${status}-${retry_after}`,{...event().envelope,event_type:'order.received'});const row=await h.outbox.enqueue(e,binding());h.setTime(start);h.deps.transport.send=async()=>({status,retry_after});
    assert.equal(await dispatchWebhook(row.event.envelope.event_id,endpoint,h.deps),state);
    const result=(await h.outbox.get(row.event.envelope.event_id))!;if(status===403)assert.equal(result.endpoint_attention,true);if(retry_after==='120')assert.equal(result.next_attempt_at,'2026-09-28T12:02:00.000Z');
  }
});
test('expired claims recover uncertain outcomes; late acknowledgement cannot override a newer delivery',async t=>{
  const h=await harness(t),r=await h.outbox.enqueue(event(),binding());let release!:(r:{status:number})=>void;let entered!:()=>void;const waiting=new Promise<void>(resolve=>entered=resolve);
  const first=dispatchWebhook(r.event.envelope.event_id,endpoint,{...h.deps,transport:{kind:'loopback-test',send:async()=>{entered();return new Promise(resolve=>release=resolve);}}});
  await waiting;h.setTime('2026-09-28T12:01:00Z');assert.equal(await dispatchWebhook(r.event.envelope.event_id,endpoint,h.deps),'delivered');release({status:500});assert.equal(await first,'stale');
  const done=(await h.outbox.get(r.event.envelope.event_id))!;assert.equal(done.state,'delivered');assert.equal(done.attempts[0].outcome,'uncertain');assert.equal(done.attempts.length,2);
});
test('timeout is retryable and raw receiver/network details never enter state',async t=>{
  const h=await harness(t),r=await h.outbox.enqueue(event(),binding());h.deps.timeout_ms=10;h.deps.transport.send=async()=>new Promise(()=>{});
  assert.equal(await dispatchWebhook(r.event.envelope.event_id,endpoint,h.deps),'pending');const pending=(await h.outbox.get(r.event.envelope.event_id))!;assert.equal(pending.code,'DELIVERY_UNCERTAIN');
  h.setTime('2026-09-28T12:01:00Z');h.deps.transport.send=async()=>{throw Error('secret signed URL in receiver failure');};await dispatchWebhook(r.event.envelope.event_id,endpoint,h.deps);
  assert.ok(!JSON.stringify(await h.outbox.get(r.event.envelope.event_id)).includes('secret signed URL'));
});
test('resolved customer issue suppresses delayed delivery and status retains resolved lifecycle',async t=>{
  const h=await receiptHarness(t),r=h.receipt;const issue={issue_id:'iss_'+'b'.repeat(24),code:'ARTWORK_CHECKSUM_MISMATCH',field:'lines[0].artwork',external_line_id:h.p.lines[0].external_line_id,owner:'customer' as const,message:'safe',corrective_action:'safe'};
  const failed={...r,revision:1,issues:[issue]};await h.store.compareAndSet(r,failed);await materializeReceiptEvents(h.store,h.outbox,endpoint);
  const rows=[];for await(const row of h.outbox.list(scope))rows.push(row);const action=rows.find(r=>r.event.envelope.event_type==='order.action_required')!;
  h.deps.isCurrent=currentReceiptEvent(h.store);h.deps.transport.send=async()=>({status:503});await dispatchWebhook(action.event.envelope.event_id,endpoint,h.deps);
  const resolved={...failed,revision:2,issues:[],updated_at:'2026-09-28T12:00:30Z'};await h.store.compareAndSet(failed,resolved);h.setTime('2026-09-28T12:01:00Z');h.deps.transport.send=async()=>{throw Error('must not send');};
  assert.equal(await dispatchWebhook(action.event.envelope.event_id,endpoint,h.deps),'suppressed');
  const status=await receiptWebhookStatus(h.store,h.outbox,resolved);assert.equal(status.issues[0].status,'resolved');assert.ok(!JSON.stringify(status).includes('http://127.0.0.1'));
});
test('controlled replay retains event identity/body and prior attempts with an idempotent audit',async t=>{
  const h=await harness(t),r=await h.outbox.enqueue(event(),binding());h.deps.transport.send=async()=>({status:403});await dispatchWebhook(r.event.envelope.event_id,endpoint,h.deps);
  const audit={request_id:'repair-1',actor_id:'synthetic-operator',reason:'endpoint_repaired' as const,at:'2026-09-28T13:00:00Z'};
  const replay=await replayWebhook(h.outbox,r.event.envelope.event_id,endpoint,audit);assert.equal(replay.event.body,r.event.body);assert.equal(replay.attempts.length,1);assert.equal(replay.cycle_attempts,0);assert.equal(replay.cycle,1);
  assert.equal((await replayWebhook(h.outbox,r.event.envelope.event_id,endpoint,audit)).replays.length,1);
  await assert.rejects(replayWebhook(h.outbox,r.event.envelope.event_id,endpoint,{...audit,reason:'manual_retry'}),/conflict/);
  await assert.rejects(replayWebhook(h.outbox,r.event.envelope.event_id,{...endpoint,url:'http://127.0.0.1:45679/events'},audit),/conflict/);
  await assert.rejects(h.outbox.cas(replay,{...replay,revision:replay.revision+1,replays:[{...replay.replays[0],actor_id:'different'}]}),/immutable/);
  h.setTime(audit.at);h.deps.transport.send=async()=>({status:204});assert.equal(await dispatchWebhook(r.event.envelope.event_id,endpoint,h.deps),'delivered');
  await assert.rejects(replayWebhook(h.outbox,r.event.envelope.event_id,endpoint,{...audit,request_id:'again'}),/eligible/);
});

test('real loopback receiver authenticates exact bytes, durably queues and deduplicates retry after uncertain acknowledgement',async t=>{
  const h=await harness(t),inbox=new LocalWebhookInbox(h.root);let requests=0,accepted=0;
  const server=createServer(async(req,res)=>{
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128*1024)throw Error('limit');chunks.push(chunk);}
      const raw=Buffer.concat(chunks),headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,typeof v==='string'?v:undefined]));
      const event=verifyDelivery(raw,headers,new Map([[endpoint.active_key_id,secret]]),Math.floor(Date.parse(h.deps.now!())/1000),scope.store);
      if(await inbox.accept(scope,event.event_id,raw))accepted++;requests++;res.statusCode=requests===1?503:204;res.end();
    }catch{res.statusCode=401;res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
  const address=server.address() as {port:number};const target={...endpoint,url:`http://127.0.0.1:${address.port}/events`};
  const r=await h.outbox.enqueue(event(),binding(target));h.deps.transport=loopbackTransport;
  assert.equal(await dispatchWebhook(r.event.envelope.event_id,target,h.deps),'pending');h.setTime('2026-09-28T12:01:00Z');
  assert.equal(await dispatchWebhook(r.event.envelope.event_id,target,h.deps),'delivered');assert.equal(requests,2);assert.equal(accepted,1);
  const duplicate=new LocalWebhookInbox(h.root);assert.equal(await duplicate.accept(scope,r.event.envelope.event_id,Buffer.from(r.event.body)),false);
  await assert.rejects(duplicate.accept(scope,r.event.envelope.event_id,Buffer.from(r.event.body+' ')),/body conflict/);
});

test('confirmation requires matching durable job, submission, receipt and verified association, and rejects cross-read drift',async t=>{
  const h=await receiptHarness(t),r=h.receipt;
  await assert.rejects(captureVerifiedConfirmation(h.store,h.l.api,r.receipt_id,async()=>null),/missing/);
  let {attempt}=await h.l.api.reserve(r.signal,r.deadline);
  for(const [state,fields]of [['preparing',{}],['ready',{job_id:'synthetic-job'}],['reconciling',{submit_attempt_id:'synthetic-submit'}],['confirmed',{confirmed_order_number:'A0000000'}]] as const){
    attempt=await h.l.api.transition(scope.customer_id,attempt.attempt_id,{event_id:`synthetic-${state}`,expected_revision:attempt.revision,occurred_at:start,state,reason:null,next_action_at:state==='confirmed'?null:r.deadline,...fields});
  }
  const evidence:ConfirmationEvidence={job:{job_id:'synthetic-job',customer_id:scope.customer_id,integration_id:scope.integration_id,receipt_id:r.receipt_id,source_order_number:r.adapted.canonical.source.source_record_id,external_order_id:r.adapted.canonical.order.external_order_id,target_customer_id:'synthetic-target',target_order_number:'A0000000',sandbox:true},
    submit:{attempt_id:'synthetic-submit',job_id:'synthetic-job',customer_id:scope.customer_id,ext_id:r.adapted.canonical.order.external_order_id,request_fingerprint:'a'.repeat(64),sandbox:true},
    association:{order_number:'A0000000',customer_id:'synthetic-target',external_order_id:r.adapted.canonical.order.external_order_id,submit_attempt_id:'synthetic-submit',request_fingerprint:'a'.repeat(64),verified_at:start}};
  for(const mutate of [(e:ConfirmationEvidence)=>e.job.integration_id='other',(e:ConfirmationEvidence)=>e.submit.job_id='wrong',(e:ConfirmationEvidence)=>e.association.customer_id='wrong',(e:ConfirmationEvidence)=>e.association.request_fingerprint='b'.repeat(64),(e:ConfirmationEvidence)=>e.job.sandbox=false]){
    const invalid=structuredClone(evidence);mutate(invalid);await assert.rejects(captureVerifiedConfirmation(h.store,h.l.api,r.receipt_id,async()=>invalid),/mismatch/);
  }
  let reads=0;await assert.rejects(captureVerifiedConfirmation(h.store,h.l.api,r.receipt_id,async()=>{reads++;return reads===1?evidence:{...evidence,association:{...evidence.association,verified_at:'2026-09-28T12:00:01Z'}};}),/changed/);
  const captured=await captureVerifiedConfirmation(h.store,h.l.api,r.receipt_id,async()=>evidence);assert.equal(statusResponse(captured).intake_status,'confirmed');
  await materializeReceiptEvents(h.store,h.outbox,endpoint);await h.store.compareAndSet(captured,{...captured,revision:captured.revision+1});await materializeReceiptEvents(h.store,h.outbox,endpoint);
  const rows=[];for await(const row of h.outbox.list(scope))rows.push(row);assert.equal(rows.filter(r=>r.event.envelope.event_type==='order.confirmed').length,1);
  const confirmation=rows.find(r=>r.event.envelope.event_type==='order.confirmed')!;assert.equal(confirmation.event.envelope.lift_order_number,'A0000000');assert.ok(!confirmation.event.body.includes('synthetic-target'));
});
test('receiver revision ordering prevents older events from regressing current state while acknowledging both IDs',async t=>{
  const h=await harness(t),inbox=new LocalWebhookInbox(h.root),base=event();let latest=0;const received=[];
  for(const revision of [4,1,4]){
    const e=committedEvent(scope,`ordered-${revision}`,{...base.envelope,order_revision:revision,event_type:'order.received'});
    const ts=String(Math.floor(Date.parse(start)/1000)),headers=deliveryHeaders(e,endpoint.active_key_id,secret,ts,1);
    const verified=verifyDelivery(Buffer.from(e.body),Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v])),new Map([[endpoint.active_key_id,secret]]),Number(ts),scope.store);
    const created=await inbox.accept(scope,verified.event_id,Buffer.from(e.body));received.push(created);if(created && verified.order_revision>latest)latest=verified.order_revision;
  }assert.equal(latest,4);assert.deepEqual(received,[true,true,false]);
});
test('outbox survives real process restart and cross-process CAS chooses one writer',async t=>{
  const h=await harness(t),r=await h.outbox.enqueue(event(),binding()),module=new URL('../src/webhooks/local-outbox.ts',import.meta.url).href;
  const code=`const {LocalWebhookOutbox}=await import(${JSON.stringify(module)});const store=new LocalWebhookOutbox(${JSON.stringify(h.root)});const current=await store.get(${JSON.stringify(r.event.envelope.event_id)});if(!current)throw Error('missing');const base={...current,revision:0};console.log(await store.cas(base,{...base,revision:1,state:'paused',code:'SYNTHETIC_RESTART_CHECK'}));`;
  const run=()=>new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx/esm','--input-type=module','-e',code]);let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim()):reject(Error(error)));});
  const results=await Promise.all(Array.from({length:4},run));assert.equal(results.filter(x=>x==='true').length,1);const persisted=await new LocalWebhookOutbox(h.root).get(r.event.envelope.event_id);assert.equal(persisted?.event.body,r.event.body);assert.equal(persisted?.state,'paused');
});


test('authenticated status checks receipt ownership before loading webhook history',async t=>{
  const h=await receiptHarness(t);await materializeReceiptEvents(h.store,h.outbox,endpoint);
  const token='synthetic_read_token_abcdefghijklmnopqrstuvwxyz';
  const credential:TestCredential={token_sha256:digest(token),identity:h.receipt.identity,expires_at:'2026-10-01T00:00:00Z',revoked:false,scopes:['orders:read']};
  let reads=0;
  const app=(credential:TestCredential)=>express().use('/api/v1/intake',createJsonIntakeRouter({enabled:true,service:h.service,credentials:[credential],webhookStatus:async r=>{reads++;return receiptWebhookStatus(h.store,h.outbox,r);}}));
  const url=`/api/v1/intake/orders/${h.receipt.receipt_id}`;
  for(const identity of [{...credential.identity,customer_id:'other'},{...credential.identity,integration_id:'other'},{...credential.identity,store:'other'}]){
    assert.equal((await request(app({...credential,identity})).get(url).set('Authorization',`Bearer ${token}`)).status,404);
  }
  assert.equal(reads,0);
  const response=await request(app(credential)).get(url).set('Authorization',`Bearer ${token}`);
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'private, no-store');assert.equal(reads,1);
  assert.equal(response.body.webhooks.deliveries.length,1);assert.equal(response.body.order_revision,1);
  assert.ok(!JSON.stringify(response.body).includes('127.0.0.1'));
});

// Shipping uses the same receipt revision/outbox/signature contract as intake events.
import { captureShippingSnapshot, projectShipping, shippingEvents, type ShippingSnapshot } from '../src/json-intake/shipping-events.js';
async function shippingHarness(t:any, quantities?:number[]) {
  const h=await receiptHarness(t,p=>{
    if(quantities)p.lines=p.lines.slice(0,quantities.length).map((line:any,i:number)=>({...line,quantity:quantities[i],area_sq_in:Number((line.print_w_in*line.print_h_in*quantities[i]).toFixed(2))}));
  });
  const receipt={...h.receipt,revision:h.receipt.revision+1,confirmation:{job_id:'synthetic-job',submit_attempt_id:'synthetic-submit',order_number:'A0000001',confirmed_at:start,intake_revision:1,evidence_sha256:'a'.repeat(64)}};
  assert.equal(await h.store.compareAndSet(h.receipt,receipt),true);
  const snapshot:ShippingSnapshot={scope,receipt_id:receipt.receipt_id,lift_order_number:'A0000001',confirmation_sha256:'a'.repeat(64),source_revision:1,observed_at:start,complete:true,packages:[]};
  const pkg=(index:number,amount=receipt.adapted.canonical.lines[index].quantity,id=`package-${index}`):ShippingSnapshot['packages'][number]=>({
    package_id:id,package_number:index+1,carrier:'Synthetic Carrier',service:'Synthetic Ground',tracking_number:`SYNTHETIC-${id}`,
    label_source:'purchased',status:'shipped',dispatch_evidence:'synthetic-dispatch-record',shipped_at:start,delivered_at:null,source_updated_at:start,
    lines:[{external_line_id:receipt.adapted.canonical.lines[index].source_line.external_line_id,quantity:amount}]
  });
  return {...h,receipt,snapshot,pkg};
}
test('shipping distinguishes partial dispatch from attached prepaid labels and complete seven-package shipment',async t=>{
  const h=await shippingHarness(t),s=h.snapshot;
  s.packages=[h.pkg(1),h.pkg(2),{...h.pkg(0),label_source:'customer_prepaid',status:'pending',dispatch_evidence:null,shipped_at:null}];
  (s as any).prepaid_label_url='https://private.invalid/label?secret=1';
  let r={...h.receipt,shipping:s},p=projectShipping(r);
  assert.equal(p.fulfillment_status,'partially_shipped');assert.equal(p.all_items_shipped,false);assert.equal(p.shipments.length,2);
  assert.deepEqual(shippingEvents(r).map(e=>e.envelope.event_type),['shipment.updated','shipment.updated']);
  assert.ok(!JSON.stringify(shippingEvents(r)).includes('private.invalid'));
  s.packages=[h.pkg(0,25,'a'),h.pkg(0,25,'b'),h.pkg(1,25,'c'),h.pkg(1,25,'d'),h.pkg(2,25,'e'),h.pkg(2,25,'f'),h.pkg(3,50,'g')];
  p=projectShipping(r);assert.equal(p.all_items_shipped,true);assert.equal(p.shipments.length,7);
  assert.equal(shippingEvents(r).filter(e=>e.envelope.event_type==='order.shipped').length,1);
  assert.equal(shippingEvents(r,p).length,0);
  s.complete=false;assert.equal(projectShipping(r).all_items_shipped,false);assert.equal(shippingEvents(r).length,0);
});
test('fractional package allocations remain exact and unknown dispatch times stay null',async t=>{
  const h=await shippingHarness(t);h.snapshot.packages=[h.pkg(0,0.5,'first'),h.pkg(0,49.5,'rest'),h.pkg(1),h.pkg(2),h.pkg(3)];
  h.snapshot.packages[0].shipped_at=null;
  const p=projectShipping(h.receipt,h.snapshot);assert.equal(p.all_items_shipped,true);
  assert.equal(p.shipments.find(s=>s.tracking_number==='SYNTHETIC-first')?.shipped_at,null);
  h.snapshot.packages[0].shipped_at='2026-09-28';assert.throws(()=>projectShipping(h.receipt,h.snapshot),/timestamp/);
});
test('shipping rejects cross-scope, wrong association, unknown lines, duplicate packages and invalid allocations',async t=>{
  const h=await shippingHarness(t);h.snapshot.packages=[h.pkg(0)];
  for(const edit of [
    (s:ShippingSnapshot)=>s.scope={...scope,customer_id:'other'},
    (s:ShippingSnapshot)=>s.confirmation_sha256='b'.repeat(64),
    (s:ShippingSnapshot)=>s.lift_order_number='A0000002',
    (s:ShippingSnapshot)=>s.receipt_id='other',
    (s:ShippingSnapshot)=>s.packages.push(structuredClone(s.packages[0])),
    (s:ShippingSnapshot)=>s.packages[0].lines[0].external_line_id='other',
    (s:ShippingSnapshot)=>s.packages[0].lines[0].quantity=51,
    (s:ShippingSnapshot)=>s.packages[0].lines[0].quantity=-1,
    (s:ShippingSnapshot)=>s.packages[0].dispatch_evidence=null,
    (s:ShippingSnapshot)=>s.packages[0].status='pending'
  ]){const s=structuredClone(h.snapshot);edit(s);assert.throws(()=>projectShipping(h.receipt,s));}
  assert.throws(()=>projectShipping({...h.receipt,confirmation:undefined},h.snapshot),/binding/);
});
test('shipping capture survives restart, replays idempotently, and uses the accepted signing contract',async t=>{
  const h=await shippingHarness(t);h.snapshot.packages=[h.pkg(0),h.pkg(1),h.pkg(2),h.pkg(3)];
  const first=await captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>h.snapshot);
  const second=await captureShippingSnapshot(new LocalReceiptStore(h.root),h.receipt.receipt_id,async()=>h.snapshot);
  assert.equal(first.revision,second.revision);
  await materializeReceiptEvents(h.store,h.outbox,endpoint);
  await materializeReceiptEvents(new LocalReceiptStore(h.root),new LocalWebhookOutbox(h.root),endpoint);
  const rows=[];for await(const row of h.outbox.list(scope))rows.push(row);
  const shipping=rows.filter(r=>['shipment.updated','order.shipped'].includes(r.event.envelope.event_type));
  assert.equal(shipping.length,5);
  for(const row of shipping){
    const headers=deliveryHeaders(row.event,'test-key',secret,'1790596800',1);
    const lower=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
    assert.deepEqual(verifyDelivery(Buffer.from(row.event.body),lower,new Map([['test-key',secret]]),1790596800,scope.store),row.event.envelope);
    assert.equal(await currentReceiptEvent(h.store)(row.event),true);
    assert.equal(row.event.envelope.order_revision,first.revision+1);
  }
});
test('shipping correction preserves package identity, invalidates stale pending events and never reuses changed revision',async t=>{
  const h=await shippingHarness(t);h.snapshot.packages=[h.pkg(1)];
  const first=await captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>h.snapshot),old=shippingEvents(first)[0];
  const correction=structuredClone(h.snapshot);correction.source_revision=2;correction.packages[0].tracking_number='SYNTHETIC-CORRECTED';
  const next=await captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>correction),event=shippingEvents(next,projectShipping(first))[0];
  assert.equal((event.envelope.data.shipment as any).shipment_id,(old.envelope.data.shipment as any).shipment_id);
  assert.notEqual(event.envelope.event_id,old.envelope.event_id);
  assert.equal(await currentReceiptEvent(h.store)(old),false);assert.equal(await currentReceiptEvent(h.store)(event),true);
  await assert.rejects(captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>h.snapshot),/Stale/);
  correction.packages[0].tracking_number='CHANGED-SAME-REVISION';
  await assert.rejects(captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>correction),/revision conflict/);
});
test('incomplete, drifting and reversed shipping evidence cannot overwrite a committed snapshot',async t=>{
  const h=await shippingHarness(t);h.snapshot.packages=[h.pkg(0)];
  const first=await captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>h.snapshot);
  const next={...structuredClone(h.snapshot),source_revision:2};next.complete=false;
  await assert.rejects(captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>next),/Incomplete/);
  next.complete=true;next.packages=[];
  await assert.rejects(captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>next),/reversal/);
  next.packages=[h.pkg(0)];let reads=0;
  await assert.rejects(captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>({...next,source_revision:++reads+1})),/changed/);
  const held=await h.store.get(h.receipt.receipt_id);
  assert.deepEqual(held?.shipping,first.shipping);assert.equal(held?.shipping_review?.code,'DRIFT');
  assert.equal(shippingEvents(held!).length,0);
  assert.equal(await currentReceiptEvent(h.store)(shippingEvents(first)[0]),false);
});
test('verified partial shape 2/1/1 and fractional 0.5+0.5 retain exact outstanding quantities',async t=>{
  const h=await shippingHarness(t,[2,1,1]);h.snapshot.packages=[h.pkg(1),h.pkg(2)];
  assert.equal(projectShipping(h.receipt,h.snapshot).all_items_shipped,false);
  const complete=await shippingHarness(t,[1,1,1]);complete.snapshot.packages=[complete.pkg(0,0.5,'a'),complete.pkg(0,0.5,'b'),complete.pkg(1),complete.pkg(2)];
  assert.equal(projectShipping(complete.receipt,complete.snapshot).all_items_shipped,true);
});
test('shipping CAS races and interrupted materialization recover without duplicate events',async t=>{
  const h=await shippingHarness(t);h.snapshot.packages=[h.pkg(1),h.pkg(2)];
  const attempts=await Promise.allSettled(Array.from({length:3},()=>captureShippingSnapshot(h.store,h.receipt.receipt_id,async()=>h.snapshot)));
  assert.ok(attempts.some(r=>r.status==='fulfilled'));
  const saved=await h.store.get(h.receipt.receipt_id);assert.equal(saved?.revision,h.receipt.revision+1);
  let count=0;
  const interrupted={get:h.outbox.get.bind(h.outbox),cas:h.outbox.cas.bind(h.outbox),list:h.outbox.list.bind(h.outbox),enqueue:async(...args:Parameters<LocalWebhookOutbox['enqueue']>)=>{
    if(++count===4)throw new Error('synthetic crash');return h.outbox.enqueue(...args);
  }};
  await assert.rejects(materializeReceiptEvents(h.store,interrupted,endpoint),/synthetic crash/);
  await materializeReceiptEvents(new LocalReceiptStore(h.root),new LocalWebhookOutbox(h.root),endpoint);
  await materializeReceiptEvents(h.store,h.outbox,endpoint);
  const rows=[];for await(const row of h.outbox.list(scope))rows.push(row);
  assert.equal(rows.filter(r=>r.event.envelope.event_type==='shipment.updated').length,2);
  assert.equal(rows.filter(r=>r.event.envelope.event_type==='order.shipped').length,0);
});

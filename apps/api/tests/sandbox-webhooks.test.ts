import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { DurableWebhookOutbox } from '../src/webhooks/durable-outbox.js';
import { createSandboxHttpsTransport } from '../src/webhooks/https-transport.js';
import { committedEvent,signature } from '../src/webhooks/contract.js';
import { dispatchWebhook,replayWebhook } from '../src/webhooks/dispatch.js';
import { DurableReceiptStore } from '../src/json-intake/durable-receipts.js';
import { SandboxWebhookHistory } from '../src/json-intake/sandbox-webhook-history.js';
import { createSandboxWebhookHandler } from '../src/json-intake/sandbox-webhook-lambda.js';
import { JsonIntakeService } from '../src/json-intake/service.js';
import { stickerPressV1 } from '../src/json-intake/adapter.js';
const scope={customer_id:'synthetic',integration_id:'sandbox-test',store:'ltlco',environment:'test' as const};
const url='https://receiver.example.com/pathfinder';
const endpoint={id:'receiver',revision:'v1',scope,enabled:true,url,active_key_id:'test-key'};
const start='2026-09-30T12:00:00Z';
const event=()=>committedEvent(scope,'test:received',{event_type:'order.received',receipt_id:'rcpt_test',order_number:'TEST',lift_order_number:null,occurred_at:start,order_revision:1,data:{intake_status:'received'}});
function fixture(){
 const items=new Map<string,any>(),objects=new Map<string,Buffer>();
 const key=(table:string,k:any)=>table+'/'+k.pk.S+'/'+k.sk.S;
 const db={async send(c:any){const x=c.input;
  if(c.constructor.name==='GetItemCommand')return {Item:structuredClone(items.get(key(x.TableName,x.Key)))};
  if(c.constructor.name==='QueryCommand')return {Items:[...items.entries()].filter(([k,v])=>k.startsWith(x.TableName+'/')&&v.pk.S===x.ExpressionAttributeValues[':pk'].S&&v.sk.S.startsWith(x.ExpressionAttributeValues[':prefix'].S)).map(([,v])=>structuredClone(v))};
  assert.equal(c.constructor.name,'TransactWriteItemsCommand');
  const puts=x.TransactItems.map((t:any)=>t.Put);
  const failures=puts.map((p:any)=>{const old=items.get(key(p.TableName,p.Item));return p.ConditionExpression==='attribute_not_exists(pk)'?!!old:!old||old.revision.N!==(p.ExpressionAttributeValues[':rev']??p.ExpressionAttributeValues[':before']).N||old.sha256.S!==p.ExpressionAttributeValues[':sha'].S;});
  if(failures.some(Boolean))throw {name:'TransactionCanceledException',CancellationReasons:failures.map((f:boolean)=>({Code:f?'ConditionalCheckFailed':'None'}))};
  for(const p of puts)items.set(key(p.TableName,p.Item),structuredClone(p.Item));return {};
 }};
 const s3={async send(c:any){const x=c.input;if(c.constructor.name==='PutObjectCommand'){if(objects.has(x.Key))throw {name:'PreconditionFailed'};objects.set(x.Key,Buffer.from(x.Body));return {};}
  const bytes=objects.get(x.Key)!;return {ContentLength:bytes.length,Body:{transformToByteArray:async()=>bytes}};
 }};
 const outbox=new DurableWebhookOutbox('outbox',scope,db);
 return {items,objects,db,s3,outbox};
}
test('durable concurrent enqueue and claim converge; restart preserves exact signature bytes and audit history',async()=>{
 const f=fixture();const rows=await Promise.all(Array.from({length:8},()=>f.outbox.enqueue(event(),endpoint)));assert.equal(f.items.size,2);
 const reopened=new DurableWebhookOutbox('outbox',scope,f.db);let sends=0;
 await Promise.all(rows.map(r=>dispatchWebhook(r.event.envelope.event_id,endpoint,{outbox:reopened,now:()=>start,secret:async()=> 'synthetic-secret',transport:{kind:'sandbox-https',validate:()=>{},async send(_u,body,headers){sends++;assert.equal(body.toString(),event().body);assert.equal(headers['X-Pathfinder-Signature'],signature('synthetic-secret',headers['X-Pathfinder-Timestamp'],body));return {status:204};}}})));
 assert.equal(sends,1);const final=(await reopened.get(event().envelope.event_id))!;assert.equal(final.state,'delivered');assert.equal(f.items.size,4);
 assert.equal(await reopened.cas(rows[0],{...rows[0],revision:1,state:'paused'}),false);
 await assert.rejects(reopened.cas(final,{...final,revision:final.revision+1,attempts:[]}),/immutable/);
 const other=new DurableWebhookOutbox('outbox',{...scope,customer_id:'other'},f.db);assert.equal(await other.get(event().envelope.event_id),null);
 await assert.rejects(other.enqueue(event(),endpoint),/scope/);
});
test('durable dead-worker claim is retried with stable event identity and recorded uncertain outcome',async()=>{
 const f=fixture(),r=await f.outbox.enqueue(event(),endpoint);
 const claimed={...r,revision:1,state:'in_flight' as const,claim:{token:'old',until:'2026-09-30T12:00:15Z'},first_attempt_at:start,cycle_attempts:1,attempts:[{number:1,cycle:0,started_at:start,key_id:'test-key',timestamp:'1',outcome:'in_flight' as const}]};
 await f.outbox.cas(r,claimed);
 const result=await dispatchWebhook(r.event.envelope.event_id,endpoint,{outbox:f.outbox,now:()=> '2026-09-30T12:01:00Z',secret:async()=> 'secret',transport:{kind:'sandbox-https',validate:()=>{},send:async()=>({status:204})}});
 assert.equal(result,'delivered');assert.deepEqual((await f.outbox.get(r.event.envelope.event_id))?.attempts.map(a=>a.outcome),['uncertain','delivered']);
});
test('HTTPS rejects unsafe destinations, mixed DNS answers and DNS completion after abort',async()=>{
 for(const target of ['http://receiver.example.com','https://127.0.0.1','https://user:pass@receiver.example.com','https://receiver.example.com:8443','https://receiver.example.com/#x'])assert.throws(()=>createSandboxHttpsTransport(target));
 let sockets=0;const req=(()=>{sockets++;throw Error('should not send');}) as any;
 const mixed=createSandboxHttpsTransport(url,{request:req,resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]});
 await assert.rejects(mixed.send(url,Buffer.from('{}'),{},new AbortController().signal),/ADDRESS/);
 const controller=new AbortController();let release!:()=>void;const dns=new Promise<void>(r=>release=r);
 const late=createSandboxHttpsTransport(url,{request:req,resolve:async()=>{await dns;return [{address:'8.8.8.8',family:4}];}});
 const sending=late.send(url,Buffer.from('{}'),{},controller.signal);controller.abort();release();await assert.rejects(sending,/ABORTED/);assert.equal(sockets,0);
 assert.throws(()=>late.validate!('https://elsewhere.example.com'),/MISMATCH/);
});
test('HTTPS pins approved DNS and TLS hostname, sends raw bytes, discards redirect body without following',async()=>{
 let sockets=0,closed=0;
 const raw=Buffer.from('{"exact": true}');
 const transport=createSandboxHttpsTransport(url,{resolve:async()=>[{address:'8.8.8.8',family:4}],request:((_url:any,options:any,callback:any)=>{
  sockets++;assert.equal(options.method,'POST');assert.equal(options.agent,false);assert.equal(options.rejectUnauthorized,true);assert.equal(options.servername,'receiver.example.com');
  options.lookup('ignored',{all:true},(error:any,addresses:any)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
  const req=new EventEmitter() as any;req.end=(body:Buffer)=>{assert.deepEqual(body,raw);callback({socket:{remoteAddress:'8.8.8.8'},statusCode:302,headers:{location:'https://evil.example'},destroy(){closed++;}});};return req;
 }) as any});
 assert.deepEqual(await transport.send(url,raw,{},new AbortController().signal),{status:302,retry_after:undefined});assert.equal(sockets,1);assert.equal(closed,1);
});
async function receiptFixture(){
 const f=fixture(),store=new DurableReceiptStore('receipts','bucket',f.db,f.s3),service=new JsonIntakeService(store,null,[stickerPressV1],()=>start);
 const payload=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
 const {receipt}=await service.receive({...scope,customer_name:'Synthetic',schema:'stickerpress.order.v1'},payload,Buffer.from(JSON.stringify(payload)));
 return {...f,store,receipt};
}
test('history validates scope, immutable revisions and missing commits before materialization',async()=>{
 const f=await receiptFixture(),r=f.receipt;await f.store.compareAndSet(r,{...r,revision:1});
 const history=new SandboxWebhookHistory('receipts','bucket',f.db,f.s3,scope,[r.receipt_id]);
 const revisions=[];for await(const row of history.history())revisions.push(row.revision);assert.deepEqual(revisions,[0,1]);
 const wrong=new SandboxWebhookHistory('receipts','bucket',f.db,f.s3,{...scope,integration_id:'other'},[r.receipt_id]);
 await assert.rejects(async()=>{for await(const _ of wrong.history()){}},/scope/);
 f.items.delete(`receipts/${r.receipt_id}/revision#000000000000`);
 await assert.rejects(async()=>{for await(const _ of history.history()){}},/history pointer/);
});
test('worker defaults disabled; dry run queues allowlisted receipt, then delivery binds separate secret and is idempotent',async()=>{
 const f=await receiptFixture();let secrets=0,sends=0;
 const env:any={WEBHOOK_ENABLED:'false',WEBHOOK_DELIVERY_ENABLED:'false',WEBHOOK_CUSTOMER_ID:scope.customer_id,WEBHOOK_INTEGRATION_ID:scope.integration_id,WEBHOOK_ENDPOINT_ID:endpoint.id,WEBHOOK_ENDPOINT_REVISION:endpoint.revision,WEBHOOK_ENDPOINT_URL:url,WEBHOOK_KEY_ID:endpoint.active_key_id,WEBHOOK_RECEIPT_IDS:JSON.stringify([f.receipt.receipt_id]),SANDBOX_RECEIPTS_TABLE:'receipts',SANDBOX_RECEIPTS_BUCKET:'bucket',WEBHOOK_OUTBOX_TABLE:'outbox',WEBHOOK_SIGNING_SECRET_ARN:'synthetic-arn'};
 let binding:any={scope,key_id:endpoint.active_key_id,endpoint_id:endpoint.id,endpoint_revision:endpoint.revision,destination:url,secret:'synthetic-independent-signing-secret'};
 const run=createSandboxWebhookHandler({env,db:f.db,s3:f.s3,secrets:{async send(){secrets++;return {SecretString:JSON.stringify(binding)};}},transport:{kind:'sandbox-https',validate:()=>{},async send(){sends++;return {status:204};}}});
 assert.deepEqual(await run({}),{enabled:false});env.WEBHOOK_ENABLED='true';
 const dry=await run({});assert.equal(dry.receipts?.[0].deliveries[0].state,'pending');assert.equal(secrets,0);assert.equal(sends,0);
 env.WEBHOOK_DELIVERY_ENABLED='true';binding={...binding,scope:{...scope,customer_id:'wrong'}};
 await assert.rejects(run({}),/binding mismatch/);assert.equal(sends,0);
 binding={...binding,scope};assert.equal((await run({})).receipts?.[0].deliveries[0].state,'delivered');await run({});assert.equal(sends,1);
 assert.equal((await f.store.get(f.receipt.receipt_id))?.revision,0);
});

test('trusted HTTPS replay retains body and audit identity and does not silently allow HTTPS for old callers',async()=>{
 const f=fixture(),r=await f.outbox.enqueue(event(),endpoint);
 await f.outbox.cas(r,{...r,revision:1,state:'paused'});
 const audit={request_id:'repair-1',actor_id:'synthetic-operator',reason:'endpoint_repaired' as const,at:start};
 await assert.rejects(replayWebhook(f.outbox,r.event.envelope.event_id,endpoint,audit),/loopback/);
 const transport=createSandboxHttpsTransport(url);
 const replayed=await replayWebhook(f.outbox,r.event.envelope.event_id,endpoint,audit,transport);
 assert.equal(replayed.event.body,r.event.body);assert.equal(replayed.cycle,1);
 assert.equal((await replayWebhook(f.outbox,r.event.envelope.event_id,endpoint,audit,transport)).revision,replayed.revision);
 await assert.rejects(replayWebhook(f.outbox,r.event.envelope.event_id,endpoint,{...audit,actor_id:'different'},transport),/conflict/);
});

test('color review history queues stable action event, excludes internal findings and suppresses resolved review',async()=>{
 const f=await receiptFixture(),r=f.receipt;
 const issue={issue_id:'iss_'+'a'.repeat(24),code:'PDF_RGB_PROFILE_MISSING',field:'lines[0].artwork',external_line_id:r.adapted.canonical.lines[0].source_line.external_line_id,owner:'customer' as const,message:'untrusted URL must not appear',retryable:false};
 const internal={...issue,issue_id:'iss_'+'b'.repeat(24),owner:'internal' as const,code:'PDF_COLOR_REVIEW_REQUIRED'};
 const held={...r,revision:1,issues:[issue,internal],asset_status:'action_required' as const,work:'complete' as const};await f.store.compareAndSet(r,held);
 const env:any={WEBHOOK_ENABLED:'true',WEBHOOK_DELIVERY_ENABLED:'false',WEBHOOK_CUSTOMER_ID:scope.customer_id,WEBHOOK_INTEGRATION_ID:scope.integration_id,WEBHOOK_ENDPOINT_ID:endpoint.id,WEBHOOK_ENDPOINT_REVISION:endpoint.revision,WEBHOOK_ENDPOINT_URL:url,WEBHOOK_KEY_ID:endpoint.active_key_id,WEBHOOK_RECEIPT_IDS:JSON.stringify([r.receipt_id]),SANDBOX_RECEIPTS_TABLE:'receipts',SANDBOX_RECEIPTS_BUCKET:'bucket',WEBHOOK_OUTBOX_TABLE:'outbox',WEBHOOK_SIGNING_SECRET_ARN:'synthetic'};
 let sends=0;
 const run=createSandboxWebhookHandler({env,db:f.db,s3:f.s3,secrets:{async send(){return {SecretString:JSON.stringify({scope,key_id:endpoint.active_key_id,endpoint_id:endpoint.id,endpoint_revision:endpoint.revision,destination:url,secret:'synthetic-independent-signing-secret'})};}},transport:{kind:'sandbox-https',validate:()=>{},async send(){sends++;return {status:204};}}});
 const first=await run({}),again=await run({});assert.deepEqual(first,again);
 const deliveries=first.receipts![0].deliveries;assert.equal(deliveries.length,2);
 const action=deliveries.find(x=>x.event_type==='order.action_required')!;
 const stored=(await f.outbox.get(action.event_id))!;assert.equal((stored.event.envelope.data.issues as any[]).length,1);
 assert.match(stored.event.body,/Preserve the original/);assert.ok(!stored.event.body.includes('untrusted URL'));assert.ok(!stored.event.body.includes(internal.issue_id));
 await f.store.compareAndSet(held,{...held,revision:2,issues:[internal]});env.WEBHOOK_DELIVERY_ENABLED='true';
 await run({});assert.equal((await f.outbox.get(action.event_id))?.state,'suppressed');assert.equal(sends,1);
});
test('strict 24-hour deadline takes precedence over tenth attempt when scheduler arrives late',async()=>{
 for(const [at,expected] of [['2026-10-01T12:00:00Z','delivered'],['2026-10-01T12:00:00.001Z','exhausted']] as const){
  const f=fixture(),r=await f.outbox.enqueue(event(),endpoint);
  const attempts=Array.from({length:9},(_,i)=>({number:i+1,cycle:0,started_at:start,key_id:'test-key',timestamp:'1',outcome:'retryable' as const}));
  await f.outbox.cas(r,{...r,revision:1,first_attempt_at:start,cycle_attempts:9,attempts,next_attempt_at:'2026-10-01T12:00:00Z'});
  let sends=0;
  const result=await dispatchWebhook(r.event.envelope.event_id,endpoint,{outbox:f.outbox,now:()=>at,secret:async()=> 'secret',transport:{kind:'sandbox-https',validate:()=>{},async send(){sends++;return {status:204};}}});
  assert.equal(result,expected);assert.equal(sends,expected==='delivered'?1:0);
 }
});
test('empty receipt allowlist is an armed no-op and never reads data or signing secrets',async()=>{
 let calls=0;const noCalls={async send(){calls++;throw Error('unexpected access');}};
 const run=createSandboxWebhookHandler({env:{WEBHOOK_ENABLED:'true',WEBHOOK_DELIVERY_ENABLED:'true',WEBHOOK_CUSTOMER_ID:scope.customer_id,WEBHOOK_INTEGRATION_ID:scope.integration_id,WEBHOOK_ENDPOINT_ID:endpoint.id,WEBHOOK_ENDPOINT_REVISION:endpoint.revision,WEBHOOK_ENDPOINT_URL:url,WEBHOOK_KEY_ID:endpoint.active_key_id,WEBHOOK_RECEIPT_IDS:'[]',SANDBOX_RECEIPTS_TABLE:'receipts',SANDBOX_RECEIPTS_BUCKET:'bucket',WEBHOOK_OUTBOX_TABLE:'outbox'},db:noCalls,s3:noCalls,secrets:noCalls});
 // Outbox enumeration must also be skipped for an empty trusted allowlist.
 assert.deepEqual(await run({}),{enabled:true,delivery_enabled:true,attempted:0,receipts:[]});assert.equal(calls,0);
});

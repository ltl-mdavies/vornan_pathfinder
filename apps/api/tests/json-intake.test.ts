import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import { stickerPressV1, sha256, IntakeError, type IntegrationIdentity } from '../src/json-intake/adapter.js';
import { LocalReceiptStore, type Receipt } from '../src/json-intake/local-store.js';
import { JsonIntakeService, statusResponse } from '../src/json-intake/service.js';
import { createJsonIntakeRouter } from '../src/json-intake/router.js';
import { authenticate, type TestCredential } from '../src/json-intake/auth.js';
import { createIntakeAttempt, transitionIntake, type IntakeLedger, type IntakeAttempt } from '../src/intake-assurance.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const identity: IntegrationIdentity = {customer_id:'synthetic-customer',customer_name:'Synthetic',integration_id:'synthetic-integration',store:'ltlco',schema:'stickerpress.order.v1',environment:'test'};
const start = '2026-09-28T12:00:00.000Z';
const token = 'synthetic_token_abcdefghijklmnopqrstuvwxyz123456';
const credential: TestCredential = {token_sha256:sha256(token),identity,expires_at:'2026-10-01T00:00:00.000Z',revoked:false,scopes:['orders:read','orders:write']};
const bytes = Buffer.from('%PDF-1.7\nSynthetic integrity fixture only; not a production PDF.\n%%EOF');
function synthetic() {
  const p = structuredClone(fixture);
  for (const l of p.lines) {l.artwork.bytes=bytes.length; l.artwork.artwork_sha256=sha256(bytes); l.approval.artwork_sha256=sha256(bytes);}
  return p;
}
function memoryLedger(): IntakeLedger & {rows: Map<string,IntakeAttempt>} {
  const rows = new Map<string,IntakeAttempt>();
  return {rows, async reserve(signal,deadline) {const a=createIntakeAttempt(signal,deadline); const old=rows.get(a.attempt_id); if(!old) rows.set(a.attempt_id,a); return {attempt:old??a,created:!old};},
    async get(customer,id) {const a=rows.get(id);return a?.signal.customer_id===customer?a:null;},
    async transition(customer,id,event) {const a=rows.get(id);assert.equal(a?.signal.customer_id,customer);const next=transitionIntake(a!,event);rows.set(id,next);return next;}};
}
async function harness(t: any) {
  const root=await mkdtemp(join(tmpdir(),'json-intake-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new LocalReceiptStore(root);const ledger=memoryLedger();let time=start;
  const service=new JsonIntakeService(store,ledger,[stickerPressV1],()=>time);
  const transport={kind:'local-fixture' as const,read:async (_url:string)=>bytes,retain:store.retain.bind(store)};
  return {root,store,ledger,service,transport,setTime:(value:string)=>{time=value;}};
}
const receive = (service:JsonIntakeService,p:any=synthetic(),id=identity) => service.receive(id,p,Buffer.from(JSON.stringify(p)));

test('four-line mapping preserves evidence, canonical fields, false/null values and source/target distinction',()=>{
  const a=stickerPressV1.validate(fixture,identity);
  assert.equal(a.canonical.lines.length,4);
  assert.deepEqual(JSON.parse(JSON.stringify(a)).evidence,fixture);
  assert.equal(a.canonical.customer.destination_customer_id,undefined);
  assert.equal(a.canonical.lines[0].unit_number,'');
  assert.equal(a.canonical.lines[0].source_line.store_variation_id,'11197');
  assert.equal(a.canonical.lines[0].source_line.approval.provider,fixture.schema);
  assert.equal(a.canonical.lines[0].line_note,'Sanitized fixture');
  assert.equal(a.canonical.order.ship_date,null);
  const p=structuredClone(fixture);p.shipping.blind_ship=false;p.order.requested_ship_date='';
  assert.equal(stickerPressV1.validate(p,identity).canonical.order.shipping_policy.blind_ship,false);
});
test('strict versioned adapter rejects invalid values with stable fields and no coercion',()=>{
  const cases: [string,(p:any)=>void][]=[
    ['lines[0].quantity',p=>p.lines[0].quantity=0],['lines[0].quantity',p=>p.lines[0].quantity='50'],
    ['lines[0].print_w_in',p=>p.lines[0].print_w_in=Infinity],['lines[0].external_line_id',p=>p.lines[0].external_line_id=''],
    ['lines[1].external_line_id',p=>p.lines[1].external_line_id=p.lines[0].external_line_id],
    ['lines[0].artwork.bytes',p=>p.lines[0].artwork.bytes=-1],['lines[0].artwork.pages',p=>p.lines[0].artwork.pages=2],
    ['lines[0].artwork.artwork_sha256',p=>p.lines[0].artwork.artwork_sha256='bad'],
    ['lines[0].approval.artwork_sha256',p=>p.lines[0].approval.artwork_sha256='0'.repeat(64)],
    ['lines[0].material_code',p=>p.lines[0].material_code='clear_bopp'],['lines[0].artwork.download_url',p=>p.lines[0].artwork.download_url='http://127.0.0.1/a'],
    ['lines[0].artwork.download_url',p=>p.lines[0].artwork.download_url='https://[::1]/a'],
    ['order.requested_ship_date',p=>p.order.requested_ship_date='2026-02-30'],['order.creation_date',p=>p.order.creation_date='2026-02-30T00:00:00Z'],
    ['lines[0].unreviewed',p=>p.lines[0].unreviewed=true],['account.store',p=>p.account.store='other'],['schema',p=>p.schema='stickerpress.order.v2']
  ];
  for(const [field,mutate] of cases){const p=structuredClone(fixture);mutate(p);assert.throws(()=>stickerPressV1.validate(p,identity),(e:any)=>e instanceof IntakeError && e.status===422 && e.issues.some((i:any)=>i.field===field),field);}
});
test('semantic identity ignores signed artwork/preview access changes and submission time only',()=>{
  const p=structuredClone(fixture);const old=stickerPressV1.validate(p,identity);
  p.submitted_at='2026-09-29T00:00:00Z';p.lines[0].artwork.download_url='https://another.example.invalid/a?signature=synthetic';p.lines[0].artwork.artwork_expires_at='2026-10-06T00:00:00Z';p.lines[0].preview.url='https://another.example.invalid/a.png?new=1';
  assert.equal(stickerPressV1.validate(p,identity).fingerprint,old.fingerprint);
  p.lines[0].approval.approved_at='2026-09-29T00:00:00Z';assert.notEqual(stickerPressV1.validate(p,identity).fingerprint,old.fingerprint);
});
test('concurrent POST retries persist one receipt with pending recovery work; changed content conflicts',async t=>{
  const h=await harness(t);const responses=await Promise.all(Array.from({length:16},()=>receive(h.service)));
  assert.equal(responses.filter(r=>!r.replayed).length,1);assert.equal(new Set(responses.map(r=>r.receipt.receipt_id)).size,1);
  assert.equal(h.ledger.rows.size,0); // receipt must be durable before asynchronous ledger/work
  const r=responses[0].receipt;const p=synthetic();p.lines[0].quantity=51;p.lines[0].area_sq_in=+(p.lines[0].print_w_in*p.lines[0].print_h_in*51).toFixed(2);
  await assert.rejects(receive(h.service,p),(e:any)=>e.status===409);
  assert.equal((await new LocalReceiptStore(h.root).get(r.receipt_id))?.work,'pending');
  assert.equal((await stat(join(h.root,'receipts',r.receipt_id,'0.json'))).mode&0o777,0o600);
});
test('scoped auth rejects expiry/revocation/production/missing scope and router remains off by default',async t=>{
  const h=await harness(t);
  for(const key of [{...credential,revoked:true},{...credential,expires_at:start}])assert.throws(()=>authenticate(`Bearer ${token}`,[key],'orders:read',start));
  assert.throws(()=>authenticate(`Bearer ${token}`,[{...credential,scopes:[]}],'orders:read',start));
  assert.throws(()=>authenticate(`Bearer ${token}`,[{...credential,identity:{...identity,environment:'production' as any}}],'orders:read',start));
  const off=express().use('/api/v1/intake',createJsonIntakeRouter({service:h.service,credentials:[credential]}));
  assert.equal((await request(off).post('/api/v1/intake/orders').send(fixture)).status,404);
  const app=express().use('/api/v1/intake',createJsonIntakeRouter({enabled:true,service:h.service,credentials:[credential]}));
  assert.equal((await request(app).post('/api/v1/intake/orders').send(fixture)).status,401);
  const response=await request(app).post('/api/v1/intake/orders').set('Authorization',`Bearer ${token}`).send(fixture);
  assert.equal(response.status,202);assert.equal(response.headers['cache-control'],'private, no-store');
  const replay=await request(app).post('/api/v1/intake/orders').set('Authorization',`Bearer ${token}`).send(fixture);assert.equal(replay.status,200);
  const status=await request(app).get(response.body.status_url).set('Authorization',`Bearer ${token}`);assert.equal(status.status,200);
  assert.equal(status.body.lift_order_number,null);assert.ok(!JSON.stringify(status.body).includes('download_url'));
  const other={...credential,identity:{...identity,integration_id:'other'}};
  const otherApp=express().use('/api/v1/intake',createJsonIntakeRouter({enabled:true,service:h.service,credentials:[other]}));
  assert.equal((await request(otherApp).get(response.body.status_url).set('Authorization',`Bearer ${token}`)).status,404);
  await assert.rejects(h.service.lookup({...identity,customer_id:'other'},response.body.receipt_id),(e:any)=>e.status===404);
  const bad=structuredClone(fixture);bad.lines[0].quantity=0;
  assert.equal((await request(app).post('/api/v1/intake/orders').set('Authorization',`Bearer ${token}`).send(bad)).status,422);
});
test('worker claim excludes concurrent workers; retained bytes and upstream approval survive URL expiry',async t=>{
  const h=await harness(t);const {receipt}=await receive(h.service);let reads=0;
  const transport={...h.transport,read:async()=>{reads++;return bytes;}};
  const results=await Promise.all(Array.from({length:8},()=>h.service.process(receipt.receipt_id,transport)));
  assert.equal(results.filter(Boolean).length,1);assert.equal(reads,4);assert.equal(h.ledger.rows.size,1);
  const done=(await h.store.get(receipt.receipt_id))!;assert.equal(done.asset_status,'integrity_verified');assert.equal(done.work,'complete');
  assert.equal([...h.ledger.rows.values()][0].state,'preparing');assert.equal([...h.ledger.rows.values()][0].job_id,null);
  h.setTime('2026-10-08T00:00:00Z');await h.service.recover(transport);assert.equal(reads,4);
  assert.deepEqual(await readFile(join(h.root,done.assets[0].retained_ref)),bytes);
  assert.equal(statusResponse(done).review_required,true);assert.equal(statusResponse(done).lines[0].inspection,'not_run');
});
test('crash after receipt, after reserve, and after transition recover without another shared attempt',async t=>{
  for(const point of ['receipt','reserve','transition']){
    const h=await harness(t);const {receipt}=await receive(h.service);
    if(point!=='receipt'){
      const {attempt}=await h.ledger.reserve(receipt.signal,receipt.deadline);
      if(point==='transition') await h.ledger.transition(identity.customer_id,attempt.attempt_id,{event_id:'crash-prepare',expected_revision:0,occurred_at:start,state:'preparing',reason:null,next_action_at:receipt.deadline});
      await h.store.compareAndSet(receipt,{...receipt,revision:1,claim:{token:'dead-worker',until:'2026-09-28T12:01:00Z'},...(point==='transition'?{ledger_projection:{attempt_id:attempt.attempt_id,expected_revision:0,before_state:'received' as const,before_event_id:null,event_id:'crash-prepare',state:'preparing' as const}}:{})});
      h.setTime('2026-09-28T12:02:00Z');
    }
    const restarted=new JsonIntakeService(new LocalReceiptStore(h.root),h.ledger,[stickerPressV1],h.service.now);
    await restarted.recover(h.transport);assert.equal(h.ledger.rows.size,1);assert.equal((await h.store.get(receipt.receipt_id))?.work,'complete');
    const retry=await receive(restarted);assert.equal(retry.replayed,true);assert.equal(retry.receipt.received_at,start);
  }
});
test('bad bytes/expiry are customer issues, transient failure is internal and recoverable',async t=>{
  for(const [mode,code] of [['hash','ARTWORK_CHECKSUM_MISMATCH'],['size','ARTWORK_SIZE_MISMATCH'],['expired','ARTWORK_URL_EXPIRED'],['transient','ASSET_TRANSPORT_FAILURE']]){
    const h=await harness(t);const {receipt}=await receive(h.service);
    if(mode==='expired')h.setTime('2026-10-06T00:00:00Z');
    await h.service.process(receipt.receipt_id,{...h.transport,read:async()=>{
      if(mode==='transient')throw new Error('secret query must not leak');
      return mode==='hash'?Buffer.alloc(bytes.length):mode==='size'?Buffer.from('small'):bytes;
    }});
    const r=(await h.store.get(receipt.receipt_id))!;assert.equal(r.issues[0].code,code);assert.ok(!JSON.stringify(statusResponse(r)).includes('secret query'));
    if(mode==='transient'){assert.equal(r.work,'pending');h.setTime('2026-09-28T12:02:00Z');await h.service.recover(h.transport);assert.equal((await h.store.get(receipt.receipt_id))?.asset_status,'integrity_verified');}
  }
});
test('URL refresh updates existing receipt, preserves original evidence and clears expired-access failures',async t=>{
  const h=await harness(t);const p=synthetic();const {receipt}=await receive(h.service,p);h.setTime('2026-10-06T00:00:00Z');
  await h.service.process(receipt.receipt_id,h.transport);
  for(const l of p.lines){l.artwork.download_url+='?fresh=1';l.artwork.artwork_expires_at='2026-10-12T00:00:00Z';}
  p.submitted_at='2026-10-06T00:00:00Z';const refreshed=await receive(h.service,p);assert.equal(refreshed.receipt.receipt_id,receipt.receipt_id);
  await h.service.process(receipt.receipt_id,h.transport);assert.equal((await h.store.get(receipt.receipt_id))?.asset_status,'integrity_verified');
  const first=JSON.parse(await readFile(join(h.root,'receipts',receipt.receipt_id,'0.json'),'utf8'));assert.equal(first.adapted.evidence.submitted_at,fixture.submitted_at);
});
test('filesystem CAS is cross-process and receipt survives a real process restart',async t=>{
  const h=await harness(t);const {receipt}=await receive(h.service);
  const moduleUrl=new URL('../src/json-intake/local-store.ts',import.meta.url).href;
  const script=`const {LocalReceiptStore}=await import(${JSON.stringify(moduleUrl)}); const store=new LocalReceiptStore(${JSON.stringify(h.root)}); const r=await store.get(${JSON.stringify(receipt.receipt_id)}); if(!r)throw Error('missing'); const initial={...r,revision:0}; console.log(await store.compareAndSet(initial,{...initial,revision:1,claim:{token:'child',until:'2026-09-28T12:30:00Z'}}));`;
  const run=()=>new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx/esm','--input-type=module','-e',script]);let output='';let error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(error)));});
  const results=await Promise.all(Array.from({length:4},run));assert.equal(results.filter(x=>x==='true').length,1);assert.equal((await h.store.get(receipt.receipt_id))?.revision,1);
});

test('same source order is isolated across integrations and customers',async t=>{
  const h=await harness(t);const a=await receive(h.service);const b=await receive(h.service,synthetic(),{...identity,integration_id:'second'});const c=await receive(h.service,synthetic(),{...identity,customer_id:'second'});
  assert.equal(new Set([a,b,c].map(x=>x.receipt.receipt_id)).size,3);
  for(const r of [a,b,c])await h.service.process(r.receipt.receipt_id,h.transport);
  assert.equal(h.ledger.rows.size,3);
});
test('crash after shared failure transition but before receipt completion is recovered',async t=>{
  const h=await harness(t);const {receipt}=await receive(h.service);
  const cas=h.store.compareAndSet.bind(h.store);let crashed=false;
  h.store.compareAndSet=async (before,after)=>{if(after.work==='complete'&&!crashed){crashed=true;throw new Error('simulated crash');}return cas(before,after);};
  const bad={...h.transport,read:async()=>Buffer.alloc(bytes.length)};
  await assert.rejects(h.service.process(receipt.receipt_id,bad),/simulated crash/);
  assert.equal([...h.ledger.rows.values()][0].state,'manual_review');
  assert.equal([...h.ledger.rows.values()][0].reason,null);
  h.setTime('2026-09-28T12:31:00Z');await h.service.recover(bad);
  assert.equal(h.ledger.rows.size,1);assert.equal((await h.store.get(receipt.receipt_id))?.asset_status,'action_required');
});
test('expired worker cannot complete after another worker recovers its claim',async t=>{
  const h=await harness(t);const {receipt}=await receive(h.service);let unblock!:()=>void;let entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});const blocked=new Promise<void>(resolve=>{unblock=resolve;});
  const first=h.service.process(receipt.receipt_id,{...h.transport,read:async()=>{entered();await blocked;return bytes;}});
  const rejection=assert.rejects(first,/Receipt claim lost/);
  await waiting;h.setTime('2026-09-28T12:31:00Z');await h.service.process(receipt.receipt_id,h.transport);unblock();await rejection;
  assert.equal((await h.store.get(receipt.receipt_id))?.asset_status,'integrity_verified');assert.equal(h.ledger.rows.size,1);
});
test('PDF signature failure cannot be described as verified even with matching declared and approval hashes',async t=>{
  const h=await harness(t);const p=synthetic();const invalid=Buffer.alloc(bytes.length);
  for(const l of p.lines){l.artwork.artwork_sha256=sha256(invalid);l.approval.artwork_sha256=sha256(invalid);}
  const {receipt}=await receive(h.service,p);await h.service.process(receipt.receipt_id,{...h.transport,read:async()=>invalid});
  assert.equal((await h.store.get(receipt.receipt_id))?.issues[0].code,'ARTWORK_SIGNATURE_INVALID');
});
test('injected existing local IntakeLedger survives process restart with a single receipt association',async t=>{
  const h=await harness(t);const {receipt}=await receive(h.service);
  const storeModule=new URL('../src/store.ts',import.meta.url).href;
  const localModule=new URL('../src/json-intake/local-store.ts',import.meta.url).href;
  const serviceModule=new URL('../src/json-intake/service.ts',import.meta.url).href;
  const adapterModule=new URL('../src/json-intake/adapter.ts',import.meta.url).href;
  const script=`const {intakeLedger}=await import(${JSON.stringify(storeModule)}); const {LocalReceiptStore}=await import(${JSON.stringify(localModule)}); const {JsonIntakeService}=await import(${JSON.stringify(serviceModule)}); const {stickerPressV1}=await import(${JSON.stringify(adapterModule)}); const store=new LocalReceiptStore(${JSON.stringify(h.root)}); const service=new JsonIntakeService(store,intakeLedger,[stickerPressV1],()=>${JSON.stringify(start)}); await service.recover({kind:'local-fixture',read:async()=>Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64'),retain:store.retain.bind(store)});`;
  const path=join(h.root,'shared.local.json');
  const run=()=>new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx/esm','--input-type=module','-e',script],{env:{...process.env,PATHFINDER_STORAGE_DRIVER:'local',PATHFINDER_SECRETS_DRIVER:'local',PATHFINDER_LOCAL_STORE_PATH:path}});let output='';child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(output)));});
  await run();await run();const data=JSON.parse(await readFile(path,'utf8'));assert.equal(data.intake_attempts.length,1);assert.equal(data.intake_attempts[0].state,'preparing');
  assert.equal(data.intake_attempts[0].job_id,null);assert.equal(data.intake_attempts[0].submit_attempt_id,null);
});

test('receipt retry never clears an unrelated operator review',async t=>{
  const h=await harness(t);const p=synthetic();const {receipt}=await receive(h.service,p);
  await h.service.process(receipt.receipt_id,{...h.transport,read:async()=>Buffer.alloc(bytes.length)});
  const current=[...h.ledger.rows.values()][0];
  await h.ledger.transition(identity.customer_id,current.attempt_id,{event_id:'operator-review',expected_revision:current.revision,occurred_at:start,state:'manual_review',reason:null,next_action_at:current.next_action_at});
  p.lines[0].artwork.download_url+='?renewed=1';await receive(h.service,p);
  await assert.rejects(h.service.process(receipt.receipt_id,h.transport),/ownership conflict/);
  assert.equal([...h.ledger.rows.values()][0].last_event?.event_id,'operator-review');
});

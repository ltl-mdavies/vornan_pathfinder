import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { createHttpsAssetReader, isPublicAddress, createPinnedHttpsExchange, type HttpsAssetDependencies, type PinnedResponse } from '../src/json-intake/https-assets.js';
import { createPdfInspector, measurePdf } from '../src/json-intake/pdf-inspection.js';
import { AssetCheckError } from '../src/json-intake/asset-errors.js';
import { stickerPressV1, sha256, type IntegrationIdentity } from '../src/json-intake/adapter.js';
import { LocalReceiptStore } from '../src/json-intake/local-store.js';
import { JsonIntakeService, statusResponse, type LocalAssetTransport } from '../src/json-intake/service.js';
import { createIntakeAttempt, transitionIntake, type IntakeLedger, type IntakeAttempt } from '../src/intake-assurance.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const identity:IntegrationIdentity={customer_id:'synthetic',customer_name:'Synthetic',integration_id:'asset-review',store:'ltlco',schema:'stickerpress.order.v1',environment:'test'};
const policy={policy_id:'local-review-0.001-not-production-approved',metadata_tolerance_in:0.001};
const inspect=createPdfInspector(policy);
const publicAddress={address:'93.184.216.34',family:4 as const};
function reply(body:Buffer=Buffer.from('%PDF-example'),status=200,headers:Record<string,string>={}):PinnedResponse{
  return {status,headers:{'content-type':'application/pdf',...headers},body:(async function*(){yield body;})(),close(){}};
}
const rejectsCode=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,(e:any)=>e instanceof AssetCheckError && e.code===code);

async function makePdf(options:{pages?:number;trim?:number;spot?:boolean;layer?:boolean;rotate?:boolean;boxes?:boolean;compressed?:boolean}={}){
  const doc=await PDFDocument.create();
  for(let i=0;i<(options.pages??1);i++){
    const page=doc.addPage([151.2,151.2]);
    if(options.boxes!==false){page.setTrimBox(9,9,options.trim??133.2,133.2);page.setBleedBox(0,0,151.2,151.2);}
    if(options.rotate)page.setRotation(degrees(90));
    const resources=doc.context.obj({});
    if(options.spot!==false){
      const tint=doc.context.obj({FunctionType:2,Domain:[0,1],C0:[0,0,0,0],C1:[0,1,0,0],N:1});
      resources.set(PDFName.of('ColorSpace'),doc.context.obj({Cut:[PDFName.of('Separation'),PDFName.of('Laser - Thru Cut'),PDFName.of('DeviceCMYK'),tint]}));
    }
    if(options.layer!==false){
      const layer=doc.context.register(doc.context.obj({Type:'OCG',Name:PDFString.of('Laser - Thru Cut')}));
      resources.set(PDFName.of('Properties'),doc.context.obj({CutLayer:layer}));
      doc.catalog.set(PDFName.of('OCProperties'),doc.context.obj({OCGs:[layer],D:{Order:[layer]}}));
    }
    page.node.set(PDFName.of('Resources'),resources);
  }
  return Buffer.from(await doc.save({useObjectStreams:options.compressed??true}));
}
function source(bytes:Buffer){
  const p=structuredClone(fixture);p.lines=p.lines.slice(0,1);
  p.lines[0].artwork.bytes=bytes.length;p.lines[0].artwork.artwork_sha256=sha256(bytes);p.lines[0].approval.artwork_sha256=sha256(bytes);
  return p;
}
function line(bytes:Buffer){return stickerPressV1.validate(source(bytes),identity).canonical.lines[0];}

test('HTTPS rejects non-HTTPS, credentials, literals, untrusted hosts and every private/special DNS address',async()=>{
  let calls=0;const deps:HttpsAssetDependencies={resolve:async()=>[publicAddress],exchange:async()=>{calls++;return reply();}};
  const read=createHttpsAssetReader({allowed_hosts:['assets.example.invalid']},deps);
  for(const url of ['http://assets.example.invalid/a','https://user:secret@assets.example.invalid/a','https://127.0.0.1/a','https://[::1]/a','https://assets.example.invalid:444/a','https://evil.example.invalid/a','file:///tmp/a'])await rejectsCode(read(url),'ASSET_URL_UNSUPPORTED');
  assert.equal(calls,0);
  for(const address of ['127.0.0.1','10.1.1.1','172.16.4.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','192.0.2.1','224.0.0.1']){
    assert.equal(isPublicAddress({address,family:4}),false,address);
    const reader=createHttpsAssetReader({allowed_hosts:['assets.example.invalid']},{...deps,resolve:async()=>[publicAddress,{address,family:4}]});
    await rejectsCode(reader('https://assets.example.invalid/a?signature=synthetic-secret'),'ASSET_PRIVATE_ADDRESS');
  }
  for(const address of ['::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::','3fff::1'])assert.equal(isPublicAddress({address,family:6}),false,address);
  assert.equal(isPublicAddress({address:'2606:4700:4700::1111',family:6}),true);
});
test('each redirect is allowlisted and re-resolved; private target and redirect loops are stopped',async()=>{
  let resolves=0,requests=0,closes=0;
  const deps:HttpsAssetDependencies={resolve:async()=>{resolves++;return resolves===1?[publicAddress]:[{address:'10.0.0.1',family:4}];},exchange:async()=>{requests++;const r=reply(Buffer.alloc(0),302,{location:'/next'});r.close=()=>{closes++;};return r;}};
  await rejectsCode(createHttpsAssetReader({allowed_hosts:['assets.example.invalid']},deps)('https://assets.example.invalid/a'),'ASSET_PRIVATE_ADDRESS');
  assert.equal(requests,1);assert.equal(closes,1);
  const redirect:HttpsAssetDependencies={resolve:async()=>[publicAddress],exchange:async()=>reply(Buffer.alloc(0),302,{location:'https://evil.example.invalid/a'})};
  await rejectsCode(createHttpsAssetReader({allowed_hosts:['assets.example.invalid']},redirect)('https://assets.example.invalid/a'),'ASSET_URL_UNSUPPORTED');
  redirect.exchange=async()=>reply(Buffer.alloc(0),302,{location:'/loop'});
  await rejectsCode(createHttpsAssetReader({allowed_hosts:['assets.example.invalid'],max_redirects:1},redirect)('https://assets.example.invalid/a'),'ASSET_REDIRECT_REJECTED');
});
test('actual Node transport pins DNS, disables pooling, verifies TLS name and checks remote socket',async()=>{
  let options:any;let callback:any;const req=new EventEmitter() as any;req.end=()=>{};
  const exchange=createPinnedHttpsExchange(((url:any,opt:any,cb:any)=>{assert.equal(url.hostname,'assets.example.invalid');options=opt;callback=cb;return req;}) as any);
  const pending=exchange(new URL('https://assets.example.invalid/a'),publicAddress,new AbortController().signal);
  assert.equal(options.agent,false);assert.equal(options.rejectUnauthorized,true);assert.equal(options.servername,'assets.example.invalid');
  options.lookup('assets.example.invalid',{all:true},(error:any,list:any)=>{assert.equal(error,null);assert.deepEqual(list,[publicAddress]);});
  let destroyed=false;callback({socket:{remoteAddress:'127.0.0.1'},destroy(){destroyed=true;}});
  await rejectsCode(pending,'ASSET_CONNECTION_REJECTED');assert.equal(destroyed,true);
});
test('stream byte limits, content type, encoding, HTTP failures and total deadlines are bounded and sanitized',async()=>{
  const base:HttpsAssetDependencies={resolve:async()=>[publicAddress],exchange:async()=>reply()};
  const run=(exchange:HttpsAssetDependencies['exchange'],timeout_ms=100)=>createHttpsAssetReader({allowed_hosts:['assets.example.invalid'],max_bytes:10,timeout_ms},{...base,exchange})('https://assets.example.invalid/a?signature=synthetic-secret');
  await rejectsCode(run(async()=>reply(Buffer.alloc(11))),'ASSET_BYTE_LIMIT');
  await rejectsCode(run(async()=>reply(Buffer.alloc(1),200,{'content-length':'100'})),'ASSET_BYTE_LIMIT');
  await rejectsCode(run(async()=>reply(Buffer.alloc(1),200,{'content-type':'text/html'})),'ASSET_CONTENT_TYPE_MISMATCH');
  await rejectsCode(run(async()=>reply(Buffer.alloc(1),200,{'content-encoding':'gzip'})),'ASSET_ENCODING_UNSUPPORTED');
  await rejectsCode(run(async()=>reply(Buffer.alloc(1),200,{'content-length':'2'})),'ASSET_LENGTH_MISMATCH');
  await rejectsCode(run(async()=>reply(Buffer.alloc(0),403)),'ARTWORK_URL_EXPIRED');
  await assert.rejects(run(async()=>reply(Buffer.alloc(0),503)),(e:any)=>e.retryable && e.owner==='internal');
  await rejectsCode(run(async()=>({...reply(),body:(async function*(){await new Promise(()=>{});yield Buffer.alloc(0);})()}),20),'ASSET_FETCH_TIMEOUT');
  await rejectsCode(createHttpsAssetReader({allowed_hosts:['assets.example.invalid'],timeout_ms:20},{...base,resolve:async()=>new Promise(()=>{})})('https://assets.example.invalid/a'),'ASSET_FETCH_TIMEOUT');
  await assert.rejects(run(async()=>{throw new Error('synthetic-secret');}),(e:any)=>e.code==='ASSET_FETCH_FAILED' && !String(e).includes('synthetic-secret'));
  assert.deepEqual(await run(async()=>reply(Buffer.from('valid'))),Buffer.from('valid'));
});
test('real parser measures boxes and named page resources without modifying PDF bytes',async()=>{
  for(const compressed of [true,false]){
    const bytes=await makePdf({compressed}),before=sha256(bytes);const report=await inspect(bytes,line(bytes));
    assert.equal(report.verdict,'pass');assert.equal(report.sha256,before);assert.equal(sha256(bytes),before);
    assert.equal(report.measured.spot_present,true);assert.equal(report.measured.layer_present,true);assert.equal(report.production_approved,false);
    assert.ok(Math.abs(report.measured.trim_in.w-1.85)<1e-9);
  }
});
test('malformed, truncated, encrypted, multipage, missing-box and transformed PDFs fail explicitly',async()=>{
  await rejectsCode(measurePdf(Buffer.from('%PDF-garbage\n%%EOF'),'x','x'),'PDF_MALFORMED');
  const valid=await makePdf();await rejectsCode(measurePdf(valid.subarray(0,valid.length-20),'x','x'),'PDF_MALFORMED');
  await rejectsCode(measurePdf(await makePdf({pages:2}),'x','x'),'PDF_PAGE_COUNT');
  await rejectsCode(measurePdf(await makePdf({boxes:false}),'x','x'),'PDF_BOX_MISSING');
  await rejectsCode(measurePdf(await makePdf({rotate:true}),'x','x'),'PDF_TRANSFORM_UNSUPPORTED');
  const doc=await PDFDocument.load(valid);doc.context.trailerInfo.Encrypt=doc.context.register(doc.context.obj({Filter:'Standard',V:1,R:2,Length:40}));
  await rejectsCode(measurePdf(Buffer.from(await doc.save()),'x','x'),'PDF_ENCRYPTED');
});
test('metadata geometry/cut failures and explicit rounding tolerance remain review-only findings',async()=>{
  for(const [options,code] of [[{trim:140},'PDF_TRIM_GEOMETRY_MISMATCH'],[{spot:false},'PDF_CUT_SPOT_MISSING'],[{layer:false},'PDF_CUT_LAYER_MISSING']] as const){
    const bytes=await makePdf(options);const report=await inspect(bytes,line(bytes));assert.equal(report.verdict,'fail');assert.ok(report.findings.includes(code));
  }
  const bytes=await makePdf({trim:133.23});assert.equal((await inspect(bytes,line(bytes))).verdict,'pass');
  const strict=createPdfInspector({policy_id:'strict-local',metadata_tolerance_in:0});assert.equal((await strict(bytes,line(bytes))).verdict,'fail');
});
test('parser timeout terminates a real worker and subsequent inspection remains usable',async()=>{
  const bytes=await makePdf();const start=Date.now();
  await rejectsCode(measurePdf(bytes,'Laser - Thru Cut','Laser - Thru Cut',1),'PDF_PARSER_TIMEOUT');
  assert.ok(Date.now()-start<2000);assert.equal((await inspect(bytes,line(bytes))).verdict,'pass');
});

async function harness(t:any,bytes:Buffer){
  const root=await mkdtemp(join(tmpdir(),'json-asset-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new LocalReceiptStore(root);const rows=new Map<string,IntakeAttempt>();let time='2026-09-28T12:00:00Z';
  const ledger:IntakeLedger={async reserve(signal,deadline){const a=createIntakeAttempt(signal,deadline);const old=rows.get(a.attempt_id);if(!old)rows.set(a.attempt_id,a);return{attempt:old??a,created:!old};},async get(customer,id){const a=rows.get(id);return a?.signal.customer_id===customer?a:null;},async transition(customer,id,event){const a=rows.get(id)!;assert.equal(a.signal.customer_id,customer);const next=transitionIntake(a,event);rows.set(id,next);return next;}};
  const service=new JsonIntakeService(store,ledger,[stickerPressV1],()=>time);
  const payload=source(bytes);const {receipt}=await service.receive(identity,payload,Buffer.from(JSON.stringify(payload)));
  const transport:LocalAssetTransport={kind:'review-assets',read:async url=>{if(url.endsWith('.png'))throw new Error('optional preview unavailable');return bytes;},retain:store.retain.bind(store),readRetained:store.readRetained.bind(store),inspect,inspection_profile:{engine:'pdf-lib@1.17.1',policy_id:policy.policy_id}};
  return{root,store,rows,service,receipt,transport,setTime:(v:string)=>{time=v;}};
}
test('retained production/approval bytes and metadata survive expiry while preview failure stays separate',async t=>{
  const bytes=await makePdf();const h=await harness(t,bytes);await h.service.process(h.receipt.receipt_id,h.transport);
  const r=(await h.store.get(h.receipt.receipt_id))!;assert.equal(r.asset_status,'integrity_verified');assert.equal(r.assets[0].inspection,'metadata_pass');
  assert.equal(r.previews?.[0].status,'unavailable');assert.equal(r.issues.length,0);assert.equal(statusResponse(r).review_required,true);
  assert.equal([...h.rows.values()][0].state,'preparing');assert.equal([...h.rows.values()][0].submit_attempt_id,null);
  h.setTime('2026-10-10T12:00:00Z');await h.service.recover({...h.transport,read:async()=>{throw Error('must not fetch');}});
  assert.deepEqual(await readFile(join(h.root,r.assets[0].retained_ref)),bytes);
  await assert.rejects(h.store.readRetained('another tenant',r.assets[0].retained_ref),/scope mismatch/);
});
test('checkpoint before inspection allows crash recovery from retained bytes after source expiry',async t=>{
  const bytes=await makePdf();const h=await harness(t,bytes);
  await h.service.process(h.receipt.receipt_id,{...h.transport,inspect:async()=>{throw new Error('simulated inspector outage');}});
  const pending=(await h.store.get(h.receipt.receipt_id))!;assert.equal(pending.work,'pending');assert.equal(pending.assets.length,1);assert.equal(pending.assets[0].inspection,'not_run');
  h.setTime('2026-10-10T12:00:00Z');await h.service.recover({...h.transport,read:async()=>{throw Error('expired source must not be fetched');}});
  const done=(await h.store.get(h.receipt.receipt_id))!;assert.equal(done.asset_status,'integrity_verified');assert.equal(done.assets[0].inspection,'metadata_pass');assert.equal(h.rows.size,1);
});
test('transient retrieval retries are delayed and stop after three processing attempts',async t=>{
  const h=await harness(t,await makePdf());let requests=0;const transport={...h.transport,read:async()=>{requests++;throw new AssetCheckError('ASSET_FETCH_FAILED',true,'internal');}};
  await h.service.process(h.receipt.receipt_id,transport);const first=requests;await h.service.recover(transport);assert.equal(requests,first);
  h.setTime('2026-09-28T12:02:00Z');await h.service.recover(transport);h.setTime('2026-09-28T12:05:00Z');await h.service.recover(transport);
  const r=(await h.store.get(h.receipt.receipt_id))!;assert.equal(r.retry_attempts,3);assert.equal(r.work,'complete');assert.equal(r.next_retry_at,null);assert.equal(r.asset_status,'internal_action_required');
});

test('adversarial compressed object stream is rejected before excessive decoded-buffer allocation',async()=>{
  const doc=await PDFDocument.load(await makePdf());
  doc.context.register(doc.context.flateStream(Buffer.alloc(9*1024*1024,32),{Type:'ObjStm',N:1,First:4}));
  const bytes=Buffer.from(await doc.save({useObjectStreams:false}));assert.ok(bytes.length<100000);
  const start=Date.now();await rejectsCode(measurePdf(bytes,'x','x'),'PDF_RESOURCE_LIMIT');assert.ok(Date.now()-start<5000);
  const good=await makePdf();assert.equal((await inspect(good,line(good))).verdict,'pass');
});

test('inspection checkpoint survives a crash before completion without refetching or reinspection',async t=>{
  const bytes=await makePdf(),h=await harness(t,bytes);const cas=h.store.compareAndSet.bind(h.store);let crashed=false;
  h.store.compareAndSet=async(before,after)=>{if(after.work==='complete'&&!crashed){crashed=true;throw Error('simulated completion crash');}return cas(before,after);};
  await assert.rejects(h.service.process(h.receipt.receipt_id,h.transport),/completion crash/);
  assert.equal((await h.store.get(h.receipt.receipt_id))?.assets[0].inspection,'metadata_pass');
  h.setTime('2026-10-10T12:00:00Z');await h.service.recover({...h.transport,read:async()=>{throw Error('must reuse retention');},inspect:async()=>{throw Error('must reuse inspection');}});
  const r=(await h.store.get(h.receipt.receipt_id))!;assert.equal(r.asset_status,'integrity_verified');assert.equal(r.retry_attempts,2);
});
test('concurrent retries cannot spend or reset the same persistent attempt budget',async t=>{
  const h=await harness(t,await makePdf());let reads=0;
  const transport={...h.transport,read:async()=>{reads++;throw new AssetCheckError('ASSET_FETCH_FAILED',true,'internal');}};
  await h.service.process(h.receipt.receipt_id,transport);const initial=reads;h.setTime('2026-09-28T12:02:00Z');
  const runs=await Promise.all(Array.from({length:8},()=>h.service.process(h.receipt.receipt_id,transport)));
  assert.equal(runs.filter(Boolean).length,1);assert.equal(reads,initial*2);assert.equal((await h.store.get(h.receipt.receipt_id))?.retry_attempts,2);
});
test('process crashes consume claimed attempts; recovery after the third crash does not start more asset work',async t=>{
  const h=await harness(t,await makePdf());const reserve=h.service.ledger.reserve.bind(h.service.ledger);
  h.service.ledger.reserve=async()=>{throw Error('crash after claim');};
  for(let i=0;i<3;i++){h.setTime(`2026-09-28T${12+i}:00:00Z`);await assert.rejects(h.service.process(h.receipt.receipt_id,h.transport),/crash after claim/);}
  h.service.ledger.reserve=reserve;h.setTime('2026-09-28T15:00:00Z');let reads=0;
  await h.service.recover({...h.transport,read:async()=>{reads++;throw Error('budget exhausted');}});
  const r=(await h.store.get(h.receipt.receipt_id))!;assert.equal(reads,0);assert.equal(r.retry_attempts,3);assert.equal(r.work,'complete');assert.equal(r.issues[0].code,'ASSET_RETRY_EXHAUSTED');assert.equal([...h.rows.values()][0].owner,'internal');
});
test('retained reference preview is private and never acts as a production approval',async t=>{
  const bytes=await makePdf(),h=await harness(t,bytes);const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  await h.service.process(h.receipt.receipt_id,{...h.transport,read:async url=>url.endsWith('.png')?png:bytes});
  const r=(await h.store.get(h.receipt.receipt_id))!;assert.equal(r.previews?.[0].status,'retained');assert.ok(r.previews?.[0].retained_ref?.endsWith('.png'));
  assert.equal(r.adapted.canonical.lines[0].source_line.approval.artwork_sha256,sha256(bytes));assert.equal(statusResponse(r).review_required,true);
  assert.ok(!JSON.stringify(statusResponse(r)).includes('retained_ref'));
});

test('unused named resources are declarations only; catalog-only layer names cannot satisfy page metadata',async()=>{
  const bytes=await makePdf();const report=await inspect(bytes,line(bytes));
  assert.equal(report.verdict,'pass');assert.equal(report.cut_path_verified,false);assert.equal(report.malware_scanned,false);
  const doc=await PDFDocument.load(bytes);const resources=doc.getPage(0).node.Resources()!;
  resources.delete(PDFName.of('Properties'));
  const catalogOnly=Buffer.from(await doc.save());const result=await inspect(catalogOnly,line(catalogOnly));
  assert.ok(result.findings.includes('PDF_CUT_LAYER_MISSING'));
});
test('indirect boxes and nested Form/DeviceN named resources are measured; UserUnit and invalid boxes fail',async()=>{
  const doc=await PDFDocument.load(await makePdf());const page=doc.getPage(0);
  const resources=page.node.Resources()!;const colors=doc.context.obj({Cut:[PDFName.of('DeviceN'),[PDFName.of('Laser - Thru Cut')],PDFName.of('DeviceCMYK'),doc.context.obj({FunctionType:2,Domain:[0,1],C0:[0,0,0,0],C1:[0,1,0,0],N:1})]});
  resources.set(PDFName.of('ColorSpace'),colors);
  const form=doc.context.register(doc.context.flateStream('',{Type:'XObject',Subtype:'Form',BBox:[0,0,151.2,151.2],Resources:resources}));
  page.node.set(PDFName.of('Resources'),doc.context.obj({XObject:{Nested:form}}));
  page.node.set(PDFName.of('TrimBox'),doc.context.register(doc.context.obj([9,9,142.2,142.2])));
  const nested=Buffer.from(await doc.save());assert.equal((await inspect(nested,line(nested))).verdict,'pass');
  page.node.set(PDFName.of('UserUnit'),doc.context.obj(2));await rejectsCode(measurePdf(Buffer.from(await doc.save()),'x','x'),'PDF_TRANSFORM_UNSUPPORTED');
  page.node.delete(PDFName.of('UserUnit'));page.node.set(PDFName.of('TrimBox'),doc.context.obj([0,0,-10,100]));
  await rejectsCode(measurePdf(Buffer.from(await doc.save()),'x','x'),'PDF_BOX_INVALID');
});

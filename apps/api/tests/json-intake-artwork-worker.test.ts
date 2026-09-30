import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFString,rgb} from 'pdf-lib';
import {createSandboxArtworkWorker} from '../src/json-intake/sandbox-artwork.js';
import {createPdfInspector} from '../src/json-intake/pdf-inspection.js';
import {JsonIntakeService,statusResponse} from '../src/json-intake/service.js';
import {sha256,stickerPressV1} from '../src/json-intake/adapter.js';
import type {Receipt,ReceiptStore} from '../src/json-intake/local-store.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const identity={customer_id:'test',customer_name:'Test',integration_id:'test-art',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
async function setup(count=1){
 const payload=structuredClone(fixture);payload.lines=payload.lines.slice(0,count);const bytes=Buffer.from('%PDF-test');
 for(const l of payload.lines){l.artwork.bytes=bytes.length;l.artwork.artwork_sha256=sha256(bytes);l.approval.artwork_sha256=sha256(bytes);l.artwork.artwork_expires_at='2099-01-01T00:00:00Z';}
 let current:Receipt|null=null;
 const store:ReceiptStore={get:async()=>structuredClone(current),create:async r=>{if(current)return false;current=structuredClone(r);return true;},compareAndSet:async(before,after)=>{if(current!.revision!==before.revision)return false;current=structuredClone(after);return true;},async *pending(){}};
 const {receipt}=await new JsonIntakeService(store,null,[stickerPressV1]).receive(identity,payload,Buffer.from(JSON.stringify(payload)));
 let reads=0,retains=0;
 const inspection:any={schema:'pathfinder.pdf-metadata-review.v1',sha256:sha256(bytes),engine:'test',policy_id:'test',verdict:'pass',findings:[],measured:{},comparison_tolerance_in:0.001,production_approved:false,cut_path_verified:false,malware_scanned:false};
 const transport={kind:'review-assets' as const,read:async()=>{reads++;return bytes;},retain:async()=>{retains++;return 'private-ref';},readRetained:async()=>bytes,inspect:async()=>inspection};
 return {store,receipt,transport,inspection,bytes,get:()=>current!,set:(r:Receipt)=>{current=r;},counts:()=>({reads,retains})};
}
test('worker checkpoints one line, completes all lines, is idempotent, exposes findings without paths',async()=>{
 const s=await setup(2),worker=createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'});
 assert.equal(await worker(s.receipt.receipt_id),'pending');assert.equal(s.get().asset_status,'pending');
 assert.equal(await worker(s.receipt.receipt_id),'complete');assert.equal(s.get().asset_status,'integrity_verified');
 assert.equal(await worker(s.receipt.receipt_id),'terminal');assert.deepEqual(s.counts(),{reads:2,retains:2});
 const response=JSON.stringify(statusResponse(s.get()));assert.ok(!response.includes('private-ref'));assert.equal(s.get().confirmation,undefined);
});
test('worker rejects other tenant, serializes claims and cannot clear terminal review',async()=>{
 const s=await setup(),wrong=createSandboxArtworkWorker({...s,customerId:'other',integrationId:'test-art'});
 assert.equal(await wrong(s.receipt.receipt_id),'out_of_scope');assert.equal(s.counts().reads,0);
 s.inspection.verdict='fail';s.inspection.findings=['PDF_RGB_PROFILE_MISSING'];
 const worker=createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'});
 const results=await Promise.all([worker(s.receipt.receipt_id),worker(s.receipt.receipt_id)]);
 assert.ok(results.includes('busy'));assert.equal(s.counts().reads,1);assert.equal(s.get().asset_status,'action_required');
 assert.equal(await worker(s.receipt.receipt_id),'terminal');
});
test('lease recovery reuses retained original, while crash budget prevents repeated fetch',async()=>{
 const s=await setup();const a={external_line_id:s.receipt.adapted.canonical.lines[0].source_line.external_line_id,sha256:sha256(s.bytes),bytes:s.bytes.length,retained_ref:'private-ref',inspection:'not_run' as const};
 s.set({...s.get(),assets:[a],claim:{token:'dead',until:'2000-01-01T00:00:00Z'},retry_attempts:1});
 const worker=createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'});
 assert.equal(await worker(s.receipt.receipt_id),'complete');assert.deepEqual(s.counts(),{reads:0,retains:0});
 const t=await setup();t.set({...t.get(),retry_attempts:3});
 assert.equal(await createSandboxArtworkWorker({...t,customerId:'test',integrationId:'test-art'})(t.receipt.receipt_id),'review');
 assert.equal(t.get().issues[0].code,'ASSET_RETRY_EXHAUSTED');assert.equal(t.counts().reads,0);
});
test('hash mismatch fails closed without retaining bytes',async()=>{
 const s=await setup();s.transport.read=async()=>Buffer.from('wrong');
 await createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'})(s.receipt.receipt_id);
 assert.equal(s.get().asset_status,'action_required');assert.equal(s.counts().retains,0);
});
test('RGB with no profile is held; old metadata-only policy stays unchanged',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([234,162]);page.setTrimBox(9,9,216,144);page.setBleedBox(0,0,234,162);
 page.drawRectangle({x:9,y:9,width:216,height:144,color:rgb(1,0,0)});
 const res=page.node.Resources()!;res.set(PDFName.of('ColorSpace'),doc.context.obj({Cut:[PDFName.of('Separation'),PDFName.of('Laser - Thru Cut'),PDFName.of('DeviceCMYK'),doc.context.obj({FunctionType:2,Domain:[0,1],C0:[0,0,0,0],C1:[1,0,0,0],N:1})]}));
 res.set(PDFName.of('Properties'),doc.context.obj({Cut:doc.context.obj({Type:'OCG',Name:PDFString.of('Laser - Thru Cut')})}));
 const bytes=Buffer.from(await doc.save());const line:any={source_line:{artwork:{page_in:{w:3.25,h:2.25},trim_in:{w:3,h:2}},cut:{spot_name:'Laser - Thru Cut',layer_name:'Laser - Thru Cut'}},dimensions:{bleed:0.125}};
 const reviewed=await createPdfInspector({policy_id:'new',metadata_tolerance_in:0.001,review_color:true})(bytes,line);
 assert.ok(reviewed.findings.includes('PDF_RGB_PROFILE_MISSING'));
 assert.equal((await createPdfInspector({policy_id:'legacy',metadata_tolerance_in:0.001})(bytes,line)).verdict,'pass');
});

test('access refresh of already-inspected review cannot leave status pending or erase findings',async()=>{
 const s=await setup();s.inspection.verdict='fail';s.inspection.findings=['PDF_RGB_PROFILE_MISSING'];
 const worker=createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'});
 await worker(s.receipt.receipt_id);
 s.set({...s.get(),work:'pending',asset_status:'pending'});
 assert.equal(await worker(s.receipt.receipt_id),'complete');assert.equal(s.get().asset_status,'action_required');assert.equal(s.counts().reads,1);
});

test('PDF lexical delimiters detect compact RGB operators and ignore strings, names, and comments',async()=>{
 const inspect=createPdfInspector({policy_id:'lexical-test',metadata_tolerance_in:0.001,review_color:true});
 const line:any={source_line:{artwork:{page_in:{w:3.25,h:2.25},trim_in:{w:3,h:2}},cut:{spot_name:'Laser - Thru Cut',layer_name:'Laser - Thru Cut'}},dimensions:{bleed:0.125}};
 async function check(content:string){
  const doc=await PDFDocument.create(),p=doc.addPage([234,162]);p.setTrimBox(9,9,216,144);p.setBleedBox(0,0,234,162);
  p.node.set(PDFName.of('Resources'),doc.context.obj({ColorSpace:{Cut:[PDFName.of('Separation'),PDFName.of('Laser - Thru Cut'),PDFName.of('DeviceCMYK'),doc.context.obj({FunctionType:2,Domain:[0,1],C0:[0,0,0,0],C1:[1,0,0,0],N:1})]},Properties:{Cut:doc.context.obj({Type:'OCG',Name:PDFString.of('Laser - Thru Cut')})}}));
  p.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(content)));
  return inspect(Buffer.from(await doc.save()),line);
 }
 for(const syntax of ['/DeviceRGB cs 1 0 0 scn','/#44eviceRGB CS 1 0 0 SCN','1 0 0 rg /Artifact BMC 9 9 216 144 re f EMC','1 0 0 rg/Artifact BMC 9 9 216 144 re f EMC','1 0 0 rg% comment\n/Artifact BMC 9 9 216 144 re f EMC'])assert.ok((await check(syntax)).findings.includes('PDF_RGB_PROFILE_MISSING'),syntax);
 for(const syntax of ['% 1 0 0 rg\n0 0 0 1 k','(1 0 0 rg) Tj','(escaped \\( 1 0 0 rg) Tj','<3120302030207267> Tj','/rg MP'])assert.equal((await check(syntax)).verdict,'pass',syntax);
 assert.ok((await check('BI /W 1 /H 1 ID 1 0 0 rg EI')).findings.includes('PDF_COLOR_REVIEW_REQUIRED'));
 assert.ok((await check('1 0 0rg')).findings.includes('PDF_COLOR_REVIEW_REQUIRED'));
});

test('terminal internal hold survives access URL refresh, while customer expiry can be repaired',async()=>{
 const s=await setup();s.transport.read=async()=>{throw Error('internal failure');};
 const worker=createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'});
 await worker(s.receipt.receipt_id);assert.equal(s.get().asset_status,'internal_action_required');
 async function refresh(t:Awaited<ReturnType<typeof setup>>){const p=structuredClone(t.get().adapted.evidence) as any;p.lines[0].artwork.download_url+='?fresh=1';p.lines[0].artwork.artwork_expires_at='2099-01-01T00:00:00Z';return new JsonIntakeService(t.store,null,[stickerPressV1]).receive(identity,p,Buffer.from(JSON.stringify(p)));}
 await refresh(s);assert.equal(s.get().work,'complete');assert.equal(s.get().asset_status,'internal_action_required');
 assert.equal(await worker(s.receipt.receipt_id),'terminal');
 const t=await setup();const p:any=structuredClone(t.get().adapted.evidence);p.lines[0].artwork.artwork_expires_at='2000-01-01T00:00:00Z';
 await new JsonIntakeService(t.store,null,[stickerPressV1]).receive(identity,p,Buffer.from(JSON.stringify(p)));
 const other=createSandboxArtworkWorker({...t,customerId:'test',integrationId:'test-art'});
 await other(t.receipt.receipt_id);assert.equal(t.get().issues[0].code,'ARTWORK_URL_EXPIRED');
 await refresh(t);await other(t.receipt.receipt_id);assert.equal(t.get().asset_status,'integrity_verified');assert.equal(t.get().issues.length,0);
});
test('mixed internal and customer issues remain internal-owned even after stale pending refresh',async()=>{
 const s=await setup();s.set({...s.get(),issues:[{issue_id:'a',code:'ARTWORK_WORKER_FAILED',field:'lines',owner:'internal',message:'x',corrective_action:'x'},{issue_id:'b',code:'PDF_RGB_PROFILE_MISSING',field:'lines',owner:'customer',message:'x',corrective_action:'x'}]});
 await createSandboxArtworkWorker({...s,customerId:'test',integrationId:'test-art'})(s.receipt.receipt_id);
 assert.equal(s.get().asset_status,'internal_action_required');assert.equal(s.get().work,'complete');assert.equal(s.counts().reads,0);assert.equal(s.get().issues.length,2);
});

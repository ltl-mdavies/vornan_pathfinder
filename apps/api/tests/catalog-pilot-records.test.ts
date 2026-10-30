import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import request from 'supertest';
import {CatalogRecordService} from '../src/catalog-records/service.js';
import {LocalCatalogDraftRepository} from '../src/catalog-records/local-store.js';
import {configuredCatalogRecordRouter} from '../src/catalog-records/configured-router.js';
import {catalogCustomerAccess} from '../src/catalog-records/customer-access.js';
import {reviewedDataHash} from '../src/catalog-records/content-hash.js';
const customer={id:'synthetic-a',name:'Example A',source:'standard-v1'};
const rows=[{row:2,raw:{'Customer Number':customer.id,'Source ID':'sample-1',SKU:'DEMO-001',Name:'Sample label',Product:'Label',Width:'2',Height:'3',Material:'Example substrate',Laminate:'None',Varnish:'None','Cut Type':'Laser',Shape:'Square/Rectangle','Corner Radius':'1/8','Spacing (in)':'0.125','White Ink Required':'No',Unwind:'3-Right','Roll Mode':'Max Labels per Roll','Roll Value':'1000','Unit Price':'0.01234',Approval:'pending','Artwork URL':'https://example.test/art.pdf'}}];
const importBody={expectedRevision:0,operation:{kind:'import',name:'synthetic.csv',rows}};
async function setup(t:any){const root=await mkdtemp(join(tmpdir(),'catalog-pilot-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));const repo=new LocalCatalogDraftRepository(root);return {root,repo,service:new CatalogRecordService(repo,{customer})};}
const edit=(record:any,price='0.01235')=>({expectedRevision:record.revision,operation:{kind:'edit-item',itemKey:record.catalog.items[0].key,expectedItemRevision:record.catalog.items[0].revision,data:{...record.catalog.items[0].data,price},reasonId:'pricing-update',details:'Synthetic pricing review'}});
test('generic import/edit/restart retains actor, price, artwork link and exact immutable history',async t=>{
 const {root,service}=await setup(t);const first=await service.apply(importBody,'import-key-0001','editor-a');assert.equal(first.catalog.items.length,1);
 const saved=await service.apply(edit(first),'edit-key-000001','editor-a');assert.equal(saved.catalog.items[0].data.artwork,rows[0].raw['Artwork URL']);assert.equal(saved.catalog.items[0].history.at(-1)?.actor,'editor-a');
 const reopened=new CatalogRecordService(new LocalCatalogDraftRepository(root),{customer});assert.equal((await reopened.current())?.catalog.items[0].data.price,'0.01235');assert.equal((await reopened.history()).length,2);
 assert.equal((await reopened.operationStatus('edit-key-000001','editor-a')).status,'recorded');assert.equal((await reopened.operationStatus('edit-key-000001','other')).status,'unconfirmed');
});
test('repeat import, exact replay, altered replay and competing revisions preserve one item and one winning write',async t=>{
 const {service,repo}=await setup(t);let first=await service.apply(importBody,'import-key-0001','editor-a');first=await service.apply({...importBody,expectedRevision:1},'import-key-0002','editor-a');assert.equal(first.catalog.items.length,1);
 const body=edit(first);const saved=await service.apply(body,'edit-key-000001','editor-a');const replay=await service.apply(body,'edit-key-000001','editor-a');assert.equal(replay.replayed,true);assert.equal(replay.revision,saved.revision);
 await assert.rejects(service.apply(edit(first,'0.01236'),'edit-key-000001','editor-a'),(e:any)=>e.code==='idempotency_conflict');await assert.rejects(service.apply(body,'edit-key-000002','editor-a'),(e:any)=>e.code==='revision_conflict');
 const other=new CatalogRecordService(repo,{customer});const race=await Promise.allSettled([service.apply(edit(saved,'0.01237'),'race-key-000001','editor-a'),other.apply(edit(saved,'0.01238'),'race-key-000002','editor-b')]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
});
test('PO receipt is a saved reconciliation only; foreign imports and artwork/approval changes fail closed',async t=>{
 const {service}=await setup(t);const first=await service.apply(importBody,'import-key-0001','editor-a');
 const po={number:'SYNTHETIC-PO',customerName:customer.name,filename:'synthetic.csv',format:'Standard PO v1',sourceText:'fixture',header:{},issues:[],lines:[{row:2,sku:'DEMO-001',description:'Sample',quantity:1000,price:'0.01234',amount:'12.34',width:'2',height:'3',uom:'EA'}]};
 const result=await service.apply({expectedRevision:1,operation:{kind:'record-po',po}},'receipt-key-0001','editor-a');assert.equal(result.catalog.receipts[0].total,'12.34');assert.equal(result.submissionEnabled,false);
 for(const patch of [{artwork:'https://example.test/replaced.pdf'},{approval:'approved'},{artworkVersion:'spoofed'}]){const b=edit(result);Object.assign(b.operation.data,patch);await assert.rejects(service.apply(b,'reject-key-00001','editor-a'));}
 const foreign={...importBody,expectedRevision:2,operation:{...importBody.operation,rows:[{row:2,raw:{...rows[0].raw,'Customer Number':'synthetic-b'}}]}};await assert.rejects(service.apply(foreign,'foreign-key-0001','editor-a'),(e:any)=>e.code==='invalid_import');
 assert.equal((await service.current())?.revision,2);
});
test('configured routes keep disabled/default/unsupported flows shut and enforce editor/reader/customer grants',async t=>{
 const {repo}=await setup(t);let reads=0;const env={PATHFINDER_CATALOG_DRAFT_TABLE:'synthetic-table',PATHFINDER_CATALOG_DRAFT_BUCKET:'synthetic-bucket',PATHFINDER_CATALOG_DRAFT_PREFIX:'catalog-drafts/pilot/',PATHFINDER_ENABLE_CATALOG_DRAFTS:'true',PATHFINDER_ENABLE_CATALOG_RECORDS:'true',PATHFINDER_CATALOG_CUSTOMER_ACCESS:JSON.stringify([{customer,editors:['editor-a'],readers:['reader-a']}])};
 function app(config:any){const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.header('test-uid'))res.locals.authUser={uid:req.header('test-uid')};next();});app.use('/api',configuredCatalogRecordRouter(config,{repository:()=>{reads++;return repo;}}));app.get('/unrelated',(_req,res)=>res.json({ok:true}));return app;}
 const route=`/api/customers/${customer.id}/catalog-records`;
 await request(app({})).get(route).expect(423);assert.equal(reads,0);
 await request(app({PATHFINDER_CATALOG_CUSTOMER_ACCESS:'invalid'})).get(route).expect(423);
 for(const config of [{...env,PATHFINDER_CATALOG_CUSTOMER_ACCESS:'malformed-secret-value'},{...env,PATHFINDER_CATALOG_CUSTOMER_ACCESS:undefined},{...env,PATHFINDER_CATALOG_DRAFT_TABLE:''},{...env,PATHFINDER_CATALOG_DRAFT_BUCKET:''},{...env,PATHFINDER_CATALOG_DRAFT_PREFIX:'outside-scope/'}]){const instance=app(config);const response=await request(instance).get(route).expect(503);assert.equal(response.body.code,'catalog_configuration_unavailable');assert.equal(JSON.stringify(response.body).includes('malformed-secret-value'),false);await request(instance).get('/unrelated').expect(200);}
 assert.equal(reads,0);
 const active=app(env);await request(active).get(route).expect(401);await request(active).get(route).set('test-uid','ungranted').expect(403);await request(active).get(route.replace(customer.id,'synthetic-b')).set('test-uid','editor-a').expect(403);assert.equal(reads,0);
 const reader=await request(active).get(route).set('test-uid','reader-a').expect(200);assert.equal(reader.body.capabilities.edit,false);
 await request(active).post(route).set('test-uid','reader-a').send(importBody).expect(403);
 await request(active).post(route).set('test-uid','editor-a').set('Idempotency-Key','import-key-0001').send(importBody).expect(200);
 await request(active).post(route+'/submit').set('test-uid','editor-a').send({}).expect(423);
 await request(active).post(route.replace('catalog-records','catalog-drafts')).set('test-uid','editor-a').send({}).expect(423);
 assert.throws(()=>catalogCustomerAccess({PATHFINDER_CATALOG_CUSTOMER_ACCESS:JSON.stringify([{customer:{...customer,source:'legacy'},editors:['editor-a'],readers:[]}])}));
});
test('content hashing retains deterministic old evidence representation and rejects nonfinite values',()=>{
 assert.equal(reviewedDataHash({b:2,a:1,unused:undefined}),reviewedDataHash({a:1,b:2}));assert.notEqual(reviewedDataHash([1,2]),reviewedDataHash([2,1]));assert.throws(()=>reviewedDataHash({a:NaN}));
});
test('near-capacity manifest rejects the next commit without changing catalog, history or prior receipts',async()=>{
 const {CloudCatalogDraftRepository}=await import('../src/catalog-records/cloud-store.js');
 let item:any;const blobs=new Map<string,string>();let writes=0;
 const dynamo={send:async(command:any)=>{const c=command.input;if(!c.Item)return item?{Item:structuredClone(item)}:{};writes++;item=structuredClone(c.Item);return {};}};
 const s3={send:async(command:any)=>{const c=command.input;if(c.Body!==undefined){blobs.set(c.Key,c.Body);return {};}return {Body:{transformToString:async()=>blobs.get(c.Key)!}};}};
 const repo=new CloudCatalogDraftRepository({table:'synthetic-table',bucket:'synthetic-bucket',prefix:'catalog-drafts/pilot/',kind:'catalog',customerId:customer.id},dynamo,s3);
 const service=new CatalogRecordService(repo,{customer});const first=await service.apply(importBody,'import-key-0001','editor-a');
 const state=await repo.read(),prior=Object.values(state.requests)[0];let counter=0;
 for(;;){const key=reviewedDataHash({counter:counter++});state.requests[key]=prior;if(Buffer.byteLength(JSON.stringify(state))>349900){delete state.requests[key];break;}}
 item.document.S=JSON.stringify(state);const before=item.document.S,bytes=Buffer.byteLength(before),history=await service.history(),receipt=await service.operationStatus('import-key-0001','editor-a');
 assert.ok(bytes>349500&&bytes<=350000);const writesBefore=writes;
 await assert.rejects(service.apply(edit(first),'capacity-key-0001','editor-a'),/capacity requires storage migration/);
 assert.equal(item.document.S,before);assert.equal(writes,writesBefore);assert.deepEqual(await service.history(),history);assert.deepEqual(await service.operationStatus('import-key-0001','editor-a'),receipt);assert.equal((await service.current())!.revision,1);assert.equal((await service.operationStatus('capacity-key-0001','editor-a')).status,'unconfirmed');
});

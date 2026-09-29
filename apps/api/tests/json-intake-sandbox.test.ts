import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {DurableReceiptStore} from '../src/json-intake/durable-receipts.js';
import {createSandboxHandler} from '../src/json-intake/sandbox-lambda.js';
import {JsonIntakeService} from '../src/json-intake/service.js';
import {sha256,stickerPressV1} from '../src/json-intake/adapter.js';
const sample=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const identity={customer_id:'synthetic',customer_name:'Synthetic',integration_id:'test-sandbox',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
const token='synthetic_only_token_not_for_use_123456';
const now=()=> '2026-09-29T12:00:00Z';
function fixture(){
 const items=new Map<string,any>(),objects=new Map<string,Buffer>();let failTransaction=false;
 const dynamo={send:async(c:any)=>{
  const x=c.input;
  if(c.constructor.name==='GetItemCommand')return {Item:structuredClone(items.get(x.Key.pk.S+'/'+x.Key.sk.S))};
  assert.equal(c.constructor.name,'TransactWriteItemsCommand');
  if(failTransaction)throw new Error('Synthetic durable write failure');
  const writes=x.TransactItems.map((t:any)=>t.Put);
  const failures=writes.map((w:any)=>{
   const old=items.get(w.Item.pk.S+'/'+w.Item.sk.S);
   return w.ConditionExpression==='attribute_not_exists(pk)'?!!old:!old||old.revision.N!==w.ExpressionAttributeValues[':before'].N||old.sha256.S!==w.ExpressionAttributeValues[':sha'].S;
  });
  if(failures.some(Boolean))throw {name:'TransactionCanceledException',CancellationReasons:failures.map((f:boolean)=>({Code:f?'ConditionalCheckFailed':'None'}))};
  for(const w of writes)items.set(w.Item.pk.S+'/'+w.Item.sk.S,structuredClone(w.Item));return {};
 }};
 const s3={send:async(c:any)=>{
  const x=c.input;
  if(c.constructor.name==='PutObjectCommand'){assert.equal(x.IfNoneMatch,'*');if(objects.has(x.Key))throw {name:'PreconditionFailed'};objects.set(x.Key,Buffer.from(x.Body));return {};}
  assert.equal(c.constructor.name,'GetObjectCommand');return {Body:{transformToByteArray:async()=>{if(!objects.has(x.Key))throw new Error('Missing');return objects.get(x.Key)!;}}};
 }};
 const store=new DurableReceiptStore('synthetic-table','synthetic-bucket',dynamo,s3),service=new JsonIntakeService(store,null,[stickerPressV1],now);
 let enabled=true;
 const handler=createSandboxHandler({enabled:()=>enabled,service,credentials:async()=>[{token_sha256:sha256(token),identity,expires_at:'2026-10-10T00:00:00Z',revoked:false,scopes:['orders:write','orders:read']}]});
 const post=(body:unknown=sample,auth=token)=>handler({rawPath:'/api/v1/intake/orders',requestContext:{http:{method:'POST'}},headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)});
 return {store,service,handler,post,items,objects,dynamo,s3,setFail:(v:boolean)=>failTransaction=v,disable:()=>enabled=false};
}
test('isolated sandbox durably accepts/replays concurrent orders and reads across store instances',async()=>{
 const f=fixture();const responses=await Promise.all([f.post(),f.post()]);assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,202]);
 const a=JSON.parse(responses[0].body),b=JSON.parse(responses[1].body);assert.equal(a.receipt_id,b.receipt_id);
 const restarted=new DurableReceiptStore('synthetic-table','synthetic-bucket',f.dynamo,f.s3);assert.equal((await restarted.get(a.receipt_id))?.revision,0);
 const status=await f.handler({rawPath:a.status_url,requestContext:{http:{method:'GET'}},headers:{Authorization:`Bearer ${token}`}});
 assert.equal(status.statusCode,200);assert.equal(JSON.parse(status.body).lift_order_number,null);
 assert.ok(!status.body.includes('download_url'));assert.equal(f.items.size,2);
 await assert.rejects(f.service.process(a.receipt_id,{} as any),/Receipt-only/);
});
test('auth, disabled routes, invalid schema and changed business order never overwrite receipts',async()=>{
 const f=fixture();assert.equal((await f.post(sample,'bad')).statusCode,401);assert.equal(f.items.size,0);
 assert.equal((await f.post({...sample,schema:'bad'})).statusCode,422);assert.equal(f.items.size,0);
 const accepted=JSON.parse((await f.post()).body),changed=structuredClone(sample);changed.order.order_title='changed';
 assert.equal((await f.post(changed)).statusCode,409);assert.equal((await f.store.get(accepted.receipt_id))?.revision,0);
 await assert.rejects(f.service.lookup({...identity,customer_id:'other'},accepted.receipt_id),/NOT_FOUND/);
 f.disable();assert.equal((await f.post()).statusCode,404);
 const health=await f.handler({rawPath:'/health',requestContext:{http:{method:'GET'}}});assert.equal(JSON.parse(health.body).lift_submission_enabled,false);
});
test('failed transaction cannot acknowledge acceptance and orphaned evidence can recover safely',async()=>{
 const f=fixture();f.setFail(true);assert.equal((await f.post()).statusCode,503);assert.equal(f.items.size,0);assert.equal(f.objects.size,1);
 f.setFail(false);assert.equal((await f.post()).statusCode,202);assert.equal(f.objects.size,1);
});
test('receipt history CAS rejects stale and forged versions and detects corrupted S3 bytes',async()=>{
 const f=fixture();const id=JSON.parse((await f.post()).body).receipt_id,before=(await f.store.get(id))!;
 const after={...before,revision:1,updated_at:'2026-09-29T12:01:00Z'};
 assert.equal(await f.store.compareAndSet(before,after),true);assert.equal(await f.store.compareAndSet(before,{...after,updated_at:'2026-09-29T12:02:00Z'}),false);
 assert.equal((await f.store.get(id))?.updated_at,after.updated_at);assert.equal(f.items.size,3);
 const key=f.items.get(id+'/latest').object_key.S;f.objects.set(key,Buffer.from('corrupt'));
 await assert.rejects(f.store.get(id),/Corrupt receipt/);
});
test('sandbox enforces JSON and size limits and never exposes internal errors',async()=>{
 const f=fixture(),base={rawPath:'/api/v1/intake/orders',requestContext:{http:{method:'POST'}},headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}};
 assert.equal((await f.handler({...base,body:'{'})).statusCode,400);
 assert.equal((await f.handler({...base,body:'x'.repeat(1024*1024+1)})).statusCode,413);
 assert.equal((await f.handler({...base,body:'{}',headers:{authorization:`Bearer ${token}`}})).statusCode,415);
 assert.equal((await f.handler({...base,body:Buffer.from(JSON.stringify(sample)).toString('base64'),isBase64Encoded:true})).statusCode,202);
});

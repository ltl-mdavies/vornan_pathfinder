/** Explicit operator bridge for the approved release-button test. Defaults to read-only preparation.
 * --apply inserts one Waiting job and a disabled test profile on only the Ecomm route.
 * No network request is sent to Lift and no receipt/callback state is changed.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareReceiptSubmissionJob,receiptJobIdentity,assertReceiptJobReplay,stickerPressTestProfile} from '../apps/api/src/json-intake/submission-job.js';
import {stickerPressLiftRouteId} from '../apps/api/src/json-intake/stickerpress-lift-configuration.js';
import {sha256,stableJson} from '../apps/api/src/json-intake/adapter.js';
import type {Receipt} from '../apps/api/src/json-intake/local-store.js';
const apply=process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(x=>x==='--apply'),'Only --apply is supported');
const receiptId='rcpt_1b05a005e1fe64e71a8515dace68753d77c96d727f414d3e07145fb5b767567f';
const customer='174094',region='us-east-1';
const root=resolve('outputs/stickerpress-submission-2026-10-16');await mkdir(root,{recursive:true,mode:0o700});
const aws=(...args:string[])=>JSON.parse(execFileSync('aws',[...args,'--region',region,'--output','json'],{encoding:'utf8',maxBuffer:8*1024*1024})||'{}');
const save=async(n:string,x:unknown)=>writeFile(resolve(root,n),JSON.stringify(x,null,2)+'\n',{mode:0o600});
const get=(table:string,key:Record<string,string>)=>aws('dynamodb','get-item','--table-name',table,'--key',JSON.stringify(Object.fromEntries(Object.entries(key).map(([k,v])=>[k,{S:v}]))),'--consistent-read').Item;
const query=(table:string,c:string)=>aws('dynamodb','query','--table-name',table,'--key-condition-expression','customer_id = :c','--expression-attribute-values',JSON.stringify({':c':{S:c}}),'--consistent-read').Items;
const data=(item:any)=>JSON.parse(item.data.S);
const runtime=aws('lambda','get-function-configuration','--function-name','vornan-pathfinder-api-prod','--query','Environment.Variables.{namespace:PATHFINDER_TABLE_NAMESPACE,targets:PATHFINDER_TARGETS_TABLE}');
assert.equal(runtime.namespace,'1|Pathfinder|prod');assert.equal(runtime.targets,'Pathfinder-Targets-prod');
const params=aws('cloudformation','describe-stacks','--stack-name','vornan-pathfinder-json-intake-webhooks','--query','Stacks[0].Parameters');
const param=(name:string)=>params.find((p:any)=>p.ParameterKey===name)?.ParameterValue;
assert.equal(param('CustomerId'),customer);assert.equal(param('IntegrationId'),'stickerpress-sandbox');
const receiptTable=param('ReceiptTable'),bucket=param('ReceiptBucket');assert.ok(receiptTable&&bucket);
const pointer=get(receiptTable,{pk:receiptId,sk:'latest'});assert.ok(pointer);
const receiptFile=resolve(root,'receipt.private.json');
await writeFile(receiptFile,'',{mode:0o600});
aws('s3api','get-object','--bucket',bucket,'--key',pointer.object_key.S,receiptFile);
const raw=await readFile(receiptFile);assert.equal(sha256(raw),pointer.sha256.S);
const receipt=JSON.parse(raw.toString()) as Receipt;assert.equal(receipt.receipt_id,receiptId);
assert.equal(receipt.revision,Number(pointer.revision.N));assert.equal(receipt.identity.customer_id,customer);
assert.equal(receipt.identity.integration_id,'stickerpress-sandbox');assert.equal(receipt.identity.environment,'test');
assert.equal(receipt.adapted.canonical.source.source_record_id,'SPM-D2611133');
const identity=receiptJobIdentity(receipt),jobKey={customer_id:customer,job_id:identity.job_id};
const existing=get('Pathfinder-Jobs-prod',jobKey);
if(existing){
 const job=assertReceiptJobReplay(data(existing),receipt);
 const result={replayed:true,job_id:job.job_id,pathfinder_order_id:job.pathfinder_order_id,state:job.state,receipt_id:receiptId,submitted:false};
 await save('replay.json',result);console.log(JSON.stringify(result));
}else{
 const customerJobs=query('Pathfinder-Jobs-prod',customer);
 assert.ok(!customerJobs.some((i:any)=>data(i).lift_payload?.order?.ext_id===receipt.adapted.canonical.order.external_order_id),'Reconcile existing job before preparing');
 const before={target:get(runtime.targets,{target_id:'lift-standard-graphics'}),
  route:get('Pathfinder-OutputRoutes-prod',{customer_id:customer,output_route_id:stickerPressLiftRouteId}),
  product:get('Pathfinder-ProductMappings-prod',{customer_route_id:customer+'#'+stickerPressLiftRouteId,mapping_id:'mapping-stickerpress-sticker-374549'}),
  ownHighEnd:get('Pathfinder-OutputRoutes-prod',{customer_id:customer,output_route_id:'route-ltl-lift-91-standard-graphics'}),
  momentaraHighEnd:get('Pathfinder-OutputRoutes-prod',{customer_id:'284619',output_route_id:'route-ltl-lift-91-standard-graphics'})};
 await save('before.private.json',before);
 const target=data(before.target),route=data(before.route),product=data(before.product);
 const template=target.output_templates.find((t:any)=>t.output_template_id===route.output_template_id);
 assert.equal(route.status,'Draft');assert.equal(template.status,'Draft');
 assert.equal(route.customer_id,customer);assert.equal(product.customer_id,customer);
 const timestamp=new Date().toISOString();
 const existingProfile=route.submit_profiles.find((p:any)=>p.profile_id===stickerPressTestProfile.profile_id);
 if(existingProfile)assert.deepEqual(existingProfile,stickerPressTestProfile);
 else route.submit_profiles.push(stickerPressTestProfile);
 route.updated_at=timestamp;
 const scope=`${customer}/${receipt.identity.integration_id}/${receiptId}`;
 for(const [index,asset] of receipt.assets.entries()){
  assert.equal(asset.retained_ref,`worker-originals/${sha256(scope)}/${asset.sha256}.pdf`);
  const file=resolve(root,`verify-artwork-${index}.private.pdf`);await writeFile(file,'',{mode:0o600});
  try{aws('s3api','get-object','--bucket',bucket,'--key',asset.retained_ref,file);
   const bytes=await readFile(file);assert.equal(bytes.length,asset.bytes);assert.equal(sha256(bytes),asset.sha256);
  }finally{await rm(file,{force:true});}
 }
 const job=prepareReceiptSubmissionJob(receipt,{target,route,template,product,order_date_format:target.lift.order_date_format},new Date(timestamp));
 assert.equal(job.lift_payload.lines.length,3);
 await save('job.private.json',job);
 const item=(keys:Record<string,string>,value:unknown)=>({...Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,{S:v}])),data:{S:JSON.stringify(value)},updated_at:{S:timestamp}});
 const check=(table:string,key:Record<string,string>,original:any)=>({ConditionCheck:{TableName:table,Key:Object.fromEntries(Object.entries(key).map(([k,v])=>[k,{S:v}])),ConditionExpression:'#d = :before',ExpressionAttributeNames:{'#d':'data'},ExpressionAttributeValues:{':before':original.data}}});
 const transaction={ClientRequestToken:sha256(identity.job_id+timestamp).slice(0,36),TransactItems:[
  {Put:{TableName:'Pathfinder-Jobs-prod',Item:item(jobKey,job),ConditionExpression:'attribute_not_exists(customer_id) AND attribute_not_exists(job_id)'}},
  {Put:{TableName:'Pathfinder-OrderIds-prod',Item:{pathfinder_order_id:{S:job.pathfinder_order_id},created_at:{S:timestamp}},ConditionExpression:'attribute_not_exists(pathfinder_order_id)'}},
  {Put:{TableName:'Pathfinder-OutputRoutes-prod',Item:item({customer_id:customer,output_route_id:route.output_route_id},route),ConditionExpression:'#d = :before',ExpressionAttributeNames:{'#d':'data'},ExpressionAttributeValues:{':before':before.route.data}}},
  check(runtime.targets,{target_id:target.target_id},before.target),
  check('Pathfinder-ProductMappings-prod',{customer_route_id:customer+'#'+route.output_route_id,mapping_id:product.mapping_id},before.product),
  {ConditionCheck:{TableName:receiptTable,Key:{pk:{S:receiptId},sk:{S:'latest'}},ConditionExpression:'#sha = :sha',ExpressionAttributeNames:{'#sha':'sha256'},ExpressionAttributeValues:{':sha':pointer.sha256}}}
 ]};
 await save('transaction.private.json',transaction);
 if(apply){
  aws('dynamodb','transact-write-items','--cli-input-json','file://'+resolve(root,'transaction.private.json'));
  const saved=get('Pathfinder-Jobs-prod',jobKey);assert.equal(stableJson(data(saved)),stableJson(job));await save('job-saved.private.json',saved);
  assert.deepEqual(get(runtime.targets,{target_id:target.target_id}),before.target);
  assert.deepEqual(get('Pathfinder-OutputRoutes-prod',{customer_id:customer,output_route_id:'route-ltl-lift-91-standard-graphics'}),before.ownHighEnd);
  assert.deepEqual(get('Pathfinder-OutputRoutes-prod',{customer_id:'284619',output_route_id:'route-ltl-lift-91-standard-graphics'}),before.momentaraHighEnd);
  assert.deepEqual(data(get('Pathfinder-OutputRoutes-prod',{customer_id:customer,output_route_id:route.output_route_id})),route);
 }
 const summary={persisted:apply,replayed:false,job_id:job.job_id,pathfinder_order_id:job.pathfinder_order_id,receipt_id:receiptId,
  order:'SPM-D2611133',lines:job.lift_payload.lines.length,product:'374549',state:job.state,artwork_hashes_verified:receipt.assets.length,
  existing_high_end_routes_unchanged:apply,target_and_templates_unchanged:apply,submitted:false,
  pending:['Publish and verify retained original delivery URLs','Review exact request and enable only Ecomm test route/profile','Controlled Lift import']};
 await save(apply?'result.json':'plan.json',summary);console.log(JSON.stringify(summary,null,2));
}

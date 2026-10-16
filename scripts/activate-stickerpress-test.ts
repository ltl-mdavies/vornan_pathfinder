/** Conditional activation of one existing reviewed test job; no Lift submission.
 * --apply requires the verified deployed API package SHA in --api-code-sha=... . */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {preflightArtwork} from '../apps/api/src/json-intake/artwork-delivery.js';
import {sha256,stableJson} from '../apps/api/src/json-intake/adapter.js';
import {prepareLiftEcommercePayload,generateLiftPayload} from '@pathfinder/lift-adapter';
const root='outputs/stickerpress-artwork-2026-10-16';
const apply=process.argv.includes('--apply'),expectedSha=process.argv.find(a=>a.startsWith('--api-code-sha='))?.slice(15);
assert.ok(process.argv.slice(2).every(a=>a==='--apply'||a.startsWith('--api-code-sha=')));
const aws=(...args:string[])=>JSON.parse(execFileSync('aws',[...args,'--region','us-east-1','--output','json'],{encoding:'utf8',maxBuffer:8*1024*1024})||'{}');
const key=(value:Record<string,string>)=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,{S:v}]));
const get=(table:string,k:Record<string,string>)=>aws('dynamodb','get-item','--table-name',table,'--key',JSON.stringify(key(k)),'--consistent-read').Item;
const data=(i:any)=>JSON.parse(i.data.S),save=async(n:string,v:any)=>writeFile(root+'/'+n,JSON.stringify(v,null,2)+'\n',{mode:0o600});
const review=JSON.parse(await readFile(root+'/review-job.private.json','utf8'));
const jobKey={customer_id:'174094',job_id:review.job_id},routeKey={customer_id:'174094',output_route_id:'route-ltl-lift-91-ecomm-orders'};
const productKey={customer_route_id:'174094#'+routeKey.output_route_id,mapping_id:'mapping-stickerpress-sticker-374549'};
const before={job:get('Pathfinder-Jobs-prod',jobKey),route:get('Pathfinder-OutputRoutes-prod',routeKey),target:get('Pathfinder-Targets-prod',{target_id:'lift-standard-graphics'}),
 product:get('Pathfinder-ProductMappings-prod',productKey),
 ownHighEnd:get('Pathfinder-OutputRoutes-prod',{customer_id:'174094',output_route_id:'route-ltl-lift-91-standard-graphics'}),
 momentaraHighEnd:get('Pathfinder-OutputRoutes-prod',{customer_id:'284619',output_route_id:'route-ltl-lift-91-standard-graphics'})};
const receiptTable='vornan-pathfinder-json-intake-sandbox-Receipts-IMH58R7YQ41Y';
const receiptKey={pk:review.json_intake_binding.receipt_id,sk:'latest'},pointer=get(receiptTable,receiptKey);
assert.equal(Number(pointer.revision.N),review.json_intake_binding.receipt_revision,'Receipt changed; review again');
const original=JSON.parse(await readFile(root+'/job-before.private.json','utf8'));
assert.equal(before.job.data.S,original.data.S,'Job changed; reconcile before activation');
const attempts=aws('dynamodb','query','--table-name','Pathfinder-SubmitAttempts-prod','--key-condition-expression','customer_id = :c','--expression-attribute-values',JSON.stringify({':c':{S:'174094'}}),'--consistent-read').Items;
assert.ok(!attempts.some((a:any)=>data(a).job_id===review.job_id),'Existing submit attempt requires reconciliation');
const target=data(before.target),route=data(before.route),product=data(before.product),job=structuredClone(review);
assert.equal(route.status,'Draft');assert.equal(route.environment_id,'env-lift-prod');assert.equal(route.company_id,'91');assert.equal(product.lift_product_id,'374549');assert.equal(product.status,'Mapped');
const template=target.output_templates.find((t:any)=>t.output_template_id===route.output_template_id);assert.equal(template.output_template_id,'template-lift-ecommerce-orders');assert.equal(template.status,'Draft');
const prepared=prepareLiftEcommercePayload({template_id:template.output_template_id,base:generateLiftPayload(job.canonical_order,{jobId:job.job_id,canonicalOrderId:`co_${job.job_id}`,pathfinderOrderId:job.pathfinder_order_id,extIdStrategy:'customer_order_id'}),canonical:job.canonical_order,source:job.canonical_order,order_mappings:template.canonical_mappings,order_date_format:target.lift.order_date_format,validation_options:{product_identifier_type:'lift_product_id'}});
assert.equal(stableJson(prepared.payload),stableJson(review.lift_payload),'Current template does not reproduce reviewed payload');
assert.ok(!prepared.validation.some(v=>v.severity==='FAIL'));assert.ok(!job.canonical_validation.some((v:any)=>v.severity==='FAIL'));
const runtime=aws('lambda','get-function-configuration','--function-name','vornan-pathfinder-api-prod');
if(apply){assert.ok(expectedSha,'Verified deployed API SHA required');assert.equal(runtime.CodeSha256,expectedSha);}
const env=runtime.Environment.Variables;
const preflight=await preflightArtwork({job,publication_enabled:env.PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION==='true',delivery_bucket_name:env.PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET,manifest_bucket_name:env.PATHFINDER_SOURCE_EVIDENCE_BUCKET});
assert.equal(preflight?.documents.length,3);
const timestamp=new Date().toISOString();
route.status='Active';route.updated_at=timestamp;route.submit_profiles=route.submit_profiles.map((p:any)=>({...p,enabled:p.profile_id==='sandbox-stickerpress-174094'}));
template.status='Active';template.updated_at=timestamp;target.updated_at=timestamp;
job.state='Ready';job.lift_validation=prepared.validation;job.updated_at=timestamp;delete job.submit_integrity;
job.submit_certification={can_submit:false,external_submit_enabled:false,summary:'Artwork and exact payload verified; refresh normal API certification to use current connection settings.',items:[{item_id:'review-refresh',label:'Refresh certification',status:'Blocked',blocking:true,message:'Review the final request through the normal API.'}]};
const put=(table:string,k:Record<string,string>,value:any,old:any)=>({Put:{TableName:table,Item:{...old,...key(k),data:{S:JSON.stringify(value)},updated_at:{S:timestamp}},ConditionExpression:'#d = :old',ExpressionAttributeNames:{'#d':'data'},ExpressionAttributeValues:{':old':old.data}}});
const check=(table:string,k:Record<string,string>,old:any)=>({ConditionCheck:{TableName:table,Key:key(k),ConditionExpression:'#d = :old',ExpressionAttributeNames:{'#d':'data'},ExpressionAttributeValues:{':old':old.data}}});
const tx={ClientRequestToken:sha256(timestamp+job.job_id).slice(0,36),TransactItems:[put('Pathfinder-Jobs-prod',jobKey,job,before.job),put('Pathfinder-OutputRoutes-prod',routeKey,route,before.route),put('Pathfinder-Targets-prod',{target_id:target.target_id},target,before.target),check('Pathfinder-ProductMappings-prod',productKey,before.product),{ConditionCheck:{TableName:receiptTable,Key:key(receiptKey),ConditionExpression:'#s = :s',ExpressionAttributeNames:{'#s':'sha256'},ExpressionAttributeValues:{':s':pointer.sha256}}}]};
await save('activation-before.private.json',before);await save('activation-transaction.private.json',tx);await save('preflight.private.json',preflight);
if(apply){aws('dynamodb','transact-write-items','--cli-input-json','file://'+process.cwd()+'/'+root+'/activation-transaction.private.json');
 assert.equal(get('Pathfinder-OutputRoutes-prod',{customer_id:'174094',output_route_id:'route-ltl-lift-91-standard-graphics'}).data.S,before.ownHighEnd.data.S);
 assert.equal(get('Pathfinder-OutputRoutes-prod',{customer_id:'284619',output_route_id:'route-ltl-lift-91-standard-graphics'}).data.S,before.momentaraHighEnd.data.S);
 const after=data(get('Pathfinder-Targets-prod',{target_id:target.target_id})),prior=data(before.target);
 delete after.updated_at;delete prior.updated_at;after.output_templates=after.output_templates.filter((t:any)=>t.output_template_id!==template.output_template_id);prior.output_templates=prior.output_templates.filter((t:any)=>t.output_template_id!==template.output_template_id);assert.deepEqual(after,prior);
 assert.deepEqual(data(get('Pathfinder-Jobs-prod',jobKey)),job);
}
const result={activated:apply,job_id:job.job_id,order:'SPM-D2611133',files_verified:preflight?.documents.length,payload_sha256:sha256(stableJson(job.lift_payload)),lift_submitted:false,high_end_unchanged:apply,normal_api_certification_required:true};await save('activation-result.json',result);console.log(JSON.stringify(result,null,2));

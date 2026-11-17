import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { DynamoDBClient, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { decodeDynamoRecord, encodeJobDynamoItem, jobDynamoItemBytes, JobStorageError } from "../src/job-dynamo-codec.js";
import type { ProcessingJobPreview, ImportMethod, SubmitAttempt } from "../src/store.js";

type Item = Record<string, AttributeValue>;
const tables = new Map<string, Map<string, Item>>(), writes: any[] = [];
const timestamp = "2026-11-17T18:00:00.000Z";
const customer = { lift_customer_id: "284619", customer_name: "Synthetic", customer_number: "284619", customer_status: "Active", contacts: [] } as any;
let store: typeof import("../src/store.js"), job: ProcessingJobPreview;
const originalSend = DynamoDBClient.prototype.send;
function key(item: Item) { return JSON.stringify(Object.keys(item).filter(k => k.endsWith("_id") && k !== "pathfinder_order_id").sort().map(k=>[k,item[k]?.S])); }
function table(name: string) { if (!tables.has(name)) tables.set(name,new Map()); return tables.get(name)!; }
function persist(name: string,item: Item) { table(name).set(key(item),structuredClone(item)); }
function jobItem(value: ProcessingJobPreview) { return encodeJobDynamoItem({ customer_id:{S:value.customer_id},job_id:{S:value.job_id},data:{S:JSON.stringify(value)},updated_at:{S:value.updated_at} }); }
function storedJob() { return [...table("test-JOBS").values()].find(i=>i.job_id?.S===job.job_id)!; }
function verifyLines(value: ProcessingJobPreview | null | undefined) {
  assert.ok(value);
  for (const field of ["source_grid","source_sheets","parsed_order_rows","canonical_order","lift_payload","submit_request_masked"] as const)
    assert.deepEqual(value[field],job[field],field);
  assert.equal(value.canonical_order.lines.length,100);
  assert.equal(value.canonical_order.lines.reduce((n,l)=>n+l.quantity,0),100);
  assert.ok(storedJob().data.B);
  for (const write of writes.filter(w=>w.TableName==="test-JOBS")) assert.ok(jobDynamoItemBytes(write.Item)<400*1024);
}

before(async()=>{
  Object.assign(process.env,{PATHFINDER_RUNTIME:"lambda",PATHFINDER_STORAGE_DRIVER:"dynamodb",PATHFINDER_SECRETS_DRIVER:"local",PATHFINDER_LOCAL_SECRETS_PATH:"/tmp/nonexistent-job-codec-secrets.json"});
  for(const name of ["CUSTOMERS","CUSTOMER_WORKSPACES","TARGETS","IMPORT_METHODS","OUTPUT_ROUTES","PRODUCT_MAPPINGS","JOBS","ORDER_IDS","SUBMIT_ATTEMPTS","LIFT_PRODUCT_CACHE","ORDER_STATUS_TOKENS","ORDER_STATUS_SNAPSHOTS","CANONICAL_REGISTRY"])
    process.env[`PATHFINDER_${name}_TABLE`]=`test-${name}`;
  (DynamoDBClient.prototype as any).send=async(command:any)=>{
    const input=command.input,name=command.constructor.name;
    if(name==="ScanCommand" || name==="QueryCommand") return {Items:[...table(input.TableName).values()]};
    if(name==="GetItemCommand") return {Item:table(input.TableName).get(key(input.Key))};
    const put=(p:any)=>{
      assert.ok(jobDynamoItemBytes(p.Item)<400*1024,"complete persisted item fits");
      const prior=table(p.TableName).get(key(p.Item));
      const expected=p.ExpressionAttributeValues?.[":expected_updated_at"]?.S;
      if(expected && prior?.updated_at?.S!==expected) throw Object.assign(new Error("conflict"),{name:"ConditionalCheckFailedException"});
      writes.push(p);persist(p.TableName,p.Item);
    };
    if(name==="PutItemCommand") {put(input);return {};}
    if(name==="TransactWriteItemsCommand") {for(const action of input.TransactItems) if(action.Put) put(action.Put);return {};}
    if(name==="BatchWriteItemCommand") {for(const [name,items] of Object.entries(input.RequestItems))for(const action of items as any[])if(action.PutRequest)put({TableName:name,Item:action.PutRequest.Item});return {};}
    throw new Error(`Unexpected ${name}`);
  };
  store=await import("../src/store.js");
});
beforeEach(()=>{
  tables.clear();writes.length=0;
  const lines=Array.from({length:100},(_,i)=>({line_number:i+1,quantity:1,product_id:"348225",creative:`${i<50?'A':'B'}${i%50+1}`,width:18.5,height:23.5}));
  const data=process.env.PATHFINDER_PRIVATE_JOB_FIXTURE
    ? JSON.parse(readFileSync(process.env.PATHFINDER_PRIVATE_JOB_FIXTURE,"utf8"))
    : {source_grid:{columns:[],rows:[]},source_sheets:[],parsed_order_rows:[],canonical_order:{lines},lift_payload:{order:{ext_id:"PF-SYNTHETIC",lines}},submit_request_masked:{body:{lines}},diagnostic_padding:"synthetic".repeat(60000)};
  job={...data,customer_id:"284619",job_id:"job-codec-transitions",customer_name:"Synthetic",pathfinder_order_id:"PF-SYNTHETIC",output_route_id:"route-test",submit_profile_id:"profile-test",state:"Ready",created_at:timestamp,updated_at:timestamp,source_order_history:[{event_id:"event-test",action:"source_change_observed_after_transport"}]} as ProcessingJobPreview;
  persist("test-JOBS",jobItem(job));
  persist("test-TARGETS",{target_id:{S:"lift-standard-graphics"},data:{S:JSON.stringify({target_id:"lift-standard-graphics",updated_at:timestamp})},updated_at:{S:timestamp}});
  persist("test-OUTPUT_ROUTES",{customer_id:{S:customer.lift_customer_id},output_route_id:{S:"route-test"},data:{S:JSON.stringify({output_route_id:"route-test",order_lookup_url:"https://example.invalid/{order_number}"})}});
});
after(()=>{DynamoDBClient.prototype.send=originalSend;});

test("scan/get and monotonic snapshot preserve the complete large order",async()=>{
  verifyLines(await store.getJob(customer,job.job_id));
  await store.persistJobSnapshot(customer,job);
  verifyLines(await store.getJob(customer,job.job_id));
  assert.ok(writes.some(w=>w.ConditionExpression));
});
test("atomic and ordinary preview writes preserve all lines",async()=>{
  const method={import_method_id:"method-test",name:"Test",type:"Manual upload",mappings:[],source_config:{}} as unknown as ImportMethod;
  for(const atomic of [false,true]) {
    await store.persistPreviewJob(customer,job,method,{persistMethod:false,reserveOrderIdAtomically:atomic});
    verifyLines(await store.getJob(customer,job.job_id));
  }
});
test("whole-store archive persistence retains compressed job content",async()=>{
  await store.setJobsArchived(customer,[job.job_id],true,"synthetic@example.invalid");
  verifyLines(await store.getJob(customer,job.job_id));
});
test("conditional association, source review and Wrike posted state remain lossless",async()=>{
  const result=await store.associateJobWithLiftOrder(customer,{job_id:job.job_id,order_number:"A-TEST",expected_current_order_number:null,linked_by_email:null,reason:"Test only",verification:{order_number:"A-TEST",customer_id:"284619",customer_name:"Synthetic",order_title:"Test",contract_number:"C-SYNTHETIC",created_by:"PATHFINDER",order_status:"Pending Art Approval",line_count:100,fetched_at:timestamp}});
  verifyLines(result?.job);
  const review=await store.recordWrikeSourceOrderReviewDisposition(customer,{job_id:job.job_id,event_id:"event-test",disposition:"resolved",actor_id:"test"});
  verifyLines(review?.job);
  const prepared=await store.prepareWrikeStatusWriteback(customer,{job_id:job.job_id,task_id:"task-test",connection_id:"connection-test",order_number:"A-TEST",contract_number:"C-SYNTHETIC",comment_sha256:"a".repeat(64),status_url_sha256:"b".repeat(64)});
  verifyLines(prepared?.job);
  const posted=await store.transitionWrikeStatusWriteback(customer,{job_id:job.job_id,writeback_id:prepared!.record.writeback_id,expected_state:"prepared",next_state:"posted",comment_id:"comment-test"});
  verifyLines(posted?.job);assert.equal(posted?.record.state,"posted");
  await assert.rejects(store.transitionWrikeStatusWriteback(customer,{job_id:job.job_id,writeback_id:prepared!.record.writeback_id,expected_state:"prepared",next_state:"posted"}),/will not be posted again/);
});
test("transactional uncertain-order reconciliation preserves all lines",async()=>{
  const result=await store.associateJobWithLiftOrder(customer,{job_id:job.job_id,order_number:"A-TEST",expected_current_order_number:null,linked_by_email:null,reason:"Test only",verification:{order_number:"A-TEST",customer_id:"284619",customer_name:"Synthetic",order_title:"Test",contract_number:"C-SYNTHETIC",created_by:"PATHFINDER",order_status:"Pending Art Approval",line_count:100,fetched_at:timestamp,external_order_id:"PF-SYNTHETIC",submit_attempt_id:"attempt-test",request_fingerprint:"fingerprint"},source:"scheduled_uncertain_reconciliation",expected_uncertain_attempt:{attempt_id:"attempt-test",idempotency_key:"key-test",request_fingerprint:"fingerprint"}});
  verifyLines(result?.job);
});
test("accepted submit finalization can update the compressed job",async()=>{
  const attempt={attempt_id:"attempt-test",customer_id:"284619",customer_name:"Synthetic",job_id:job.job_id,output_route_id:"route-test",submit_profile_id:"profile-test",idempotency_key:"key-test",state:"Order Confirmed",transport_mode:"live",submit_mode:"live",sandbox:false,ext_id:"PF-SYNTHETIC",submit_request_masked:job.submit_request_masked,response:{status:"accepted",lift_order_id:"A-TEST",message:"Accepted",received_at:timestamp},created_at:timestamp,updated_at:timestamp,blocking_items:[]} as unknown as SubmitAttempt;
  attempt.state="Submitted";
  await store.finalizeReservedSubmitAttempt(customer,attempt);
  const updated=await store.getJob(customer,job.job_id);verifyLines(updated);assert.equal(updated?.target_order_number,"A-TEST");
});
test("corrupt compressed records fail real job reads, never disappear silently",async()=>{
  const valid=structuredClone(storedJob());
  for(const patch of [{data_encoding:{S:"unknown"}},{data_sha256:{S:"a".repeat(64)}},{data_utf8_bytes:{N:"999999999"}}]){
    persist("test-JOBS",{...valid,...patch});
    await assert.rejects(store.getJob(customer,job.job_id),JobStorageError);
  }
});

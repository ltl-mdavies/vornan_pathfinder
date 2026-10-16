/** Publish the approved test's retained originals and write a private payload review.
 * Does not enable a route, edit a job, submit to Lift, or send a callback. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {S3Client,GetObjectCommand}=createRequire(new URL('../apps/api/package.json',import.meta.url))('@aws-sdk/client-s3');
import {publishArtwork,controlledArtworkReceipt,assertArtworkBinding} from '../apps/api/src/json-intake/artwork-delivery.js';
import {sha256} from '../apps/api/src/json-intake/adapter.js';
import type {JsonReceiptJob} from '../apps/api/src/json-intake/submission-job.js';
const root='outputs/stickerpress-artwork-2026-10-16';await mkdir(root,{recursive:true,mode:0o700});
const aws=(...args:string[])=>JSON.parse(execFileSync('aws',[...args,'--region','us-east-1','--output','json'],{encoding:'utf8',maxBuffer:8*1024*1024}));
const runtime=aws('lambda','get-function-configuration','--function-name','vornan-pathfinder-api-prod','--query','Environment.Variables');
const bucket=runtime.PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET,manifest=runtime.PATHFINDER_SOURCE_EVIDENCE_BUCKET;
assert.equal(runtime.PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION,'true');assert.equal(runtime.PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BASE_URL,'https://go.vornan.co');
assert.equal(aws('s3api','get-bucket-versioning','--bucket',bucket).Status,'Enabled');
const lifecycle=aws('s3api','get-bucket-lifecycle-configuration','--bucket',bucket).Rules;
assert.ok(lifecycle.some((r:any)=>r.Status==='Enabled'&&r.Filter?.Prefix==='d/'&&r.Expiration?.Days===14));
const jobId='job_json_c056759e4523d5ef9debdddcf67d708237355112413823ca00d89635c19707d0';
const original=aws('dynamodb','get-item','--table-name','Pathfinder-Jobs-prod','--key',JSON.stringify({customer_id:{S:'174094'},job_id:{S:jobId}}),'--consistent-read').Item;
const job=JSON.parse(original.data.S) as JsonReceiptJob;assert.equal(job.state,'Waiting');assert.ok(!job.target_order_number);
const s3=new S3Client({region:'us-east-1'}),receiptBucket='vornan-pathfinder-json-intake-sandbox-evidence-yyswkc0nj8yi';
const pointer=aws('dynamodb','get-item','--table-name','vornan-pathfinder-json-intake-sandbox-Receipts-IMH58R7YQ41Y','--key',JSON.stringify({pk:{S:controlledArtworkReceipt},sk:{S:'latest'}}),'--consistent-read').Item;
const r=await s3.send(new GetObjectCommand({Bucket:receiptBucket,Key:pointer.object_key.S}));const bytes=Buffer.from(await r.Body!.transformToByteArray());assert.equal(sha256(bytes),pointer.sha256.S);
const receipt=JSON.parse(bytes.toString());assert.equal(receipt.fingerprint,job.json_intake_binding.business_fingerprint);assert.equal(receipt.revision,job.json_intake_binding.receipt_revision);assert.ok(!receipt.confirmation);
const binding=await publishArtwork({job,delivery_bucket:bucket,manifest_bucket:manifest,required_until:'2026-10-23T23:59:59.000Z',sender:s3 as any,
 readRetained:async(e)=>{const asset=receipt.assets.find((a:any)=>a.external_line_id===e.external_line_id);assert.equal(asset.retained_ref,e.retained_ref);assert.equal(asset.sha256,e.sha256);assert.equal(asset.bytes,e.bytes);
 const result=await s3.send(new GetObjectCommand({Bucket:receiptBucket,Key:e.retained_ref}));return Buffer.from(await result.Body!.transformToByteArray());}});
job.json_artwork_binding=binding;
binding.publications.forEach((p,i)=>{job.canonical_order.lines[i].artwork!.file_url=p.direct_url;job.lift_payload.lines[i].artwork!.file_url=p.direct_url;});
assertArtworkBinding(job);
await writeFile(root+'/publication.private.json',JSON.stringify(binding,null,2)+'\n',{mode:0o600});
await writeFile(root+'/review-job.private.json',JSON.stringify(job,null,2)+'\n',{mode:0o600});
await writeFile(root+'/final-payload.private.json',JSON.stringify(job.lift_payload,null,2)+'\n',{mode:0o600});
await writeFile(root+'/job-before.private.json',JSON.stringify(original,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({receipt_id:controlledArtworkReceipt,files:binding.publications.length,byte_verified:true,required_until:binding.required_until,expires_at:binding.publications.map(p=>p.expires_at),live_job_changed:false,lift_submitted:false},null,2));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultLiftTargetConfig} from '@pathfinder/lift-adapter';
import {createSeedOutputTemplate} from '../src/lift-output-templates.js';
import {createStickerPressLiftConfiguration} from '../src/json-intake/stickerpress-lift-configuration.js';
import {prepareReceiptSubmissionJob,assertReceiptJobReplay,stickerPressTestProfile} from '../src/json-intake/submission-job.js';
import {stickerPressV1,sha256} from '../src/json-intake/adapter.js';
import type {Receipt} from '../src/json-intake/local-store.js';
import type {OutputRoute,TargetConfig} from '../src/store.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
function setup(){
 const identity={customer_id:'174094',customer_name:'Silicone Pasture',integration_id:'stickerpress-sandbox',store:'ltlco',environment:'test' as const,schema:'stickerpress.order.v1'};
 const payload=structuredClone(fixture);payload.lines.forEach((l:any)=>{l.material='White Bopp (Sticker)';l.finish='Gloss Laminate (.75 mil)';});
 const adapted=stickerPressV1.validate(payload,identity);
 const receipt={receipt_id:`rcpt_${sha256('synthetic-bridge')}`,identity,adapted,fingerprint:adapted.fingerprint,revision:4,
 assets:adapted.canonical.lines.map(l=>({external_line_id:l.source_line.external_line_id,sha256:l.source_line.artwork.artwork_sha256,bytes:l.source_line.artwork.bytes,retained_ref:'synthetic-retained-ref',inspection:'metadata_pass'}))} as Receipt;
 const base=createSeedOutputTemplate();
 const route={target_id:'lift-standard-graphics',company_id:'91',output_template_id:base.output_template_id,environment_id:'env-lift-prod',submit_profiles:[stickerPressTestProfile]} as OutputRoute;
 const config=createStickerPressLiftConfiguration(base,route);
 const target={target_id:route.target_id,lift:defaultLiftTargetConfig,output_templates:[base,config.template],environments:[{environment_id:'env-lift-prod',endpoint_url:'https://example.invalid/create_order'}]} as TargetConfig;
 return {receipt,config:{...config,target,order_date_format:'MM/DD/YYYY' as const}};
}
test('normal submission job preserves receipt identity, all line bindings and explicit non-submittable state',()=>{
 const {receipt,config}=setup(),before=structuredClone({receipt,config});
 const job=prepareReceiptSubmissionJob(receipt,config);
 assert.deepEqual({receipt,config},before);assert.equal(job.state,'Waiting');assert.equal(job.sandbox,true);
 assert.equal(job.submit_certification?.can_submit,false);assert.equal(job.submit_integrity,undefined);
 assert.equal(job.lift_payload.order.ext_id,receipt.adapted.canonical.order.external_order_id.replace(/^json_/, 'json-'));
 assert.equal(job.submit_request_masked.headers.Ext_ID,job.lift_payload.order.ext_id);
 assert.equal(job.lift_payload.source.pathfinder_job_id,job.job_id);
 assert.equal(job.json_intake_binding.artwork.length,4);assert.equal(job.product_resolution_results.length,4);
 assert.ok(job.lift_validation.some(v=>v.severity==='FAIL'&&v.code==='JSON-ARTWORK-PUBLICATION-PENDING'));
 assert.equal(job.json_intake_binding.configuration_sha256.length,64);
 assert.ok(job.lift_payload.lines.every(line=>(line as any).approval.proof_status==='5217816'));
});
test('new prepared job carries Approved for auto and Pending for operator, while transport stays disabled',()=>{
 const {receipt,config}=setup();receipt.adapted.canonical.lines[0].source_line.approval.approved_by='auto';
 const before=structuredClone(receipt);
 const job=prepareReceiptSubmissionJob(receipt,config,new Date('2026-10-23T12:00:00Z'));
 assert.deepEqual(job.lift_payload.lines.map(line=>(line as any).approval.proof_status),['5217817','5217816','5217816','5217816']);
 assert.equal(job.submit_certification?.can_submit,false);assert.equal(job.state,'Waiting');
 assert.deepEqual(receipt,before);
});
test('replay returns the same job without resetting confirmed or uncertain state',()=>{
 const {receipt,config}=setup();const first=prepareReceiptSubmissionJob(receipt,config);
 const refreshed=structuredClone(receipt);refreshed.revision++;refreshed.assets[0].inspection='metadata_fail';
 assert.equal(prepareReceiptSubmissionJob(refreshed,config).job_id,first.job_id);
 first.state='Order Confirmed';first.target_order_number='A0000001';
 assert.equal(assertReceiptJobReplay(first,refreshed),first);assert.equal(first.state,'Order Confirmed');
 const changed=structuredClone(receipt);changed.fingerprint='0'.repeat(64);
 assert.throws(()=>assertReceiptJobReplay(first,changed));
});
test('invalid retained approval evidence, wrong route/profile and confirmed receipt cannot prepare another job',()=>{
 for(const mutate of [
 (x:ReturnType<typeof setup>)=>{x.receipt.assets[0].sha256='0'.repeat(64);},
 (x:ReturnType<typeof setup>)=>{x.receipt.assets.push(x.receipt.assets[0]);},
 (x:ReturnType<typeof setup>)=>{x.receipt.assets=[];},
 (x:ReturnType<typeof setup>)=>{x.config.route.output_route_id='high-end-work';},
 (x:ReturnType<typeof setup>)=>{x.config.route.submit_profiles=[{...stickerPressTestProfile,enabled:true}];},
 (x:ReturnType<typeof setup>)=>{x.receipt.confirmation={} as any;}
 ]){const x=setup();mutate(x);assert.throws(()=>prepareReceiptSubmissionJob(x.receipt,x.config));}
});

test('new job carries ID mappings and mapping provenance without mutating input or rewriting existing jobs',()=>{
 const {receipt,config}=setup();
 receipt.adapted.canonical.lines.forEach((l,i)=>{l.production={...l.production,material:i%2?'Clear Bopp (Sticker)':'White Bopp (Sticker)',laminate:i<2?'Gloss Laminate (.75 mil)':'Matte Laminate (.71 mil)'};});
 const before=structuredClone({receipt,config});const job=prepareReceiptSubmissionJob(receipt,config);
 assert.deepEqual(job.lift_payload.lines.map((l:any)=>[l.production.material,l.production.laminate]),[['355948','354498'],['362180','354498'],['355948','354757'],['362180','354757']]);
 assert.equal(job.json_intake_binding.approval_mapping_version,'stickerpress-approval-ids-2026-10-27-v1');
 assert.equal(job.json_intake_binding.production_mapping_version,'stickerpress-material-ids-2026-10-27-v1');
 assert.deepEqual({receipt,config},before);assert.equal(job.submit_certification?.can_submit,false);
 const existing=structuredClone(job);delete existing.json_intake_binding.production_mapping_version;delete existing.json_intake_binding.approval_mapping_version;
 (existing.lift_payload.lines[0] as any).approval.proof_status='Approved';
 existing.state='Order Confirmed';(existing.lift_payload.lines[0] as any).production.material='White BOPP Sticker';
 const saved=structuredClone(existing);assert.equal(assertReceiptJobReplay(existing,receipt),existing);assert.deepEqual(existing,saved);
});

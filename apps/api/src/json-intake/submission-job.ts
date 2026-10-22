import assert from 'node:assert/strict';
import {validateCanonicalOrder, type ValidationMessage} from '@pathfinder/canonical';
import {generateLiftPayload, liftEcommerceExternalId, prepareLiftEcommercePayload, buildLiftSubmitRequest, maskLiftSubmitRequest} from '@pathfinder/lift-adapter';
import type {ProcessingJobPreview, TargetConfig, SubmitProfile} from '../store.js';
import {sha256, stableJson} from './adapter.js';
import type {Receipt} from './local-store.js';
import {mapStickerPressReceiptToCanonical,stickerPressLiftRouteId} from './stickerpress-lift-configuration.js';

export const stickerPressTestProfile: SubmitProfile = {profile_id:'sandbox-stickerpress-174094',
  name:'Sandbox · Sticker Press',mode:'sandbox_customer',enabled:false,
  customer_override:{lift_customer_id:'174094',customer_name:'Silicone Pasture'},
  description:'Controlled Sticker Press test orders only; activation follows artwork delivery and exact-payload review.'};

export interface JsonReceiptJobBinding {
  version:1; receipt_id:string; receipt_revision:number; receipt_sha256:string; business_fingerprint:string;
  integration_id:string; store:string; environment:'test'; source_order_number:string;
  configuration_sha256:string;
  artwork: Array<{external_line_id:string;sha256:string;bytes:number;retained_ref:string}>;
}
export type JsonReceiptJob = ProcessingJobPreview & {json_intake_binding:JsonReceiptJobBinding};

export function receiptJobIdentity(receipt: Pick<Receipt,'receipt_id'|'identity'>) {
  assert.match(receipt.receipt_id,/^rcpt_[a-f0-9]{64}$/);
  const digest=sha256(stableJson({receipt_id:receipt.receipt_id,identity:receipt.identity}));
  return {job_id:`job_json_${digest}`,pathfinder_order_id:`PF${digest.slice(0,24).toUpperCase()}`};
}

/** Prepares a normal durable job, never transport. Missing publication remains a hard validation failure.
 * It intentionally cannot mark a test as Ready or reuse a live-customer submit profile.
 */
export function prepareReceiptSubmissionJob(receipt:Receipt,
  config: Parameters<typeof mapStickerPressReceiptToCanonical>[1] & {target:TargetConfig}, now=new Date()):JsonReceiptJob {
  assert.ok(!receipt.confirmation,'Receipt is already confirmed');
  assert.equal(receipt.fingerprint,receipt.adapted.fingerprint);
  const canonical=mapStickerPressReceiptToCanonical(receipt,config);
  const profile=config.route.submit_profiles.find(p=>p.profile_id===stickerPressTestProfile.profile_id);
  assert.deepEqual(profile,stickerPressTestProfile);
  assert.equal(config.target.target_id,config.route.target_id);
  assert.deepEqual(config.target.output_templates.find(t=>t.output_template_id===config.template.output_template_id),config.template);
  const environment=config.target.environments.find(e=>e.environment_id===config.route.environment_id);
  assert.ok(environment);assert.equal(environment.environment_id,'env-lift-prod');
  assert.ok(environment.endpoint_url);
  const artwork=canonical.lines.map(line=>{
    const source=line.source_line;
    const matches=receipt.assets.filter(a=>a.external_line_id===source.external_line_id);
    assert.equal(matches.length,1,'Each line requires exactly one retained original');
    const asset=matches[0];
    assert.equal(asset.sha256,source.artwork.artwork_sha256);
    assert.equal(asset.sha256,source.approval.artwork_sha256);
    assert.equal(asset.bytes,source.artwork.bytes);
    assert.ok(asset.retained_ref);
    return {external_line_id:asset.external_line_id,sha256:asset.sha256,bytes:asset.bytes,retained_ref:asset.retained_ref};
  });
  const identity=receiptJobIdentity(receipt),timestamp=now.toISOString();
  const prepared=prepareLiftEcommercePayload({template_id:config.template.output_template_id,
    base:generateLiftPayload(canonical,{jobId:identity.job_id,canonicalOrderId:`co_${identity.job_id}`,pathfinderOrderId:identity.pathfinder_order_id,extIdStrategy:'customer_order_id'}),
    canonical,source:canonical,order_mappings:config.template.canonical_mappings,order_date_format:config.order_date_format,
    validation_options:{product_identifier_type:'lift_product_id'}});
  const pending:ValidationMessage={severity:'FAIL',code:'JSON-ARTWORK-PUBLICATION-PENDING',object:'lift.payload',field:'lines[].artwork.file_url',
    message:'Retained originals are verified. Publish and verify their Lift delivery URLs before reviewing this job for submission.',
    suggested_action:'Complete the Sticker Press artwork delivery binding; then regenerate the reviewed job.'};
  // Build only the masked request; connection credentials stay in the existing target secret store.
  const request=maskLiftSubmitRequest(buildLiftSubmitRequest(prepared.payload,{...config.target.lift,active_environment:'PROD',
    environments:{...config.target.lift.environments,PROD:{endpoint_url:environment.endpoint_url}},
    headers:{...config.target.lift.headers,Company:config.route.company_id!},credentials:{User:'REVIEW_REQUIRED',Password:'REVIEW_REQUIRED'}}));
  const rows=canonical.lines.map(line=>({line_number:line.line_number,external_line_id:line.source_line.external_line_id,
    description:line.description??'',quantity:line.quantity,product_id:'374549',material:String(line.production?.material??''),laminate:String(line.production?.laminate??'')}));
  return {...identity,customer_id:receipt.identity.customer_id,customer_name:receipt.identity.customer_name,
    source_customer_id:receipt.identity.customer_id,source_customer_name:receipt.identity.customer_name,
    submit_customer_id:'174094',submit_customer_name:'Silicone Pasture',submit_profile_id:profile.profile_id,
    submit_profile_name:profile.name,submit_mode:profile.mode,sandbox:true,import_method_id:'json-stickerpress-sandbox',
    import_method_name:'Sticker Press sandbox JSON',output_route_id:config.route.output_route_id,output_route_name:config.route.name,
    state:'Waiting',source_file_name:`${canonical.source.source_record_id}.json`,sheet_name:null,
    source_grid:{columns:Object.keys(rows[0]),rows},source_sheets:[],parsed_order_rows:[],reference_rows:[],mappings:[],
    product_resolution_results:canonical.lines.map(line=>({output_route_id:config.route.output_route_id,source_scope_id:'stickerpress-sandbox',
      source_sheet_name:'JSON order',source_row_number:line.line_number,line_number:line.line_number,strategy:'derived_key',mode:'map_to_lift_unit',
      customer_product_key:config.product.customer_product_key,display_label:config.product.display_label,source_columns:[],
      resolved_product_identifier:'374549',resolved_product_id:'374549',resolved_unit_number:null,product_name:config.product.product_name,
      status:'Mapped',message:'Customer-scoped Sticker Press single-product mapping.'})),
    unresolved_products:[],canonical_order:canonical,canonical_validation:validateCanonicalOrder(canonical,{product_identifier_type:'lift_product_id'}),
    lift_payload:prepared.payload,lift_validation:[...prepared.validation.filter(v=>v.severity!=='PASS'),pending],
    submit_request_masked:request,submit_certification:{can_submit:false,external_submit_enabled:false,
      summary:'Prepared from the sandbox receipt; artwork delivery and test-route activation remain pending.',
      items:[{item_id:'json-artwork-publication',label:'Artwork delivery',status:'Blocked',blocking:true,message:pending.message},
        {item_id:'json-test-activation',label:'Controlled test activation',status:'Blocked',blocking:true,message:'The Ecomm route and sandbox submit profile remain disabled for submission.'}]},
    target_order_number:null,source_document_publications:[],created_at:timestamp,updated_at:timestamp,
    json_intake_binding:{version:1,receipt_id:receipt.receipt_id,receipt_revision:receipt.revision,receipt_sha256:sha256(stableJson(receipt)),
      business_fingerprint:receipt.fingerprint,integration_id:receipt.identity.integration_id,store:receipt.identity.store,environment:'test',
      source_order_number:canonical.source.source_record_id,configuration_sha256:sha256(stableJson({template:config.template,route:config.route,product:config.product})),artwork}
  };
}

/** Replays never rewrite an existing job, including confirmed or uncertain jobs. */
export function assertReceiptJobReplay(existing:JsonReceiptJob, receipt:Receipt) {
  const identity=receiptJobIdentity(receipt),b=existing.json_intake_binding;
  assert.equal(existing.job_id,identity.job_id);assert.equal(existing.customer_id,receipt.identity.customer_id);
  assert.equal(b?.receipt_id,receipt.receipt_id);assert.equal(b.business_fingerprint,receipt.fingerprint);
  assert.equal(b.integration_id,receipt.identity.integration_id);
  assert.equal(b.store,receipt.identity.store);assert.equal(b.environment,receipt.identity.environment);
  assert.equal(existing.output_route_id,stickerPressLiftRouteId);assert.equal(existing.sandbox,true);
  assert.ok([receipt.adapted.canonical.order.external_order_id,liftEcommerceExternalId(receipt.adapted.canonical.order.external_order_id)].includes(existing.lift_payload.order.ext_id));
  return existing;
}

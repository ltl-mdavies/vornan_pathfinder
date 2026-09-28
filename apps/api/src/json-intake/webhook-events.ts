import { committedEvent,scopeKey,digest,type CommittedWebhookEvent,type WebhookScope } from '../webhooks/contract.js';
import type { WebhookOutbox } from '../webhooks/local-outbox.js';
import { webhookStatus,type LocalEndpoint } from '../webhooks/dispatch.js';
import { intakeAttemptId,validatePersistedIntakeAttempt,type IntakeLedger } from '../intake-assurance.js';
import { stableJson } from './adapter.js';
import type { Receipt,ReceiptStore } from './local-store.js';
export interface ReceiptHistory { history():AsyncIterable<Receipt> }
export const webhookScope=(r:Receipt):WebhookScope=>({customer_id:r.identity.customer_id,integration_id:r.identity.integration_id,store:r.identity.store,environment:r.identity.environment});
const corrections:Record<string,string>={
  ARTWORK_URL_EXPIRED:'Provide a renewed URL for the unchanged approved PDF.',
  ARTWORK_CHECKSUM_MISMATCH:'Provide the exact approved PDF or request review of replacement artwork.',
  ARTWORK_SIZE_MISMATCH:'Correct the declared size or provide the exact approved PDF.',
  ARTWORK_SIGNATURE_INVALID:'Provide a valid production PDF matching its approval.',
  PDF_MALFORMED:'Provide a valid production PDF matching its approval.',
  PDF_ENCRYPTED:'Provide an unencrypted production PDF with matching approval evidence.',
  PDF_PAGE_COUNT:'Provide one approved single-page PDF per line.',
  PDF_BOX_MISSING:'Provide a PDF with the required page, trim and bleed boxes.',
  PDF_BOX_INVALID:'Correct the PDF page, trim and bleed boxes and review its approval.',
  PDF_TRANSFORM_UNSUPPORTED:'Request review of the PDF page transform before resubmitting.',
  PDF_TRIM_GEOMETRY_MISMATCH:'Review the production PDF trim dimensions and supplied metadata.',
  PDF_PAGE_GEOMETRY_MISMATCH:'Review the production PDF page dimensions and supplied metadata.',
  PDF_BLEED_GEOMETRY_MISMATCH:'Review the production PDF bleed and supplied metadata.',
  PDF_CUT_SPOT_MISSING:'Provide the agreed named cut spot in the production PDF.',
  PDF_CUT_LAYER_MISSING:'Provide the agreed named cut layer in the production PDF.'
};
/** No free-form source errors/messages/URLs are forwarded. Only validated line-bound customer findings qualify. */
export function actionableIssues(r:Receipt){
  return r.issues.filter(i=>i.owner==='customer' && !i.retryable && Object.hasOwn(corrections,i.code)).map(i=>{
    const index=r.adapted.canonical.lines.findIndex(l=>l.source_line.external_line_id===i.external_line_id);
    if(index<0 || !/^iss_[a-f0-9]{24}$/.test(i.issue_id) || i.field!==`lines[${index}].artwork`)throw new Error('Invalid customer finding binding');
    return {issue_id:i.issue_id,scope:'line',external_line_id:i.external_line_id,code:i.code,field:i.field,
      message:'The production artwork needs a correction or review.',corrective_action:corrections[i.code],owner:'customer',status:'open'};
  }).sort((a,b)=>a.issue_id.localeCompare(b.issue_id));
}
/** Scan immutable commits; deterministic inserts are the cursor. Crash/restart can safely replay the full local journal. */
export async function materializeReceiptEvents(history:ReceiptHistory,outbox:WebhookOutbox,endpoint:LocalEndpoint){
  const prior=new Map<string,string>(),confirmed=new Set<string>();
  for await(const r of history.history()){
    if(scopeKey(webhookScope(r))!==scopeKey(endpoint.scope))continue;
    const base={receipt_id:r.receipt_id,order_number:r.adapted.canonical.source.source_record_id,lift_order_number:null,
      occurred_at:r.updated_at,order_revision:r.revision+1};
    const binding={id:endpoint.id,revision:endpoint.revision,url:endpoint.url};
    if(r.revision===0)await outbox.enqueue(committedEvent(webhookScope(r),`${r.receipt_id}:received:v1`,{
      ...base,occurred_at:r.received_at,event_type:'order.received',data:{intake_status:'received',line_count:r.adapted.canonical.lines.length,status_url:`/api/v1/intake/orders/${r.receipt_id}`}}),binding);
    const issues=actionableIssues(r),key=stableJson(issues),old=prior.get(r.receipt_id)??'[]';
    if(issues.length && key!==old)await outbox.enqueue(committedEvent(webhookScope(r),`${r.receipt_id}:${r.revision}:action:v1`,{
      ...base,event_type:'order.action_required',data:{intake_status:'customer_action_required',issues}}),binding);
    prior.set(r.receipt_id,key);
    if(r.confirmation&&!confirmed.has(r.receipt_id)){await outbox.enqueue(committedEvent(webhookScope(r),`${r.receipt_id}:confirmed:${r.confirmation.evidence_sha256}:v1`,{
      ...base,occurred_at:r.confirmation.confirmed_at,event_type:'order.confirmed',lift_order_number:r.confirmation.order_number,
      data:{intake_status:'confirmed',confirmed_at:r.confirmation.confirmed_at,status_page_url:null,status_page_expires_at:null}}),binding);confirmed.add(r.receipt_id);}
  }
}
export function currentReceiptEvent(store:ReceiptStore){return async(event:CommittedWebhookEvent)=>{
  const r=await store.get(event.envelope.receipt_id);if(!r || scopeKey(webhookScope(r))!==scopeKey(event.scope))return false;
  if(event.envelope.event_type==='order.action_required')return stableJson(actionableIssues(r))===stableJson(event.envelope.data.issues);
  if(event.envelope.event_type==='order.confirmed')return r.confirmation?.order_number===event.envelope.lift_order_number;
  return true;
};}
/** Narrow read-only projection from authoritative job, submit and verified-association records; no live binding is installed. */
export interface ConfirmationEvidence {
  job:{job_id:string;customer_id:string;integration_id:string;receipt_id:string;source_order_number:string;external_order_id:string;target_customer_id:string;target_order_number:string;sandbox:boolean};
  submit:{attempt_id:string;job_id:string;customer_id:string;ext_id:string;request_fingerprint:string;sandbox:boolean};
  association:{order_number:string;customer_id:string;external_order_id:string;submit_attempt_id:string;request_fingerprint:string;verified_at:string};
}
export async function captureVerifiedConfirmation(store:ReceiptStore,ledger:IntakeLedger,receiptId:string,load:(jobId:string,submitId:string)=>Promise<ConfirmationEvidence|null>){
  const r=await store.get(receiptId);if(!r)throw new Error('Receipt missing');
  const attempt=structuredClone(await ledger.get(r.identity.customer_id,intakeAttemptId(r.signal)));
  if(!attempt)throw new Error('Confirmation evidence missing');validatePersistedIntakeAttempt(attempt);
  if(attempt.state!=='confirmed'||!attempt.job_id||!attempt.submit_attempt_id||!attempt.confirmed_order_number||stableJson(attempt.signal)!==stableJson(r.signal))throw new Error('Confirmation evidence mismatch');
  const evidence=structuredClone(await load(attempt.job_id,attempt.submit_attempt_id));if(!evidence)throw new Error('Confirmation evidence missing');
  const {job,submit,association}=evidence;
  if(!job.sandbox || !submit.sandbox || job.customer_id!==r.identity.customer_id||job.integration_id!==r.identity.integration_id||job.receipt_id!==r.receipt_id||
    job.source_order_number!==r.adapted.canonical.source.source_record_id||job.external_order_id!==r.adapted.canonical.order.external_order_id||job.job_id!==attempt.job_id||
    submit.attempt_id!==attempt.submit_attempt_id||submit.job_id!==job.job_id||submit.customer_id!==job.customer_id||submit.ext_id!==job.external_order_id||
    !/^[a-f0-9]{64}$/.test(submit.request_fingerprint)||association.request_fingerprint!==submit.request_fingerprint||association.submit_attempt_id!==submit.attempt_id||
    association.external_order_id!==job.external_order_id||!job.target_customer_id||association.customer_id!==job.target_customer_id||
    job.target_order_number!==attempt.confirmed_order_number||association.order_number!==attempt.confirmed_order_number||!/^A\d{7,8}$/.test(association.order_number)||
    !Number.isFinite(Date.parse(association.verified_at)))throw new Error('Confirmation evidence mismatch');
  // Reads are not atomic: require unchanged compatible records before the receipt CAS.
  const reread=await ledger.get(r.identity.customer_id,attempt.attempt_id),again=await load(attempt.job_id,attempt.submit_attempt_id);
  if(!reread||stableJson(reread)!==stableJson(attempt)||stableJson(again)!==stableJson(evidence))throw new Error('Confirmation evidence changed');
  const proof=digest(stableJson(evidence));
  if(r.confirmation){if(r.confirmation.evidence_sha256!==proof)throw new Error('Confirmation association is immutable');return r;}
  const next:Receipt={...r,revision:r.revision+1,updated_at:attempt.updated_at,confirmation:{job_id:job.job_id,submit_attempt_id:submit.attempt_id,
    order_number:association.order_number,confirmed_at:attempt.updated_at,intake_revision:attempt.revision,evidence_sha256:proof}};
  if(!await store.compareAndSet(r,next))throw new Error('Receipt confirmation conflict');return next;
}
export async function receiptWebhookStatus(history:ReceiptHistory,outbox:WebhookOutbox,r:Receipt){
  const lifecycle=new Map<string,Record<string,unknown>>();
  for await(const row of history.history())if(row.receipt_id===r.receipt_id&&row.revision<=r.revision&&scopeKey(webhookScope(row))===scopeKey(webhookScope(r))){
    const active=actionableIssues(row),ids=new Set(active.map(i=>i.issue_id));
    for(const [id,issue]of lifecycle)if(issue.status==='open'&&!ids.has(id))lifecycle.set(id,{...issue,status:'resolved',resolved_at:row.updated_at});
    for(const issue of active)lifecycle.set(issue.issue_id,issue);
  }
  return {issues:[...lifecycle.values(),...r.issues.filter(i=>i.owner!=='customer').map(i=>({issue_id:i.issue_id,code:i.code,owner:'internal',status:'open',message:'Internal processing review is required.'}))],webhooks:await webhookStatus(outbox,webhookScope(r),r.receipt_id)};
}

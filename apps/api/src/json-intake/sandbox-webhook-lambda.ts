import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient,GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DurableWebhookOutbox } from '../webhooks/durable-outbox.js';
import { createSandboxHttpsTransport } from '../webhooks/https-transport.js';
import { dispatchWebhook,webhookStatus,type LocalEndpoint } from '../webhooks/dispatch.js';
import { scopeKey, committedEvent } from '../webhooks/contract.js';
import { SandboxWebhookHistory } from './sandbox-webhook-history.js';
import { materializeReceiptEvents,currentReceiptEvent } from './webhook-events.js';
import { reviewedPartialShipping, type PartialShippingPermit } from './partial-shipping-permit.js';
import { reviewedFullShipping, type FullShippingPermit } from './full-shipping-permit.js';
import { projectShipping } from './shipping-events.js';
import { reviewedConfirmation, type ConfirmationPermit } from './manual-confirmation.js';

/** No HTTP route. Trusted IAM invocation returns safe delivery status; schedule is independently gated. */
export function createSandboxWebhookHandler(deps:{env:NodeJS.ProcessEnv;db:any;s3:any;secrets:any;transport?:ReturnType<typeof createSandboxHttpsTransport>}){
return async function(_event:unknown,context?:{getRemainingTimeInMillis():number}){
  const env=deps.env;
  if(env.WEBHOOK_ENABLED!=='true')return {enabled:false};
  const required=(key:string)=>{const value=env[key];if(!value)throw new Error('Sandbox callback configuration missing');return value;};
  const endpoint:LocalEndpoint={id:required('WEBHOOK_ENDPOINT_ID'),revision:required('WEBHOOK_ENDPOINT_REVISION'),enabled:true,
    scope:{customer_id:required('WEBHOOK_CUSTOMER_ID'),integration_id:required('WEBHOOK_INTEGRATION_ID'),store:'ltlco',environment:'test'},
    url:required('WEBHOOK_ENDPOINT_URL'),active_key_id:required('WEBHOOK_KEY_ID')};
  const ids=JSON.parse(required('WEBHOOK_RECEIPT_IDS')) as string[];
  const permits=JSON.parse(env.WEBHOOK_CONFIRMATION_PERMITS??'[]') as ConfirmationPermit[];
  if(!Array.isArray(permits)||permits.length>20||permits.some(p=>!p||!ids.includes(p.receipt_id)))throw new Error('Invalid confirmation permits');
  const shippingPermits=JSON.parse(env.WEBHOOK_PARTIAL_SHIPPING_PERMITS??'[]') as PartialShippingPermit[];
  if(!Array.isArray(shippingPermits)||shippingPermits.length>20||shippingPermits.some(p=>!p||!ids.includes(p.receipt_id)))throw new Error('Invalid partial shipping permits');
  const fullPermits=JSON.parse(env.WEBHOOK_FULL_SHIPPING_PERMITS??'[]') as FullShippingPermit[];
  if(!Array.isArray(fullPermits)||fullPermits.length>20||fullPermits.some(p=>!p||!ids.includes(p.receipt_id)))throw new Error('Invalid full shipping permits');
  const reviewedShipping=(receipt:import('./local-store.js').Receipt)=>{
    if(receipt.shipping && projectShipping(receipt).all_items_shipped)return reviewedFullShipping(receipt,fullPermits);
    const partial=reviewedPartialShipping(receipt,shippingPermits);
    return {events:[partial.event],permit:partial.permit};
  };
  const {db,s3}=deps;
  const history=new SandboxWebhookHistory(required('SANDBOX_RECEIPTS_TABLE'),required('SANDBOX_RECEIPTS_BUCKET'),db,s3,endpoint.scope,ids);
  const outbox=new DurableWebhookOutbox(required('WEBHOOK_OUTBOX_TABLE'),endpoint.scope,db);
  const transport=deps.transport??createSandboxHttpsTransport(endpoint.url);
  // Load the complete bounded history before materialization: missing revisions cannot make false transitions.
  const revisions:import('./local-store.js').Receipt[]=[];let historyBytes=0;
  for await(const receipt of history.history()){
    if((context?.getRemainingTimeInMillis()??120000)<30000)throw new Error('Sandbox callback history deadline');
    // Every historic shipping snapshot requires its own immutable reviewed permit.
    if(receipt.shipping||receipt.shipping_review)reviewedShipping(receipt);
    if(receipt.confirmation)reviewedConfirmation(receipt,permits);
    historyBytes+=Buffer.byteLength(JSON.stringify(receipt));
    if(historyBytes>16*1024*1024||revisions.length>=500)throw new Error('Sandbox callback history budget');
    revisions.push(receipt);
  }
  await materializeReceiptEvents({async *history(){yield* revisions;}},outbox,endpoint);
  let count=0;
  if(env.WEBHOOK_DELIVERY_ENABLED==='true'&&ids.length){
    const client=deps.secrets;let secret:string|undefined;
    const loadSecret=async()=>{
      if(secret)return secret;
      const result=await client.send(new GetSecretValueCommand({SecretId:required('WEBHOOK_SIGNING_SECRET_ARN')}));
      let value:any;try{value=JSON.parse(result.SecretString??'{}');}catch{throw new Error('Signing secret format invalid');}
      if(value.key_id!==endpoint.active_key_id||value.endpoint_id!==endpoint.id||value.endpoint_revision!==endpoint.revision||value.destination!==endpoint.url||
        scopeKey(value.scope)!==scopeKey(endpoint.scope)||typeof value.secret!=='string'||Buffer.byteLength(value.secret)<32)throw new Error('Signing secret binding mismatch');
      secret=value.secret;return secret!;
    };
    // Final order notification follows acknowledged package updates, even after retries/restarts.
    for(const finalPass of [false,true])for await(const row of outbox.list(endpoint.scope)){
      if((row.event.envelope.event_type==='order.shipped')!==finalPass)continue;
      if(!ids.includes(row.event.envelope.receipt_id)||!['order.received','order.action_required','order.confirmed','shipment.updated','order.shipped'].includes(row.event.envelope.event_type))continue;
      if(count>=10||(context?.getRemainingTimeInMillis()??120000)<20000)break;
      if(['delivered','paused','exhausted','suppressed'].includes(row.state)||row.next_attempt_at&&Date.parse(row.next_attempt_at)>Date.now())continue;
      if(['shipment.updated','order.shipped'].includes(row.event.envelope.event_type)){
        const latest=await history.store.get(row.event.envelope.receipt_id);
        if(!latest)continue;
        const reviewed=reviewedShipping(latest);
        if(Date.now()>Date.parse(reviewed.permit.delivery_before)||!reviewed.events.some(e=>e.body===row.event.body))continue;
        if(row.event.envelope.event_type==='order.shipped'){
          const packages=reviewed.events.filter(e=>e.envelope.event_type==='shipment.updated');
          const updates=await Promise.all(packages.map(e=>outbox.get(e.envelope.event_id)));
          if(updates.some((r,i)=>r?.state!=='delivered'||r.event.body!==packages[i].body))continue;
        }
      }
      await dispatchWebhook(row.event.envelope.event_id,endpoint,{outbox,transport,secret:loadSecret,isCurrent:async event=>{
        if(['shipment.updated','order.shipped'].includes(event.envelope.event_type)){
          const latest=await history.store.get(event.envelope.receipt_id);if(!latest)return false;
          reviewedConfirmation(latest,permits);
          const reviewed=reviewedShipping(latest);
          if(Date.now()>Date.parse(reviewed.permit.delivery_before)||!reviewed.events.some(e=>e.body===event.body))return false;
        }
        if(event.envelope.event_type==='order.confirmed'){
          const latest=await history.store.get(event.envelope.receipt_id);if(!latest)return false;
          const c=reviewedConfirmation(latest,permits);
          if(c.order_number!==event.envelope.lift_order_number||c.confirmed_at!==event.envelope.occurred_at||
            event.envelope.order_number!==latest.adapted.canonical.source.source_record_id)return false;
          // Bind the queued event to the same proof, not merely the same Lift number.
          if(event.envelope.event_id!==committedEvent(event.scope,`${latest.receipt_id}:confirmed:${c.evidence_sha256}:v1`,event.envelope).envelope.event_id)return false;
        }
        return currentReceiptEvent(history.store)(event);
      }});count++;
    }
  }
  const receipts=[];
  for(const id of ids)receipts.push({receipt_id:id,...await webhookStatus(outbox,endpoint.scope,id)});
  return {enabled:true,delivery_enabled:env.WEBHOOK_DELIVERY_ENABLED==='true',attempted:count,receipts};
}
}
const configured=createSandboxWebhookHandler({env:process.env,db:new DynamoDBClient({}),s3:new S3Client({}),secrets:new SecretsManagerClient({})});
export async function handler(event:unknown,context?:{getRemainingTimeInMillis():number}){
  try{return await configured(event,context);}catch{throw new Error('SANDBOX_CALLBACK_WORKER_FAILED');}
}

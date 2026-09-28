import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookScope { customer_id:string; integration_id:string; store:string; environment:'test' }
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const scopeKey=(scope:WebhookScope)=>JSON.stringify([scope.customer_id,scope.integration_id,scope.store,scope.environment]);
export type EventType='order.received'|'order.action_required'|'order.confirmed';
export interface EventEnvelope {
  schema_version:'pathfinder.webhook.v1'; event_id:string; event_type:EventType; environment:'test';
  receipt_id:string; order_number:string; store:string; lift_order_number:string|null;
  occurred_at:string; order_revision:number; data:Record<string,unknown>;
}
export interface CommittedWebhookEvent { scope:WebhookScope; envelope:EventEnvelope; body:string; body_sha256:string }
/** Trusted source adapters project only safe, committed state into this method-independent envelope. */
export function committedEvent(scope:WebhookScope, sourceKey:string, fields:Omit<EventEnvelope,'schema_version'|'event_id'|'store'|'environment'>):CommittedWebhookEvent {
  if(scope.environment!=='test' || !scope.customer_id || !scope.integration_id || !scope.store || !sourceKey ||
    !Number.isSafeInteger(fields.order_revision) || fields.order_revision<1 || !Number.isFinite(Date.parse(fields.occurred_at)))throw new Error('Invalid committed webhook identity');
  const event_id=`evt_${digest(JSON.stringify([scopeKey(scope),sourceKey,fields.event_type]))}`;
  const envelope:EventEnvelope={schema_version:'pathfinder.webhook.v1',event_id,event_type:fields.event_type,environment:scope.environment,
    receipt_id:fields.receipt_id,order_number:fields.order_number,store:scope.store,lift_order_number:fields.lift_order_number,
    occurred_at:fields.occurred_at,order_revision:fields.order_revision,data:fields.data};
  const body=JSON.stringify(envelope);
  if(Buffer.byteLength(body)>128*1024)throw new Error('Webhook body limit');
  return {scope:structuredClone(scope),envelope,body,body_sha256:digest(body)};
}
export function signature(secret:string,timestamp:string,body:Buffer) {
  if(!/^(0|[1-9]\d{0,11})$/.test(timestamp) || !secret)throw new Error('Invalid signing configuration');
  return `v1=${createHmac('sha256',Buffer.from(secret,'utf8')).update(Buffer.from(timestamp+'.','ascii')).update(body).digest('hex')}`;
}
export function deliveryHeaders(event:CommittedWebhookEvent, keyId:string, secret:string, timestamp:string, attempt:number) {
  if(!/^[A-Za-z0-9._-]{1,128}$/.test(keyId) || !Number.isSafeInteger(attempt) || attempt<1)throw new Error('Invalid signing configuration');
  return {'Content-Type':'application/json; charset=utf-8','X-Pathfinder-Event-Id':event.envelope.event_id,
    'X-Pathfinder-Timestamp':timestamp,'X-Pathfinder-Signature':signature(secret,timestamp,Buffer.from(event.body)),
    'X-Pathfinder-Key-Id':keyId,'X-Pathfinder-Delivery-Attempt':String(attempt)};
}
/** Receiver validation: authenticate exact bytes first, then parse and bind event ID/schema/environment. */
export function verifyDelivery(body:Buffer,headers:Record<string,string|undefined>,keys:ReadonlyMap<string,string>,nowSeconds:number,expectedStore:string):EventEnvelope {
  const fail=()=>{throw new Error('Webhook authentication failed');};
  if(body.length>128*1024 || !Number.isSafeInteger(nowSeconds))return fail();
  const timestamp=headers['x-pathfinder-timestamp']??'', mac=headers['x-pathfinder-signature']??'';
  const key=keys.get(headers['x-pathfinder-key-id']??'');
  if(!key || !/^(0|[1-9]\d{0,11})$/.test(timestamp) || Math.abs(nowSeconds-Number(timestamp))>300 || !/^v1=[a-f0-9]{64}$/.test(mac))return fail();
  if(!timingSafeEqual(Buffer.from(mac.slice(3),'hex'),Buffer.from(signature(key,timestamp,body).slice(3),'hex')))return fail();
  let event:EventEnvelope;try{event=JSON.parse(body.toString('utf8'));}catch{return fail();}
  if(!event || event.schema_version!=='pathfinder.webhook.v1' || event.environment!=='test' || event.store!==expectedStore || typeof event.event_id!=='string' || event.event_id!==headers['x-pathfinder-event-id'] || !Number.isSafeInteger(event.order_revision) || event.order_revision<1)return fail();
  return event;
}

import { GetItemCommand, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { digest,scopeKey,type WebhookScope,type CommittedWebhookEvent } from './contract.js';
import { validateOutbox,type WebhookOutbox,type OutboxRecord } from './local-outbox.js';
import { stableJson } from '../json-intake/adapter.js';
type Sender={send(command:any):Promise<any>};
const valid=(id:string)=>/^evt_[a-f0-9]{64}$/.test(id);
/** Dedicated sandbox table: atomic latest + immutable audit revisions, scoped at construction. */
export class DurableWebhookOutbox implements WebhookOutbox {
  readonly pk:string;
  constructor(readonly table:string,readonly scope:WebhookScope,readonly db:Sender){
    if(!table||scope.environment!=='test')throw new Error('Invalid sandbox outbox configuration');
    this.pk=`scope#${digest(scopeKey(scope))}`;
  }
  private decode(item:any){
    const r=validateOutbox(JSON.parse(item.body.S));
    if(scopeKey(r.event.scope)!==scopeKey(this.scope)||item.pk.S!==this.pk||item.sk.S!==r.event.envelope.event_id||item.sha256.S!==digest(item.body.S)||item.revision.N!==String(r.revision))throw new Error('Corrupt outbox pointer');
    return r;
  }
  async get(id:string){
    if(!valid(id))return null;
    const result=await this.db.send(new GetItemCommand({TableName:this.table,Key:{pk:{S:this.pk},sk:{S:id}},ConsistentRead:true}));
    return result.Item?this.decode(result.Item):null;
  }
  private async write(after:OutboxRecord,before?:OutboxRecord){
    validateOutbox(after);
    if(scopeKey(after.event.scope)!==scopeKey(this.scope))throw new Error('Outbox scope mismatch');
    const body=JSON.stringify(after);
    if(Buffer.byteLength(body)>350*1024)throw new Error('Outbox record limit');
    const id=after.event.envelope.event_id,item={pk:{S:this.pk},sk:{S:id},revision:{N:String(after.revision)},sha256:{S:digest(body)},body:{S:body}};
    try{
      await this.db.send(new TransactWriteItemsCommand({TransactItems:[
        {Put:{TableName:this.table,Item:item,ConditionExpression:before?'#rev = :rev AND #sha = :sha':'attribute_not_exists(pk)',
          ...(before?{ExpressionAttributeNames:{'#rev':'revision','#sha':'sha256'},ExpressionAttributeValues:{':rev':{N:String(before.revision)},':sha':{S:digest(JSON.stringify(before))}}}:{})}},
        {Put:{TableName:this.table,Item:{...item,sk:{S:`audit#${id}#${String(after.revision).padStart(12,'0')}`}},ConditionExpression:'attribute_not_exists(pk)'}}
      ]}));return true;
    }catch(error){
      const e=error as any;
      if(e.name==='TransactionCanceledException'&&e.CancellationReasons?.some((x:any)=>x.Code==='ConditionalCheckFailed')&&e.CancellationReasons.every((x:any)=>['None','ConditionalCheckFailed'].includes(x.Code)))return false;
      throw error;
    }
  }
  async enqueue(event:CommittedWebhookEvent,endpoint:{id:string;revision:string;url:string}){
    if(!endpoint.id||!endpoint.revision)throw new Error('Missing endpoint binding');
    const row:OutboxRecord={version:1,revision:0,event:structuredClone(event),endpoint_id:endpoint.id,endpoint_revision:endpoint.revision,destination_sha256:digest(endpoint.url),
      state:'pending',code:null,endpoint_attention:false,next_attempt_at:event.envelope.occurred_at,first_attempt_at:null,updated_at:event.envelope.occurred_at,
      cycle:0,cycle_attempts:0,attempts:[],replays:[],claim:null};
    if(await this.write(row))return row;
    const prior=await this.get(event.envelope.event_id);
    if(!prior||prior.event.body!==event.body||prior.endpoint_id!==endpoint.id)throw new Error('Webhook event identity conflict');return prior;
  }
  async cas(before:OutboxRecord,after:OutboxRecord){
    if(after.revision!==before.revision+1||stableJson(after.event)!==stableJson(before.event)||after.endpoint_id!==before.endpoint_id||
      after.attempts.length<before.attempts.length||after.replays.length<before.replays.length||
      before.replays.some((a,i)=>stableJson(a)!==stableJson(after.replays[i]))||
      before.attempts.some((a,i)=>a.outcome!=='in_flight'&&stableJson(a)!==stableJson(after.attempts[i])))throw new Error('Webhook immutable identity changed');
    return this.write(after,before);
  }
  async *list(scope:WebhookScope){
    if(scopeKey(scope)!==scopeKey(this.scope))throw new Error('Outbox scope mismatch');
    let cursor:any;
    do{
      const page=await this.db.send(new QueryCommand({TableName:this.table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':{S:this.pk},':prefix':{S:'evt_'}},ConsistentRead:true,Limit:25,ExclusiveStartKey:cursor}));
      for(const item of page.Items??[])yield this.decode(item);
      cursor=page.LastEvaluatedKey;
    }while(cursor);
  }
}

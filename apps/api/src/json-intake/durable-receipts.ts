import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { sha256, stableJson } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';

type Sender={send(command:any):Promise<any>};
const validId=(id:string)=>/^rcpt_[a-f0-9]{64}$/.test(id);
/** Dedicated sandbox store. Immutable S3 bodies precede atomic latest/history pointers.
 * A crash before the transaction leaves an unreferenced body, never an accepted receipt. */
export class DurableReceiptStore implements ReceiptStore {
  constructor(readonly table:string,readonly bucket:string,readonly dynamo:Sender,readonly s3:Sender){
    if(!table||!bucket)throw new Error('Sandbox receipt storage is not configured');
  }
  async get(id:string):Promise<Receipt|null>{
    if(!validId(id))return null;
    const result=await this.dynamo.send(new GetItemCommand({TableName:this.table,Key:{pk:{S:id},sk:{S:'latest'}},ConsistentRead:true}));
    const row=result.Item;if(!row)return null;
    const revision=Number(row.revision?.N),digest=row.sha256?.S,key=row.object_key?.S;
    if(!Number.isSafeInteger(revision)||revision<0||!/^[a-f0-9]{64}$/.test(digest)||key!==`receipts/${id}/${revision}/${digest}.json`)throw new Error('Corrupt receipt pointer');
    const object=await this.s3.send(new GetObjectCommand({Bucket:this.bucket,Key:key}));
    const bytes=Buffer.from(await object.Body.transformToByteArray());
    if(bytes.length>4*1024*1024||sha256(bytes)!==digest)throw new Error('Corrupt receipt body');
    const r=JSON.parse(bytes.toString('utf8')) as Receipt;
    if(r.version!==1||r.receipt_id!==id||r.revision!==revision||r.fingerprint!==r.adapted?.fingerprint||r.signal?.customer_id!==r.identity?.customer_id)throw new Error('Corrupt receipt identity');
    return r;
  }
  private async write(after:Receipt,before?:Receipt){
    if(!validId(after.receipt_id)||after.version!==1||after.fingerprint!==after.adapted.fingerprint||after.identity.environment!=='test')throw new Error('Invalid sandbox receipt');
    const body=Buffer.from(stableJson(after)),digest=sha256(body),key=`receipts/${after.receipt_id}/${after.revision}/${digest}.json`;
    if(body.length>4*1024*1024)throw new Error('Receipt size exceeded');
    try{await this.s3.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:body,ContentType:'application/json',ServerSideEncryption:'AES256',IfNoneMatch:'*'}));}
    catch(error){if((error as any)?.$metadata?.httpStatusCode!==412 && (error as any)?.name!=='PreconditionFailed')throw error;}
    const item={pk:{S:after.receipt_id},revision:{N:String(after.revision)},object_key:{S:key},sha256:{S:digest}};
    try{
      await this.dynamo.send(new TransactWriteItemsCommand({TransactItems:[
        {Put:{TableName:this.table,Item:{...item,sk:{S:'latest'}},ConditionExpression:before?'#revision = :before AND #sha = :sha':'attribute_not_exists(pk)',
          ...(before?{ExpressionAttributeNames:{'#revision':'revision','#sha':'sha256'},ExpressionAttributeValues:{':before':{N:String(before.revision)},':sha':{S:sha256(Buffer.from(stableJson(before)))}}}:{})}},
        {Put:{TableName:this.table,Item:{...item,sk:{S:`revision#${String(after.revision).padStart(12,'0')}`}},ConditionExpression:'attribute_not_exists(pk)'}}
      ]}));return true;
    }catch(error){
      const e=error as any;
      if(e.name==='TransactionCanceledException' && e.CancellationReasons?.some((r:any)=>r.Code==='ConditionalCheckFailed') && e.CancellationReasons.every((r:any)=>['None','ConditionalCheckFailed'].includes(r.Code)))return false;
      throw error;
    }
  }
  async create(r:Receipt){if(r.revision!==0)throw new Error('Initial receipt revision must be zero');return this.write(r);}
  async compareAndSet(before:Receipt,after:Receipt){
    if(before.receipt_id!==after.receipt_id||after.revision!==before.revision+1||before.fingerprint!==after.fingerprint||stableJson(before.identity)!==stableJson(after.identity)||before.received_at!==after.received_at||stableJson(before.signal)!==stableJson(after.signal))throw new Error('Receipt immutable identity changed');
    return this.write(after,before);
  }
  async *pending():AsyncIterable<Receipt>{throw new Error('Sandbox receipt-only service has no asset worker');}
}

import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { DurableReceiptStore } from './durable-receipts.js';
import { sha256,stableJson } from './adapter.js';
import type { Receipt } from './local-store.js';
import { scopeKey,type WebhookScope } from '../webhooks/contract.js';
import { webhookScope } from './webhook-events.js';
type Sender={send(command:any):Promise<any>};
/** Explicit receipt allowlist avoids silently backfilling all historic customer orders. */
export class SandboxWebhookHistory {
  readonly store:DurableReceiptStore;
  constructor(readonly table:string,readonly bucket:string,readonly db:Sender,readonly s3:Sender,readonly scope:WebhookScope,readonly receiptIds:readonly string[]){
    if(scope.environment!=='test'||!Array.isArray(receiptIds)||!receiptIds.length||receiptIds.length>20||new Set(receiptIds).size!==receiptIds.length||receiptIds.some(id=>!/^rcpt_[a-f0-9]{64}$/.test(id)))throw new Error('Invalid receipt allowlist');
    this.store=new DurableReceiptStore(table,bucket,db,s3);
  }
  async *history():AsyncIterable<Receipt>{
    for(const id of this.receiptIds){
      const latest=await this.store.get(id);if(!latest)throw new Error('Allowlisted receipt missing');
      this.check(latest,id);
      if(latest.revision>250)throw new Error('Sandbox history limit');
      for(let revision=0;revision<=latest.revision;revision++){
        const result=await this.db.send(new GetItemCommand({TableName:this.table,Key:{pk:{S:id},sk:{S:`revision#${String(revision).padStart(12,'0')}`}},ConsistentRead:true}));
        const row=result.Item,digest=row?.sha256?.S,key=row?.object_key?.S;
        if(!/^[a-f0-9]{64}$/.test(digest??'')||row?.revision?.N!==String(revision)||key!==`receipts/${id}/${revision}/${digest}.json`)throw new Error('Invalid receipt history pointer');
        const object=await this.s3.send(new GetObjectCommand({Bucket:this.bucket,Key:key}));
        if(!object.ContentLength||object.ContentLength>4*1024*1024)throw new Error('Receipt history size limit');
        const bytes=Buffer.from(await object.Body.transformToByteArray());
        if(bytes.length>4*1024*1024||sha256(bytes)!==digest)throw new Error('Invalid receipt history digest');
        const r=JSON.parse(bytes.toString()) as Receipt;
        this.check(r,id);
        if(r.revision!==revision||r.fingerprint!==latest.fingerprint||stableJson(r.identity)!==stableJson(latest.identity))throw new Error('Receipt history identity changed');
        yield r;
      }
    }
  }
  private check(r:Receipt,id:string){
    if(r.version!==1||r.receipt_id!==id||scopeKey(webhookScope(r))!==scopeKey(this.scope)||r.identity.schema!=='stickerpress.order.v1')throw new Error('Receipt scope mismatch');
    if(r.fingerprint!==r.adapted.fingerprint||id!==`rcpt_${sha256(stableJson([r.identity.customer_id,r.identity.integration_id,r.identity.environment,r.identity.store,r.adapted.canonical.source.source_record_id]))}`)throw new Error('Receipt identity mismatch');
  }
}

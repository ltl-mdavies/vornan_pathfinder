import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DurableReceiptStore } from './durable-receipts.js';
import { createSandboxArtworkWorker } from './sandbox-artwork.js';
import { createHttpsAssetReader } from './https-assets.js';
import { createPdfInspector } from './pdf-inspection.js';
import { sha256 } from './adapter.js';

export const inspectSandboxPdf=createPdfInspector({policy_id:'sandbox-artwork-v1-review-only',metadata_tolerance_in:0.001,timeout_ms:5000,review_color:true,isolated_sandbox:true});

/** Dedicated scheduled Lambda; no HTTP handler, provider client, credentials secret or shared ledger. */
export async function handler(event:{receipt_id?:string},context?:{getRemainingTimeInMillis():number}) {
 if(process.env.ARTWORK_ENABLED!=='true')return {enabled:false};
 const table=process.env.SANDBOX_RECEIPTS_TABLE!,bucket=process.env.SANDBOX_RECEIPTS_BUCKET!;
 const customerId=process.env.ARTWORK_CUSTOMER_ID!,integrationId=process.env.ARTWORK_INTEGRATION_ID!,host=process.env.ARTWORK_ALLOWED_HOST!;
 if(!table||!bucket||!customerId||!integrationId||!host)throw new Error('Worker configuration missing');
 const db=new DynamoDBClient({}),s3=new S3Client({});
 const store=new DurableReceiptStore(table,bucket,db,s3);
 const read=createHttpsAssetReader({allowed_hosts:[host],timeout_ms:20000,max_redirects:0});
 const key=(scope:string,digest:string)=>`worker-originals/${sha256(scope)}/${digest}.pdf`;
 const transport={kind:'review-assets' as const,read,
  retain:async(scope:string,bytes:Buffer)=>{
   const ref=key(scope,sha256(bytes));
   try{await s3.send(new PutObjectCommand({Bucket:bucket,Key:ref,Body:bytes,ContentType:'application/pdf',ServerSideEncryption:'AES256',IfNoneMatch:'*'}));}
   catch(e){if((e as any).$metadata?.httpStatusCode!==412)throw e;}
   return ref;
  },
  readRetained:async(scope:string,ref:string)=>{
   const match=ref.match(/^worker-originals\/[a-f0-9]{64}\/([a-f0-9]{64})\.pdf$/);
   if(!match || ref!==key(scope,match[1]))throw new Error('Retained scope mismatch');
   const obj=await s3.send(new GetObjectCommand({Bucket:bucket,Key:ref}));
   if(!obj.ContentLength || obj.ContentLength>25*1024*1024)throw new Error('Retained size invalid');
   const bytes=Buffer.from(await obj.Body!.transformToByteArray());
   if(sha256(bytes)!==match[1])throw new Error('Retained digest mismatch');return bytes;
  },
  inspect:inspectSandboxPdf
 };
 const processReceipt=createSandboxArtworkWorker({store,transport,customerId,integrationId});
 if(event.receipt_id){if(!/^rcpt_[a-f0-9]{64}$/.test(event.receipt_id))throw new Error('Invalid receipt');return {result:await processReceipt(event.receipt_id)};}
 let cursor:Record<string,any>|undefined;let processed=0;
 do {
  const result=await db.send(new ScanCommand({TableName:table,ProjectionExpression:'pk,sk',FilterExpression:'sk = :latest',ExpressionAttributeValues:{':latest':{S:'latest'}},ExclusiveStartKey:cursor,ConsistentRead:true}));
  for(const row of result.Items??[]){
   if((context?.getRemainingTimeInMillis()??120000)<35000)return {processed};
   try{await processReceipt(row.pk.S!);}catch{console.warn('SANDBOX_ARTWORK_RECEIPT_FAILED');}processed++;
  }
  cursor=result.LastEvaluatedKey;
 }while(cursor && (context?.getRemainingTimeInMillis()??120000)>35000);
 return {processed};
}

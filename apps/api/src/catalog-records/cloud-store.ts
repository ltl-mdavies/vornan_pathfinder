import {validCatalogCustomerId} from './customer-access.js';
import {DynamoDBClient,GetItemCommand,PutItemCommand} from '@aws-sdk/client-dynamodb';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {reviewedDataHash} from './content-hash.js';
import {emptyDraftState,type DraftRepository,type DraftState,type JsonRecord} from './storage-contract.js';
type Sender={send(command:any):Promise<any>};
/** S3 immutable evidence + one strongly-consistent, conditionally replaced customer manifest. */
export class CloudCatalogDraftRepository implements DraftRepository {
 constructor(readonly config:{table:string;bucket:string;prefix:string;kind?:'catalog';customerId:string},readonly dynamo:Sender=new DynamoDBClient({}),readonly s3:Sender=new S3Client({})){
  if(!validCatalogCustomerId(config.customerId))throw new Error('Invalid catalog storage customer identity.');
  if(!config.table||!config.bucket||!/^catalog-drafts\/[A-Za-z0-9/-]+\/$/.test(config.prefix))throw new Error('Explicit catalog draft storage configuration is required.');
 }
 private get key(){return {pk:{S:`${this.config.kind==='catalog'?'catalog-records':'catalog-drafts'}#${this.config.customerId}`},sk:{S:'manifest#v1'}};}
 private get blobPrefix(){return `${this.config.prefix}${this.config.customerId}/${this.config.kind==='catalog'?'catalog/':''}blobs/`;}
 async read():Promise<DraftState>{const result=await this.dynamo.send(new GetItemCommand({TableName:this.config.table,Key:this.key,ConsistentRead:true}));if(!result.Item)return emptyDraftState();const state=JSON.parse(result.Item.document.S);if(state.revision!==Number(result.Item.revision.N))throw new Error('Draft manifest integrity failure.');return state;}
 async blob(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid snapshot identity.');const result=await this.s3.send(new GetObjectCommand({Bucket:this.config.bucket,Key:`${this.blobPrefix}${hash}.json`}));const value=JSON.parse(await result.Body.transformToString());if(reviewedDataHash(value)!==hash)throw new Error('Draft snapshot integrity failure.');return value;}
 async put(value:JsonRecord){const hash=reviewedDataHash(value);try{await this.s3.send(new PutObjectCommand({Bucket:this.config.bucket,Key:`${this.blobPrefix}${hash}.json`,Body:JSON.stringify(value),ContentType:'application/json',IfNoneMatch:'*'}));}catch(e){if((e as any).$metadata?.httpStatusCode!==412)throw e;await this.blob(hash);}return hash;}
 async commit(expected:number,state:DraftState){
  if(state.revision!==expected+1)throw new Error('Invalid revision sequence.');
  const document=JSON.stringify(state);if(Buffer.byteLength(document)>350000)throw new Error('Draft manifest capacity requires storage migration; existing evidence is preserved.');
  try{await this.dynamo.send(new PutItemCommand({TableName:this.config.table,Item:{...this.key,revision:{N:String(state.revision)},document:{S:document}},ConditionExpression:expected===0?'attribute_not_exists(pk)':'revision = :expected',...(expected?{ExpressionAttributeValues:{':expected':{N:String(expected)}}}:{})}));return true;}catch(e){if((e as any).name==='ConditionalCheckFailedException')return false;throw e;}
 }
}

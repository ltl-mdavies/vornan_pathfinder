import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { authenticate, type TestCredential } from './auth.js';
import { IntakeError, stickerPressV1 } from './adapter.js';
import { DurableReceiptStore } from './durable-receipts.js';
import { JsonIntakeService, receiptResponse, statusResponse } from './service.js';

type Event={rawPath?:string;requestContext?:{http?:{method?:string}};headers?:Record<string,string|undefined>;body?:string|null;isBase64Encoded?:boolean};
type Intake=Pick<JsonIntakeService,'now'|'receive'|'lookup'>;
/** Separate endpoint with machine auth; does not import the shared server or run asset/Lift workers. */
export function createSandboxHandler(deps:{enabled:()=>boolean;credentials:()=>Promise<TestCredential[]>;service:Intake}){
  return async(event:Event)=>{
    const reply=(statusCode:number,body:unknown)=>({statusCode,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify(body)});
    const path=event.rawPath??'',method=event.requestContext?.http?.method;
    if(path==='/health'&&method==='GET')return reply(200,{service:'pathfinder-json-intake-sandbox',intake_enabled:deps.enabled(),lift_submission_enabled:false,asset_processing_enabled:false,callback_delivery_enabled:false});
    if(!deps.enabled())return reply(404,{code:'NOT_FOUND'});
    if(!(path==='/api/v1/intake/orders'&&method==='POST') && !(method==='GET'&&/^\/api\/v1\/intake\/orders\/rcpt_[a-f0-9]{64}$/.test(path)))return reply(404,{code:'NOT_FOUND'});
    try{
      const headers=Object.fromEntries(Object.entries(event.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
      const identity=authenticate(headers.authorization,await deps.credentials(),method==='POST'?'orders:write':'orders:read',deps.service.now());
      if(method==='GET')return reply(200,statusResponse(await deps.service.lookup(identity,path.split('/').at(-1)!)));
      if(headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new IntakeError(415,'JSON_REQUIRED');
      const raw=Buffer.from(event.body??'',event.isBase64Encoded?'base64':'utf8');if(raw.length>1024*1024)throw new IntakeError(413,'PAYLOAD_TOO_LARGE');
      let payload:unknown;try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new IntakeError(400,'INVALID_JSON');}
      const {receipt,replayed}=await deps.service.receive(identity,payload,raw);
      return reply(replayed?200:202,receiptResponse(receipt,replayed));
    }catch(e){
      if(e instanceof IntakeError)return reply(e.status,{code:e.code,...(e.issues.length?{issues:e.issues}:{})});
      return reply(503,{code:'INTAKE_TEMPORARILY_UNAVAILABLE'});
    }
  };
}
let runtime:ReturnType<typeof createSandboxHandler>|undefined;
export async function handler(event:Event){
  if(!runtime){
    const table=process.env.SANDBOX_RECEIPTS_TABLE!,bucket=process.env.SANDBOX_RECEIPTS_BUCKET!,secret=process.env.SANDBOX_CREDENTIALS_SECRET_ARN!;
    if(!table||!bucket||!secret)throw new Error('Sandbox configuration missing');
    const store=new DurableReceiptStore(table,bucket,new DynamoDBClient({}),new S3Client({}));
    const secrets=new SecretsManagerClient({});
    runtime=createSandboxHandler({enabled:()=>process.env.SANDBOX_INTAKE_ENABLED==='true',service:new JsonIntakeService(store,null,[stickerPressV1]),
      credentials:async()=>{
        const value=await secrets.send(new GetSecretValueCommand({SecretId:secret}));
        const parsed=JSON.parse(value.SecretString??'null');
        if(!Array.isArray(parsed)||parsed.length>10)throw new Error('Invalid sandbox credentials');
        return parsed;
      }});
  }
  return runtime(event);
}

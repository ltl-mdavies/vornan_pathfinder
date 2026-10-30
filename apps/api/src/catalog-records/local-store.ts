import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {publishImmutable} from '../json-intake/local-store.js';
import {reviewedDataHash} from './content-hash.js';
import {emptyDraftState,type DraftRepository,type DraftState,type JsonRecord} from './storage-contract.js';
/** Durable localhost implementation. Never use local disks as a Lambda store. */
export class LocalCatalogDraftRepository implements DraftRepository {
 constructor(readonly root:string){if(process.env.AWS_LAMBDA_FUNCTION_NAME||process.env.PATHFINDER_RUNTIME==='lambda')throw new Error('Local draft storage is not allowed in Lambda.');}
 async read():Promise<DraftState>{
  let names:string[];try{names=await readdir(join(this.root,'revisions'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return emptyDraftState();throw e;}
  const revisions=names.filter(n=>/^\d+\.json$/.test(n)).map(n=>Number(n.slice(0,-5))).sort((a,b)=>b-a);if(!revisions.length)return emptyDraftState();
  const state=JSON.parse(await readFile(join(this.root,'revisions',`${revisions[0]}.json`),'utf8'));if(state.revision!==revisions[0])throw new Error('Draft manifest integrity failure.');return state;
 }
 async blob(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid blob identity.');const value=JSON.parse(await readFile(join(this.root,'blobs',`${hash}.json`),'utf8'));if(reviewedDataHash(value)!==hash)throw new Error('Draft snapshot integrity failure.');return value;}
 async put(value:JsonRecord){const hash=reviewedDataHash(value);await publishImmutable(join(this.root,'blobs',`${hash}.json`),Buffer.from(JSON.stringify(value)));return hash;}
 async commit(expected:number,state:DraftState){if(state.revision!==expected+1)throw new Error('Invalid revision sequence.');if((await this.read()).revision!==expected)return false;return publishImmutable(join(this.root,'revisions',`${state.revision}.json`),Buffer.from(JSON.stringify(state)));}
}

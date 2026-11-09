import {createHash} from 'node:crypto';
import {scope} from '../proof-control-cas/control-cas.mjs';
import {digest} from '../proof-approval-lifecycle/lifecycle.mjs';
export const bodyHash=body=>createHash('sha256').update(body).digest('hex');
const fail=()=>{throw Error('Retained-anchor verification failed; stop and reconcile');};
const match=(r,a)=>r&&a&&typeof a.versionId==='string'&&a.versionId!=='null'&&r.versionId===a.versionId&&Buffer.isBuffer(r.body)&&bodyHash(r.body)===a.bodySha256;
export function anchoredStorage({mode,storage,retention,verification}){
 if(mode!=='mock-only'||storage?.kind!=='synthetic'||retention?.kind!=='synthetic'||verification?.purpose!=='publish'||verification?.evidenceKind!=='recorded-human-verification')fail();
 let stopped=false;
 const load=async()=>{
  const retained=structuredClone(await retention.load(verification.context.releaseId));
  if(!retained||retained.contextDigest!==digest(verification.context)||!retained.anchor||retained.pending||retained.ownerRecordRef!==verification.privateRecordRef)fail();
  return retained;
 };
 return Object.freeze({kind:'synthetic',
  async get(request){
   try{
    if(digest(request)!==digest(scope))fail();
    const retained=await load(),current=await storage.get(scope);if(!match(current,retained.anchor))fail();
    return current;
   }catch{fail();}
  },
  async put(request){
   if(stopped)fail();
   try{
    if(request.bucket!==scope.bucket||request.key!==scope.key||request.ifNoneMatch!==undefined||typeof request.ifMatch!=='string'||request.encryption!=='AES256'||!Buffer.isBuffer(request.body))fail();
    const retained=await load(),before=await storage.get(scope);if(!match(before,retained.anchor)||before.etag!==request.ifMatch)fail();
    const pending={contextDigest:digest(verification.context),prior:retained.anchor,candidateSha256:bodyHash(request.body)};
    // Real retained record path/permissions remain unapplied. Lost intent ack stops.
    await retention.intent(pending);
    const ack=await storage.put(request);
    const after=await storage.get(scope);
    if(!ack||ack.versionId!==after?.versionId||after.versionId===before.versionId||bodyHash(after.body)!==pending.candidateSha256)fail();
    const next={versionId:after.versionId,bodySha256:pending.candidateSha256};
    await retention.confirm({pending,next});
    const readback=await load();if(digest(readback.anchor)!==digest(next))fail();
    return ack;
   }catch{stopped=true;fail();}
  }
 });
}

import {boundedBytes} from '../proof-guarded-publisher/bounded-io.mjs';import {sha256} from '../proof-guarded-publisher/controller.mjs';import {validVersionId} from '../proof-disabled-sdk/version-id.mjs';
import {validateOffline,invocationKeys} from './contract.mjs';
import {digest} from '../proof-approval-lifecycle/lifecycle.mjs';
/** Local composition only: validates the existing contract before any storage call.
 * Retained data remains unauthenticated; this is not a live approval adapter.
 */
export async function retainOfflineApproval({client,bucket,input,archive,now}){
 if(client?.kind!=='synthetic')throw Error('Isolated client required');
 // Snapshot caller-owned data before validation/async retention to avoid mutation.
 const snapshot=structuredClone(input);
 const validated=validateOffline(snapshot,archive,{now});
 if(snapshot.mode!=='publish')throw Error('Recovery remains read-only');
 if(bucket!==validated.finalReceipt.bucket)throw Error('Evidence bucket mismatch');
 const ref=await retainReference(client,bucket,invocationKeys(snapshot).authority,snapshot);
 return {ref,integrityVerified:true,authenticatedAuthority:false,operationallyReady:false};
}
/** Local final-receipt rehearsal only. Reuses the existing receipt shape and
 * exact-version reader; neither retained input nor its hash grants authority.
 * No publisher, credential acquisition, or operational entry is called here.
 */
export async function retainOfflineFinal({client,bucket,input,archive,now,source,authority}){
 if(client?.kind!=='synthetic')throw Error('Isolated client required');
 const snapshot=structuredClone(input),sourceRef=structuredClone(source),authorityRef=structuredClone(authority);
 const validated=validateOffline(snapshot,archive,{now});
 if(snapshot.mode!=='publish')throw Error('Recovery remains read-only');
 if(bucket!==validated.finalReceipt.bucket||authorityRef?.key!==invocationKeys(snapshot).authority)throw Error('Evidence scope mismatch');
 const sourceKey=authorityRef.key.split('invocations/')[0]+`source-${snapshot.sourceRunId}-${snapshot.sourceAttempt}.json`;
 if(sourceRef?.key!==sourceKey)throw Error('Source scope mismatch');
 const retainedSource=await readReference(client,bucket,sourceRef);
 if(digest(retainedSource.value)!==digest(snapshot.sourceRecord))throw Error('Retained source mismatch');
 const retained=await readReference(client,bucket,authorityRef);
 // Compare canonical contract inputs, not an affirmative flag on an observation.
 if(digest(retained.value)!==digest(snapshot))throw Error('Retained invocation mismatch');
 const ref=await retainReference(client,bucket,validated.finalReceipt.key,{status:'isolated-only',source:sourceRef,authority:authorityRef});
 return {ref,integrityVerified:true,authenticatedAuthority:false,operationallyReady:false,handoffComplete:false,automaticRetry:false};
}
/** Isolated integrity plumbing. Never authenticates owner/run provenance. */
export async function readReference(client,bucket,ref){
 if(client.kind!=='synthetic'||!validVersionId(ref.versionId)||!/^[a-f0-9]{64}$/.test(ref.bodySha256))throw Error('Reference');
 const r=await client.get({Bucket:bucket,Key:ref.key});const body=await boundedBytes(r.Body,{maxBytes:128*1024,contentLength:r.ContentLength});if(r.VersionId!==ref.versionId||sha256(body)!==ref.bodySha256)throw Error('Evidence mismatch');return{value:JSON.parse(body),integrityVerified:true,authenticatedAuthority:false};
}
export async function retainReference(client,bucket,key,value){
 if(client.kind!=='synthetic'||typeof client.close!=='function')throw Error('Closable isolated session required');
 const body=Buffer.from(JSON.stringify(value));
 try{const ack=await client.put({key,body}),ref={key,versionId:ack.versionId,bodySha256:sha256(body)};await readReference(client,bucket,ref);return ref;}
 catch{client.close();throw Error('Retention uncertain; session closed; use separate read-only recovery');}
}
export function requireTrustedAuthority(){throw Error('HOLD: supervised owner trusted acquisition not connected; schema and hash checks are not authentication');}

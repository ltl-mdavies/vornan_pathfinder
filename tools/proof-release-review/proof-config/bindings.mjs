import {readFileSync,lstatSync} from 'node:fs';import {createHash} from 'node:crypto';
const pins=JSON.parse(readFileSync(new URL('./pins.json',import.meta.url)));
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const fail=()=>{throw Error('Pinned configuration rejected');};
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
export function validateBindingBytes(bytes,profile){
 if(!['fixture','private'].includes(profile)||!Buffer.isBuffer(bytes)||bytes.length>8192||createHash('sha256').update(bytes).digest('hex')!==pins[profile])fail();
 let b;try{b=JSON.parse(bytes);}catch{fail();}
 if(!exact(b,['target','reviewedRewrite','originId','repository','ownerId','environments','releaseId','control'])||!exact(b.target,['account','bucket','distribution','origin','region'])||!exact(b.reviewedRewrite,['name','arn','etag','sha256','stage'])||!exact(b.environments,['proof-release-owner','proof-release-recovery'])||!exact(b.control,['bucket','key']))fail();
 if(!/^\d{12}$/.test(b.target.account)||!/^https:\/\/[a-z0-9.-]+$/.test(b.target.origin)||!/^[-a-z0-9]+\/[-a-z0-9_]+$/.test(b.repository)||!Number.isSafeInteger(b.ownerId)||b.ownerId<=0||Object.values(b.environments).some(x=>!Number.isSafeInteger(x)||x<=0)||b.reviewedRewrite.stage!=='LIVE'||!/^[a-f0-9]{64}$/.test(b.reviewedRewrite.sha256))fail();
 return freeze(b);
}
const profile=process.env.PROOF_REVIEW_PROFILE??'private';
if(!['fixture','private'].includes(profile))fail();
const source=new URL(profile==='fixture'?'../test-fixtures/bindings.json':'../../private/bindings.json',import.meta.url);
if(lstatSync(source).isSymbolicLink())fail();
export const bindings=validateBindingBytes(readFileSync(source),profile);

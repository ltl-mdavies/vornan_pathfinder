import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import{publish,rollback,sha256}from'./controller.mjs';import{createTransport,target}from'./transport.mjs';import{releaseRecord,createJournal,openJournal,reconcileReadOnly}from'./recovery.mjs';
async function fixture(failure){
 const old=Buffer.from('old'),html=Buffer.from('new'),asset=Buffer.from('asset'),abort=new AbortController(),calls=[];
 const config={Aliases:{Items:['proof.example.invalid']},DefaultRootObject:'index.html',Origins:{Items:[{Id:'fixture-origin',DomainName:target.bucket+'.s3.us-east-1.amazonaws.com',OriginPath:''}]},DefaultCacheBehavior:{TargetOriginId:'fixture-origin',FunctionAssociations:{Quantity:0},LambdaFunctionAssociations:{Quantity:0}},CacheBehaviors:{Quantity:0}};
 const metadata={ContentType:'text/html',CacheControl:'private,max-age=17',ServerSideEncryption:'AES256'};
 const objects=new Map([['index.html',{bytes:old,VersionId:'v1',ETag:'e1',Metadata:{},...metadata}]]);let version=1;
 async function send(c){calls.push(c);const p=c.input;if(c.operation==='GetCallerIdentity')return{Account:target.account};if(c.operation==='GetBucketVersioning')return{Status:'Enabled'};if(c.operation==='GetDistributionConfig')return{ETag:'config',DistributionConfig:config};if(c.operation==='GetObject'){const o=objects.get(p.Key);if(!o)throw Object.assign(Error('missing'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});return{...o,Body:o.bytes};}if(c.operation==='PutObject'){
   const current=objects.get(p.Key);if(p.IfNoneMatch&&current||p.IfMatch&&p.IfMatch!==current?.ETag)throw Object.assign(Error('condition'),{name:'PreconditionFailed',$metadata:{httpStatusCode:412}});
   if(p.Key==='index.html'&&failure==='before-accept')throw Error('network sentinel');
   const o={bytes:p.Body,VersionId:'v'+(++version),ETag:'e'+version,Metadata:p.Metadata,ContentType:p.ContentType,CacheControl:p.CacheControl,ContentEncoding:p.ContentEncoding,ServerSideEncryption:p.ServerSideEncryption};objects.set(p.Key,o);
   if(p.Key==='index.html'&&['lost','cancel'].includes(failure)){if(failure==='cancel')abort.abort();throw Error('secret sentinel');}return o;
  }throw Error('unexpected operation');}
 const fetchPublic=async url=>({url,status:200,redirected:false,body:objects.get(new URL(url).pathname.slice(1)).bytes});
 const options={mode:'mock-only',send,fetchPublic,signal:abort.signal,appendReceipt:async()=>{throw Error('not wired');}};
 const reader=createTransport({...options,mode:'mock-read-only'});await reader.initialize();
 const baseline={index:await reader.read('index.html'),configFingerprint:sha256(Buffer.from(JSON.stringify(config))),configEtag:'config'};
 const files=new Map([['index.html',html],['assets/file-12345678.js',asset]]),assets=[...files].map(([key,b])=>({key,sha256:sha256(b)}));
 const input={releaseId:'release-recovery-test',baseline,assets,files},rollbackAssets=[{key:'index.html',sha256:sha256(old)}];
 const record=releaseRecord(input,rollbackAssets,{artifactSha256:'a'.repeat(64),sourceManifestSha256:'b'.repeat(64)}),dir=fs.mkdtempSync(join(tmpdir(),'proof-recovery-test-')),journal=createJournal(dir,record);
 const appendReceipt=async r=>{if(failure==='receipt'&&r.phase==='response'&&r.key==='index.html')throw Error('secret sentinel');return journal.appendReceipt(r);};
 const io=createTransport({...options,appendReceipt});await io.initialize();
 async function fresh(){const t=createTransport({...options,signal:undefined,mode:'mock-read-only',appendReceipt:async()=>{throw Error('Read-only');}});await t.initialize();return t;}
 return{input,io,fresh,dir,objects,calls,journal,rollbackAssets,rollbackFiles:new Map([['index.html',old]])};
}
for(const failure of ['lost','receipt','cancel'])test('restart recovers accepted index without retry: '+failure,async()=>{
 const f=await fixture(failure);if(failure==='cancel')await assert.rejects(()=>publish(f.input,f.io,{mode:'execute'}));else assert.equal((await publish(f.input,f.io,{mode:'execute'})).status,'published-response-reconciled');
 // Deserialize through an actual new Node process, not retained in-memory controller state.
 const moduleUrl=new URL('./recovery.mjs',import.meta.url).href;
 const record=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import{openJournal}from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(openJournal(process.argv[1]).record))`,f.dir],{encoding:'utf8'}));
 const readOnly=await f.fresh(),result=await reconcileReadOnly(record,readOnly);assert.equal(result.status,'publication-recovered');assert.equal(result.receipt.previous.metadata.cacheControl,'private,max-age=17');
 assert.equal(f.calls.filter(c=>c.operation==='PutObject'&&c.input.Key==='index.html').length,1);
 await assert.rejects(()=>readOnly.replaceIndex(Buffer.from('x'),{}),/Read-only/);
});
test('persisted intent prevents duplicate attempted write after restart',async()=>{const f=await fixture('before-accept');assert.equal((await publish(f.input,f.io,{mode:'execute'})).status,'index-write-unconfirmed-unchanged');const journal=openJournal(f.dir);await assert.rejects(()=>journal.appendReceipt({phase:'intent',key:'index.html',releaseId:f.input.releaseId,sha256:sha256(f.input.files.get('index.html')),condition:f.input.baseline.index.etag}));assert.equal((await reconcileReadOnly(journal.record,await f.fresh())).status,'unchanged-unconfirmed');assert.equal(f.calls.filter(c=>c.operation==='PutObject'&&c.input.Key==='index.html').length,1);});
test('superseding same-byte release is neither recovered nor rolled back',async()=>{const f=await fixture('lost');const published=await publish(f.input,f.io,{mode:'execute'});const o=f.objects.get('index.html');f.objects.set('index.html',{...o,VersionId:'v-other',ETag:'e-other',Metadata:{'release-id':'other-release','parent-version':o.VersionId}});const before=f.calls.filter(c=>c.operation==='PutObject').length;assert.equal((await reconcileReadOnly(openJournal(f.dir).record,await f.fresh())).status,'superseded-unconfirmed');await assert.rejects(()=>rollback(published.receipt,f.rollbackAssets,f.rollbackFiles,f.io,{mode:'execute',rollbackId:'rollback-test'}),/drift/);assert.equal(f.calls.filter(c=>c.operation==='PutObject').length,before);});
test('release record integrity and exclusive creation',async()=>{const f=await fixture('lost');assert.throws(()=>createJournal(f.dir,f.journal.record));const p=f.dir+'/release.json',e=JSON.parse(fs.readFileSync(p));e.record.parentVersion='tampered';fs.writeFileSync(p,JSON.stringify(e));assert.throws(()=>openJournal(f.dir),/integrity/);});

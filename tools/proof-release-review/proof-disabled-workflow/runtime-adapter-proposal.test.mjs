import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {resolve,dirname,join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {readReleaseInput} from '../proof-config/release-inputs.mjs';
import {bindings} from '../proof-config/bindings.mjs';import {releaseRecord} from '../proof-guarded-publisher/recovery.mjs';import {packageApprovalPreview} from './contract.mjs';
const source=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=n=>JSON.parse(readReleaseInput(n));
const git=(cwd,args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function commit(root,paths){git(root,['init','-q']);git(root,['add','--',...paths]);git(root,['-c','user.name=Local Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Synthetic validation fixture']);return git(root,['rev-parse','HEAD']);}
function write(root,name,value){const path=resolve(root,name);fs.mkdirSync(dirname(path),{recursive:true});fs.writeFileSync(path,value);}
function fixture(t){
 const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'proof-runtime-fixture-')),verifier=resolve(root,'verifier'),pkg=resolve(verifier,'tools/proof-release-review');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(source,pkg,{recursive:true,filter:p=>!p.split('/').includes('node_modules'),verbatimSymlinks:true});
 const toolingCommit=commit(verifier,['tools/proof-release-review']);
 const files=git(verifier,['ls-files','--','tools/proof-release-review']).split('\n').map(p=>{const bytes=fs.readFileSync(resolve(verifier,p));return{path:p.slice('tools/proof-release-review/'.length),bytes:bytes.length,sha256:hash(bytes)};});
 const inventory=Buffer.from(JSON.stringify({files}));
 const workflow=fs.readFileSync(resolve(pkg,'proof-disabled-workflow/validation-only.yml.template'));
 const prior=read('proof-release-prep/baseline-and-plan.json'),plan=read('proof-oidc-release-draft/release-plan.json'),i=prior.objects.find(o=>o.key==='index.html');
 const tooling={repository:bindings.repository,commit:toolingCommit,workflowPath:'.github/workflows/proof-validation-only.yml',workflowSha256:hash(workflow),inventorySha256:hash(inventory)};
 const record=releaseRecord({releaseId:bindings.releaseId,assets:read('proof-pdf6-candidate/freeze.json').assets.map(a=>({key:a.path,sha256:a.sha256})),baseline:{index:{versionId:i.VersionId,etag:i.ETag,sha256:i.sha256,metadata:{contentType:i.ContentType,cacheControl:i.CacheControl??null,contentEncoding:i.ContentEncoding??null,serverSideEncryption:i.ServerSideEncryption}},configFingerprint:prior.distributionConfigSha256,configEtag:prior.distributionETag}},prior.objects.map(o=>({key:o.key,sha256:o.sha256})),{sourceManifestSha256:hash(readReleaseInput('proof-pdf6-candidate/manifest.json')),artifactSha256:plan.candidateArchiveSha256,tooling});
 const recordBytes=Buffer.from(JSON.stringify(record));
 write(root,'validation/pins.json',JSON.stringify({record:{bytes:recordBytes.length,sha256:hash(recordBytes)},inventory:{bytes:inventory.length,sha256:hash(inventory)},toolingCommit}));
 write(root,'validation/source-inventory.json',inventory);write(root,tooling.workflowPath,workflow);
 const launcherCommit=commit(root,['validation','.github']);write(root,'private/validation-release-record.json',recordBytes);
 const invocation={mode:'publish',runId:'123',attempt:'1',jobId:'456'},preview=packageApprovalPreview(record,invocation,tooling,'validation-only');
 const job={id:456,run_id:123,run_attempt:1,head_sha:launcherCommit,name:'Proof validation only',status:'in_progress',conclusion:null};
 const data={jobs:{total_count:1,jobs:[job]},run:{id:123,run_attempt:1,head_sha:launcherCommit,path:tooling.workflowPath,repository:{full_name:bindings.repository},head_repository:{full_name:bindings.repository},head_branch:'main',event:'workflow_dispatch',status:'in_progress',conclusion:null},reviews:[{state:'approved',user:{id:bindings.ownerId,type:'User'},environments:[{id:preview.environmentId,name:preview.environment}],comment:preview.statement}],environment:{id:preview.environmentId,name:preview.environment,can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:bindings.ownerId}}]},{type:'branch_policy'}]},policy:{total_count:1,branch_policies:[{id:301,name:'main',type:'branch'}]}};
 const env={...process.env,PROOF_REVIEW_PROFILE:'fixture',GITHUB_WORKSPACE:root,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:bindings.repository,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:launcherCommit,GITHUB_WORKFLOW_SHA:launcherCommit,GITHUB_JOB:'validate',GITHUB_WORKFLOW_REF:`${bindings.repository}/${tooling.workflowPath}@refs/heads/main`,GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com',GITHUB_RUN_ID:'123',GITHUB_TOKEN:'synthetic-never-print',PROOF_TEST_NETWORK_FILE:resolve(root,'network.json'),PROOF_TEST_CALLS_FILE:resolve(root,'calls.txt')};
 return{root,pkg,env,data,record,tooling,run(){write(root,'network.json',JSON.stringify(data));const r=spawnSync(process.execPath,['--import',resolve(pkg,'proof-disabled-workflow/runtime-test-network.mjs'),resolve(pkg,'proof-disabled-workflow/runtime-validation-proposal.mjs')],{env,encoding:'utf8',timeout:20000});assert.equal(r.error,undefined);assert.ok(!r.stdout.includes('synthetic-never-print'));return{result:JSON.parse(r.stdout),exit:r.status,calls:Number(fs.readFileSync(env.PROOF_TEST_CALLS_FILE,'utf8'))};}};
}
test('complete adapter loads distinct launcher/verifier, bounded record and real transport/composition with intercepted HTTP',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.exit,0);assert.equal(r.calls,13);assert.equal(r.result.status,'snapshot-matches-NOT-AUTHORIZED');assert.equal(r.result.authenticatedAuthority,false);assert.equal(r.result.operationallyReady,false);assert.equal(r.result.validationOnly,true);
});
for(const [name,mutate,network]of [
 ['record bytes',f=>fs.appendFileSync(resolve(f.root,'private/validation-release-record.json'),'x'),false],
 ['record symlink',f=>{const p=resolve(f.root,'private/validation-release-record.json');fs.renameSync(p,p+'.saved');fs.symlinkSync(p+'.saved',p);},false],
 ['verifier bytes',f=>fs.appendFileSync(resolve(f.pkg,'proof-disabled-workflow/runtime-context-proposal.mjs'),'\n// drift'),false],
 ['workflow bytes',f=>fs.appendFileSync(resolve(f.root,f.tooling.workflowPath),'\n# drift'),false],
 ['launcher identity',f=>f.env.GITHUB_WORKFLOW_SHA='a'.repeat(40),false],
 ['missing credential',f=>delete f.env.GITHUB_TOKEN,false],
 ['failed credential',f=>f.data.httpStatus=401,true],
 ['pagination',f=>f.data.pagination=true,true],
 ['cancelled job',f=>f.data.jobs.jobs[0].conclusion='cancelled',true],
 ['cancelled run',f=>f.data.run.conclusion='cancelled',true],
 ['unavailable approval',f=>f.data.reviews=[],true],
 ['release consent',f=>f.data.reviews[0].comment=packageApprovalPreview(f.record,{mode:'publish',runId:'123',attempt:'1',jobId:'456'},f.tooling).statement,true],
 ['missing pending job identity',f=>{f.data.jobs.jobs=[];f.data.jobs.total_count=0;},true],
])test('full adapter rejects '+name,t=>{const f=fixture(t);mutate(f);const r=f.run();assert.equal(r.exit,78);assert.equal(r.result.status,'blocked');assert.equal(r.result.operationallyReady,false);assert.equal(r.calls>0,network);});
for(const helper of ['diff.external','diff.fixture.textconv','core.fsmonitor'])test('repository '+helper+' cannot execute a helper',t=>{
 const f=fixture(t),marker=resolve(f.root,'must-not-exist');
 git(f.root,['config',helper,`touch ${marker}`]);
 if(helper==='diff.fixture.textconv')write(f.root,'.git/info/attributes','* diff=fixture\n');
 fs.appendFileSync(resolve(f.root,f.tooling.workflowPath),'\n# changed');
 const r=f.run();assert.equal(r.exit,78);assert.equal(r.calls,0);assert.equal(fs.existsSync(marker),false);
});
test('stalled PATH-selected Git is killed at its command deadline before network',t=>{
 const f=fixture(t),bin=process.env.PROOF_TEST_STALLED_GIT_DIR??resolve(f.root,'test-bin');
 // Offline Linux harness supplies the same fixture from its read-only mount;
 // executable test files cannot live on its noexec temporary filesystem.
 if(!process.env.PROOF_TEST_STALLED_GIT_DIR){fs.mkdirSync(bin);write(f.root,'test-bin/git','#!/bin/sh\nexec /bin/sleep 30\n');fs.chmodSync(resolve(bin,'git'),0o755);}
 f.env.PATH=bin+':'+process.env.PATH;
 const start=Date.now(),r=f.run(),elapsed=Date.now()-start;
 assert.equal(r.exit,78);assert.equal(r.calls,0);assert.ok(elapsed>=4500&&elapsed<12000);
});

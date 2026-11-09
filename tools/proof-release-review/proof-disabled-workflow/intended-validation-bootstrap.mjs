// INACTIVE REVIEW SOURCE. Intended location: proof-disabled-workflow/.
// Not installed, no top-level invocation, no changes to existing HOLD exports.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeBootstrapForReview} from './isolated-child-proposal.mjs';
import {readBoundedPinnedFile} from '../proof-config/release-inputs.mjs';
const account='744016783602',bucket='vornan-pathfinder-artifacts';
const repository='ltl-mdavies/vornan_pathfinder';
const role='vornan-proof-validation-reader',region='us-east-1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('Validation bootstrap rejected');};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===keys.sort().join();
function git(root,args,maxBuffer=1024*1024){return execFileSync('git',['--no-pager','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',root,...args],{timeout:5000,killSignal:'SIGKILL',maxBuffer,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});}
function blob(root,path,maxBuffer){const line=git(root,['ls-tree','HEAD','--',path],4096).toString();if(!line.startsWith('100644 blob ')||line.split('\t')[1]?.trim()!==path)fail();return git(root,['show',`HEAD:${path}`],maxBuffer);}
function pin(p,max){if(!exact(p,['bytes','sha256'])||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>max||!/^[a-f0-9]{64}$/.test(p.sha256))fail();}

export function inspectIntendedInputs(env){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REPOSITORY!==repository||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_JOB!=='validate'||env.GITHUB_WORKFLOW_REF!==`${repository}/.github/workflows/proof-validation-only.yml@refs/heads/main`||env.GITHUB_SERVER_URL!=='https://github.com'||env.GITHUB_API_URL!=='https://api.github.com'||!/^\d+$/.test(env.GITHUB_RUN_ID??'')||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||env.GITHUB_WORKFLOW_SHA!==env.GITHUB_SHA||!env.GITHUB_TOKEN)fail();
 const workspace=env.GITHUB_WORKSPACE;if(typeof workspace!=='string'||!workspace.startsWith('/'))fail();
 const toolRoot=fileURLToPath(new URL('../../../',import.meta.url));
 if(resolve(workspace,'verifier')!==resolve(toolRoot)||git(workspace,['rev-parse','HEAD'],4096).toString().trim()!==env.GITHUB_SHA)fail();
 git(workspace,['diff','--no-ext-diff','--no-textconv','--exit-code','HEAD','--','validation','.github/workflows/proof-validation-only.yml']);
 const pins=JSON.parse(blob(workspace,'validation/pins.json',8192));
 if(!exact(pins,['record','inventory','toolingCommit'])||!/^[a-f0-9]{40}$/.test(pins.toolingCommit))fail();pin(pins.record,65536);pin(pins.inventory,1024*1024);
 if(git(toolRoot,['rev-parse','HEAD'],4096).toString().trim()!==pins.toolingCommit)fail();
 git(toolRoot,['diff','--no-ext-diff','--no-textconv','--exit-code','HEAD','--','tools/proof-release-review']);
 const bytes=blob(workspace,'validation/source-inventory.json',1024*1024);if(bytes.length!==pins.inventory.bytes||hash(bytes)!==pins.inventory.sha256)fail();
 const inventory=JSON.parse(bytes);if(!exact(inventory,['files'])||!Array.isArray(inventory.files)||inventory.files.length<1||inventory.files.length>500)fail();
 const tracked=git(toolRoot,['ls-files','--','tools/proof-release-review']).toString().trim().split('\n').map(p=>p.slice('tools/proof-release-review/'.length)).sort();
 if(JSON.stringify(inventory.files.map(f=>f.path).sort())!==JSON.stringify(tracked))fail();
 for(const f of inventory.files){if(!exact(f,['path','bytes','sha256']))fail();readBoundedPinnedFile(resolve(toolRoot,'tools/proof-release-review'),f.path,f);}
 const descriptorPin=JSON.parse(blob(workspace,'validation/descriptor-pin.json',4096));pin(descriptorPin,16384);
 if(typeof env.PROOF_VALIDATION_DESCRIPTOR!=='string')fail();const raw=Buffer.from(env.PROOF_VALIDATION_DESCRIPTOR);if(raw.length!==descriptorPin.bytes||hash(raw)!==descriptorPin.sha256)fail();
 const descriptor=JSON.parse(raw);if(!exact(descriptor,['files'])||!Array.isArray(descriptor.files)||descriptor.files.length!==5)fail();
 const inputs=JSON.parse(fs.readFileSync(new URL('../proof-config/release-input-pins.json',import.meta.url))).private;
 const bindings=JSON.parse(fs.readFileSync(new URL('../proof-config/pins.json',import.meta.url))).private;
 const expected={'bindings.json':{bytes:760,sha256:bindings},'validation-release-record.json':pins.record};
 for(const n of ['proof-oidc-release-draft/release-plan.json','proof-pdf6-candidate/freeze.json','proof-pdf6-candidate/manifest.json'])expected['original/'+n]=inputs[n];
 if(new Set(descriptor.files.map(f=>f.name)).size!==5)fail();
 for(const f of descriptor.files){const p=expected[f.name];if(!p||f.bytes!==p.bytes||f.sha256!==p.sha256||f.bucket!==bucket||f.key!==`proof/releases/proof-pdf6-be74e0055210/validation-inputs/${p.sha256}.json`||typeof f.versionId!=='string'||!f.versionId||f.versionId==='null')fail();}
 return {workspace,descriptor};
}

export async function runIntendedValidation({env={...process.env},clients,spawnImpl=spawn}={}){
 let sts,s3;
 try{
  const {workspace,descriptor}=inspectIntendedInputs(env);
  const credentialFields=['PROOF_AWS_ACCESS_KEY_ID','PROOF_AWS_SECRET_ACCESS_KEY','PROOF_AWS_SESSION_TOKEN'];
  if(credentialFields.some(k=>typeof env[k]!=='string'||!env[k]))fail();
  const credentials={accessKeyId:env.PROOF_AWS_ACCESS_KEY_ID,secretAccessKey:env.PROOF_AWS_SECRET_ACCESS_KEY,sessionToken:env.PROOF_AWS_SESSION_TOKEN};
  // No default credential chain. The inactive workflow supplies OIDC outputs.
  const require=createRequire(new URL('../proof-tooling-deps/package.json',import.meta.url));
  const sdkS3=require('@aws-sdk/client-s3'),sdkSTS=require('@aws-sdk/client-sts');
  if(require('@aws-sdk/client-s3/package.json').version!=='3.1094.0'||require('@aws-sdk/client-sts/package.json').version!=='3.1094.0')fail();
  const config={region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true,requestHandler:{connectionTimeout:2000,requestTimeout:5000}};
  // Clients/spawn injection is solely for isolated review tests; no authority
  // is inferred from injected results. Production uses fixed SDK construction.
  sts=clients?.sts??new sdkSTS.STSClient(config);s3=clients?.s3??new sdkS3.S3Client({...config,followRegionRedirects:false});
  const identity=await sts.send(new sdkSTS.GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(5000)});
  if(identity.Account!==account||identity.Arn!==`arn:aws:sts::${account}:assumed-role/${role}/proof-validation-${env.GITHUB_RUN_ID}-1`)fail();
  const childEnv={...env};for(const k of credentialFields){delete childEnv[k];delete process.env[k];}
  return await composeBootstrapForReview({workspace,manifest:descriptor,environment:childEnv,spawnImpl,
   sendVersion:(input,options)=>s3.send(new sdkS3.GetObjectCommand({...input,ExpectedBucketOwner:account}),options)});
 }catch{return {status:'blocked',reason:'bootstrap-unavailable',validationOnly:true,authenticatedAuthority:false,operationallyReady:false};}
 finally{sts?.destroy();s3?.destroy();for(const k of ['PROOF_AWS_ACCESS_KEY_ID','PROOF_AWS_SECRET_ACCESS_KEY','PROOF_AWS_SESSION_TOKEN'])delete process.env[k];}
}

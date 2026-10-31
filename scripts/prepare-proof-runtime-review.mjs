// Prepare artifacts and read-only recovery evidence. Never deploys or activates.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve('outputs/proof-runtime-review-20261031');
const aws = args => JSON.parse(execFileSync('aws',[...args,'--region','us-east-1','--output','json'],{encoding:'utf8',maxBuffer:8*1024*1024}));
const hash = b => createHash('sha256').update(b).digest('hex');
const save = (name,value) => writeFile(resolve(root,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
await mkdir(root,{recursive:true,mode:0o700});
const account=aws(['sts','get-caller-identity']);
if(account.Account!=='744016783602')throw Error('Wrong AWS account');
const stack=aws(['cloudformation','describe-stacks','--stack-name','vornan-proof-dev']).Stacks[0];
if(stack.StackStatus!=='UPDATE_COMPLETE')throw Error('Stack not stable');
const params=Object.fromEntries(stack.Parameters.map(p=>[p.ParameterKey,p.ParameterValue]));
const liveTemplate=aws(['cloudformation','get-template','--stack-name','vornan-proof-dev','--template-stage','Original']).TemplateBody;
await writeFile(resolve(root,'rollback-template.yaml'),typeof liveTemplate==='string'?liveTemplate:JSON.stringify(liveTemplate),{mode:0o600});
const rollback=[];
for(const name of ['vornan-proof-public-dev','vornan-proof-sync-dev','vornan-proof-operator-dev']){
  const value=aws(['lambda','get-function','--function-name',name]);
  const response=await fetch(value.Code.Location);
  if(!response.ok)throw Error('Recovery artifact download failed');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('base64')!==value.Configuration.CodeSha256)throw Error('Recovery digest mismatch');
  await writeFile(resolve(root,`${name}-rollback.zip`),bytes,{mode:0o600});
  rollback.push({name,sha256:hash(bytes),awsCodeSha256:value.Configuration.CodeSha256,lastModified:value.Configuration.LastModified,role:value.Configuration.Role,
    environmentDigest:hash(JSON.stringify(value.Configuration.Environment?.Variables??{}))});
}
await copyFile('infra/aws/proof-cloudformation.yaml',resolve(root,'candidate-template.yaml'));
await mkdir(resolve(root,'public'),{recursive:true});
for(const name of ['public-lambda.mjs','public-lambda.mjs.map','package.json','proof-reviewer-external-account.json'])await copyFile(resolve('outputs/proof-lambdas',name),resolve(root,'public',name));
execFileSync('zip',['-q','../candidate-public.zip','public-lambda.mjs','public-lambda.mjs.map','package.json','proof-reviewer-external-account.json'],{cwd:resolve(root,'public')});
const candidateHash=hash(await readFile(resolve(root,'candidate-public.zip')));
const prefix=`proof/releases/runtime-prep-20261031-${candidateHash.slice(0,16)}`;
const overrides={PublicFunctionCodeS3Key:`${prefix}/candidate-public.zip`,StatusReviewerRuntimePrepared:'true',StatusReviewerFirebaseProjectId:'ltl-dashboard-site'};
const parameters=stack.Parameters.map(p=>overrides[p.ParameterKey]!==undefined?{ParameterKey:p.ParameterKey,ParameterValue:overrides[p.ParameterKey]}:{ParameterKey:p.ParameterKey,UsePreviousValue:true});
for(const [key,value]of Object.entries(overrides))if(!stack.Parameters.some(p=>p.ParameterKey===key))parameters.push({ParameterKey:key,ParameterValue:value});
await save('change-set-parameters.json',parameters);
await save('manifest.json',{createdAt:new Date().toISOString(),base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),stack:stack.StackId,stackUpdated:stack.LastUpdatedTime,prefix,bucket:params.PublicLambdaCodeS3Bucket,
  candidate:{sha256:candidateHash,templateSha256:hash(await readFile(resolve(root,'candidate-template.yaml')))},rollback,
  previousArtifactParameters:Object.fromEntries(['PublicLambdaCodeS3Bucket','PublicLambdaCodeS3Key','PublicFunctionCodeS3Key','OperatorFunctionCodeS3Key'].map(k=>[k,params[k]])),
  holds:{deployment:true,activation:true},note:'Environment digests only; restore existing live configuration through reviewed previous stack parameters, never defaults.'});
console.log(JSON.stringify({root,prefix,candidateHash,rollbackVerified:rollback.length,parametersPreserved:true}));

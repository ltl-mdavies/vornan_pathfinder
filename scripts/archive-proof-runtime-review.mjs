// Authorized private archive and non-executed UPDATE plan only. No execute call.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve('outputs/proof-runtime-review-20261031');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
if(manifest.bucket!=='vornan-pathfinder-artifacts'||!/^proof\/releases\/runtime-prep-20261031-[a-f0-9]{16}$/.test(manifest.prefix))throw Error('Archive boundary mismatch');
const aws=args=>JSON.parse(execFileSync('aws',[...args,'--region','us-east-1','--output','json'],{encoding:'utf8',maxBuffer:4*1024*1024}));
const files=['candidate-public.zip','candidate-template.yaml','rollback-template.yaml','manifest.json','change-set-parameters.json',...manifest.rollback.map(x=>`${x.name}-rollback.zip`)];
const receipts=[];
for(const name of files){
  const path=resolve(root,name),bytes=await readFile(path),checksum=createHash('sha256').update(bytes).digest('base64');
  const key=`${manifest.prefix}/${name}`;
  const put=aws(['s3api','put-object','--bucket',manifest.bucket,'--key',key,'--body',path,'--server-side-encryption','AES256','--checksum-sha256',checksum,'--if-none-match','*']);
  const head=aws(['s3api','head-object','--bucket',manifest.bucket,'--key',key,'--version-id',put.VersionId,'--checksum-mode','ENABLED']);
  if(head.ChecksumSHA256!==checksum||head.ContentLength!==bytes.length||head.ServerSideEncryption!=='AES256')throw Error('Archive readback mismatch');
  receipts.push({name,key,versionId:put.VersionId,checksumSHA256:checksum,bytes:bytes.length});
}
await writeFile(resolve(root,'archive-receipts.json'),JSON.stringify(receipts,null,2)+'\n',{mode:0o600});
const template=receipts.find(x=>x.name==='candidate-template.yaml');
const name=`proof-runtime-review-${manifest.candidate.sha256.slice(0,16)}`;
const result=aws(['cloudformation','create-change-set','--stack-name','vornan-proof-dev','--change-set-name',name,'--change-set-type','UPDATE','--template-url',`https://${manifest.bucket}.s3.us-east-1.amazonaws.com/${template.key}?versionId=${encodeURIComponent(template.versionId)}`,'--parameters',`file://${resolve(root,'change-set-parameters.json')}`,'--capabilities','CAPABILITY_NAMED_IAM','--description','Review only: Proof keyless runtime preparation; deployment and activation held.']);
await writeFile(resolve(root,'change-set-id.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({archived:receipts.length,checksumsVerified:true,changeSet:name,executed:false}));

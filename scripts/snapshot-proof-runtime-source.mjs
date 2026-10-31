import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve('outputs/proof-runtime-review-20261031');
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024});
const added=git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(p=>p && !p.startsWith('apps/api/data/') && !p.startsWith('tests/'));
let patch=git(['diff','--binary','HEAD']);
for(const path of added){
  const result=spawnSync('git',['diff','--no-index','--binary','--','/dev/null',path],{encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.status!==1)throw Error('Could not snapshot added source');
  patch+=result.stdout;
}
await writeFile(resolve(root,'candidate-source.patch'),patch,{mode:0o600});
const paths=[...git(['diff','--name-only','HEAD']).trim().split('\n'),...added].filter(Boolean).sort();
const files=[];
for(const path of paths)files.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
await writeFile(resolve(root,'source-manifest.json'),JSON.stringify({base:git(['rev-parse','HEAD']).trim(),remoteBaseline:git(['rev-parse','origin/main']).trim(),excluded:['apps/api/data/','tests/ (local synthetic/browser harnesses)'],patchSha256:createHash('sha256').update(patch).digest('hex'),files},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({sourceFiles:files.length,excludedLocalHarnesses:true}));

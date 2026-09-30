import {build} from 'esbuild';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url),out='outputs/json-intake-artwork';
await mkdir(out,{recursive:true});
const result=await build({entryPoints:['apps/api/src/json-intake/sandbox-artwork-lambda.ts'],outfile:`${out}/artwork.mjs`,bundle:true,platform:'node',target:'node22',format:'esm',metafile:true,external:['pdf-lib','pdf-lib/*'],banner:{js:"import {createRequire as bundleRequire} from 'node:module'; const require=bundleRequire(import.meta.url);"}});
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(p=>/apps\/api\/src\/(server|store|lift-client|proof)\b/.test(p)))throw new Error('Shared runtime imported');
const visited=new Set(),manifest=[];
async function copyPackage(name,from){
 const req=createRequire(from);
 let root=dirname(req.resolve(name)),file,pkg;
 for(;;){
  file=join(root,'package.json');
  try{pkg=JSON.parse(await readFile(file,'utf8'));if(pkg.name===name)break;}catch{}
  const parent=dirname(root);if(parent===root)throw new Error('Package root missing');root=parent;
 }
 if(visited.has(name)){if(manifest.find(x=>x.name===name).version!==pkg.version)throw new Error('Conflicting dependency versions');return;}
 visited.add(name);manifest.push({name,version:pkg.version,license:pkg.license});
 await cp(root,join(out,'node_modules',name),{recursive:true});
 for(const dependency of Object.keys(pkg.dependencies??{}))await copyPackage(dependency,file);
}
await copyPackage('pdf-lib',import.meta.url);
await writeFile(`${out}/package.json`,JSON.stringify({type:'module'}));
await writeFile(`${out}/dependency-manifest.json`,JSON.stringify(manifest,null,2));
await writeFile(`${out}/build-inputs.json`,JSON.stringify(inputs));
console.log(JSON.stringify({output:out,dependencies:manifest}));

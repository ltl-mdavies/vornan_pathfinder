import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const out='outputs/json-intake-webhooks';await mkdir(out,{recursive:true});
const result=await build({entryPoints:['apps/api/src/json-intake/sandbox-webhook-lambda.ts'],outfile:`${out}/webhooks.mjs`,bundle:true,platform:'node',target:'node22',format:'esm',metafile:true,banner:{js:"import {createRequire as bundleRequire} from 'node:module'; const require=bundleRequire(import.meta.url);"}});
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(p=>/apps\/api\/src\/(server|store|lift-client|proof)\b|pdf-lib/.test(p)))throw new Error('Shared runtime imported');
await writeFile(`${out}/build-inputs.json`,JSON.stringify(inputs));
console.log(JSON.stringify({output:out}));

import {assertSandboxBundleInputs} from './lib/sandbox-bundle-boundary.mjs';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const outdir='outputs/json-intake-sandbox';
await mkdir(outdir,{recursive:true});
const result=await build({entryPoints:['apps/api/src/json-intake/sandbox-lambda.ts'],outfile:`${outdir}/sandbox.mjs`,bundle:true,platform:'node',target:'node22',format:'esm',metafile:true,
  banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
const inputs=Object.keys(result.metafile.inputs);
assertSandboxBundleInputs(inputs);
await writeFile(`${outdir}/package.json`,JSON.stringify({type:'module'}));
console.log('Built isolated intake sandbox; no shared server, store runtime, or PDF parser.');

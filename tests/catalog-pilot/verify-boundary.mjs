import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='output/catalog-pilot-handoff';await mkdir(out,{recursive:true});
const entries=[['ui','apps/web/src/customer-catalog/AuthenticatedCatalogWorkspace.tsx','browser'],['api','apps/api/src/catalog-records/configured-router.ts','node']];
const evidence=[];
const canaries=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):[];
for(const [name,entry,platform] of entries){
 const result=await build({entryPoints:[entry],bundle:true,platform,format:'esm',target:'es2022',metafile:true,write:false,outfile:`${out}/${name}-boundary.js`,loader:{'.css':'empty','.svg':'dataurl'}});
 const firstParty=Object.keys(result.metafile.inputs).filter(path=>!path.includes('node_modules/'));
 const forbidden=firstParty.filter(path=>/cvo|legacy-order|account-terms|material-mapping-review|product-rules|catalog-drafts\/service|catalog-validation|catalog-preview/i.test(path));
 if(forbidden.length)throw Error(`Private dependency reached ${name}: ${forbidden.join(', ')}`);
 const files=[];
 for(const file of result.outputFiles){const text=file.text;const hits=canaries.filter(value=>text.includes(value));if(hits.length)throw Error(`Private data canaries reached ${name} (${hits.length} matches)`);files.push({bytes:file.contents.length,sha256:createHash('sha256').update(file.contents).digest('hex')});}
 await writeFile(`${out}/${name}-imports.json`,JSON.stringify(firstParty,null,2));
 evidence.push({entry,firstPartyInputs:firstParty,forbiddenDependencies:forbidden,canariesChecked:canaries.length,canaryMatches:0,files});
}
await writeFile(`${out}/dependency-privacy.json`,JSON.stringify({evidence,note:'Catalog entrypoint dependency closure. Private canary values are supplied externally and never emitted.'},null,2));
console.log(JSON.stringify(evidence.map(({entry,firstPartyInputs,canariesChecked,canaryMatches,files})=>({entry,firstPartyFiles:firstPartyInputs.length,canariesChecked,canaryMatches,files}))));

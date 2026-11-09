// Test-process preload only. The production adapter neither imports this file
// nor reads this environment variable. Every fetch is intercepted; no network.
import {readFileSync,writeFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(process.env.PROOF_TEST_NETWORK_FILE));
let calls=0;
globalThis.fetch=async(url,options)=>{
 calls++;
 if(!url.startsWith('https://api.github.com/repos/example/proof-review/')||options.method!=='GET'||options.redirect!=='manual')throw Error('Unexpected test request');
 const kind=url.includes('deployment-branch-policies')?'policy':url.includes('/environments/')?'environment':url.endsWith('/approvals')?'reviews':url.includes('/jobs?')?'jobs':'run';
 const status=fixture.httpStatus??200;
 const headers=new Headers({'content-type':'application/json'});
 if(fixture.pagination&&kind==='jobs')headers.set('link','<https://api.github.com/unsupported>; rel="next"');
 return {url,status,redirected:false,headers,body:new Response(JSON.stringify(fixture[kind])).body};
};
process.on('exit',()=>writeFileSync(process.env.PROOF_TEST_CALLS_FILE,String(calls)));

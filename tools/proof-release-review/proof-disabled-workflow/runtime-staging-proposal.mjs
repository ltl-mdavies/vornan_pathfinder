import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readBoundedPinnedFile} from '../proof-config/release-inputs.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('Validation staging rejected');};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===keys.sort().join();
const entry=e=>exact(e,['bytes','sha256'])&&Number.isSafeInteger(e.bytes)&&e.bytes>0&&/^[a-f0-9]{64}$/.test(e.sha256);
const toolRoot=fileURLToPath(new URL('../../../',import.meta.url));
// PATH-selected Git is not an immutable binary pin. The eventual runner must
// provide a reviewed toolchain. No checkout/fetch/reset; all commands are reads.
function git(root,args,maxBuffer=1024*1024){return execFileSync('git',['--no-pager','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',root,...args],{timeout:5000,killSignal:'SIGKILL',maxBuffer,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});}
function blob(root,path,max){
 const listing=git(root,['ls-tree','HEAD','--',path],4096).toString();
 if(!listing.startsWith('100644 blob ')||listing.split('\t')[1]?.trim()!==path)fail();
 return git(root,['show',`HEAD:${path}`],max);
}
/** Reads a launcher L and separately staged verifier T. Hash pins are bootstrap
 * configuration in L, not authority or a new deployment receipt schema.
 */
export function inspectRuntimeStaging(env){
 const workspace=env.GITHUB_WORKSPACE;
 if(typeof workspace!=='string'||!workspace.startsWith('/')||resolve(workspace,'verifier')!==resolve(toolRoot))fail();
 const launcherCommit=git(workspace,['rev-parse','HEAD'],4096).toString().trim();
 if(launcherCommit!==env.GITHUB_SHA||launcherCommit!==env.GITHUB_WORKFLOW_SHA)fail();
 git(workspace,['diff','--no-ext-diff','--no-textconv','--exit-code','HEAD','--','.github/workflows/proof-validation-only.yml','validation']);
 const pins=JSON.parse(blob(workspace,'validation/pins.json',8192));
 if(!exact(pins,['record','inventory','toolingCommit'])||!entry(pins.record)||!entry(pins.inventory)||pins.record.bytes>65536||pins.inventory.bytes>1024*1024||!/^[a-f0-9]{40}$/.test(pins.toolingCommit))fail();
 if(git(toolRoot,['rev-parse','HEAD'],4096).toString().trim()!==pins.toolingCommit)fail();
 git(toolRoot,['diff','--no-ext-diff','--no-textconv','--exit-code','HEAD','--','tools/proof-release-review']);
 const inventoryBytes=blob(workspace,'validation/source-inventory.json',1024*1024);
 if(inventoryBytes.length!==pins.inventory.bytes||hash(inventoryBytes)!==pins.inventory.sha256)fail();
 const inventory=JSON.parse(inventoryBytes);
 if(!exact(inventory,['files'])||!Array.isArray(inventory.files)||!inventory.files.length||inventory.files.length>500)fail();
 const names=inventory.files.map(f=>f.path);
 const tracked=git(toolRoot,['ls-files','--','tools/proof-release-review'],1024*1024).toString().trim().split('\n').map(p=>p.slice('tools/proof-release-review/'.length)).sort();
 if(new Set(names).size!==names.length||JSON.stringify([...names].sort())!==JSON.stringify(tracked))fail();
 for(const f of inventory.files){
  if(!exact(f,['path','bytes','sha256'])||!entry({bytes:f.bytes,sha256:f.sha256}))fail();
  readBoundedPinnedFile(resolve(toolRoot,'tools/proof-release-review'),f.path,{bytes:f.bytes,sha256:f.sha256});
 }
 // Private records are never committed to L. Only the nonsecret hash/length pin
 // above is publishable; source/customer identifiers remain in this private root.
 if(git(workspace,['ls-files','--','private'],4096).length)fail();
 const record=JSON.parse(readBoundedPinnedFile(resolve(workspace,'private'),'validation-release-record.json',pins.record));
 if(record.tooling?.commit!==pins.toolingCommit||record.tooling.inventorySha256!==pins.inventory.sha256||record.tooling.workflowPath!=='.github/workflows/proof-validation-only.yml')fail();
 const workflow=blob(workspace,record.tooling.workflowPath,65536);
 if(hash(workflow)!==record.tooling.workflowSha256)fail();
 return {record,runtimeWorkflow:{commit:launcherCommit,workflowPath:record.tooling.workflowPath}};
}

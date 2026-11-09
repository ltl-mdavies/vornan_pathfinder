import {pathToFileURL} from 'node:url';
import {inspectRuntimeStaging} from './runtime-staging-proposal.mjs';
import {bindings} from '../proof-config/bindings.mjs';
import {githubReadOnlyTransport} from './github-http-transport.mjs';
import {runtimeContext,runtimeAssertions} from './runtime-context-proposal.mjs';
import {reviewGithubApprovalProposal} from './github-approval-proposal.mjs';

/** Proposed real read-only adapter: no injectable network/credential/clock and
 * no publication imports. Not operational authority, even after a match.
 */
export async function validateRuntimeOnly(){
 try{
  if(process.argv.length!==2)throw Error('arguments');
  const env={...process.env};
  const {record,runtimeWorkflow}=inspectRuntimeStaging(env);
  // Validate runner assertions before acquiring a token or contacting GitHub.
  runtimeAssertions(env,record.tooling,runtimeWorkflow);
  const credential=async()=>{const token=process.env.GITHUB_TOKEN;if(!token)throw Error('credential');return token;};
  const transport=githubReadOnlyTransport({credential});
  const jobs=await transport.get(`/repos/${bindings.repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100&page=1`);
  if(jobs.status!==200||jobs.headers?.link)throw Error('jobs');
  const invocation=runtimeContext(env,record.tooling,jobs.data,runtimeWorkflow);
  const result=await reviewGithubApprovalProposal({credential,record,invocation,reviewedTooling:record.tooling,jobName:'Proof validation only',purpose:'validation-only',runtimeWorkflow});
  return {...result,validationOnly:true,authenticatedAuthority:false,operationallyReady:false};
 }catch{return{status:'blocked',reason:'validation-context-or-read-unavailable',validationOnly:true,authenticatedAuthority:false,operationallyReady:false};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await validateRuntimeOnly();process.stdout.write(JSON.stringify(result)+'\n');
 process.exitCode=result.status==='snapshot-matches-NOT-AUTHORIZED'?0:78;
}

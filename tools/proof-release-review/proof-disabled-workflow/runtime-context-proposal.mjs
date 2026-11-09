import {bindings} from '../proof-config/bindings.mjs';

const fail=()=>{throw Error('Validation runtime context rejected');};
/** Pure validation for tests. Environment variables are assertions, not authority.
 * The read-only API observer must independently match the returned identity.
 */
export function runtimeAssertions(env,tooling,runtimeWorkflow=tooling){
 if(!tooling||tooling.repository!==bindings.repository||!/^([a-f0-9]{40})$/.test(tooling.commit)||
    tooling.workflowPath!=='.github/workflows/proof-validation-only.yml')fail();
 if(!/^[a-f0-9]{40}$/.test(runtimeWorkflow?.commit)||runtimeWorkflow.workflowPath!==tooling.workflowPath)fail();
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
    env.GITHUB_REPOSITORY!==bindings.repository||env.GITHUB_REF!=='refs/heads/main'||
    env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_SHA!==runtimeWorkflow.commit||
    env.GITHUB_WORKFLOW_SHA!==runtimeWorkflow.commit||env.GITHUB_JOB!=='validate'||
    env.GITHUB_WORKFLOW_REF!==`${bindings.repository}/${tooling.workflowPath}@refs/heads/main`||
    env.GITHUB_SERVER_URL!=='https://github.com'||env.GITHUB_API_URL!=='https://api.github.com'||
    !/^[1-9]\d{0,19}$/.test(env.GITHUB_RUN_ID??''))fail();
}
export function runtimeContext(env,tooling,jobs,runtimeWorkflow=tooling){
 runtimeAssertions(env,tooling,runtimeWorkflow);
 if(!jobs||!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length||jobs.jobs.length>100)fail();
 const matches=jobs.jobs.filter(j=>j.name==='Proof validation only');
 if(matches.length!==1)fail();
 const job=matches[0];
 if(!Number.isSafeInteger(job.id)||job.id<=0||String(job.run_id)!==env.GITHUB_RUN_ID||
    job.run_attempt!==1||job.head_sha!==runtimeWorkflow.commit||job.status!=='in_progress'||job.conclusion!==null)fail();
 return Object.freeze({mode:'publish',runId:env.GITHUB_RUN_ID,attempt:'1',jobId:String(job.id)});
}

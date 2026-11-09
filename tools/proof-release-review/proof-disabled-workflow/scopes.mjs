import {readReleaseInput} from '../proof-config/release-inputs.mjs';import {resourceDelta} from './contract.mjs';
/** One explicit publish/recovery pair. Resource-set proposal, never a grant. */
export function invocationScopes(pair){
 if(pair.publish.mode!=='publish'||pair.recovery.mode!=='recovery'||pair.publish.runId===pair.recovery.runId||pair.publish.sourceRunId!==pair.publish.runId||pair.publish.sourceAttempt!==pair.publish.attempt||pair.recovery.sourceRunId!==pair.publish.runId||pair.recovery.sourceAttempt!==pair.publish.attempt)throw Error('Invocation pair');
 const deltas=[resourceDelta(pair.publish),resourceDelta(pair.recovery)],scopes=structuredClone(JSON.parse(readReleaseInput('proof-disabled-sdk/audit-policies-proposed/scope-review.json')).scopes);
 for(const role of ['publisher','recovery'])scopes[role].read=scopes[role].read.filter(k=>k!==deltas[0].removeFreshUseOf);
 for(const d of deltas)for(const addition of [d.authorityRecorder,d.consumer])for(const field of ['read','exclusive','conditional'])scopes[addition.role][field]=[...new Set([...scopes[addition.role][field],...(addition[field]??[])])];
 return scopes;
}

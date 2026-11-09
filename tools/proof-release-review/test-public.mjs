import {spawnSync} from 'node:child_process';

// Explicitly select synthetic configuration; never inherit a private profile.
const tests = [
  'proof-disabled-workflow/runtime-adapter-proposal.test.mjs',
  'proof-disabled-workflow/runtime-context-proposal.test.mjs',
  'proof-disabled-workflow/github-approval-proposal.test.mjs',
  'proof-disabled-workflow/contract.test.mjs',
  'proof-disabled-workflow/evidence.test.mjs',
  'proof-disabled-workflow/github-evidence-reader.test.mjs',
  'proof-disabled-workflow/github-http-transport.test.mjs',
  'proof-guarded-publisher/recovery.test.mjs',
  'proof-config/bindings.test.mjs',
  'proof-config/release-inputs.test.mjs',
];
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: new URL('./', import.meta.url),
  env: {...process.env, PROOF_REVIEW_PROFILE: 'fixture'},
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

LOCAL REVIEW ONLY — NOT A DEPLOYMENT TOOL

From this public directory, run:

  npm ci --prefix proof-tooling-deps --ignore-scripts --no-audit --no-fund
  npm run test:public

The dependency installation uses the included pinned lockfile. The runner explicitly
selects synthetic fixture bindings, even if the parent environment selects a
private profile. It uses the current Node executable and propagates failures.
This command can run from a standalone copy of this directory without private
release data. It covers contract, evidence, diagnostic, HTTP, recovery and input
binding tests. All release files in the fixture profile are synthetic; archive
contents are deliberately not a real app and must never be published.

These synthetic checks do not replace private release evidence or live checks.
The default private profile requires the fixed sibling private input directory;
it fails closed when private inputs are absent or their hashes do not match.
The operational entry point remains blocked. A passing result does not authorize
deployment, activation, submissions, emails or any cloud mutation.

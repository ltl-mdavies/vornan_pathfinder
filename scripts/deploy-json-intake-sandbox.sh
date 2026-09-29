#!/usr/bin/env bash
set -euo pipefail
# Additive sandbox only. This script never deploys the shared API or frontend.
# Prepare a CREATE change set; inspect and execute separately after candidate review.
expected_sha="${1:?Usage: deploy-json-intake-sandbox.sh EXACT_MERGED_MAIN_SHA ARTIFACT_BUCKET}"
artifact_bucket="${2:?Artifact bucket required}"
stack_name="vornan-pathfinder-json-intake-sandbox"
current_sha="$(git rev-parse HEAD)"
remote_sha="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [[ "$current_sha" != "$expected_sha" || "$remote_sha" != "$expected_sha" || -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Deployment requires a clean checkout at the exact current merged main SHA.' >&2
  exit 1
fi
if aws cloudformation describe-stacks --stack-name "$stack_name" >/dev/null 2>&1; then
  echo 'Sandbox already exists; use an explicit reviewed update preserving existing parameters and credentials.' >&2
  exit 1
fi
node scripts/build-json-intake-sandbox.mjs
python3 - <<'PY'
import pathlib,zipfile
with zipfile.ZipFile('outputs/json-intake-sandbox.zip','w',zipfile.ZIP_DEFLATED) as z:
 for path in sorted(pathlib.Path('outputs/json-intake-sandbox').iterdir()):
  if path.name in ('sandbox.mjs','package.json'):z.write(path,arcname=path.name)
PY
artifact_key="json-intake-sandbox/${expected_sha}.zip"
aws s3 cp outputs/json-intake-sandbox.zip "s3://${artifact_bucket}/${artifact_key}" --only-show-errors
aws cloudformation create-change-set --stack-name "$stack_name" \
  --change-set-name "sandbox-${expected_sha:0:12}" --change-set-type CREATE \
  --template-body file://infra/aws/json-intake-sandbox.yaml --capabilities CAPABILITY_IAM \
  --parameters "ParameterKey=CodeBucket,ParameterValue=${artifact_bucket}" \
    "ParameterKey=CodeKey,ParameterValue=${artifact_key}" "ParameterKey=IntakeEnabled,ParameterValue=false"
echo 'Prepared disabled sandbox change set. Inspect all resource actions before execution.'

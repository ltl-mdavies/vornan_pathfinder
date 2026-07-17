#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-$(aws configure get region || true)}"
region="${region:-us-east-1}"

admin_bucket="${PATHFINDER_ADMIN_BUCKET:-vornan-pathfinder}"
status_bucket="${PATHFINDER_STATUS_BUCKET:-vornan-pathfinder-status}"
artifact_bucket="${PATHFINDER_API_ARTIFACT_BUCKET:-vornan-pathfinder-artifacts}"

create_bucket() {
  local bucket="$1"
  local purpose="$2"

  if aws s3api head-bucket --bucket "${bucket}" >/dev/null 2>&1; then
    echo "Bucket exists: ${bucket} (${purpose})"
  else
    echo "Creating bucket: ${bucket} (${purpose}) in ${region}"
    if [[ "${region}" == "us-east-1" ]]; then
      aws s3api create-bucket --bucket "${bucket}" --region "${region}"
    else
      aws s3api create-bucket \
        --bucket "${bucket}" \
        --region "${region}" \
        --create-bucket-configuration "LocationConstraint=${region}"
    fi
  fi

  aws s3api put-public-access-block \
    --bucket "${bucket}" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  aws s3api put-bucket-encryption \
    --bucket "${bucket}" \
    --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

  aws s3api put-bucket-versioning \
    --bucket "${bucket}" \
    --versioning-configuration Status=Enabled
}

create_bucket "${admin_bucket}" "Pathfinder admin web"
create_bucket "${status_bucket}" "Pathfinder public status web"
create_bucket "${artifact_bucket}" "Pathfinder API Lambda artifacts"

echo
echo "Bootstrap complete."
echo "PATHFINDER_ADMIN_BUCKET=${admin_bucket}"
echo "PATHFINDER_STATUS_BUCKET=${status_bucket}"
echo "PATHFINDER_API_ARTIFACT_BUCKET=${artifact_bucket}"

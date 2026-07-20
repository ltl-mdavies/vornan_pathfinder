#!/usr/bin/env bash
set -euo pipefail

environment_name="${PATHFINDER_PROOF_ENVIRONMENT_NAME:-dev}"
bucket="${PATHFINDER_PROOF_WEB_BUCKET:-vornan-pathfinder-proof-${environment_name}}"
distribution_id="${PATHFINDER_PROOF_CLOUDFRONT_DISTRIBUTION_ID:-}"
dist_dir="apps/proof/dist"

npm run build --workspace @pathfinder/proof

aws s3 sync "${dist_dir}" "s3://${bucket}" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "${dist_dir}/index.html" "s3://${bucket}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

if [[ -n "${distribution_id}" ]]; then
  aws cloudfront create-invalidation --distribution-id "${distribution_id}" --paths "/*"
else
  echo "PATHFINDER_PROOF_CLOUDFRONT_DISTRIBUTION_ID is not set; skipping invalidation."
fi

#!/usr/bin/env bash
set -euo pipefail

bucket="${PATHFINDER_ADMIN_BUCKET:-vornan-pathfinder}"
distribution_id="${PATHFINDER_ADMIN_CLOUDFRONT_DISTRIBUTION_ID:-}"
api_base_url="${VITE_API_BASE_URL:-https://api.pathfinder.vornan.co}"
dist_dir="apps/web/dist"

echo "Building Pathfinder admin app for ${api_base_url}"
VITE_API_BASE_URL="${api_base_url}" npm run build --workspace @pathfinder/web

echo "Syncing static assets to s3://${bucket}"
aws s3 sync "${dist_dir}" "s3://${bucket}" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

echo "Uploading index.html with no-cache headers"
aws s3 cp "${dist_dir}/index.html" "s3://${bucket}/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

if [[ -n "${distribution_id}" ]]; then
  echo "Invalidating CloudFront distribution ${distribution_id}"
  aws cloudfront create-invalidation \
    --distribution-id "${distribution_id}" \
    --paths "/*"
else
  echo "PATHFINDER_ADMIN_CLOUDFRONT_DISTRIBUTION_ID is not set; skipping invalidation."
fi

echo "Pathfinder admin deploy finished."

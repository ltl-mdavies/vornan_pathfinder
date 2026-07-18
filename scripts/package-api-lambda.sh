#!/usr/bin/env bash
set -euo pipefail

artifact_dir="outputs/api-lambda"
zip_path="outputs/pathfinder-api-lambda.zip"

npm run build:api-lambda

rm -f "${zip_path}"
(cd "${artifact_dir}" && zip -qr "../pathfinder-api-lambda.zip" .)

echo "Created ${zip_path}"

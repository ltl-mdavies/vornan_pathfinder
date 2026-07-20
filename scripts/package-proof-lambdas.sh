#!/usr/bin/env bash
set -euo pipefail

artifact_dir="outputs/proof-lambdas"
zip_path="outputs/vornan-proof-lambdas.zip"

npm run build:proof-public-lambda

rm -f "${zip_path}"
(cd "${artifact_dir}" && zip -qr "../vornan-proof-lambdas.zip" .)

echo "Created ${zip_path}"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

export PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME="${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME:-dev}"
export AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
export PATHFINDER_PROOF_ASSET_BUCKET="${PATHFINDER_PROOF_ASSET_BUCKET:-vornan-pathfinder-proof-assets-${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME}-${AWS_ACCOUNT_ID}}"
export PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET="${PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET:-vornan-pathfinder-wrike-delivery-${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME}-${AWS_ACCOUNT_ID}}"
export PATHFINDER_PROOF_ASSET_DOMAIN_NAME="${PATHFINDER_PROOF_ASSET_DOMAIN_NAME:-}"
export PATHFINDER_PROOF_ASSET_CERTIFICATE_ARN="${PATHFINDER_PROOF_ASSET_CERTIFICATE_ARN:-}"
export PATHFINDER_PROOF_ASSET_RETAINED_SOURCE_DAYS="${PATHFINDER_PROOF_ASSET_RETAINED_SOURCE_DAYS:-90}"
export PATHFINDER_PROOF_ASSET_OUTBOUND_DAYS="${PATHFINDER_PROOF_ASSET_OUTBOUND_DAYS:-14}"
export PATHFINDER_PROOF_ASSET_PACKET_DAYS="${PATHFINDER_PROOF_ASSET_PACKET_DAYS:-30}"
export PATHFINDER_PROOF_ASSET_UNFINALIZED_DAYS="${PATHFINDER_PROOF_ASSET_UNFINALIZED_DAYS:-7}"
export PATHFINDER_PROOF_ASSET_INCOMPLETE_MULTIPART_DAYS="${PATHFINDER_PROOF_ASSET_INCOMPLETE_MULTIPART_DAYS:-1}"
export PATHFINDER_PROOF_ASSET_MALWARE_PROTECTION_ENABLED="false"

stack_lookup_result=""
if ! stack_lookup_result="$(aws cloudformation describe-stacks \
  --stack-name "vornan-proof-assets-${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME}" \
  --query "Stacks[0].Outputs[?((OutputKey=='WrikeDocumentDeliveryEnabled' || OutputKey=='ProofAssetAliasConfigured' || OutputKey=='ProofAssetMalwareProtectionEnabled') && OutputValue=='true')].OutputKey" \
  --output text 2>&1)"; then
  if [[ "${stack_lookup_result}" == *"does not exist"* ]]; then
    stack_lookup_result=""
  else
    echo "Unable to inspect the existing Proof asset stack; refusing the dark-foundation deploy." >&2
    exit 1
  fi
fi

existing_live_boundary="${stack_lookup_result}"

if [[ -n "${existing_live_boundary}" && "${existing_live_boundary}" != "None" ]]; then
  echo "Refusing to apply the dark-foundation deploy over active asset-stack capabilities: ${existing_live_boundary}." >&2
  echo "Use an explicitly reviewed change set that preserves every current stack parameter." >&2
  exit 1
fi

npm run verify:proof-assets

aws cloudformation deploy \
  --stack-name "vornan-proof-assets-${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME}" \
  --template-file infra/aws/proof-assets-cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    EnvironmentName="${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME}" \
    AssetBucketName="${PATHFINDER_PROOF_ASSET_BUCKET}" \
    WrikeDeliveryBucketName="${PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET}" \
    WrikeDocumentDeliveryEnabled="false" \
    AssetDomainName="" \
    CertificateArn="" \
    RetainedSourceDays="${PATHFINDER_PROOF_ASSET_RETAINED_SOURCE_DAYS}" \
    OutboundCopyDays="${PATHFINDER_PROOF_ASSET_OUTBOUND_DAYS}" \
    ProofPacketDays="${PATHFINDER_PROOF_ASSET_PACKET_DAYS}" \
    UnfinalizedUploadDays="${PATHFINDER_PROOF_ASSET_UNFINALIZED_DAYS}" \
    IncompleteMultipartDays="${PATHFINDER_PROOF_ASSET_INCOMPLETE_MULTIPART_DAYS}" \
    ProofAssetMalwareProtectionEnabled="false"

distribution_domain="$(aws cloudformation describe-stacks \
  --stack-name "vornan-proof-assets-${PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='ProofAssetDistributionDomainName'].OutputValue" \
  --output text)"

status="$(curl --silent --output /dev/null --write-out "%{http_code}" "https://${distribution_domain}/a/pre-activation-check")"
if [[ "${status}" != "404" ]]; then
  echo "Expected the dark Proof asset distribution to return 404, received ${status}." >&2
  exit 1
fi

echo "Proof asset foundation deployed dark: https://${distribution_domain} (404 verified)"

#!/usr/bin/env bash
set -euo pipefail

environment_name="${PATHFINDER_PROOF_ENVIRONMENT_NAME:-dev}"
stack_name="${PATHFINDER_PROOF_STACK_NAME:-vornan-proof-${environment_name}}"
artifact_bucket="${PATHFINDER_API_ARTIFACT_BUCKET:?Set PATHFINDER_API_ARTIFACT_BUCKET to the S3 artifact bucket.}"
artifact_key="${PATHFINDER_PROOF_ARTIFACT_KEY:-proof/${environment_name}/vornan-proof-lambdas-$(date +%Y%m%d%H%M%S).zip}"
zip_path="outputs/vornan-proof-lambdas.zip"
public_read_enabled="${PATHFINDER_PROOF_ENABLE_PUBLIC_READ:-false}"
synthetic_qa_enabled="${PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA:-false}"
edge_shared_secret="${PATHFINDER_PROOF_EDGE_SHARED_SECRET:-}"
lift_read_environment="${PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT:?Set PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT to dev, qa, or prod.}"
lift_order_read_url="${PATHFINDER_PROOF_LIFT_ORDER_READ_URL:?Set PATHFINDER_PROOF_LIFT_ORDER_READ_URL to the reviewed stage endpoint.}"
lift_report_read_url="${PATHFINDER_PROOF_LIFT_REPORT_READ_URL:?Set PATHFINDER_PROOF_LIFT_REPORT_READ_URL to the reviewed stage endpoint.}"

if [[ "${public_read_enabled}" == "true" && -z "${edge_shared_secret}" ]]; then
  echo "PATHFINDER_PROOF_EDGE_SHARED_SECRET is required before public read can be enabled." >&2
  exit 1
fi

node scripts/proof-deploy-preflight.mjs
scripts/package-proof-lambdas.sh
aws s3 cp "${zip_path}" "s3://${artifact_bucket}/${artifact_key}"

aws cloudformation deploy \
  --stack-name "${stack_name}" \
  --template-file infra/aws/proof-cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName="${environment_name}" \
    LiftReadEnvironment="${lift_read_environment}" \
    LiftOrderReadUrl="${lift_order_read_url}" \
    LiftProofReportReadUrl="${lift_report_read_url}" \
    ProductionLiftReadsAcknowledged="${PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS:-false}" \
    DataTablePrefix="${PATHFINDER_DATA_TABLE_PREFIX:-Pathfinder}" \
    PublicLambdaCodeS3Bucket="${artifact_bucket}" \
    PublicLambdaCodeS3Key="${artifact_key}" \
    PublicReadEnabled="${public_read_enabled}" \
    ReadOnlyActivationExpiresAt="${PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT:-}" \
    SyntheticQaEnabled="${synthetic_qa_enabled}" \
    ReadOnlyQaConfirmed="${PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED:-false}" \
    ProductionPublicReadApproved="${PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED:-false}" \
    PublicBaseUrl="${PATHFINDER_PROOF_PUBLIC_BASE_URL:-https://proof.vornan.co}" \
    AutomaticRefreshMaxInactiveDays="${PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS:-14}" \
    EdgeSharedSecret="${edge_shared_secret}" \
    ProofWebBucketName="${PATHFINDER_PROOF_WEB_BUCKET:-vornan-pathfinder-proof-${environment_name}}" \
    ProofDomainName="${PATHFINDER_PROOF_DOMAIN_NAME:-}" \
    CertificateArn="${PATHFINDER_PROOF_CERTIFICATE_ARN:-}" \
    ProofWebAclArn="${PATHFINDER_PROOF_WEB_ACL_ARN:-}" \
    ManagedWebAclEnabled="${PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED:-false}" \
    AlarmTopicArn="${PATHFINDER_PROOF_ALARM_TOPIC_ARN:-}" \
    LogRetentionDays="${PATHFINDER_PROOF_LOG_RETENTION_DAYS:-30}"

aws cloudformation describe-stacks \
  --stack-name "${stack_name}" \
  --query "Stacks[0].Outputs" \
  --output table

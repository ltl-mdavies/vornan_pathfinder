#!/usr/bin/env bash
set -euo pipefail

stack_name="${PATHFINDER_API_STACK_NAME:-vornan-pathfinder-api-prod}"
artifact_bucket="${PATHFINDER_API_ARTIFACT_BUCKET:?Set PATHFINDER_API_ARTIFACT_BUCKET to the S3 bucket used for Lambda artifacts.}"
artifact_key="${PATHFINDER_API_ARTIFACT_KEY:-api/pathfinder-api-lambda-$(date +%Y%m%d%H%M%S).zip}"
template_file="infra/aws/api-cloudformation.yaml"
zip_path="outputs/pathfinder-api-lambda.zip"

scripts/package-api-lambda.sh

echo "Uploading ${zip_path} to s3://${artifact_bucket}/${artifact_key}"
aws s3 cp "${zip_path}" "s3://${artifact_bucket}/${artifact_key}"

echo "Deploying ${stack_name}"
aws cloudformation deploy \
  --stack-name "${stack_name}" \
  --template-file "${template_file}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName="${PATHFINDER_API_ENVIRONMENT_NAME:-prod}" \
    ApiName="${PATHFINDER_API_NAME:-vornan-pathfinder-api}" \
    LambdaFunctionName="${PATHFINDER_API_LAMBDA_NAME:-vornan-pathfinder-api}" \
    LambdaCodeS3Bucket="${artifact_bucket}" \
    LambdaCodeS3Key="${artifact_key}" \
    AllowedOrigins="${PATHFINDER_ALLOWED_ORIGINS:-https://pathfinder.vornan.co,https://status.vornan.co}" \
    PublicStatusBaseUrl="${PATHFINDER_PUBLIC_STATUS_BASE_URL:-https://status.vornan.co}" \
    PublicStatusTokenDays="${PATHFINDER_PUBLIC_STATUS_TOKEN_DAYS:-30}" \
    PublicStatusReturnLink="${PATHFINDER_PUBLIC_STATUS_RETURN_LINK:-false}" \
    PublicStatusEmailMode="${PATHFINDER_STATUS_EMAIL_MODE:-log}" \
    PublicStatusEmailDebugReturnLink="${PATHFINDER_STATUS_EMAIL_DEBUG_RETURN_LINK:-false}" \
    EmailFrom="${PATHFINDER_EMAIL_FROM:-Vornan Updates <notifications@notify.vornan.co>}" \
    StatusReplyTo="${PATHFINDER_STATUS_REPLY_TO:-support@vornan.co}" \
    ProofReplyTo="${PATHFINDER_PROOF_REPLY_TO:-support@vornan.com}" \
    OrdersReplyTo="${PATHFINDER_ORDERS_REPLY_TO:-orders@vornan.co}" \
    SystemReplyTo="${PATHFINDER_SYSTEM_REPLY_TO:-ops@vornan.co}" \
    SesRegion="${PATHFINDER_SES_REGION:-us-east-1}" \
    SesConfigurationSet="${PATHFINDER_SES_CONFIGURATION_SET:-pathfinder-transactional}" \
    PublicStatusRateLimitPepper="${PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_PEPPER:-}" \
    PublicStatusEmailMatchRequired="${PATHFINDER_PUBLIC_STATUS_EMAIL_MATCH_REQUIRED:-true}" \
    RequireFirebaseAuth="${PATHFINDER_REQUIRE_AUTH:-true}" \
    AllowedEmailDomains="${PATHFINDER_ALLOWED_EMAIL_DOMAINS:-ltlco.com,vornan.co}" \
    FirebaseProjectId="${FIREBASE_PROJECT_ID:-ltl-dashboard-site}" \
    LiftCustomerListUrl="${LIFT_CUSTOMER_LIST_URL:-https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerContactLIst/LTL-Customer-List?offset=0}" \
    LiftCustomerStatusUrl="${LIFT_CUSTOMER_STATUS_URL:-https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerStatusJSON/CustomerStatusJSON?}" \
    LiftProductCatalogBaseUrl="${LIFT_PRODUCT_CATALOG_BASE_URL:-https://ltlco.lifterp.com/ords/api/lift/erp}" \
    ApiDomainName="${PATHFINDER_API_DOMAIN_NAME:-api.pathfinder.vornan.co}" \
    ApiCertificateArn="${PATHFINDER_API_CERTIFICATE_ARN:-}" \
    DataTablePrefix="${PATHFINDER_DATA_TABLE_PREFIX:-Pathfinder}" \
    SecretPrefix="${PATHFINDER_SECRET_PREFIX:-/vornan/pathfinder/}" \
    StorageDriver="${PATHFINDER_STORAGE_DRIVER:-dynamodb}" \
    SecretsDriver="${PATHFINDER_SECRETS_DRIVER:-secrets-manager}" \
    ProofCoreTableName="${PATHFINDER_PROOF_CORE_TABLE:-}" \
    ProofCoreTableArn="${PATHFINDER_PROOF_CORE_TABLE_ARN:-}" \
    ProofAuditTableName="${PATHFINDER_PROOF_AUDIT_TABLE:-}" \
    ProofAuditTableArn="${PATHFINDER_PROOF_AUDIT_TABLE_ARN:-}" \
    ProofGrantCreationEnabled="${PATHFINDER_PROOF_ENABLE_GRANT_CREATION:-false}" \
    ProofLinkEmailEnabled="${PATHFINDER_PROOF_ENABLE_LINK_EMAIL:-false}" \
    ProofPublicBaseUrl="${PATHFINDER_PROOF_PUBLIC_BASE_URL:-https://proof.vornan.co}"

echo "Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "${stack_name}" \
  --query "Stacks[0].Outputs" \
  --output table

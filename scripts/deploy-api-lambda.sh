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
    AllowedOrigins="${PATHFINDER_ALLOWED_ORIGINS:-https://pathfinder.vornan.co}" \
    RequireFirebaseAuth="${PATHFINDER_REQUIRE_AUTH:-true}" \
    AllowedEmailDomains="${PATHFINDER_ALLOWED_EMAIL_DOMAINS:-ltlco.com,vornan.co}" \
    FirebaseProjectId="${FIREBASE_PROJECT_ID:-}" \
    LiftCustomerListUrl="${LIFT_CUSTOMER_LIST_URL:-https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerContactLIst/LTL-Customer-List?offset=0}" \
    LiftCustomerStatusUrl="${LIFT_CUSTOMER_STATUS_URL:-https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerStatusJSON/CustomerStatusJSON?}" \
    LiftProductCatalogBaseUrl="${LIFT_PRODUCT_CATALOG_BASE_URL:-https://ltlco.lifterp.com/ords/api/lift/erp}" \
    ApiDomainName="${PATHFINDER_API_DOMAIN_NAME:-api.pathfinder.vornan.co}" \
    ApiCertificateArn="${PATHFINDER_API_CERTIFICATE_ARN:-}"

echo "Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "${stack_name}" \
  --query "Stacks[0].Outputs" \
  --output table

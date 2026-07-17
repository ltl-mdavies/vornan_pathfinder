#!/usr/bin/env bash
set -euo pipefail

stack_name="${PATHFINDER_WEB_STACK_NAME:-vornan-pathfinder-web-prod}"
template_file="infra/aws/web-cloudformation.yaml"

echo "Deploying ${stack_name}"
aws cloudformation deploy \
  --stack-name "${stack_name}" \
  --template-file "${template_file}" \
  --parameter-overrides \
    EnvironmentName="${PATHFINDER_WEB_ENVIRONMENT_NAME:-prod}" \
    AdminBucketName="${PATHFINDER_ADMIN_BUCKET:-vornan-pathfinder}" \
    StatusBucketName="${PATHFINDER_STATUS_BUCKET:-vornan-pathfinder-status}" \
    AdminDomainName="${PATHFINDER_ADMIN_DOMAIN_NAME:-}" \
    StatusDomainName="${PATHFINDER_STATUS_DOMAIN_NAME:-}" \
    CertificateArn="${PATHFINDER_WEB_CERTIFICATE_ARN:-}"

echo "Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "${stack_name}" \
  --query "Stacks[0].Outputs" \
  --output table

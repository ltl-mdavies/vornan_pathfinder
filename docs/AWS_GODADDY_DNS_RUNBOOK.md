# Pathfinder AWS + GoDaddy DNS Runbook

This runbook captures the DNS steps for putting Pathfinder on the Vornan domain.

## Target Domains

| Purpose | Domain | AWS target |
| --- | --- | --- |
| Internal Pathfinder app | `pathfinder.vornan.co` | CloudFront distribution for `s3://vornan-pathfinder` |
| Pathfinder API | `api.pathfinder.vornan.co` | API Gateway custom domain regional target |
| Public order status | `status.vornan.co` | Future CloudFront distribution for `s3://vornan-pathfinder-status` |

## ACM Certificate

Request or reuse an ACM certificate that covers:

- `pathfinder.vornan.co`
- `api.pathfinder.vornan.co`
- `status.vornan.co`

Use DNS validation.

Important region note:

- CloudFront certificates must be in `us-east-1`.
- API Gateway regional custom domains need an ACM certificate in the same AWS region as the API stack.
- If the API stack is deployed in `us-east-1`, one certificate can cover both CloudFront and API Gateway.

After requesting the certificate, AWS will provide one DNS validation CNAME per domain. Add each CNAME in GoDaddy exactly as ACM shows it.

## GoDaddy DNS Records

GoDaddy zone:

```text
vornan.co
```

### API Gateway Custom Domain

After deploying `infra/aws/api-cloudformation.yaml` with:

```bash
PATHFINDER_API_DOMAIN_NAME=api.pathfinder.vornan.co
PATHFINDER_API_CERTIFICATE_ARN=arn:aws:acm:REGION:ACCOUNT:certificate/...
PATHFINDER_API_ARTIFACT_BUCKET=YOUR_ARTIFACT_BUCKET
npm run deploy:api-lambda
```

the stack output named `CustomDomainRegionalTarget` is the CNAME target for GoDaddy.

Add this GoDaddy DNS record:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `api.pathfinder` | `CustomDomainRegionalTarget` stack output | 1 hour |

Example value shape:

```text
d-abc123xyz.execute-api.us-east-1.amazonaws.com
```

Do not include `https://` in the CNAME value.

Validation check:

```bash
curl -i https://api.pathfinder.vornan.co/health
```

Expected response:

```json
{"ok":true,"service":"pathfinder-api","version":"0.1.0"}
```

### Pathfinder Admin App

When the admin CloudFront distribution is created, add:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `pathfinder` | CloudFront distribution domain | 1 hour |

Example value shape:

```text
d111111abcdef8.cloudfront.net
```

Do not include `https://` in the CNAME value.

### Public Status App

When the status CloudFront distribution is created, add:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `status` | CloudFront distribution domain | 1 hour |

## GoDaddy UI Steps

1. Open GoDaddy and choose the `vornan.co` domain.
2. Go to DNS or Manage DNS.
3. Add a new record.
4. Choose `CNAME`.
5. Enter the Host from the table above.
6. Paste the AWS target value into Points to.
7. Set TTL to 1 hour or the default.
8. Save.
9. Wait for DNS propagation.

## Notes

- `api.pathfinder.vornan.co` is a nested subdomain. In GoDaddy, the Host should be `api.pathfinder`, not the full domain.
- DNS validation records from ACM usually have generated names beginning with `_`. Add those separately from the app CNAME records.
- If GoDaddy rejects nested hostnames, use `pathfinder-api.vornan.co` instead and deploy the API stack with `PATHFINDER_API_DOMAIN_NAME=pathfinder-api.vornan.co`.

# Pathfinder AWS + Cloudflare DNS Runbook

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

After requesting the certificate, AWS will provide one DNS validation CNAME per
domain. Add each CNAME in Cloudflare exactly as ACM shows it, and keep those
validation records in place so AWS can renew the certificate.

## Cloudflare DNS Records

Cloudflare zone:

```text
vornan.co
```

## Current AWS Targets

Created on July 17, 2026:

| Surface | AWS resource | Current AWS value |
| --- | --- | --- |
| Admin app | CloudFront distribution `E34F508KID3LHW` | `dgpk5x391g0c3.cloudfront.net` |
| Public status app | CloudFront distribution `E13RHNZTC6PRRC` | `d2x5lokt6c28c4.cloudfront.net` |
| API | API Gateway custom domain target | `d-dtf1ffa6fe.execute-api.us-east-1.amazonaws.com` |

The ACM certificate has been issued and AWS aliases are attached. Add these
Cloudflare records:

| Type | Name | Target | Proxy status |
| --- | --- | --- | --- |
| CNAME | `pathfinder` | `dgpk5x391g0c3.cloudfront.net` | DNS only for first verification |
| CNAME | `status` | `d2x5lokt6c28c4.cloudfront.net` | DNS only for first verification |
| CNAME | `api.pathfinder` | `d-dtf1ffa6fe.execute-api.us-east-1.amazonaws.com` | DNS only for first verification |

Do not include `https://` in any CNAME target value.

### API Gateway Custom Domain

After deploying `infra/aws/api-cloudformation.yaml` with:

```bash
PATHFINDER_API_DOMAIN_NAME=api.pathfinder.vornan.co
PATHFINDER_API_CERTIFICATE_ARN=arn:aws:acm:REGION:ACCOUNT:certificate/...
PATHFINDER_API_ARTIFACT_BUCKET=YOUR_ARTIFACT_BUCKET
npm run deploy:api-lambda
```

the stack output named `CustomDomainRegionalTarget` is the CNAME target for
Cloudflare.

Add this Cloudflare DNS record:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `api.pathfinder` | `CustomDomainRegionalTarget` stack output | Auto |

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

After running `npm run deploy:web-hosting`, use the stack output named
`AdminDistributionDomainName` as the DNS target. Add:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `pathfinder` | CloudFront distribution domain | Auto |

Example value shape:

```text
d111111abcdef8.cloudfront.net
```

Do not include `https://` in the CNAME value.

### Public Status App

After running `npm run deploy:web-hosting`, use the stack output named
`StatusDistributionDomainName` as the DNS target. Add:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `status` | CloudFront distribution domain | Auto |

## Cloudflare UI Steps

1. Open Cloudflare and choose the `vornan.co` zone.
2. Go to DNS > Records.
3. Add a new record.
4. Choose `CNAME`.
5. Enter the Host from the table above.
6. Paste the AWS target value into Points to.
7. Set Proxy status to DNS only for first verification.
8. Leave TTL on Auto.
9. Save.
10. Wait for DNS propagation.

## Notes

- `api.pathfinder.vornan.co` is a nested subdomain. In Cloudflare, the Name can be `api.pathfinder`.
- DNS validation records from ACM usually have generated names beginning with `_`. Add those separately from the app CNAME records.

# Vornan Pathfinder

Pathfinder is a Vornan-aligned order translation and routing platform. The MVP focuses on taking customer order input from XLSX/grid sources, translating it into a Canonical Order, validating it, and generating a Lift Standard Graphics payload and submit-request preview.

## Current MVP State

- React/Vite web app with Vornan/Pathfinder UI shell.
- Express API with Lift customer directory import/fallback.
- Shared packages for Canonical Order, XLSX/template mapping, Lift payload generation, and customer directory parsing.
- Manual XLSX/grid import workflow with field mapping, canonical preview, Lift payload preview, and persisted local preview jobs.
- Local JSON persistence for development workspaces, import methods, target config, and processing jobs.
- Lift QA1/PROD target configuration UI with masked credential handling.

## Run Locally

```bash
npm install
npm run dev
```

Web app: `http://127.0.0.1:5173`  
API: `http://127.0.0.1:3000`

## Useful Commands

```bash
npm run check
npm run build
```

## Production Hosting Prep

The first AWS static hosting foundation is documented in
[docs/AWS_PRODUCTION_HOSTING_AND_STATUS_PLAN.md](docs/AWS_PRODUCTION_HOSTING_AND_STATUS_PLAN.md).

Production auth is opt-in by environment:

- Web: set `VITE_AUTH_REQUIRED=true` and the `VITE_FIREBASE_*` values.
- API: set `PATHFINDER_REQUIRE_AUTH=true`, `FIREBASE_PROJECT_ID`, and either
  `FIREBASE_SERVICE_ACCOUNT_JSON` or AWS/application default credentials.
- Allowed Google domains default to `ltlco.com,vornan.co`.

Admin web deploy entry point:

```bash
VITE_API_BASE_URL=https://api.pathfinder.vornan.co \
PATHFINDER_ADMIN_BUCKET=vornan-pathfinder \
PATHFINDER_ADMIN_CLOUDFRONT_DISTRIBUTION_ID=YOUR_DISTRIBUTION_ID \
npm run deploy:admin-web
```

The deploy script builds `@pathfinder/web`, syncs immutable assets to S3, uploads
`index.html` with no-cache headers, and optionally invalidates CloudFront.

AWS bucket bootstrap:

```bash
npm run bootstrap:aws-buckets
```

This creates or verifies the admin web bucket (`vornan-pathfinder`), public
status bucket (`vornan-pathfinder-status`), and API artifact bucket
(`vornan-pathfinder-artifacts`) with public access blocked, AES256 encryption,
and versioning enabled.

CloudFront hosting deploy:

```bash
npm run deploy:web-hosting
```

This creates CloudFront distributions and private S3 bucket policies for the
admin and public status apps. It can run before DNS is ready; leave
`PATHFINDER_WEB_CERTIFICATE_ARN` empty to create CloudFront default domains,
then redeploy with the ACM certificate ARN and domain names after validation.

API Lambda artifact build:

```bash
npm run build:api-lambda
npm run package:api-lambda
```

This writes a Lambda-ready handler bundle to `outputs/api-lambda/lambda.mjs`.
Use handler `lambda.handler` with Node.js 20.x and set
`PATHFINDER_CUSTOMER_SEED_FILE=/var/task/data/lift-customers.sample.csv`.

API Gateway/Lambda deploy scaffold:

```bash
PATHFINDER_API_ARTIFACT_BUCKET=vornan-pathfinder-artifacts \
npm run deploy:api-lambda
```

The deploy script uploads `outputs/pathfinder-api-lambda.zip` and deploys
`infra/aws/api-cloudformation.yaml`, which creates an HTTP API, Lambda function,
execution role, proxy routes, and `/health` output.

To deploy the API with `api.pathfinder.vornan.co`, provide an ACM certificate ARN:

```bash
PATHFINDER_API_ARTIFACT_BUCKET=vornan-pathfinder-artifacts \
PATHFINDER_API_DOMAIN_NAME=api.pathfinder.vornan.co \
PATHFINDER_API_CERTIFICATE_ARN=arn:aws:acm:REGION:ACCOUNT:certificate/... \
npm run deploy:api-lambda
```

GoDaddy DNS instructions live in
[docs/AWS_GODADDY_DNS_RUNBOOK.md](docs/AWS_GODADDY_DNS_RUNBOOK.md).

AWS storage and secret-management notes live in
[docs/AWS_STORAGE_AND_SECRETS_RUNBOOK.md](docs/AWS_STORAGE_AND_SECRETS_RUNBOOK.md).

## Project Records

- Master product directive: [docs/PATHFINDER_MASTER_SPEC.md](docs/PATHFINDER_MASTER_SPEC.md)
- Initial implementation plan: [docs/PATHFINDER_INITIAL_BUILD_PLAN.md](docs/PATHFINDER_INITIAL_BUILD_PLAN.md)
- Living build log: [docs/PATHFINDER_BUILD_LOG.md](docs/PATHFINDER_BUILD_LOG.md)
- Lift payload example: [docs/examples/lift-standard-graphics-order.sample.json](docs/examples/lift-standard-graphics-order.sample.json)

## Local Runtime Data

The development API writes local runtime state to `data/pathfinder-store.local.json`. That file is intentionally ignored because it can contain local job history and credential placeholders. The API will recreate it from seed defaults when needed.

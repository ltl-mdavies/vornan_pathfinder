# Pathfinder AWS Storage and Secrets Runbook

This runbook captures the first production storage foundation for Pathfinder.

## Current State

The deployed API stack can now create DynamoDB tables and grant the Lambda role access to those tables plus a scoped Secrets Manager prefix.

The runtime defaults remain:

```text
PATHFINDER_STORAGE_DRIVER=local
PATHFINDER_SECRETS_DRIVER=local
```

Keep local storage until the DynamoDB adapter is implemented and smoke-tested. Secrets Manager can now be enabled independently for target credentials:

```text
PATHFINDER_STORAGE_DRIVER=local
PATHFINDER_SECRETS_DRIVER=secrets-manager
```

If storage is accidentally changed early, the API now fails clearly instead of silently falling back to local JSON:

```text
PATHFINDER_STORAGE_DRIVER=dynamodb          # guarded until adapter implementation
```

The unauthenticated `/health` endpoint includes the active persistence driver settings and readiness flags.

## DynamoDB Tables

The API CloudFormation stack creates these on-demand, encrypted DynamoDB tables with point-in-time recovery enabled:

| Table purpose | Default table name |
| --- | --- |
| Customers | `Pathfinder-Customers-prod` |
| Customer workspaces | `Pathfinder-CustomerWorkspaces-prod` |
| Targets | `Pathfinder-Targets-prod` |
| Import methods | `Pathfinder-ImportMethods-prod` |
| Output routes | `Pathfinder-OutputRoutes-prod` |
| Product mappings | `Pathfinder-ProductMappings-prod` |
| Jobs | `Pathfinder-Jobs-prod` |
| Submit attempts | `Pathfinder-SubmitAttempts-prod` |
| Lift product cache | `Pathfinder-LiftProductCache-prod` |
| Order status tokens | `Pathfinder-OrderStatusTokens-prod` |
| Order status snapshots | `Pathfinder-OrderStatusSnapshots-prod` |
| Canonical registry | `Pathfinder-CanonicalRegistry-prod` |

The table prefix can be changed with:

```text
PATHFINDER_DATA_TABLE_PREFIX
```

## Secrets Manager

The Lambda role can read and write secrets below:

```text
/vornan/pathfinder/
```

Target credentials are stored one secret per target. The default Lift target secret name is:

```text
/vornan/pathfinder/targets/lift-standard-graphics
```

The API writes a JSON object with environment-specific credentials, for example:

```json
{
  "environments": {
    "lift-prod": {
      "credentials": {
        "User": "PATHFINDER",
        "Password": "stored-in-secrets-manager"
      }
    }
  },
  "lift": {
    "credentials": {
      "User": "PATHFINDER",
      "Password": "stored-in-secrets-manager"
    }
  }
}
```

Optional additional secret:

```text
/vornan/pathfinder/firebase/admin
```

## Deployment Variables

Local deploy:

```bash
PATHFINDER_API_ARTIFACT_BUCKET=vornan-pathfinder-artifacts \
PATHFINDER_DATA_TABLE_PREFIX=Pathfinder \
PATHFINDER_SECRET_PREFIX=/vornan/pathfinder/ \
PATHFINDER_STORAGE_DRIVER=local \
PATHFINDER_SECRETS_DRIVER=local \
npm run deploy:api-lambda
```

Before the first deploy, bootstrap the required S3 buckets:

```bash
npm run bootstrap:aws-buckets
```

The bootstrap script creates or verifies:

- `vornan-pathfinder` for the admin web app.
- `vornan-pathfinder-status` for the public order status app.
- `vornan-pathfinder-artifacts` for Lambda deployment packages.

Each bucket is configured with public access blocked, AES256 server-side
encryption, and versioning enabled. Public web access should come through
CloudFront, not direct S3 website hosting.

GitHub Actions variables:

| Variable | Suggested value |
| --- | --- |
| `PATHFINDER_DATA_TABLE_PREFIX` | `Pathfinder` |
| `PATHFINDER_SECRET_PREFIX` | `/vornan/pathfinder/` |
| `PATHFINDER_STORAGE_DRIVER` | `local` initially, then `dynamodb` |
| `PATHFINDER_SECRETS_DRIVER` | `secrets-manager` for production target credentials |

## Flip Criteria

Do not set production storage to `dynamodb` until:

- The DynamoDB adapter reads and writes every current store domain.
- The Secrets Manager adapter is enabled and preserves masked credential behavior.
- A migration script seeds targets, routes, import methods, canonical registry, and customer workspaces.
- API smoke tests pass against a deployed Lambda using the AWS drivers.
- Saved target environment credentials survive fresh Lambda invocations.

## Next Implementation Step

Add a storage adapter interface in the API package:

```text
local JSON store -> current behavior
DynamoDB store   -> production behavior
```

The secrets adapter is in place for target credentials. The next persistence step is the DynamoDB store adapter plus a migration script for existing local JSON data.

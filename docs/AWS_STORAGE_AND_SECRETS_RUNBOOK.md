# Pathfinder AWS Storage and Secrets Runbook

This runbook captures the first production storage foundation for Pathfinder.

## Current State

The deployed API stack can now create DynamoDB tables and grant the Lambda role access to those tables plus a scoped Secrets Manager prefix.

The runtime defaults remain:

```text
PATHFINDER_STORAGE_DRIVER=local
PATHFINDER_SECRETS_DRIVER=local
```

Keep those defaults until the DynamoDB and Secrets Manager adapters are implemented and smoke-tested.

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

Recommended secret names:

```text
/vornan/pathfinder/targets/lift-erp/prod/import-credentials
/vornan/pathfinder/targets/lift-erp/qa1/import-credentials
/vornan/pathfinder/firebase/admin
```

Secret values should be JSON objects, for example:

```json
{
  "User": "PATHFINDER",
  "Password": "stored-in-secrets-manager"
}
```

## Deployment Variables

Local deploy:

```bash
PATHFINDER_API_ARTIFACT_BUCKET=your-lambda-artifact-bucket \
PATHFINDER_DATA_TABLE_PREFIX=Pathfinder \
PATHFINDER_SECRET_PREFIX=/vornan/pathfinder/ \
PATHFINDER_STORAGE_DRIVER=local \
PATHFINDER_SECRETS_DRIVER=local \
npm run deploy:api-lambda
```

GitHub Actions variables:

| Variable | Suggested value |
| --- | --- |
| `PATHFINDER_DATA_TABLE_PREFIX` | `Pathfinder` |
| `PATHFINDER_SECRET_PREFIX` | `/vornan/pathfinder/` |
| `PATHFINDER_STORAGE_DRIVER` | `local` initially, then `dynamodb` |
| `PATHFINDER_SECRETS_DRIVER` | `local` initially, then `secrets-manager` |

## Flip Criteria

Do not set production to `dynamodb` / `secrets-manager` until:

- The DynamoDB adapter reads and writes every current store domain.
- The Secrets Manager adapter preserves masked credential behavior.
- A migration script seeds targets, routes, import methods, canonical registry, and customer workspaces.
- API smoke tests pass against a deployed Lambda using the AWS drivers.
- Saved target environment credentials survive fresh Lambda invocations.

## Next Implementation Step

Add a storage adapter interface in the API package:

```text
local JSON store -> current behavior
DynamoDB store   -> production behavior
```

Then add a secrets adapter interface:

```text
local secrets sidecar -> current behavior
Secrets Manager       -> production behavior
```

This keeps the working MVP stable while giving production a clean, testable path off local JSON files.

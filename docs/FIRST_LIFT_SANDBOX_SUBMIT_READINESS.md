# First Lift Sandbox Submit Readiness

Goal: submit a real order to Lift from Momentara's Manual Import workflow using the sandbox submit lane, usually `Sandbox · LTL Demo` with Lift customer `1249`.

This is intentionally different from a QA-only test. The target environment can be `PROD` if the Lift integration mapping is being built in production, while the submit profile keeps the order under the non-customer-facing LTL Demo customer.

## Pathfinder Submit Path

`Manual Import -> Preview Job -> Submit Certification -> Output Route -> Target Environment -> Lift POST`

The first submit should use:

- Customer workspace: `Empirical - Momentara`
- Import method: `Manual XLSX`
- Output route: `Larger Than Life · Lift / 91 · Standard Graphics`
- Submit profile: `Sandbox · LTL Demo`
- Submit customer in payload: `1249 / LTL Demo`
- Source customer in audit fields: Momentara
- Target environment: whichever Lift environment the integration team has mapped, likely `PROD` first

## Hard Pathfinder Gates

These must pass before Pathfinder will make the external POST:

- Preview state is `Ready`.
- Canonical Order validation has no blocking failures.
- Lift payload validation has no blocking failures.
- Every order line has a resolved route-specific product identifier.
- Output Route is `Active`.
- Target Environment for the route is `Active`.
- Endpoint URL is configured.
- Header `Ext_ID` equals body `order.ext_id`.
- Lift `Company` header is present, expected `91` for Larger Than Life.
- Lift import username and password are not placeholders or masked values.
- Submit profile is enabled.
- Submit profile is sandbox by default. Live customer submit requires explicit opt-in.
- External submit gate is enabled with `PATHFINDER_ENABLE_LIFT_SUBMIT=true`.
- Lift transport is live with `PATHFINDER_LIFT_TRANSPORT_MODE=live`.

## Safety Defaults

Pathfinder blocks live-customer submits by default. For first production-endpoint tests, choose the sandbox profile instead of enabling live customer submit.

If a future real customer submit is approved, start the API with:

```bash
PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT=true
```

Do not set this for the first sandbox lane test.

## Runtime Settings For First Real Sandbox Submit

Start the API with both submit switches:

```bash
PATHFINDER_ENABLE_LIFT_SUBMIT=true PATHFINDER_LIFT_TRANSPORT_MODE=live npm run dev:api
```

If either switch is missing, the submit certification remains blocked and the submit endpoint will not call Lift.

## Configuration Checklist

- Confirm Lift integration team mapped the submitted JSON body for the selected environment.
- Confirm whether the first endpoint should be `PROD` or `QA1`.
- Confirm the selected Target Environment endpoint is reachable from the machine running Pathfinder.
- Confirm Lift import username/password are entered in Target Environment settings.
- Confirm Company ID is `91`.
- Confirm `Sandbox · LTL Demo` profile is enabled and points to Lift customer `1249`.
- Confirm the Manual XLSX import method uses the correct Output Route.
- Upload or load the Momentara workbook and generate a fresh preview.
- Resolve all Output Product Map unmapped keys to approved Lift unit numbers.
- Review the masked submit request, especially `endpoint_url`, `Ext_ID`, `Company`, and submit customer.
- Submit from the Ready preview/job detail screen.

## Expected Response Handling

Pathfinder stores every submit attempt with:

- idempotency key
- masked submit request
- certification snapshot
- normalized Lift response
- translated error summary when possible
- returned Lift order number when Lift includes one in the import response

If Lift rejects the order, Pathfinder should retain the job and allow operators to fix mapping/configuration and retry/replay without asking Momentara to resend the source order.

## Known Open Concern

The current Lift submit body is generated from Pathfinder's Lift Standard Graphics payload builder. The Output Template editor is valuable for configuration and future rendering, but arbitrary template rendering is not yet the submit engine. For the first submit, confirm that the generated Lift payload still matches the JSON body approved by the Lift integrator.

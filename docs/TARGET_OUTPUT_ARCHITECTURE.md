# Pathfinder Target and Output Architecture

This note records the current destination model used by Pathfinder.

## Mental Model

`Customer Input -> Canonical Order -> Output Route -> Output Template -> Target Environment`

The customer import method owns how data enters Pathfinder. The output route owns where the resulting Canonical Order is rendered and sent.

## Core Objects

### Target

A Target is a destination platform Pathfinder can send orders to.

Examples:

- Lift ERP
- ThinkDifferentPrint
- Ecommerce shop
- SFTP destination

Target-level settings describe the platform itself: name, target type, adapter, status, health, environments, templates, and routes.

### Target Environment

A Target Environment is one deployable endpoint or connection context for a target.

Examples:

- QA1
- PROD
- DEV
- Sandbox

Environment-level settings include endpoint URL, auth method, credentials, headers, and status. Infrastructure environments should not be used to represent customer identity.

### Output Template

An Output Template defines the rendered body/header/file shape.

Examples:

- Lift Standard Graphics Order JSON
- Ecommerce order JSON
- CSV export
- XML file export

Templates can be pasted as normal JSON with example values. Pathfinder detects fields and lets users map those fields to Canonical Order, environment, route, generated, or static values.

### Output Route

An Output Route combines a target, environment, destination account/company, output template, and product identifier strategy.

Example:

`Larger Than Life · Lift / 91 · Standard Graphics`

Routes are what customer import methods select. Product mapping is scoped to routes because the same customer-provided value may resolve differently for different factories, Lift companies, ecommerce shops, or output templates.

### Submit Profile

A Submit Profile controls submit-time customer identity for a route.

Current profiles:

- `Live Customer`: submit using the selected customer workspace.
- `Sandbox · LTL Demo`: submit using Lift customer `1249 / LTL Demo`.

Submit Profiles are route-level because sandbox/live customer behavior is not the same thing as QA/PROD infrastructure.

## Current Lift Route

The current seeded route is:

- Target: `Lift ERP`
- Environment: `QA1`
- Destination account/company: `Larger Than Life / 91`
- Output template: `Lift Standard Graphics Order`
- Product identifier: `Lift unit_number`
- Submit profiles: `Live Customer`, `Sandbox · LTL Demo`

The route environment can be changed to `PROD` while keeping the `Sandbox · LTL Demo` submit profile. This supports the first planned production-endpoint test path:

`Lift ERP / PROD -> Larger Than Life Company 91 -> Sandbox · LTL Demo customer 1249`

This is intentionally different from a QA1 test. `PROD` describes the Lift infrastructure endpoint; `Sandbox · LTL Demo` describes the customer identity submitted in the payload.

## Rules

- Import methods select Output Routes, not raw targets or raw templates.
- Product mappings are scoped to Output Routes.
- Environment settings provide connection details and credentials.
- Submit Profiles provide submit customer identity.
- Submit Certification is separate from preview job state; a preview may be `Ready` but still blocked from real external submit by credentials, product mapping, route configuration, or the explicit external-submit gate.
- Certification blockers include action keys that route users to the relevant setup surface before retrying submit.
- Every submit request creates or reuses a Submit Attempt audit record with an idempotency key, masked request, certification snapshot, blockers, and normalized response state.
- Template body/header fields should be mapped through the template editor, not hand-authored by non-technical users where possible.
- Lift `Ext_ID` header must match `body.order.ext_id`.
- `POST /api/customers/:liftCustomerId/jobs/:jobId/submit` is the guarded submit entrypoint. It refuses uncertified jobs and records every attempt with a masked request plus normalized response state.
- External submit has two switches:
  - `PATHFINDER_ENABLE_LIFT_SUBMIT=true` unlocks the submit gate after certification passes.
  - `PATHFINDER_LIFT_TRANSPORT_MODE=live` allows the adapter to make the external Lift POST.
- If the submit gate is unlocked but transport mode is not `live`, Pathfinder records a certified dry-run submit attempt and does not call Lift.
- Live submit rebuilds the unmasked request from the selected Output Route and Target Environment at submit time. Persisted preview jobs and submit attempts remain masked.

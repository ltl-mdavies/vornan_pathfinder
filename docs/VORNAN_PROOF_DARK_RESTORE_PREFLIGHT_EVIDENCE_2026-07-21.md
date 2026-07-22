# Vornan Proof dark-restoration preflight evidence — 2026-07-21

## Outcome

The non-mutating dark-restoration preflight passed in preparation mode against the isolated `vornan-proof-dev` stack. The same preflight correctly failed closed when evaluated with the deadline trigger before the recorded expiry. No CloudFormation change set was created or executed, no stack parameter changed, and the approved internal read-only window remains active only through its existing deadline.

This slice prepares a narrowly bounded closure review; it does not authorize a deployment. Actual dark restoration remains deferred until `2026-07-28T21:49:50.000Z` or a separately approved early-rollback trigger.

## Exact dark target

The preflight accepts only this complete parameter target:

| Parameter | Required value |
|---|---|
| `PublicReadEnabled` | `false` |
| `ReadOnlyActivationExpiresAt` | empty |
| `OperatorGrantCreationEnabled` | `false` |
| `GrantAllowedCustomerIds` | empty |
| `SyntheticQaEnabled` | `false` |
| `ReadOnlyQaConfirmed` | `false` |
| `ProductionPublicReadApproved` | `false` |
| `ProofDomainName` | empty |
| `CertificateArn` | empty |

Every other CloudFormation parameter must use its previous value. The core table, audit table, operator function, public API, CloudFront distribution, sync queue, dead-letter queue, and operational dashboard must remain present. The existing bucket, logs, WAF, endpoints, and deployed artifacts are also retained by the parameter-only restoration plan.

## Live preparation result

At `2026-07-22T00:49:54.878Z`, `npm run check:proof-dark-restore` returned `ready_for_dark_restore_preparation_review`:

- source window status `healthy_no_active_access`;
- zero active grants and zero active sessions;
- zero malformed access records;
- all ten expected alarms present and `OK`;
- sync queue and dead-letter queue empty;
- every required retained-resource output present;
- exact dark target confirmed;
- `execution_review_ready=false`;
- deployment, public-read change, grant-creation change, DNS, email, decision, Lift-write, and Phase 3 authorization all `false`.

The result's next action was limited to preparing a minimal reviewed change set without execution. This slice intentionally did not create that change set because the deadline has not been reached.

## Live fail-closed deadline result

At `2026-07-22T00:50:48.102Z`, the same live inventory was evaluated with `PATHFINDER_PROOF_DARK_RESTORE_TRIGGER=deadline`. The command exited nonzero with `awaiting_dark_restore_deadline` because the recorded UTC expiry had not been reached.

All source-health and exact-target gates remained satisfied. `trigger_satisfied` was the only unmet gate, `execution_review_ready` remained `false`, and every authorization remained `false`. The reported next action was `continue_monitoring_until_deadline_or_rollback`.

## Trigger and guardrail behavior

- Preparation mode can document readiness but can never become execution-ready.
- Deadline mode cannot become review-ready before the live recorded expiry.
- Early rollback mode requires the explicit `PATHFINDER_PROOF_DARK_RESTORE_ROLLBACK_APPROVED=true` input in addition to the rollback trigger.
- Even a satisfied deadline or approved rollback reports readiness only for manual change review and keeps `deployment_authorized=false`.
- Active grants or sessions, malformed access records, missing or non-OK alarms, nonempty queues, target drift, missing retained outputs, a custom domain, or an invalid trigger block the review.
- Output is limited to bounded counts, gate results, target parameters, retained output names, and authorization booleans. It does not emit customer IDs, order numbers, grant/session identifiers, access URLs, or creative payloads.
- The preflight contains no AWS mutation operation and does not import a deployment helper.

## Validation

- every workspace typecheck passed;
- all 169 workspace tests passed;
- all 61 Proof deployment-safety tests passed, including six dark-restoration preflight cases;
- every production build passed;
- both bounded Phase 2 and activation-review evaluators passed while authorizing no deployment or mutation;
- the live preparation evaluation passed without authorizing execution;
- the live premature-deadline evaluation failed closed with only the trigger gate unmet;
- the staged sensitive-value scan and `git diff --check` passed.

## Deferred execution

No Proof stack deployment, CloudFormation change set, DNS change, email, decision, Lift write, synthetic fixture, or Pathfinder production change occurred. At the deadline or after a separately recorded rollback approval, the operator must rerun the preflight, inspect the exact parameter-only change set, and separately approve any execution. This evidence alone is not deployment authority.

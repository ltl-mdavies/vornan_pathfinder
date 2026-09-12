# Deployed artifact compatibility and storage execution boundary

Subsequent status: the user approved this plan, and the storage-only execution
completed successfully. See `storage-execution-review.md` for the postchecks.
The authorization holds below describe the pre-execution review checkpoint.

## Authorized retrieval and bounded finding

The user authorized read-only retrieval/review of the exact deployed Lambda
package, plus publication of the prior expanded change-set report. That report
is published in PR #342 at `43f6460`. This new artifact assessment remains local
until publication is authorized. No change-set execution is authorized.

The retrieved ZIP matches Lambda's recorded base64 SHA-256 and CodeSize. Its
function identity, revision, environment and code hash match the reviewed deployed
baseline. The runtime is Node.js 22, with handler `lambda.handler`. Retrieval used
the Lambda API's HTTPS package URL; the package, API response and manifest remain
private outside Git. No function invocation, provider operation or package code
execution was performed.

The exact bundle and bundled source map contain no reference to
`PATHFINDER_INTAKE_ATTEMPTS_TABLE` or the new Intake Assurance capability flags.
The source map contains 44 API application sources. The deployed handler dispatches
the existing scheduled Wrike event or HTTP handler, without the new assurance
recovery/notification/feedback/repair event dispatch branches.

Static environment-access review identified 83 direct fixed-key reads across 15
application modules. The two indexed environment helpers use explicit constant
names at their call sites: the existing DynamoDB table configuration and email
settings. Seven functions accept the environment map as a default argument; their
reads select explicit existing keys or pass the map to another inspected fixed-key
configuration function. None derives table bindings by enumerating environment
variables or selects the new intake binding.

The exact bundled handler passes Node's syntax check without executing it. A
separate private review manifest binds the downloaded evidence, extracted package
files and static environment-access inventory; restrictive permissions were checked.

This supports a **static compatibility finding for adding the unused table binding
to this exact artifact**. It is not a runtime smoke test or proof of future feature
compatibility. Storage provisioning will not deliver the newer runtime or enable
Intake Assurance. Any later artifact or activation requires separate review.

## Concrete proposed execution boundary

The candidate remains the unique change-set ID in the private creation response,
with report name `intake-storage-only-20260912-12a7b32645d4`. It adds one protected
table and modifies only the API environment and scoped table IAM. All 99 existing
parameters/artifacts remain preserved, and all intake capability gates remain off.

Before any separately approved execution:

1. Recheck account/stack identity, exact change-set ID and CREATE_COMPLETE/AVAILABLE
   status. Recompare its template, complete parameters and exact three-resource
   scope to the sealed reviewed request. Stop on any unexpected change, replacement
   or removal, concurrent stack update or competing release.
2. Refresh stack/template/Lambda code hash, configuration and complete environment;
   require the reviewed baseline and confirm the table name is still available.
   Recompute candidate bytes; the reviewed derivation is 3,658 bytes, leaving 438.
3. Capture relevant read-only operational health for the API, existing schedules,
   alarms and queues. Require an understood healthy baseline or stop for review.
4. Execute the exact approved change-set ID once. Do not retry, substitute a new
   change set, change capability gates or upload code as part of this operation.
5. Observe stack events to completion. Verify the resolved table binding and exact
   table-scoped IAM ARN, unchanged prior environment/code/configuration, dark
   capability gates, table key schema/encryption/PITR/deletion protection, retained
   resource policies and operational health. Use read-only checks without provider
   actions or customer job submissions.

The two AWS `KNOWN_AFTER_APPLY` markers are allowed only at the predicted new table
Ref/GetAtt locations. They are not arbitrary wildcards. Post-execution verification
must use actual resolved values and preserve all prior environment values, including
the value masked in the CloudFormation context.

## Failure and forward recovery

On any failure or unexpected delta, stop new actions and collect stack events and
resource identities for review. Do not automatically retry creation or delete the
table. CloudFormation rollback may retain and detach it; a deterministic-name
collision must be resolved through an explicitly reviewed import/adoption plan.

If the stack update succeeds but a later check fails, preserve the table and its
records and keep all assurance capability gates off. Do not use storage=false as
routine operational rollback. Any corrective change set, table import, removal,
code rollback or activation needs its own concrete review and authorization.

Execution approval must include this one-shot scope, read-only pre/post checks and
the stop-on-drift/failure conditions. Independent review of the exact artifact and
this execution boundary is required before recommending that approval.

Live Support independently supports the narrow static compatibility premise. Its
review found no assurance/table-binding literals or strict unknown-environment-key
rejection. It requires the listed fresh pre/post checks and separate explicit
execution approval; it performed no production or package execution.

Development independently verified package/manifest/extraction integrity and the
same baseline identity, then returned static compatibility GO for this exact hash
and single-variable addition. Its broader app/package review found no generic
unknown-key processing; dependency environment enumeration was limited to debug
configuration and Google-auth child-process pass-through, neither selecting an
assurance capability from this key. It also confirmed the table permission is
unused by this artifact.

Development recommends requesting combined explicit approval to publish this
sanitized assessment and execute the existing change set once under the documented
pre/post checks and stop conditions. Both reviews leave execution unauthorized
until the user grants that scope. Neither reviewer invoked the package or performed
production/provider actions.

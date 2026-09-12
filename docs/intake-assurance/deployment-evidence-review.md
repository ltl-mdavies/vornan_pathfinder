# Deployed evidence review — 2026-09-12

PR #341 merged after successful final-head CI. This assessment uses source
`6c247a271a576377fcc8b56d2238bdf9dc441bdb`. The user authorized production
read-only evidence collection; deployment, activation and change-set creation or
execution are not included in that authorization.

## Collected baseline

At `2026-09-12T17:23:02.637494+00:00`, the collector captured STS identity,
CloudFormation stack description, original template and resource inventory, and
the mapped API Lambda configuration. Account, stack and logical-to-physical
function identity checks passed. Stack status was `UPDATE_COMPLETE`; Lambda last
update status was `Successful`. The resource inventory contained 37 resources and
no pagination continuation.

The deployed template and stack inventory agree on 99 parameters, including one
NoEcho parameter. The Lambda has 69 environment variables totaling 3,596 UTF-8
bytes, leaving 500 bytes under the 4,096-byte limit. Intake capability flags and
the intake table binding are absent. These are collected baseline measurements,
not the synthetic fixture totals in earlier source reviews.

Raw responses and complete parameter/environment packets are private temporary
files, outside the repository, with directory mode 0700 and file mode 0600. Raw
response hashes match the collection manifest. Raw values, masked parameter
names, physical identifiers and environment maps are deliberately excluded here.
Private temporary evidence must be retained securely or recollected before use;
this report alone is insufficient deployment input.

The original YAML response is retained. Packet templates normalize supported YAML
intrinsics to CloudFormation JSON keys, including dotted GetAtt to its array form.
Canonical packet hashes bind the supplied documents; they do not independently
authenticate AWS provenance. The baseline preservation packet passes the offline
preflight with all 99 parameters preserved and identical current/candidate/rollback
environment maps.

## Offline candidate comparisons

Current source adds 15 parameters with false or empty defaults; none of the 99
existing definitions changed or disappeared. Both prepared candidates explicitly
declare all 15 new values and preserve all 99 existing parameters using
`UsePreviousValue`, including the NoEcho and artifact parameters.

| Candidate | Evaluated resource delta | Environment bytes | Remaining bytes |
| --- | --- | ---: | ---: |
| All new features and storage off | None | 3,596 | 500 |
| Storage only; all capabilities off | Add intake table; modify API role and function | 3,658 | 438 |

The all-off candidate has an equivalent symbolic API environment and no evaluated
resource changes. It supplies no new code, storage or capability activation.

The storage-only candidate adds the table binding to the complete collected
environment. Its evaluated changes are the protected intake table, scoped table
permissions on the API role, API environment binding and table output. Existing
artifact parameters remain unchanged, so it does not deliver newer runtime code.
Both candidates pass the offline preservation validator. Resource comparisons use
the repository's bounded evaluator, which supplies symbolic values for some
resource references; they are not AWS template validation or an actual change set.

The storage-only rollback packet restores the prior parameter/environment shape.
That does **not** establish safe operational rollback: disabling storage after
provisioning retains and detaches the table, and later re-enablement may require
import or collision handling. Normal operational rollback must disable capability
gates while preserving storage and records.

## Proposed next boundary

Prepare and review a **nonexecuting storage-only CloudFormation change set**, with
all existing parameters/artifacts preserved and every intake capability off.
Separate user authorization is required before creating it. Confirm evidence
freshness, physical table-name availability, supported template validation,
deployed-runtime compatibility and exact resource/replacement/IAM changes during
that preparation. Do not use the hand-maintained general deploy parameter list.

Execution remains a separate approval after the concrete change set is reviewed.
Runtime artifact delivery, Admin publication, customer selection, visibility,
capture, recovery and provider writes require their own compatible release and
activation evidence. No AWS mutation, change set, provider operation, deployment,
publication or activation occurred during this evidence collection.

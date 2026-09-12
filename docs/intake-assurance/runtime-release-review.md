# API runtime-only release preparation — 2026-09-12

Subsequent status: the user approved this candidate's execution, and the runtime-only
deployment completed with postchecks passing. See `runtime-execution-review.md`.
The authorization holds below describe the earlier preparation checkpoint.

The user approved publishing the storage execution record and preparing an API
runtime-only artifact plus a separate nonexecuting change set. The storage record
is published in PR #342 at `645b610`. This new runtime assessment remains local
pending publication approval. Runtime execution and capability activation remain
unauthorized.

## Exact candidate and validation

The source is main commit `6c247a271a576377fcc8b56d2238bdf9dc441bdb`, fetched and
exported into an isolated source directory. A clean `npm ci` used its lockfile.
All 1,050 workspace tests and 152 deployment tests passed, as did workspace
typechecks, builds and Lambda packaging. No source or dependency fix was applied.

The ZIP is 5,139,547 bytes. Its SHA-256 is
`46d1824b4a540539697fa92770fb0606d6e783d4d5274cf4f5951a4d77c6dcb1`.
All 88 bundled application/package source-map entries match the exported source
files. Compared with the deployed map, the candidate adds 26 assurance API modules,
removes none and changes six existing sources: email, Lambda entry point, server,
store, scheduled telemetry and the Wrike adapter. This is a reviewed runtime
upgrade, not a claim that only new files changed.

The packaged Proof scan-worker executable and source map are byte-identical to
the deployed package. The actual separate worker artifact parameter remains
unchanged, so its function is outside the proposed deployment.

Clean installation reported dependency advisories. `npm audit --omit=dev` reports
16 across the workspace: ten moderate and six high. Source-map attribution finds
affected dependency code in the API bundle, including the existing high-severity
`xlsx` finding; the implicated mapped sources are byte-identical to the deployed
package. This is inherited risk, not a clean security audit or remediation. No
automatic dependency upgrade was made; advisory details and attribution are retained
in the private review evidence.

## Production preservation and AWS inspection

Fresh evidence exactly matches the successfully deployed storage baseline:
114 parameters, 38 resources and 70 Lambda environment variables totaling 3,658
bytes, with 438 remaining. Storage stays enabled. The Proof worker has a nonempty
independent artifact key. The runtime preservation packet passes offline validation:
113 existing parameters use prior values, the API artifact key is the sole explicit
change, the NoEcho parameter is preserved and current/candidate/rollback environments
are identical. Rollback explicitly restores the previous API artifact key.

The immutable artifact was uploaded under a source/hash-specific key in the existing
artifact bucket; S3 SHA-256 and size match the local package. No deployed function
was updated. Change set `intake-runtime-only-20260912-46d1824b4a54` uses
`UsePreviousTemplate: true` and is CREATE_COMPLETE/AVAILABLE, **unexecuted**.

The complete CloudFormation response has exactly one change: an in-place Modify
of `PathfinderApiFunction`, Replacement=False. Full before/after property comparison
differs only at `Code.S3Key`. All 114 effective parameters match the prepared
request. There are no environment, IAM, table, scheduler, queue, Proof-worker or
other resource changes. Use the unique change-set ID in private evidence for any
later inspection or execution.

## Review and next authorization boundary

Default-off source review must cover both new assurance entry points and changed
existing modules under the actual deployed environment. New capture, recovery,
visibility, notification, feedback and repair gates remain off. Preparing this
artifact or change set activates none of them. Review the inherited dependency
advisories explicitly as part of the release decision.

Before recommending execution, require independent exact-artifact and change-set
review. A later approval would cover one execution of this existing ID only after
fresh baseline, artifact checksum, complete parameter/environment, resource-scope,
operational-health and no-competing-release checks. Stop on drift or failure; do
not substitute a different candidate or retry an ambiguous execution.

After any separately approved runtime deployment, require the exact candidate code
hash, unchanged 70-variable environment and prior configuration, unchanged storage
and scoped IAM, unchanged Proof worker/queues/scheduler, and healthy alarms. Any
read-only smoke must be explicitly provider-free and must not submit customer jobs.
Capture/visibility/recovery and all provider-writing capabilities remain separate
customer-scoped activation decisions. Runtime rollback must preserve the existing
table, its records and capability-off posture.

Raw AWS responses, sealed preservation packet, validation logs, artifact provenance,
source attribution and advisory details remain private outside Git and are bound
in a runtime-preparation manifest. No runtime execution or provider action occurred.

Live Support independently verified all 26 manifest-bound files, artifact/checksum
provenance, source attribution, unchanged Proof worker and exact API-code-only
CloudFormation delta. It returned preparation complete / conditionally execution
ready, subject to separate explicit authority and fresh checks. Its review confirms
the six advisory-affected dependencies present in the API map are unchanged from
the deployed bundle; it does not characterize the dependency audit as clean.

Development independently returned execution-readiness GO for this exact artifact
and change set. It matched the deployed application's mapped sources to commit
`b79cc939010b8bc0424fa68919419d5fa739b050`, verified the candidate source/ZIP/S3
checksums and all manifest files, and reviewed the new entry points and existing
scheduled/manual paths. With the actual capability-off environment, no new startup,
ledger, email or provider write is reachable through the added assurance paths.

Its existing-source review identified two global Wrike-adapter behavior changes:
the previously approved hyphen/en-dash equivalence for the status label, and an
additional nullable task-updated timestamp returned by the existing pre-submit
check. Both preserve existing call/write behavior. Other existing-file changes are
gated/additive or unused pure helpers. The inherited advisory findings remain
tracked separately and were not judged a new code-release blocker by either review.

Both reviewers recommend requesting separate explicit approval to publish this
sanitized assessment and execute the exact existing runtime change set once, with
the fresh checks, stop conditions and postchecks above. Neither review grants
execution authority or establishes readiness for capability activation.

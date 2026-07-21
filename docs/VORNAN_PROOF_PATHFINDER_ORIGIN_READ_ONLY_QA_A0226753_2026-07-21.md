# Vornan Proof Pathfinder-originated read-only QA — A0226753 — 2026-07-21

## Authorization and result

Marcus explicitly approved Lift order `A0226753` for read-only Proof validation on 2026-07-21. The approved correlation was:

- Pathfinder job `job_20260721171005_2cf369`.
- Pathfinder order / Lift `Ext_ID` `PFMRUWSQ4N1735`.
- Destination profile `LTL Demo`, destination customer `1249`, company `91`.
- Pathfinder state `Order Confirmed`.
- Three mapped lines with total quantity 31.

The Pathfinder-originated read-only path passed. Production Pathfinder records and the Lift order were read only; the order was not modified or resubmitted. No Lift write endpoint or decision capability was called.

This result closes the origin-path validation deferred by the approved `A0226701` run. It does not authorize public reads, DNS, grant or link email, proof decisions, or any Lift write. `ReadOnlyQaConfirmed` remains `false` because later customer-boundary and Phase 3 gates require separate review.

## Source and environment boundary

- PR #11 was reviewed with a green repository validation check and merged to `main` at `b6a383858a8a77a5a8b60cf5d57dc8ac5e91a032`.
- QA branch: `codex/proof-pathfinder-origin-readonly-qa`, created from that exact merged commit.
- AWS account: `744016783602`; region: `us-east-1`; stack: `vornan-proof-dev`.
- Stack status was `UPDATE_COMPLETE`.
- `EnvironmentName=dev`.
- `PublicReadEnabled=false`, `SyntheticQaEnabled=false`, `ReadOnlyQaConfirmed=false`, and `ProductionPublicReadApproved=false`.
- Domain and certificate parameters were empty.
- The deployed sync worker independently reported public read and grant creation false; link email, approval, revision, undo, and Lift-write flags were false or unset.
- Both the isolated sync queue and DLQ were empty before the run. The exact `ORDER#A0226753` core and audit partitions were absent.
- No Proof deployment or Pathfinder production deployment was required for this slice.

## Pathfinder persistence correlation

An exact, consistent read located one production Pathfinder job under its internal storage customer `284619`. Sanitized fields matched the approval:

| Field | Persisted result |
| --- | --- |
| Job ID | `job_20260721171005_2cf369` |
| Pathfinder order ID | `PFMRUWSQ4N1735` |
| Target Lift order | `A0226753` |
| State | `Order Confirmed` |
| Submit destination | `LTL Demo` / `1249` / company `91` |
| Submit profile | `Sandbox · LTL Demo` |
| Sandbox flag | `true` |
| Mapped lines | 3 |
| Total quantity | 31 |

The associated submit-attempt record was `Submitted`, its normalized response was `accepted` with HTTP 200, and it correlated the same job and `Ext_ID` to Lift order `A0226753`. No record was changed.

## Lift GET synchronization and cached aggregate

Two FIFO messages were processed: a clean first synchronization and one unchanged refresh. The existing `@pathfinder/lift-proof-adapter` path performs GET-only reads and exposes no implemented Proof write transport.

| Check | First sync | Unchanged refresh |
| --- | ---: | ---: |
| Cached order lines | 3 | 3 |
| Total quantity | 31 | 31 |
| Proof tasks / unique attachments | 3 / 3 | 3 / 3 |
| Unique cached Lift line IDs | 3 | 3 |
| Tasks matched to cached `ORDER_LINE_ID` | 3 of 3 | 3 of 3 |
| Unmatched / duplicate associations | 0 / 0 | 0 / 0 |
| Successful line-scoped Proof reads | 3 of 3 | 3 of 3 |
| Proof rows | 3 | 3 |
| Order-scoped fallback reads | 0 | 0 |
| Normalization warnings | 0 | 0 |
| Order version | 1 | 1 |
| Task versions | 1, 1, 1 | 1, 1, 1 |
| History entries per task | 1, 1, 1 | 1, 1, 1 |

All three proofs had HTTPS preview and download targets. None contained URL credentials. The three current version IDs remained unchanged across refresh.

The normalized-content hash—excluding sync-only timestamps/diagnostics and rotating signed query or fragment components—was identical before and after refresh:

`e31baa5dcfcc355f064de561c9cc94a43ede3599f2092b79801eaf6ac724d3c6`

The unchanged refresh advanced only `last_synced_at`; it did not change customer-visible aggregate content, order/task versions, task `updated_at`, or history.

## Audit, telemetry, queues, alarms, and logs

- Audit events after both runs were exactly two `proof.sync_completed` events and one single-shot `proof.review_ready` event.
- Both queue message IDs appeared as the audit correlation IDs for their corresponding sync-completed events.
- CloudWatch recorded two `sync-worker` / `dev` / `sync_order` requests, with durations 2,893 ms and 1,871 ms, zero server errors, and zero denied requests.
- The emitted metric dimension names were only `Service`, `Environment`, and `Operation`.
- The worker log window contained nine events and two bounded sync metric records.
- Sanitized scans found zero mentions of the approved order, Pathfinder `Ext_ID`, Pathfinder job ID, customer/recipient fields, asset URL fields, or token/cookie/password fields.
- The main queue and DLQ ended at zero visible, in-flight, and delayed messages.
- All nine `vornan-proof-dev` alarms remained `OK`.
- The post-run dark smoke passed: public read false, decisions false, invalid/unauthenticated access denied, decision routes absent, and direct API bypass rejected.

## Retained cache and cleanup procedure

The isolated dev cache intentionally retains seven records for this approved case: one profile, three tasks, and three immutable version records. It contains no grant or other lifecycle records. The audit partition retains three sanitized events.

If cleanup is later requested, first query only `pk = ORDER#A0226753` in `Pathfinder-ProofCore-dev` and `Pathfinder-ProofAudit-dev`, verify the expected 7 and 3 key sets, and then delete only those returned `pk`/`sk` pairs. Re-query both exact partitions and both queues afterward. This procedure must never target a Pathfinder production table or make a Lift request.

Cleanup was not performed in this slice so the approved normalized aggregate remains available for focused dev inspection. The production Pathfinder job, submit attempt, and Lift order remain unchanged.

## Decision

**Pass — Pathfinder-originated read-only synchronization and correlation.**

The approved production-origin identity, Lift order, cached line/task associations, unchanged refresh behavior, audit events, telemetry, alarms, logs, queues, and dark public boundary all passed. Public reads, DNS, grant/link email, decisions, and every Lift write remain disabled.

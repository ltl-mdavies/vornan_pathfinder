# JSON intake local foundation

This is the review-only foundation of a reusable intake module. The initial adapter is `stickerpress.order.v1`. It is not a deployed endpoint, customer activation, or production release candidate.

## Baseline and transfer

- Isolated branch: `codex/json-intake-foundation`, worktree `d706/pathfinder`.
- Freshly fetched baseline main: `14ff397b9b1bc317d9c22cb6023b95ba2360a5f7`.
- Entire handoff copied into this worktree's ignored `output/json-intake-webhooks-handoff-2026-09-28/` directory. All 36 immutable files passed SHA-256, byte-count, and original permission comparison. Mutable coordination/transfer updates also copied.
- Sent partner draft, examples, signature vector, ZIP, and reference artwork remain unchanged and untracked. Only the reviewed sanitized four-line JSON fixture is source-controlled. No private payload, signed URL, customer artwork, or credential is committed.
- No applicable AGENTS.md found in this checkout or its ancestor chain at kickoff.

## Ownership audit

| Existing contract | Finding and integration decision |
| --- | --- |
| `intake-assurance.ts` / `IntakeLedger` | Inject reserve/get/transition; reuse deterministic shared identity and existing state ownership. No edits to the ledger or its failure enums. |
| `store.ts` | Existing production reserve uses conditional DynamoDB Put and transitions use revision CAS, with separate intake table binding. A test injects this existing local ledger across real process restarts. No runtime store import in the new pure modules. |
| Receipt versus shared attempt | Receipt contains evidence and pending work atomically. Shared reservation is a separate write. Persist intended shared event/revision before transition; recover both crash windows without inferring ownership from `created: false`. |
| Shared recovery | Existing runtime/sweep is Wrike-specific and reads jobs/submissions. New explicit local recovery driver does not join that scheduler. |
| Shared delivery | Existing source-feedback/internal-notification delivery has uncertain-write safeguards and Wrike-shaped feedback. No changes. Later retryable webhooks require separate event/delivery identity, while reusing shared intake ownership and incidents. |
| Canonical model | Additive typed extension of existing CanonicalOrder/CanonicalOrderLine, exported from the same package; existing fields/defaults/consumers unchanged. Protected source evidence remains alongside the existing core mapping. |
| Templates | Current spreadsheet mapping is not repurposed for JSON. Registered cut_type propagation gap remains a separate reviewed repair. |
| Lift adapter | Existing EXT_ID lookup uses `p3`; submission/reconciliation unchanged. No live customer ID is configured. Source product/variation IDs never become Lift unit/product IDs. |
| Proof assets | Publication paths depend on existing Lift order/revision/asset lifecycle. Reusing publication here would conflate upstream approval with a Proof action. Isolated private retention creates no grant, public locator, reviewer approval, or Proof revision. |
| Auth/server | Existing Firebase/public human intake boundaries unchanged. A default-disabled, unmounted Express router factory uses injected scoped test credentials. |

Development, Intake Assurance, Proof, and Live Support were contacted under the user's coordination authorization. Development accepted the narrow additive module/export and unmounted router scope. Intake Assurance reviewed identity, recovery and ownership seams; its feedback is implemented. Live Support reported no known overlap for this narrow scope, not a current production attestation. Existing hotfixes in the baseline are retained.

## Review harness behavior

Mount `createJsonIntakeRouter` under `/api/v1/intake` only in a local harness, before any global JSON parser. The factory uses raw JSON with a 1 MB limit to preserve a raw submission digest. Supply `enabled: true`, synthetic hashed credentials, the service and its dependencies explicitly. Omission of `enabled` returns 404. No server.ts mount or environment activation flag is installed.

Credentials bind customer, integration, store, schema and `environment: test`; scopes are `orders:write`/`orders:read`. Expired/revoked keys fail authentication. There is no customer selection or production capability in the payload. Status enforces the same customer/integration/store/environment scope, returns neutral 404 for mismatches, and sets `Cache-Control: private, no-store`. Credentials and source URLs do not appear in status or errors.

POST validates before receipt creation. Invalid input returns stable 422 field/line issues; it is not accepted. Valid input commits a receipt containing pending work before 202. Identical retries return that receipt with 200. Changed business content returns 409. Active work may return retryable 503 for an access refresh. Auth, media type and body-size errors remain distinct.

Semantic identity is customer + integration + test environment + store + order number. Business fingerprint includes adapter schema, artwork/approval hashes and evidence, commercial/shipping fields and upstream approval timestamps. Only submission time and explicit artwork/preview access URL/expiry fields are omitted. Prepaid-label URL changes are conflicts because v1 supplies no label content hash. Raw-body SHA is separate from semantic identity. The immutable initial revision retains original structured evidence and first-seen time; later revisions retain refreshed access metadata and submitted time.

The adapter validates IDs, unique line numbers/IDs, finite positive dimensions and integer quantities, hashes, one-page PDF metadata, declared bytes, timestamps/dates, approval linkage, initial material/cut profile, HTTPS URL syntax and supported fields. It preserves null/false and source approval provenance. Blank optional ship dates mean configured turnaround, never a fabricated date. Source metadata boxes must agree with the supplied print dimensions/bleed; rounded area is checked against bounding-box area × quantity at hundredth precision. These are checks of supplied JSON, not measured PDF geometry or manufacturing acceptance. The earlier sample's `proof_url` form is explicitly unsupported by this adapter; it is not silently reinterpreted.

The core schema registry maps the existing fields already supported. New evidence types are additive TypeScript extensions, not yet registry-editable/exportable fields. The complete source structure is retained and JSON-round-tripped by the receipt store. Future shared job persistence, registry visibility, spreadsheet round-trip and opt-in Lift projection must be integrated together and regression-tested before enabling those paths. This extension is not a replacement canonical model or permission to silently drop fields in downstream templates.

## Durability, recovery and ownership

`LocalReceiptStore` is a private local review store, not a production DynamoDB implementation. Complete revision bytes are fsynced to mode-0600 temporary files and atomically hard-linked into immutable revision slots; parent directories are mode 0700. Slot creation provides cross-process CAS. A receipt's revision-zero row includes pending work, so there is no separate enqueue gap. Temporary files left by an abrupt process kill are ignored; cleanup and capacity management belong to a future production storage implementation. Local storage fails closed in Lambda.

Worker claims are revision-fenced and expire after 30 minutes in this local harness. The explicit recovery driver reclaims expired work, re-reserves the original shared signal/deadline, and verifies shared association and recorded transition identity. It never creates a new job, submission or external effect. Before a shared transition, it stores the intended event ID, expected revision, preceding event/state and intended state on the claimed receipt. Recovery accepts only the recorded before/after states. Unrelated operator revisions/reviews, existing job/submission/confirmation associations, closed/superseded states, and ownership mismatches stop work; the driver does not reopen someone else's review. Stale workers cannot commit receipt completion.

Receipt CAS and shared-ledger CAS are separate writes, not a distributed transaction. No irreversible effects exist here. Production worker fencing/lease renewal and storage transactions must be reviewed before introducing any external submission or delivery. A worker that loses ownership surfaces an error; work remains durable for internal investigation/recovery.

Verified asset/approval failures lack a faithful shared customer-failure reason today. The receipt retains specific customer-correctable diagnostic codes, while the shared attempt enters `manual_review` with internal ownership and null reason. We deliberately do not reuse `contract_mismatch` (which means mismatched contract numbers), `invalid_order_grid`, or introduce new outbound follow-up semantics. Internal fixture transport failures use `pathfinder_failure` and remain recoverable. An additive asset-specific shared reason and follow-up tests are a later coordinated change.

## Asset boundary

Only an injected `local-fixture` transport is supported. No network fetcher is implemented or automatically called. Private retained originals are content-addressed within a hashed customer/integration scope. Byte count, PDF signature, expected SHA and exact upstream approval SHA must agree. Retention is immutable; an existing corrupt object fails closed. A failed source read or expired URL never purchases shipping, submits an order or emits a callback.

`integrity_verified` means retained bytes match the supplied hash/approval, not that a PDF parser, malware scanner, RIP or production operator approved them. Status always exposes `review_required: true` and `inspection: not_run`. Structural PDF validity, measured pages/boxes, named spot/layer checks, malicious-network/DNS/redirect controls, preview retention and prepaid-label validation remain explicit future work. Existing verified reference inspection is preserved privately as handoff evidence, not manufactured by this worker. No color/scaling/cropping changes occur. Asset success leaves the shared attempt `preparing` with no job/submit reference; never `ready` or `confirmed`.

## Next review gates

1. Review additive canonical/registry/job persistence and visibility together; supply authenticated production storage/auth binding with minimum IAM only when that slice is authorized.
2. Implement bounded private asset retrieval/inspection using approved shared seams, network SSRF controls, measured metadata and review-approved tolerances. Preserve original bytes.
3. Define webhook event/outbox identity and signing/retry semantics against the immutable sent draft; contract changes must be versioned and reviewed. Do not reuse uncertain Wrike delivery slots.
4. Verify actual Lift customer, material/export/shipping/return-address mapping before target integration. Pending callback URL and production color/tolerance decisions do not affect this local foundation.
5. Follow RELEASE_COORDINATION.md for exact candidate, current main/hotfixes, deployed surface/config inventory, complete regression/packaging/browser gates, smoke/rollback and explicit user deployment approval. No release or customer activation is authorized by this foundation.

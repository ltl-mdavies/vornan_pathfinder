# Retained assets and review — local slice 3

This slice extends foundation commit `38daa0cc683073e7aa352059458bca7a1e48a010`. The API router remains unmounted/default-disabled and test-only. No Lift/Wrike/email/callback, customer URL retrieval, production credential, configuration, data change, push, merge or deployment is included.

## Scope and ownership

New isolated modules: `asset-errors.ts`, `https-assets.ts`, `pdf-inspection.ts`, `pdf-worker-source.ts`. Changes remain within JSON intake receipt/service types, tests, docs, and the API manifest/lockfile. `pdf-lib` is pinned to 1.17.1 with only its dependency closure added; no existing versions, Proof/pdfjs dependencies, shared artwork contracts, canonical consumers, shared ledger, server, scheduler or deployment scripts change.

Development reviewed the exact manifest/lock expansion for the local experiment, not production suitability. Artwork and Proof owners found no suitable backend parser to reuse and no known direct overlap. Existing artwork browser analysis uses regex or PDF.js for different purposes; catalog inspection contracts require catalog identities/workflows and are not an implemented parser. Private retention remains separate from Proof revision/grant/publication and reviewer approval. Intake Assurance reviewed recovery boundaries; the shared ownership/event/revision safeguards remain in place.

## Bounded HTTPS capability

`createHttpsAssetReader` is an unwired capability constructed from trusted exact hostnames, never a request-provided allowlist. Local tests inject DNS and HTTP responses; no real customer URL is used.

- HTTPS only, no URL credentials, fragments, IP literals, non-443 ports or unlisted hosts.
- Resolve every hop; reject empty/oversized answer sets and any private, loopback, link-local, documentation, multicast or other denied destination. IPv6 is conservatively limited to public global-unicast ranges with special transition/documentation ranges excluded. This is intentionally stricter than a general browser.
- The actual Node request receives a pinned DNS callback and address family, disables socket pooling, retains TLS certificate/hostname validation and checks the response socket's remote address. No second unvalidated DNS resolution is used for the connection.
- Redirects are independently allowlisted/resolved, at most two by default and three by configuration. No bearer credential or arbitrary request header is forwarded. Relative locations work; unsafe redirects fail.
- Default total deadline is 10 seconds across DNS, redirects, response headers and streamed body (configuration capped at 30 seconds). Abort destroys the request/response; late injected responses are closed too. DNS may finish after the deadline but cannot initiate a request afterward.
- At most 25 MiB for production PDFs, further bounded by declared bytes. Preview cap is 5 MiB. Streamed limits do not trust Content-Length. Mismatched lengths, unsupported content type/encoding, unexpected HTTP responses and empty bodies fail with safe codes. Compression is not accepted at HTTP level.
- Native network messages, response bodies and signed URLs never enter persisted diagnostics or public status. Only fixed codes are returned. Timeout/transient HTTP failures are explicitly retryable; integrity or unsupported-input failures are not relabeled transient.

## PDF metadata review

A terminable Node worker parses unchanged bytes using pinned pdf-lib 1.17.1. It extracts one-page MediaBox/TrimBox/BleedBox geometry, checks explicit boxes and unsupported rotation/UserUnit, and inspects named Separation/DeviceN and OCG declarations in page/nested-Form resources. Catalog-only declarations do not satisfy the page-resource check.

A result binds the exact retained SHA, parser version, policy ID and explicit comparison tolerance. The four local reference PDFs pass with the provisional 0.001-inch metadata-rounding policy. Zero tolerance rejects a deliberately rounded synthetic case. This tolerance is local review configuration, not an approved manufacturing tolerance or permission to scale artwork. Original page/trim/bleed measurements remain distinct from supplied metadata.

`metadata_pass` means these metadata comparisons pass. It does **not** mean a valid painted cut contour uses the named spot inside that layer. Unused/unrelated resource declarations can pass presence checks, deliberately covered by a test. Results explicitly include `cut_path_verified: false`, `malware_scanned: false` and `production_approved: false`. Full content-stream syntax/topology, overprint, RIP/color/profile acceptance, point limits and malware scanning are not established. pdf-lib may recover some malformed cross-reference structures; this is not a comprehensive PDF conformance validator. Preview checks verify signature/content bounds only and do not prove decodability or act as approval.

Worker bounds: maximum input 25 MiB; two workers per process; default five-second deadline (up to ten by configuration); 128 MiB V8 old generation, 16 MiB young generation and 4 MiB stack. A version-pinned worker-local DecodeStream guard limits decoded object/xref stream buffers to 8 MiB each and cumulative allocation to 64 MiB before allocation. A compressed 9 MiB object-stream bomb is rejected. There are also object/resource/depth bounds. Worker stdout/stderr are drained without logging attacker-controlled diagnostics.

These bounds are not an OS sandbox or an absolute process RSS guarantee. V8 heap limits alone do not cover all external allocations; the decoded-stream guard covers the parser path reviewed here, not every possible library allocation. Dependency upgrades require reviewing that internal hook and rerunning adversarial tests. Process-level memory/CPU/security containment remains a production gate.

The local inspector explicitly refuses Lambda construction. Current API packaging excludes this unmounted module and does not carry the dynamic worker parser dependency. The existing API package builds successfully; that is not evidence this new inspector is deployable. A separately reviewed worker artifact/dependency packaging design and packaged-runtime test are required before integration.

## Durable checkpoints and retry ownership

The claimed receipt now atomically spends a persistent processing attempt before work starts. Concurrent claims cannot spend the same slot. Attempt budgets cannot reset through crashes or access-URL refreshes. Retryable internal failures schedule another attempt after one then two minutes, release the claim, and return pending work; no HTTP request sleeps through a retry delay. Three attempts is the limit. A crash after the third claim is finalized as unresolved `ASSET_RETRY_EXHAUSTED` without another asset read.

After byte count, PDF signature and both original/approval SHA checks, the immutable retained reference is checkpointed before inspection. Inspection is checkpointed against that exact hash, engine and policy. Recovery reuses retained bytes and matching inspection evidence, even after source URL expiry; a different profile requires new inspection of the same retained bytes. Corrupt/mismatched retained data fails closed rather than fetching different content under the same identity.

The existing recorded shared-event/revision ownership fence still prevents delayed retries from clearing unrelated operator reviews, changed/closed/superseded attempts, or job/submission/confirmation associations. Receipt CAS and shared-ledger CAS remain separate writes. No irreversible external effect is introduced. Terminal file/metadata findings retain receipt diagnosis and project shared `manual_review` with null reason; retryable/internal failures use existing `pathfinder_failure`. Exhaustion remains unresolved internal ownership, not success.

Preview retention/status is separate and nonblocking. A missing, expired or unusable preview does not make verified production art fail, and a good preview cannot make unverified production art pass. Preview references are private, hash-addressed and never published through status. URL refresh can schedule another bounded pass for unavailable previews but cannot reset an exhausted processing budget. Status exposes safe metadata findings/measurements and preview state; it never exposes source URLs or private retained paths. All results remain review-required and never create a job, submit attempt, Lift confirmation, Proof action or public grant.

## Dependencies and public advisory review

Public package licenses read from the installed closure: pdf-lib 1.17.1 (MIT), @pdf-lib/standard-fonts 1.0.0 (MIT), @pdf-lib/upng 1.0.1 (MIT), pako 1.0.11 (MIT AND Zlib), and its nested tslib 1.14.1 (0BSD). Existing packages were not upgraded. Preserve required notices in a future packaged worker.

A full-repository `npm audit` did **not** complete: sandbox networking failed initially, then automatic approval review rejected escalation because sending repository dependency metadata could disclose private package names to npm. That action was not bypassed. No clean audit report is claimed.

Public-name-only research found [upstream pdf-lib issue 1773](https://github.com/Hopding/pdf-lib/issues/1773), an open, needs-triage report describing parseDate denial-of-service behavior for versions through 1.17.1. The inspector uses load with metadata updating disabled and page/resource inspection; it does not call date metadata accessors or save/authoring APIs. That reachability observation is limited and does not prove the dependency safe, resolve the upstream report or substitute for a security review. Worker limits reduce exposure in this local experiment. Advisory/security clearance remains open before merge/release.

Implementation references: [pdf-lib PDFDocument APIs](https://pdf-lib.js.org/docs/api/classes/pdfdocument), [PDFPage geometry APIs](https://pdf-lib.js.org/docs/api/classes/pdfpage), and [Node HTTPS request options](https://nodejs.org/api/https.html). Production packaging, isolation, policy approval and live host configuration remain separate review gates.

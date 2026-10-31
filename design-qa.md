# Status creative metadata and Proof entry — 2026-10-31 local review

## Current release-check index

The sections below are chronological checkpoints, not a cumulative list of open
gates. Current cloud/security/release status is in
`docs/proof-reviewer-runtime-release-plan.md`; fresh integrated captures are in
`/private/tmp/proof-integrated-review-20261031/`. Historical pending Firebase,
rate-limit and change-set notes below must not override that release record.
Header-only access remains the accepted presentation. Deployment and activation
remain on hold. Synthetic UI verification does not establish production reviewer
promotion or authorize a release.

## Header-only access revision — supersedes amber-banner acceptance

**Scoped UX acceptance received** for candidate `518ad753b9df3ab383a5315b2ebaf894934685d76852ab222c8147b30ac1c70c`: UX independently inspected closed/open/rejected desktop, mobile, and verified captures. Keyboard/focus and viewer-height checks are Development-reported, not independently rerun by UX. This supersedes old-banner acceptance and applies only to header/access presentation, not security or deployment.

Read-only infrastructure source review found a concrete remaining rate-limit gap: existing managed WAF matches `/api/public/proof/sessions`, `/order/refresh`, `/participants`, and `/tasks/`; those prefixes do not cover the new `/api/public/proof/status-view/...` namespace or its `/reviewer-session` endpoint. Generic API stage throttling (20/s, burst50 in template) is not an equivalent per-client authentication-attempt control. Before activation, add narrowly scoped coverage for isolated exchange, refresh, reviewer verification and decisions, with tests preserving existing rules and any external/shared WAF deployment requirement. No WAF/cloud settings changed in this review. Proof frontend CSP also still excludes Firebase connections; configuration/provider/domain validation remains pending.

Per the user's option 1 selection relayed by Pathfinder UX, view-only access guidance now lives in the existing green header. Eye/View only opens a light anchored explanation; adjacent desktop Sign in to review remains in the same row. Narrow screens use the icon control and expose sign-in inside the popover. No persistent notice row is rendered. Wrong-account feedback opens/updates that popover and is announced through a live alert, without replacing artwork. Escape and close return focus to the trigger; outside click dismisses; keyboard opening focuses the explanation; successful verification focuses the verified identity. Backend/provider/grant semantics are unchanged.

Actual-page captures and labeled synthetic review artifact: `/private/tmp/header-access-review.html`. Includes closed/open/rejected states at 1366x768 and 1920x1080, mobile390x844, and authorized1366. QA strip removed from test fixture, not hidden with production CSS. At1366 header remains56px; viewer height496.95px remains identical closed/open/rejected; page scrollWidth1366. Mobile scrollWidth390, popover bounds18–378. Approved synthetic transition retains decision dock with Approve bottom732 inside768 viewport. No decisions invoked. Fixture store was refreshed after its older seeded data stopped projecting preview URLs; this is synthetic-only evidence, not a live-provider validation.

Candidate fingerprint: `518ad753b9df3ab383a5315b2ebaf894934685d76852ab222c8147b30ac1c70c` on base `9e33ef8736202136dcca5d9d6ff946befbd749f8`,35 source/test files using the hashing method below. Supersedes prior fingerprint and banner captures for visual review. Proof typecheck,120 tests and production build pass. UX reacceptance requested. All deployment, activation, provider, cloud and security gates remain held/open as documented below.

## Reviewer sign-in — latest local checkpoint (deployment and activation held)

**Scoped UX acceptance complete:** Pathfinder UX accepted initial view-only, rejected-account and verified-reviewer states after inspecting the corrected capture. This is design/flow acceptance only, not deployment or activation authorization. Accepted evidence: `/private/tmp/reviewer-viewonly-settled-1366.png`, `/private/tmp/reviewer-rejected-1366.png`, `/private/tmp/reviewer-authorized-1366.png`, `/private/tmp/reviewer-authorized-1920.png`. The earlier `reviewer-before-1366.png` is superseded and must not be used as final evidence.

Candidate source fingerprint: `1a8443f71329fcdd889b91c25dddd1a1015ae470d95ef6c9071ef76fd06ff869`, based on HEAD `9e33ef8736202136dcca5d9d6ff946befbd749f8` plus 34 modified/untracked implementation/test files. Reproduction: lexically sort the unique union of `git diff --name-only` and `git ls-files --others --exclude-standard`, excluding this `design-qa.md` and `apps/api/data/`; SHA-256 each file; SHA-256 the UTF-8 `JSON.stringify({base,entries})` with entries shaped `{path,sha256}` in that order. This records the uncommitted candidate; it is not a new commit or release artifact. Live provider/project/account verification, CSP/auth-domain configuration, cloud parent-authority read access and abuse/rate-limit/security review remain open gates.

Final initial-state evidence correction: `/private/tmp/reviewer-viewonly-settled-1366.png` supersedes `reviewer-before-1366.png`, which was captured immediately after viewport resizing. Settled measurements: viewport 1366x768, document scrollWidth/clientWidth both1366, devicePixelRatio1, visualViewport scale1, body zoom1. CTA, counters and logout fully visible; no actual horizontal overflow. UX accepted rejected/authorized captures and is reviewing this corrected initial-state capture. No production layout change needed for this evidence correction.

UX follow-up: replaced crowded error copy with one concise message in the existing notice and a nonwrapping `Try another account` CTA (Google chooser is explicitly requested); restored UserRound/Eye header icons. Same-order failed sign-in preserved artwork, download and view-only access. Earlier unavailable artwork was from the superseded fixture asset URL, not authorization failure. Captures: `/private/tmp/reviewer-before-1366.png`, `/private/tmp/reviewer-rejected-1366.png`, `/private/tmp/reviewer-authorized-1366.png`, `/private/tmp/reviewer-authorized-1920.png`. At 1920x1080 Approve ends at y1063; at 1366x768 with the extra 38px synthetic QA banner it ends at y770 (scroll reachable; perfect initial-fold fit not claimed). No production layout compensation added for the test banner. Proof typecheck and 120 tests passed again. UX acceptance is pending review of these corrected captures.

This checkpoint supersedes the incomplete-sign-in notes below. The local implementation connects a separate, memory-only Firebase Google sign-in to a server-verified LTL Demo reviewer session for `mdavies@ltlco.com`. Exact verified email, UID, recent authentication, token expiry/revocation, CSRF, exact order, current customer capability and parent Status authority are required. Merely identifying a reviewer never grants actions. All rollout flags remain default-off; no production configuration has changed.

The isolated Status session may become review-capable only after verification. It cannot share onward, upload revisions, extend access, or change reviewer identity. Normal Proof sessions and Pathfinder authentication remain separate. Every review-capable request revalidates the bearer identity and parent authority. Browser reload intentionally loses the memory-only identity and fails closed; re-entry/sign-in is required. A different Status order replacing the shared Status cookie also fails closed in earlier tabs rather than showing the wrong order.

Verification completed locally:
- Full API tests: 907/907; Proof tests: 120/120; Status tests: 25/25; Pathfinder web tests: 309/309; workspace typecheck and Proof/Status production builds passed. Diff whitespace check passed.
- Browser fixture used actual UI/router code with synthetic data and a fake identity verifier only. View-only artwork renders without decision buttons; approved synthetic identity enables the review dock; wrong account remains view-only. No decision buttons were invoked.
- Parent revocation, cross-order mismatch and ending isolated access fail closed; a separately open normal Proof session remains usable.
- Evidence: `/private/tmp/status-reviewer-view-only.png`, `/private/tmp/status-reviewer-verified.png`, `/private/tmp/status-reviewer-wrong-account.png`. Fixture: `http://127.0.0.1:5473/qa/start`; clearly labeled synthetic, not a live QA grant or real Google verification.
- Existing thumbnail loader implementation was not changed. Test-only fixtures are isolated by an explicit test Vite configuration and are not production entry points.

Remaining release/activation gates: real Google/Firebase project/provider and approved-account acceptance; exact auth-domain and CSP allowlisting (deployed Proof connect policy currently excludes Firebase); cloud runtime read authority for parent Status/workspace data; sign-in endpoint abuse/rate-limit review; final UX/security integration acceptance. Synthetic tests do not prove live identity-provider configuration. Do not deploy, activate, send emails, create live grants, or perform proof decisions from this checkpoint. CVO and test-route activation remain held. Untracked runtime data must not enter the release.

## View-only handoff implementation — current checkpoint (release held)

This supersedes the existing-session-only design below. Explicit Status clicks can request a 15-minute, exact-order **view** grant for verified LTL Demo customer 1249, under the default-off handoff flag. No grant is minted during polling. The parent Status token is stored only as a hash; parent expiry, revocation, exact membership, current workspace visibility and current Proof capability are checked. All Status-derived write actions are denied server-side, including reviewer identification, decisions, uploads, sharing, session extension and report generation. Merely entering a name/email never authorizes a reviewer. Grant regeneration cannot detach this restriction.

The local Status banner now explains that approval requires authorized reviewer access. Proof displays a compact view-only notice and omits unsupported actions. Thumbnail loader code remains unchanged.

Security verification: focused synthetic HTTP and authority tests pass, including exact parent membership, disabled policy, wrong customer/order, parent revocation, write denial, and preservation of an existing normal Proof session without consuming the new link. Full API run passed 904/904 before adding one additional service-creation test; the final focused run passed 29/29 including that new test. Proof 119/119 and Status 25/25 passed. Workspace typecheck passed after the UI nullability corrections. Earlier transient API discovery failure did not reproduce in the focused or subsequent full suite.

**Current follow-up:** Marcus explicitly confirmed `mdavies@ltlco.com` as the sole initial LTL Demo reviewer. A test-covered identity policy now requires exact normalized email, verified email, nonempty UID, recent authentication, valid expiry, and a revocation-aware server verifier. This policy does not itself authenticate a browser, mint review grants, or enable decisions. Sign-in/elevation wiring remains incomplete and disabled.

Status viewing now uses a separate `/api/public/proof/status-view` route and distinct session/CSRF cookies. The regular Proof route rejects Status-derived grant exchange without consuming it. The isolated route rejects normal grants, uses exact expected order binding, and does not fall through into regular Proof routes. Synthetic tests cover normal and Status cookies together, preserving normal Proof on Status expiry/revocation/logout, wrong/missing order denial, unsupported actions, and frontend API/CSRF routing. The Status source tab is retained; explicit click opens a separate Proof tab with accessible new-tab text. A second Status view changing the shared Status-view cookie cannot silently change a prior tab’s order: exact-order verification fails closed. Multi-Status-tab seamless coexistence is not claimed.

**Not release-ready.** Remaining gates: actual browser coexistence/expiry/revocation coverage, approved reviewer sign-in/elevation integration, security review of the isolated session channel, and cloud/runtime read access to parent Status/workspace authority. Latest full API run passed 906/906; Proof 120/120 and Status 25/25 passed. No production settings, grants, emails, decisions, uploads, deployment or CVO/test-route activation changed.

Preview remains http://127.0.0.1:5472/design-qa?proofEntry and is synthetic presentation only, not a live access flow. UX was notified and agreed on compact view-only copy and strict session preservation. Runtime test artifacts under apps/api/data are untracked and must not enter a release.

## Secure handoff follow-up (local, not deployed)

Removed the button's `(preview)` suffix; the fixture toolbar/dialog still labels its demonstration clearly. Added a default-off `PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO` continuation path. Only the validated public Status read for customer1249, with review-link policy and current positive pending count, can project an order-bound `#/status/Axxxxxxx` destination. This URL is navigation, not a credential.

Proof's order read validates the existing session, grant, current capability, expiry and revocation first, then checks requested order against both session and persisted order and verifies actual Lift customer1249. It does not create grants, extend sessions, upgrade view permission or alter sharing. Cross-order navigation reloads the document to discard the previous workspace. Wrong order and disabled rollout return a non-authorizing error. All subsequent order loads retain the requested order context.

Verification: workspace typecheck passed; full API suite902/902; Proof119/119; Status25/25. Local UI confirms button reads `Review proofs`. Thumbnail components/loaders unchanged. Full authenticated browser handoff and deployment integration remain gates, not claimed complete. Sessionless reviewer onboarding awaits the user's choice; recommended approved-recipient verified-email flow has NOT been implemented or enabled. No live access, emails, decisions, configuration, activation or deployment performed.

Local UI checks: passed. Deployment and live Proof handoff: held.

Candidate: http://127.0.0.1:5472/design-qa?proofEntry (development-only synthetic data).
Base: 9e33ef8736202136dcca5d9d6ff946befbd749f8, including deployed thumbnail reuse.

- Creative cards stack across their section rather than nesting a second narrow grid. 96px previews, 72px at narrow mobile widths. Existing accessible filenames and timestamps retained.
- Small pending-proof notice sits below progress. No pending proofs means no notice. Checking, stale, and unavailable-access states never offer a review action.
- The local action demonstrates a handoff only; it does not create access or approve artwork.
- Long line-status labels wrap within their allocated column rather than covering counts.
- Thumbnail-loading implementation is unchanged. All four synthetic previews loaded; reopening both lines added zero requests (counters before and after: 2,2,2,1; earlier development reloads account for counts above one). Offscreen extra creatives retain existing lazy loading.
- Browser checked 1366x768, 1920x1080, and 390x844. No horizontal page overflow. Full-page captures: /private/tmp/status-proof-entry-1366.png, /private/tmp/status-proof-entry-1920.png, /private/tmp/status-proof-entry-mobile.png.
- Compared previous cramped reference /private/tmp/status-shared-thumbnail-full-layout.png alongside candidate in one visual inspection. Different synthetic datasets and viewport widths mean this is qualitative layout comparison, not pixel parity.
- Native preview dialog opens with focus on Back and returns to the page. None-pending removes notice; checking and ineligible states remove the CTA.
- Status production build passed; Status tests 25/25; web tests 309/309; diff whitespace check passed.
- UX consulted on layout/access constraints; candidate and captures sent for review. Final UX acceptance remains pending.

## Remaining live integration gates

The public API currently explicitly returns review_url:null. Customer Proof enablement alone is not a Status-to-Proof authorization grant. Before live testing, implement and test the server-side customer/order eligibility and authorized reviewer handoff, including expiration, revocation, no onward sharing, and stale/current proof versions. A forwarded Status bearer must not silently become approval authority. Decisions continue in Proof, not Status. URL allowlisting in this UI is defense in depth, not authorization. No production API, customer settings, grants, CVO activation, test routes, emails, submissions, or proof decisions changed in this review.

---

# Pathfinder login — prior local design QA

final result: passed

## Target and scope

Source: /Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/login-startup-review/login-selected-refined.png

The selected reference is subordinate to approved refinements: 420px card,
180px official logo, 26px heading, and no top-left Vornan / Pathfinder label.
The source's larger dimensions and corner label are intentionally not replicated.
This is authentication presentation only; deployment remains held.

Implementation: http://127.0.0.1:5214/auth.html?state=signed-out

## Comparison evidence

- Source pixels: 1672 × 940. Actual screenshot: 1672 × 940, CSS viewport
  1672 × 940, DPR 1. No density scaling needed.
- Both source and implementation were displayed together in one comparison input.
- Implementation: output/login-review/comparison-1672.jpg.
- Focused card inspection in that same comparison: logo, divider, eyebrow, heading,
  supporting line, and Google button are readable; no separate enlarged crop needed.
- Required desktop: output/login-review/desktop-1366.jpg, 1366 × 768.
- Mobile: output/login-review/mobile-390.jpg, 390 × 844.
- Narrow mobile: output/login-review/mobile-320.jpg, CSS viewport 320 × 568.
- Zoom-equivalent: output/login-review/zoom-equivalent-expired.jpg, CSS viewport
  683 × 384, full-page capture. This checks layout reflow, not genuine browser zoom.
- State evidence: checking.jpg, signing-in.jpg, error.jpg, expired.jpg,
  restricted.jpg, unconfigured.jpg in output/login-review.
- Keyboard focus: output/login-review/keyboard-focus.jpg.

## Findings and comparison history

No remaining actionable P0/P1/P2 visual findings.

Before final comparison, UX identified the initial button outline as too faint.
Changed #bcc5b8 to #8c9687 (approximately 3.08:1 on white), keeping Forest
hover/focus. Final desktop, mobile and comparison captures include that fix.
The initial structural prototype is not an acceptance capture.

Approved deviations from the generated image: smaller dimensions, official logo
asset instead of generated likeness, accessible darker small text/button outline,
no corner label, and 6px Forest strip rather than the image's thicker rule.

### Five fidelity surfaces

- Typography: actual Plus Jakarta Sans, 26px/800 title at desktop, 24px at narrow
  widths, 14px supporting text and action. No truncation; heading may wrap at 320px.
- Spacing: measured card 420 × 346.2px at desktop. Single centered panel,
  28px horizontal padding, 48px minimum button, 8px radius. No nested cards.
  Small-height error views scroll naturally without horizontal overflow.
- Color: Stone #f3f7f1, Forest #39523b, Lime #abc65f, white panel; restrained
  border/shadow. Text and focus indicators are distinct.
- Assets: unchanged official 900 × 300 Vornan/scout asset renders at 180 × 60.
  Existing Google SVG paths extracted unchanged from prior AuthGate; not redrawn.
  Both images loaded successfully. Lucide supplies the progress icon.
- Copy: Sign in to Pathfinder / Continue to your workspace / Continue with Google.
  No approved-account guidance, domain pills, marketing pane or corner label.
  Restricted, expired and unconfigured states explain their specific issue.

## Interaction and safety checks

- Enter on Google action enters simulated busy state; disabled button and live
  status appear. Error retry does the same. Restricted Sign out returns to signed out.
- Checking state has logo and status only; no sign-in card or action.
- Unconfigured has no Google button. Errors use alert semantics and escape HTML.
- Keyboard action focus has visible 2px Forest outline. Reduced motion is supported.
- No horizontal overflow at 1366, 390, 320, or 683 CSS pixels.
- Browser warning/error logs: none.
- Preview imports the real pure AuthScreen, not AuthGate/Firebase. All callbacks
  are local state changes; no provider, API, email or proof decisions.
- Frozen-baseline test verifies provider loading, session callbacks, allowlists,
  sign-in, token, expiry and sign-out implementation remains byte-identical.
- All workspace typechecks pass; Admin production build passes (existing
  large-chunk warning remains); all 1,392 regression tests pass.

## Limits and handoff

Live Google sign-in was not performed. This validates presentation and unchanged
authentication source contracts, not a new end-to-end provider session.
Public Proof/Status and intake/API runtime files are unchanged.
Independent UX acceptance and user local review precede any release.

Independent UX presentation review passed on this source: desktop 1366, large
1920 × 1080, mobile 390 × 844, and error 320 × 568; keyboard, busy, retry,
expired, restricted sign-out, unconfigured and quiet checking all passed.
UX evidence lives under the source reference's login-startup-review directory:
login-checks.json, login-comparison.jpg and login-*.jpg.

Independent integrated startup recheck also passed on runtime freeze 9f69433:
held targets/registry root and reload show no directory action or legacy panel;
release reaches Dashboard; directory failure retries to Dashboard; supported
Wrike customer return retries its scoped failure into LTL Demo Settings.
Evidence: startup-integrated-checks.json and startup-integrated.jpg in the same
UX directory. UX accepts this combined local candidate with no design findings.
No actual provider OAuth/sign-out was exercised, and deployment remains held.

Implementation checklist: complete. No additional P3 changes proposed.

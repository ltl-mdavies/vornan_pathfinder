# Status reviewer sign-in — held release gates

Local candidate only. No deployment, Firebase console changes, customer activation,
emails, proof decisions, or live grants are authorized by this checklist.

## Prepared locally

- Independent managed-WAF limits per IP / 300 seconds: Status token exchange 100,
  reviewer-session 30, refresh 60, task routes 60. URI decoding, normalization and
  lowercase matching cover path variants. New rules disable request sampling.
- Existing normal Proof rate-limit rules and default CSP remain unchanged.
- Optional `StatusReviewerFirebaseProjectId` prepares Firebase CSP origins only;
  empty by default. It does not turn on any runtime or customer capability.
- Frontend requires the matching `<project>.firebaseapp.com` auth domain. Enabled
  builds fail if required Firebase configuration is absent or mismatched.
- Backend rejects emulator configuration and mismatched service-account project;
  named Firebase apps must also match. Revocation-aware token verification remains
  mandatory, alongside verified email, recent authentication, exact reviewer,
  parent Status authority, customer, order, session and CSRF checks.

## Required before activation (not yet proven)

1. Confirm the Firebase project and web app, Google provider, authorized Proof
   domain, and approved reviewer account. Match frontend, backend and CSP project.
2. Supply server credentials through the existing secure secret-management flow;
   never paste service-account JSON in code, commands, reports or logs. This patch
   does not configure live credentials or grant additional IAM permissions.
3. Verify cloud parent-Status lookup configuration and least-privilege access.
4. Reviewer promotion now has a module-private exception to general grant
   creation. Its service revalidates the existing view session, CSRF, exact order,
   LTL Demo policy, both opt-in flags, approval capability, and verified identity;
   it rechecks authority after provider I/O. Ordinary grant creation remains
   disabled. Local API and browser tests pass with general issuance off.
   Initial Status view-link issuance still uses the ordinary grant gate in the
   Pathfinder service. Confirm that service's existing configuration before
   activation; this fix does not bypass or change its gate.
5. Managed WAF rules apply only when this stack creates the ACL. If an external
   ACL is supplied, equivalent coverage must be independently verified. WAF is
   approximate rate limiting, not a deterministic request counter. Ensure origin
   access cannot bypass the intended CloudFront/WAF boundary.
6. Verify actual browser popup/CSP behavior and revoked/expired/wrong-account
   rejection against the configured identity provider. Synthetic checks do not
   establish real-provider acceptance. Do not make proof decisions during QA.
7. Confirm no Status token, Firebase bearer, authorization header or private link
   is captured by upstream request sampling, access logs or error reporting.
8. Repeat regression, rollback and release review, then obtain deployment and
   activation authorization. Preserve current thumbnail and normal Proof flows.

Baseline schema validation has zero errors and one existing W1030 warning for
the optional customer-workspace ARN default. S3 encryption and public-access
Guard rules pass; this is not a full cloud security certification.

## Promotion verification — 2026-10-31

- API typecheck passed; 34 scoped API tests passed, including promotion with
  general issuance disabled, all three enablement gates off in turn, repeat
  promotion denial, wrong identity, revoked identity, parent revocation and CSRF.
- Fresh synthetic browser fixture showed view-only first, then Verified reviewer
  with decision controls after the fake verifier accepted the test identity.
  No decision was clicked. This does not verify the real Google provider.
- The synthetic browser fixture deliberately substitutes an identity provider
  and must not be used as evidence of Firebase/CSP acceptance.

## Real Firebase browser verification — 2026-10-31

- User confirmed reuse of Pathfinder's Firebase project. Deployed Pathfinder
  bundle and authenticated Firebase web-app inventory independently match
  `ltl-dashboard-site`, app `1:86194135137:web:0e491286d2bd86a7880a20`
  (Vornan Pathfinder), canonical domain `ltl-dashboard-site.firebaseapp.com`.
- Firebase console read-only inspection: Google provider enabled; localhost and
  127.0.0.1 authorized. Initially proof.vornan.co was not authorized; see the
  separately approved domain update below.
- Separate loopback harness (`tests/status-reviewer-real*`) imported the actual
  production sign-in module, without the synthetic alias or a Proof API. Public
  config was read from the deployed bundle, not copied into source or logs.
- Real Google account selection returned Firebase identity for mdavies@ltlco.com,
  email_verified=true and expected project. Candidate auth CSP enforced; no
  captured console errors/warnings. Test sign-in explicitly cleared afterward.
  No tokens were displayed, saved to files or sent to a Proof API.
- Local backend has no configured service-account credential, ADC environment
  path, or standard ADC file. Credentials were not retrieved. Consequently real
  Admin SDK `verifyIdToken(..., true)` revocation checks and the full real-token
  promotion flow remain **unverified**, not passed.
- Remaining release gates: supply backend verification credentials via approved
  secure runtime setup; verify real-token promotion/revocation and cloud binding.
  Deployment and activation remain held. Local browser success is not production
  acceptance or authorization to enable the feature.

## Approved domain update and backend discovery — 2026-10-31

- With action-time confirmation, added only proof.vornan.co to Firebase authorized
  domains. Readback confirms all six prior domains retained. No provider settings,
  customer capability, runtime flags or deployments changed.
- AWS us-east-1 secret metadata contains no identified Firebase credential.
  Runtime presence-only queries confirm neither Pathfinder API nor Proof public
  Lambda has FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS;
  Proof also lacks FIREBASE_PROJECT_ID. No environment values or secrets dumped.
- Existing Pathfinder checks signatures without checkRevoked. Proof intentionally
  requires checkRevoked=true. Do not weaken verification to work around missing
  authenticated Firebase user-read access.
- Proposed next boundary: dedicated verifier service identity with only
  firebaseauth.users.get, using keyless federation restricted to the exact Proof
  execution role. Local acceptance needs a separately constrained short-lived
  identity path; do not copy administrator CLI credentials or create a broad key.
  Identity/trust provisioning is now complete (see proof-keyless-verifier-provisioning.md).
  Exact-role trust, sole user-read permission, absence of private keys and denial
  of an unrelated AWS identity were verified. Positive backend acceptance remains
  pending because no runtime deployment or isolated execution is authorized yet.
# Isolated verifier acceptance addendum — 2026-10-31

Private temporary AWS runner successfully verified a real Chrome/Firebase sign-in
using the actual candidate token verifier with checkRevoked=true and LTL Demo
reviewer policy. No proof grants or decisions created. Malformed token denied.
34 scoped API/security tests passed (29 public API + 5 handoff/identity/authority).
See `proof-keyless-verifier-provisioning.md` for scope, cleanup and remaining
live-runtime boundary. Temporary runner/role removed; temporary Google provider
disabled and its binding removed. Deployment and activation remain on hold.

# Proof keyless verifier — identity provisioned, runtime held

Project: `ltl-dashboard-site` (86194135137).
Proposed service account: `proof-reviewer-verifier@ltl-dashboard-site.iam.gserviceaccount.com`.
Custom role: `proofReviewerVerifier` with only `firebaseauth.users.get`.
Pool/provider: `proof-reviewer` / `aws-proof-public` (global).

Trust only AWS account 744016783602 and the exact assumed-role prefix
`arn:aws:sts::744016783602:assumed-role/vornan-proof-dev-ProofPublicLambdaRole-Jo0ym7xP02Cf/`.
Use mapping `google.subject=assertion.arn` and
`attribute.aws_role=assertion.arn.extract('assumed-role/{role}/')`.
Provider attribute condition must require both the exact account and exact role
prefix; the trailing slash prevents similarly named roles from matching.
Service-account workloadIdentityUser binding must target only the pool's exact
aws_role principal set, never the whole pool or account.

## Provisioning sequence

1. Authenticate the isolated Google CLI as the approved project administrator.
   Do not extract or reuse Firebase CLI tokens. Do not print access tokens.
2. Read back existing service accounts, pools/providers, custom roles, IAM policy
   and required API enablement. Preserve existing bindings and policy etags.
3. Create the dedicated identity, custom read-only role, restricted pool/provider
   and precise impersonation binding. No service-account keys.
4. Read back every permission and trust condition; test unrelated identities
   cannot match. Record identifiers, not credentials.
5. Generate non-secret external-account config using Google's CLI. The existing
   Firebase Admin SDK uses google-auth-library ADC and supports this mechanism.
   Keep production environment/code untouched until release approval.

## Acceptance boundary

The existing AWS role trusts Lambda only. Do not modify it to allow a developer,
administrator, or local test to assume the live role. No app deployment or
activation is authorized. Therefore a genuine AWS-role-to-Google exchange needs
an approved isolated execution plan, or the eventual held deployment gate.
Local browser Firebase sign-in alone is not evidence of backend federation.
Do not claim end-to-end acceptance until the real verifier executes with its
intended role and checks revoked/disabled identity without making proof decisions.

## Verified provisioning — 2026-10-31

Provisioned under the approved mdavies@ltlco.com Google administration session:

- Enabled sts.googleapis.com; IAM, IAM Credentials, Resource Manager and Firebase
  Identity Toolkit APIs were already enabled.
- Created the dedicated service account, custom role, pool and AWS provider named
  above. Added only the custom-role project binding and exact-role
  workloadIdentityUser service-account binding. Readback matched the intended
  permission, account, role condition and attribute mapping.
- User-managed service-account key list is empty. No private key or secret created.
- Generated `infra/google/proof-reviewer-external-account.json` using gcloud.
  This is a non-secret federation descriptor, not a credential or token.
- AWS role inventory confirms only vornan-proof-public-dev uses the trusted role.
  Its last-modified time remained 2026-10-30T01:55:06.000+0000; Status handoff and
  reviewer sign-in flags remain unset. No AWS trust or Lambda configuration changed.
- Live negative check `scripts/check-proof-keyless-denial.mjs` passed: Google STS
  rejected the unrelated AWS CLI identity at the provider attribute condition.
  No credentials or Google tokens were emitted or persisted by the check.

Positive federation, Firebase user-read and real-token promotion remain unverified:
they require execution under the exact trusted Lambda role. The local machine
cannot impersonate it. Request a separately scoped isolated Proof runner if this
must be proven before deployment; do not silently widen the provider or AWS trust.
Application deployment, runtime credential wiring and customer activation are held.

## Recovery (not executed)

Disable the dedicated provider first to stop future exchanges. If removal is
approved, remove only the verifier custom-role member and exact workloadIdentityUser
binding; then retire the dedicated provider/pool/account/custom role. Do not
replace the project IAM policy or remove unrelated bindings. Short-lived tokens
already issued may remain valid until expiry. Keep the application feature flags off.

## Isolated cloud acceptance — 2026-10-31

User approved a temporary private verification runner, prohibiting public endpoints,
order writes, proof decisions, uploads and emails. Created disposable Lambda
`proof-verifier-qa-20261031` with its own Lambda-only execution role of the same
name, **no inline or managed AWS permissions**, no Function URL, no event sources,
and no application stores/routers. No CloudWatch log permission was granted.
Standard Lambda execution trust follows AWS's documented execution-role pattern.

A separate provider `aws-proof-qa-20261031` in the existing pool restricted the
AWS account and exact QA-role ARN prefix. Only that role received a temporary
workloadIdentityUser binding to the existing read-only verifier. The live provider
condition and role were not widened or reused.

Results:
- Keyless federation and Firebase getUserByEmail succeeded: approved account
  matched, enabled, verified email. Initial credential exchange failed; subsequent
  retry passed after provisioning propagation. Explicit GOOGLE_CLOUD_PROJECT was
  set to avoid unnecessary project discovery; this did not prove it caused the fix.
- Chrome Google sign-in at loopback 5474 passed under the candidate auth CSP.
  The real token travelled in memory through a same-origin, bounded local bridge
  to signed private Lambda Invoke, never through CLI arguments or disk files.
- The actual candidate verifyStatusReviewerToken(token, true) and
  verifyLtlDemoStatusReviewer accepted the token. Thus signature/project/expiry,
  Firebase revocation checking, verified email, cohort and recent-auth policy were
  exercised together. No real grant was created, session promoted, or decision made.
- Malformed token rejected. Revoked/disabled/wrong-user fixtures and real-session
  binding/promotion remain covered by local synthetic tests, not destructive live
  account revocation. No real end-to-end production grant-promotion claim is made.
- Readback: no runner AWS policies, Function URL or event sources. Local sign-in
  cleared after acceptance, bridge stopped. Screenshot evidence is local only:
  `/private/tmp/proof-verifier-e2e-pass.png` (no bearer or private order URL).

Cleanup: QA Google provider disabled; its precise service-account binding removed;
temporary Lambda and IAM role deleted and confirmed absent. Non-secret source and
package retained locally for reproducibility; no business data was deleted. The
disabled provider is retained as an audit artifact. Already issued short-lived
Google tokens can expire naturally. The live service-account binding is preserved.

Live Proof LastModified remained `2026-10-30T01:55:06.000+0000`. Handoff, reviewer
sign-in and Firebase project environment variables remain unset. Deployment and
activation are still held. Future release must package the non-secret live ADC
descriptor, wire explicit project/ADC environment variables and validate the live
role path; this isolated QA-role acceptance does not replace post-release checks.

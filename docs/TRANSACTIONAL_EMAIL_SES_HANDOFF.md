# Pathfinder Transactional Email Delivery Handoff

Date: July 18, 2026  
Project: Pathfinder / `status.vornan.co`  
Primary sender: `Vornan Updates <notifications@notify.vornan.co>`

## Directive for the receiving Codex task

Implement production-capable transactional email delivery for Pathfinder, using Amazon SES by default because the application already runs on AWS Lambda. Inspect the deployed AWS account and repository before changing anything, preserve unrelated work, implement and verify as much as current credentials permit, and leave only genuinely human-only or approval-gated actions for the user.

Do not create paid Google Workspace users for these addresses. Google Workspace Business Starter should be used only for reply-handling Groups or aliases. The application sender should be an authenticated SES identity, not a Gmail mailbox.

Use this sender and reply routing:

| Message category | From | Reply-To |
| --- | --- | --- |
| Requested status link | `Vornan Updates <notifications@notify.vornan.co>` | `support@vornan.co` |
| Order confirmation or update | `Vornan Updates <notifications@notify.vornan.co>` | `orders@vornan.co` |
| Internal system alert | `Vornan Updates <notifications@notify.vornan.co>` | `ops@vornan.co`, or the owning team |

The immediate implementation priority is the requested status-link email. Build the email abstraction so order and system messages can use the same transport later without duplicating SES code.

## Architectural decision

Use this default design:

1. `status.vornan.co` accepts a status-link request.
2. The Pathfinder API verifies that the submitted email is associated with the order.
3. The API generates an opaque scoped token and stores only its hash.
4. The API sends an HTML and plain-text email through Amazon SES.
5. The email has a stable From address on `notify.vornan.co` and a category-specific Workspace Group in `Reply-To`.
6. SES publishes delivery, bounce, complaint, reject, rendering-failure, and delay events. Do not enable open or click tracking for tokenized links.
7. Customers replying to the email reach a monitored Google Group.

Do not add `notify.vornan.co` to Google Workspace initially. The From address does not need a mailbox. If direct mail to `notifications@notify.vornan.co` must later be received, add the subdomain as a Workspace secondary domain and create a Group rather than a paid user; this is optional and out of the initial critical path.

## Revised implementation approach

The Pathfinder repository is already shaped for this work: Lambda, API Gateway, DynamoDB, Secrets Manager, Firebase verification, and the public status-token flow are in place. Implement email delivery as a small app-side slice first, then enable live SES only after DNS and SES verification are complete.

Use this rollout order:

1. **Application foundation:** add a reusable email transport, safe local log mode, SES mode, environment validation, least-privilege IAM, and documentation updates.
2. **Public endpoint hardening:** preserve the neutral public `202` response on unknown orders, mismatched emails, and provider failures; add rate limits and cooldowns before broad public use.
3. **SES identity:** create or validate `notify.vornan.co`, Easy DKIM, custom MAIL FROM, DMARC, configuration set, suppression, and monitoring.
4. **Controlled send test:** keep production in `log` mode until SES identity and production access are verified, then test with a user-controlled address before any customer send.

Production must never log raw status tokens or full token URLs. Local development may expose token URLs only behind an explicitly named local debug switch.

## Current repository state

The necessary portal and token flow already exists:

- Public status UI: `apps/status/src/main.tsx`
- API entry point: `apps/api/src/server.ts`
- Status request endpoint: `POST /public/status/request-link`
- Public token lookup: `GET /public/status/:token`
- Email stub: `sendPublicStatusLinkEmail(...)` in `apps/api/src/server.ts`
- Current mode: `PATHFINDER_STATUS_EMAIL_MODE=log`
- Token storage: DynamoDB `OrderStatusTokens` table
- Public snapshots: DynamoDB `OrderStatusSnapshots` table
- AWS stack: `infra/aws/api-cloudformation.yaml`
- Deployment wrapper: `scripts/deploy-api-lambda.sh`
- Existing DNS runbook: `docs/AWS_GODADDY_DNS_RUNBOOK.md` (the content confirms Cloudflare is authoritative despite the legacy filename)

Important existing behavior to preserve:

- Requests require order number plus email.
- The API returns the same neutral `202` response whether a matching order/email exists or not.
- The API checks that the requested email is associated with the order.
- Tokens are random 32-byte base64url values and only their hashes are persisted.
- Tokens have a configured expiration.
- `PATHFINDER_PUBLIC_STATUS_RETURN_LINK` must remain false outside local testing.

Important current gaps to close:

- The email stub logs a complete token URL in `log` mode. That must become local-only or redacted before production use.
- The public status request endpoint should keep returning a neutral accepted response even if downstream email delivery fails.
- Rate limiting and repeated-request cooldowns should be part of the first public email release, not a later hardening task.
- Basic delivery observability should be persisted or logged in a structured way without storing raw tokens.

## Implementation status as of July 18, 2026

This handoff has been converted into the first implementation slice:

- `apps/api/src/email.ts` now provides a reusable transactional email abstraction with `log` and `ses` modes.
- The public status-link endpoint now delegates to the email abstraction instead of logging raw token URLs.
- Public status-link failures continue returning the neutral accepted response.
- Public status-link request throttling now covers source IP, email, order number, and order/email pair with HMAC-style hashed keys.
- Public status-link delivery now requires the requested email to match an order, customer, or contact email by default. The only override is the explicit `PATHFINDER_PUBLIC_STATUS_EMAIL_MATCH_REQUIRED=false` development switch.
- `Referrer-Policy: no-referrer` is applied by the API.
- Lambda configuration, deployment scripts, GitHub Actions, README, and `.env.example` now include the new email and public status settings.
- The API Lambda execution role is configured for least-privilege `ses:SendEmail` against `notify.vornan.co`.

Still pending before live customer delivery:

- Wait for SES DKIM verification to move from `Pending` to `Success`.
- Request/receive SES production access. Current quota is `200` messages/day and `1` message/second, which indicates the account is still in sandbox or low-quota test posture.
- Keep `PATHFINDER_STATUS_EMAIL_MODE=log` until SES DKIM and production access are verified.
- Run a controlled status-link email test to a user-owned address before customer-facing sends.

### SES setup completed this slice

The following SES setup actions have been run in `us-east-1`:

- Confirmed SES account status is healthy, sending is enabled, account-level suppression covers bounces and complaints, and production access is not yet enabled.
- Created/requested SES domain identity verification for `notify.vornan.co`.
- Requested Easy DKIM tokens for `notify.vornan.co`.
- Set custom MAIL FROM domain to `bounce.notify.vornan.co`.
- Created SES configuration set `pathfinder-transactional`.
- Confirmed `support@vornan.co` and `dmarc@vornan.co` are available as Google Groups/addresses for reply and reporting paths.
- Added `PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_PEPPER` as a GitHub Actions repository secret.
- Added EventBridge publishing on SES configuration set `pathfinder-transactional` for `SEND`, `DELIVERY`, `DELIVERY_DELAY`, `BOUNCE`, `COMPLAINT`, `REJECT`, and `RENDERING_FAILURE`. Open and click tracking remain intentionally disabled.

Current verification status:

| Check | Status | Notes |
| --- | --- | --- |
| SES domain identity | Success | `notify.vornan.co` is verified. |
| Custom MAIL FROM | Success | `bounce.notify.vornan.co` resolves and SES reports success. |
| DKIM | Pending | All three CNAMEs resolve publicly; SES has not finished verification yet. |
| Event publishing | Enabled | SES events publish to the default EventBridge bus. |
| SES production access | Not enabled | Current quota is `200` messages/day and `1` message/second. |

Add these Cloudflare DNS records exactly as shown, with proxy status **DNS only**:

| Purpose | Type | Name | Value |
| --- | --- | --- | --- |
| SES domain verification | TXT | `_amazonses.notify` | `nsiXtGrbDS9GX50Fkce9BVnO/DLQBWxiRCCTUocmnNU=` |
| Easy DKIM 1 | CNAME | `dfrvfwmu243ae6cwmn7mqijndlrermjk._domainkey.notify` | `dfrvfwmu243ae6cwmn7mqijndlrermjk.dkim.amazonses.com` |
| Easy DKIM 2 | CNAME | `cimzzqawjugxohehq25i6szjua5ywww5._domainkey.notify` | `cimzzqawjugxohehq25i6szjua5ywww5.dkim.amazonses.com` |
| Easy DKIM 3 | CNAME | `h5dq5qjxy53yla56jndq7r43nb3wlthq._domainkey.notify` | `h5dq5qjxy53yla56jndq7r43nb3wlthq.dkim.amazonses.com` |
| Custom MAIL FROM | MX | `bounce.notify` | `10 feedback-smtp.us-east-1.amazonses.com` |
| Custom MAIL FROM SPF | TXT | `bounce.notify` | `v=spf1 include:amazonses.com -all` |
| DMARC monitoring | TXT | `_dmarc.notify` | `v=DMARC1; p=none; rua=mailto:dmarc@vornan.co; adkim=s; aspf=r; pct=100` |

Do not switch `PATHFINDER_STATUS_EMAIL_MODE` to `ses` until SES reports DKIM success and production access is enabled, unless doing a controlled sandbox send to a verified recipient.

## Phase 1: Audit the live environment

Before implementation or deployment:

1. Read the repository status, relevant docs, API code, CloudFormation stack, and deployment scripts.
2. Identify the AWS account ID and deployment region used by the production API stack.
3. Inspect the current CloudFormation stack outputs and Lambda environment.
4. Inspect SES account state in the same region:
   - Whether SES v2 is available.
   - Whether production access is enabled or the account remains in the sandbox.
   - Current sending quota.
   - Existing identities, configuration sets, suppression settings, and event destinations.
5. Inspect Cloudflare DNS records for `vornan.co` before proposing or adding records. Never overwrite an existing record without reconciling it.
6. Inspect whether `support@vornan.co`, `orders@vornan.co`, and `ops@vornan.co` already exist as users, aliases, or Groups before creating anything.
7. Record findings in this document or a dated implementation log.

Useful read-only AWS checks include:

```bash
aws sts get-caller-identity
aws configure get region
aws cloudformation describe-stacks --stack-name vornan-pathfinder-api-prod
aws sesv2 get-account
aws sesv2 list-email-identities
aws sesv2 list-configuration-sets
```

Do not expose account secrets, customer email addresses, or status tokens in task output.

## Phase 2: Google Workspace Business Starter setup

No extra Workspace licenses should be purchased for this design.

### Create or validate reply-handling Groups

In Google Admin Console:

1. Go to **Directory > Groups**.
2. Create `support@vornan.co` if it does not already exist.
3. Add the employees responsible for customer status questions.
4. Create `orders@vornan.co` if it does not already exist.
5. Add the employees responsible for order questions.
6. Optionally create `ops@vornan.co` for internal operational alerts.

For each externally reachable Group, configure:

- Who can join: invited users only.
- Who can view conversations: Group members.
- Who can view members: Group members or owners.
- Who can post: anyone on the web.
- Allow email posting: on.
- Conversation history: on if the Group will be used as a Collaborative Inbox.

“Anyone on the web can post” is required for customer replies, but external users must not be allowed to join the Group or view its conversations or membership.

If the external-posting option is not available, go to **Apps > Google Workspace > Groups for Business > Sharing settings** and allow Group owners to accept incoming email from outside the organization. Keep all unrelated external-sharing settings unchanged.

Optionally enable Collaborative Inbox for `support@` and `orders@` when the team needs assignment and completion tracking.

### Configure human replies to use the Group address

For employees who should reply as the team:

1. Open Gmail.
2. Go to **Settings > Accounts > Send mail as**.
3. Add `support@vornan.co` or `orders@vornan.co`.
4. Complete the verification delivered to the Group.
5. Confirm that a reply to an external test customer displays the appropriate Group address, not an employee’s private address.

If only one person handles an address, a free user alias is an acceptable alternative. Google permits up to 30 aliases on a licensed user without extra cost, but aliases do not have their own login or mailbox.

### Optional inbound setup for the From address

Do not do this unless the user explicitly wants direct emails to the From address to be received in addition to the Reply-To behavior.

If required:

1. Add `notify.vornan.co` to Workspace as a secondary domain.
2. Verify ownership.
3. Add Google’s MX record for the `notify` subdomain and activate Gmail for it.
4. Create `notifications@notify.vornan.co` as a Google Group, not a user.
5. Route it to the support team.

This optional inbound MX must not conflict with the SES custom MAIL FROM domain. Use `bounce.notify.vornan.co` for SES MAIL FROM, never `notify.vornan.co` itself.

## Phase 3: Amazon SES identity and DNS

Use the same AWS region as the Pathfinder API Lambda unless a reviewed reason requires otherwise. SES identities and sandbox/production state are regional.

### Create the SES identity

Preferred identity:

```text
notify.vornan.co
```

Preferred custom MAIL FROM domain:

```text
bounce.notify.vornan.co
```

Use Easy DKIM with signing enabled. The identity may be created manually through SES first or represented as `AWS::SES::EmailIdentity` in CloudFormation. Infrastructure as code is preferred once DNS ownership and replacement behavior are understood.

If CloudFormation creates the identity, expose the three Easy DKIM CNAME names and values as stack outputs so they can be copied accurately into Cloudflare.

### Cloudflare DNS records

Add only the exact values returned by SES. Cloudflare proxying must be disabled for all email-authentication records.

Expected records:

| Purpose | Type | Cloudflare name | Value |
| --- | --- | --- | --- |
| Easy DKIM 1 | CNAME | SES-generated selector under `notify` | SES-generated DKIM target |
| Easy DKIM 2 | CNAME | SES-generated selector under `notify` | SES-generated DKIM target |
| Easy DKIM 3 | CNAME | SES-generated selector under `notify` | SES-generated DKIM target |
| Custom MAIL FROM | MX | `bounce.notify` | `10 feedback-smtp.<region>.amazonses.com` |
| Custom MAIL FROM SPF | TXT | `bounce.notify` | `v=spf1 include:amazonses.com -all` |
| DMARC | TXT | `_dmarc.notify` | Start with the reviewed monitoring policy below |

Recommended initial DMARC policy:

```text
v=DMARC1; p=none; rua=mailto:dmarc@vornan.co; adkim=s; aspf=r; pct=100
```

Create and monitor `dmarc@vornan.co` before publishing `rua`, or use an approved DMARC-reporting service. After SPF/DKIM alignment has been observed and all legitimate senders are known, move deliberately toward `p=quarantine` and then `p=reject`.

Important DNS constraints:

- Do not publish multiple SPF TXT records at the same hostname.
- Do not modify the existing SPF record for `vornan.co` unless a verified provider requires it. SES custom MAIL FROM SPF belongs at `bounce.notify.vornan.co`.
- Set DKIM, MAIL FROM, and DMARC records to **DNS only**, not proxied.
- Do not use a CNAME at `notify.vornan.co` itself if that would conflict with other needed records.
- Verify DNS propagation and SES identity status before enabling production mode.

### SES sandbox and production access

If the SES account is in the sandbox, test only with verified recipients or the SES mailbox simulator. Request production access with an accurate transactional-email use case, expected volume, bounce/complaint handling description, and the `status.vornan.co` opt-in/request flow.

Do not send real customer email until:

- The identity is verified.
- DKIM is successful.
- The custom MAIL FROM domain is successful, or there is an explicitly accepted temporary fallback.
- Production access is enabled.
- Bounce and complaint handling is configured.

## Phase 4: SES monitoring and suppression

Create an SES configuration set, suggested name:

```text
pathfinder-transactional
```

Enable reputation metrics. Publish these event types to an appropriate destination such as SNS and/or CloudWatch:

- Send
- Delivery
- Delivery delay
- Hard bounce
- Complaint
- Reject
- Rendering failure

Do not enable open or click event tracking for status-link emails. Token URLs must not be rewritten or sent to engagement analytics.

Confirm that the SES account-level suppression list is enabled for bounces and complaints. A later enhancement may persist delivery outcomes in Pathfinder, but production v1 must at least provide an operationally visible event stream and alert path.

Suggested alarms:

- Any complaint event.
- Bounce rate above a conservative threshold.
- Reject or rendering-failure count greater than zero over a short window.
- Repeated send failures from Lambda.

## Phase 5: AWS infrastructure changes

Update `infra/aws/api-cloudformation.yaml` with the minimum production configuration needed by the API.

Recommended parameters or environment values:

```text
PATHFINDER_STATUS_EMAIL_MODE=log|ses
PATHFINDER_EMAIL_FROM=Vornan Updates <notifications@notify.vornan.co>
PATHFINDER_STATUS_REPLY_TO=support@vornan.co
PATHFINDER_ORDERS_REPLY_TO=orders@vornan.co
PATHFINDER_SYSTEM_REPLY_TO=ops@vornan.co
PATHFINDER_SES_REGION=<production API region>
PATHFINDER_SES_CONFIGURATION_SET=pathfinder-transactional
PATHFINDER_STATUS_EMAIL_DEBUG_RETURN_LINK=false
PATHFINDER_PUBLIC_STATUS_RATE_LIMIT_PEPPER=<secret random value>
PATHFINDER_PUBLIC_STATUS_EMAIL_MATCH_REQUIRED=true
```

Keep local development defaulting to `log`. Keep deployed production in `log` only while SES is not verified, and redact raw tokens in that mode. Reject unknown provider modes instead of silently falling back.

Grant the Lambda execution role only the SES permissions needed by the chosen API, preferably:

```text
ses:SendEmail
```

Scope the IAM resource to the verified SES identity ARN where supported:

```text
arn:aws:ses:<region>:<account-id>:identity/notify.vornan.co
```

Add `ses:SendRawEmail` only if the implementation actually requires raw MIME. SES v2 `SendEmail` with simple HTML and text content should be sufficient for v1.

Update:

- `infra/aws/api-cloudformation.yaml`
- `scripts/deploy-api-lambda.sh`
- `.env.example`
- `README.md`
- Any relevant production runbook

Never commit credentials, SMTP passwords, access keys, or customer addresses.

## Phase 6: Application implementation

### Add a reusable email transport

Add the AWS SES v2 SDK dependency to `@pathfinder/api`:

```text
@aws-sdk/client-sesv2
```

Create a focused module, suggested path:

```text
apps/api/src/email.ts
```

It should expose a narrow typed interface such as:

```ts
type TransactionalEmail = {
  to: string[];
  from: string;
  replyTo?: string[];
  subject: string;
  text: string;
  html: string;
  category: "status_link" | "order" | "system";
};
```

Provide at least:

- A log transport for local development.
- An SES transport for deployed environments.
- Centralized configuration validation.
- Structured results containing provider message ID without sensitive content.
- Structured error logging that excludes tokens and full status URLs.

The SES call should set:

- `FromEmailAddress`
- `Destination.ToAddresses`
- `ReplyToAddresses`
- Both text and HTML bodies
- UTF-8 charset
- `ConfigurationSetName`
- A non-sensitive category tag such as `message_type=status_link`

### Replace the existing status-link stub

Replace or delegate from `sendPublicStatusLinkEmail(...)` in `apps/api/src/server.ts`.

Status-link message requirements:

- Subject: clear and non-alarming, for example `Your Vornan order status link`.
- Display sender: `Vornan Updates`.
- Reply-To: `support@vornan.co`.
- Include a single prominent HTTPS link to `status.vornan.co`.
- Include the expiration in human-readable form.
- Include a plain-text fallback.
- Explain that the customer can ignore the message if they did not request it.
- Do not include sensitive order details, negotiated rates, internal identifiers, credentials, or attachments.
- Do not load remote tracking pixels.
- Do not use click-tracked or shortened links.

Escape all dynamic HTML values. Do not construct HTML by interpolating unescaped customer-controlled strings.

### Preserve anti-enumeration behavior

The public endpoint must continue returning the same neutral `202` response for:

- Unknown order.
- Known order with non-matching email.
- Known order and matching email.
- Internal email-provider failure.

Do not leak match status through response fields or error text. `debug_status_url` must never be enabled in production.

If SES sending fails, log a sanitized operational error and emit a metric/event, but do not return a distinguishable response to the public caller. Consider a durable queue as a follow-up; direct SES submission is acceptable for v1 if failures are observable and the endpoint remains neutral.

Persist or emit a minimal delivery event for support visibility:

- category
- provider mode
- provider message ID when available
- sanitized failure category when unavailable
- order number hash or job ID when already known
- timestamp

Do not persist raw email bodies, raw tokens, full status URLs, credentials, or internal-only order details in delivery telemetry.

### Protect the public request endpoint from abuse

The current endpoint needs explicit abuse controls before broad production use. This is a v1 requirement for the public form, not a follow-up. Implement a reasonable combination of:

- Rate limiting by source IP.
- Rate limiting by normalized email hash.
- Rate limiting by normalized order-number hash.
- A cooldown for repeated requests for the same order/email pair.
- API Gateway, WAF, or application-level enforcement that works in Lambda.
- Generic responses for rate-limited requests where appropriate.

Do not store raw email addresses in rate-limit keys or logs. Use an HMAC or cryptographic hash with a server-side pepper when keys could be enumerated.

The current v1 application-level guard is intentionally small and in-memory per Lambda runtime. It is acceptable for the first controlled release, but a durable shared limiter through WAF, API Gateway usage plans, or DynamoDB should be added before heavier public traffic.

Avoid issuing unlimited active tokens for repeated requests. Either reuse a safely recoverable pending link through a delivery job, or revoke/expire superseded tokens and enforce a cooldown. Because only token hashes are stored today, simple link reuse is not available without a deliberate design change.

### Token and logging safeguards

- Keep generating tokens with a cryptographically secure random source.
- Keep storing only token hashes.
- Keep tokens scoped to a single order/status snapshot.
- Keep expiration and revocation checks.
- Do not log the raw token or complete status URL in production.
- Ensure request bodies containing customer email are not indiscriminately logged.
- Add `Referrer-Policy: no-referrer` on status pages or responses where practical.
- Review whether 30 days is the right expiration; do not shorten it without product approval if customers need persistent order tracking.

The existing log transport currently logs the complete status URL. That is acceptable only for explicit local development. Add a production guard so `log` mode cannot accidentally be deployed with raw token logging, or redact the token by default and provide a deliberately named local-only override.

## Phase 7: Testing and verification

Add automated coverage proportional to the risk, even if the repository currently has limited tests.

At minimum verify:

1. Status emails contain the configured From and status Reply-To values.
2. Order emails select `orders@vornan.co`.
3. System emails select `ops@vornan.co`.
4. HTML escaping prevents injection.
5. Plain-text and HTML bodies contain the correct HTTPS URL and expiration.
6. Log mode does not call SES.
7. SES mode supplies the expected SES v2 command payload.
8. Unknown email mode fails closed during startup/configuration.
9. SES errors do not change the public endpoint’s neutral response.
10. Raw tokens and complete status URLs are absent from production logs.
11. Rate limits prevent repeated email abuse without revealing whether an order exists.

Run the repository’s normal checks:

```bash
npm run check
npm run build
npm run build:api-lambda
npm run package:api-lambda
```

### Sandbox delivery test

Before production access, send to a verified user-controlled address or SES mailbox simulator. Verify:

- SES returns a message ID.
- Both HTML and text render correctly.
- The status link opens the correct public status page.
- The Reply-To header is `support@vornan.co`.
- Replying from an external mailbox reaches the intended Group members.
- The SES event destination receives delivery or simulator events.

### Authentication test

In Gmail, use **Show original** and confirm:

- SPF: PASS
- DKIM: PASS with `notify.vornan.co` alignment
- DMARC: PASS
- TLS was used
- From and Reply-To are correct
- No unexpected click-rewriting domain appears in the link

### Production smoke test

Use a real test order and a user-controlled email associated with that order. Do not use a customer address for the first production test.

Confirm:

- `POST /public/status/request-link` returns the neutral `202` response.
- Exactly one message is delivered.
- No token appears in Lambda or API logs.
- The token resolves to only the sanitized customer-safe snapshot.
- Invalid, expired, and revoked tokens disclose no order data.
- A reply reaches the correct Workspace Group.

## Acceptance criteria

The work is complete when:

- `notifications@notify.vornan.co` is an SES-verified sending identity with DKIM and DMARC alignment.
- The Pathfinder Lambda can send using least-privilege SES permissions.
- The public status request sends a branded HTML/plain-text email through SES.
- Status messages use `support@vornan.co` as Reply-To.
- The email flow retains the existing neutral anti-enumeration response.
- Production logs do not contain raw tokens or complete token URLs.
- Click/open tracking is disabled for token-link messages.
- Bounce, complaint, reject, delay, and delivery events are observable.
- Endpoint abuse controls and request cooldowns exist.
- Workspace reply Groups are externally reachable but privately readable.
- No new Google Workspace user licenses were created.
- Automated checks and a controlled end-to-end smoke test pass.
- README, environment examples, infrastructure, and runbooks reflect the deployed design.

## Alternative provider decision

Amazon SES is the default and should be used unless a concrete blocker is found. A comparable transactional provider such as Postmark, SendGrid, or Mailgun is acceptable only when the receiving Codex task documents why SES is unsuitable—for example, production-access denial, operational requirements that SES cannot satisfy economically, or a pre-existing approved company provider.

If an alternative is selected, preserve the same application-level contract:

- Verified `notify.vornan.co` sending identity.
- SPF, DKIM, and DMARC alignment.
- Stable From and per-category Reply-To values.
- No click tracking for token URLs.
- Delivery, bounce, complaint, and suppression handling.
- Provider abstraction that does not couple business logic to one vendor.
- No Google Workspace mailbox license for the application sender.

## Expected human-only or approval-gated actions

Codex should attempt all authorized read-only inspection, local implementation, automated testing, AWS infrastructure work, and DNS/Workspace configuration available through existing signed-in sessions or CLIs. Stop only for actions that genuinely require the user, such as:

- Approving SES production access statements or account-level requests.
- Completing an unavailable Google Workspace super-admin login or MFA prompt.
- Completing an unavailable Cloudflare login or MFA prompt.
- Choosing actual members/owners for Groups when repository or directory context cannot establish them safely.
- Approving the first real external customer send.

When blocked, report the exact console path, record value, or approval needed. Do not replace actionable details with a generic “configure DNS” instruction.

## Primary documentation

- [Google Workspace: Add or delete a user email alias](https://support.google.com/a/answer/33327?hl=en)
- [Google Groups: Create a group and choose settings](https://support.google.com/groups/answer/2464926?hl=en)
- [Google Workspace: Make a Group a Collaborative Inbox](https://support.google.com/a/users/answer/10375787?hl=en)
- [Gmail: Send from another address or Group alias](https://support.google.com/mail/answer/22370?hl=en)
- [Google Workspace: Set up MX records, including subdomains](https://support.google.com/a/answer/6156494?hl=en)
- [Gmail sender guidelines: SPF, DKIM, DMARC, and alignment](https://support.google.com/mail/answer/81126?hl=en)
- [AWS CloudFormation: `AWS::SES::EmailIdentity`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ses-emailidentity.html)
- [Amazon SES v2: `SendEmail`](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
- [Amazon SES: Configuration sets](https://docs.aws.amazon.com/ses/latest/dg/using-configuration-sets.html)
- [Amazon SES: Event destinations](https://docs.aws.amazon.com/ses/latest/dg/event-destinations-manage.html)
- [Amazon SES: Custom MAIL FROM attributes](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ses-emailidentity-mailfromattributes.html)

## Suggested opening instruction for the primary Codex task

Use this exact prompt with the handoff:

> Execute `docs/TRANSACTIONAL_EMAIL_SES_HANDOFF.md` autonomously. Start by auditing the repository, deployed Pathfinder AWS stack, SES state, Cloudflare DNS, and Google Workspace address state. Use Amazon SES unless you find and document a concrete blocker. Implement the code, infrastructure, tests, and documentation; configure authenticated DNS and Workspace Groups where current access permits; preserve the neutral public response and never expose raw status tokens. Validate with SES sandbox or a user-controlled address before any customer send. Continue until only genuinely human-only approvals or unavailable authentication remain, then give me an exact checklist of those remaining items.

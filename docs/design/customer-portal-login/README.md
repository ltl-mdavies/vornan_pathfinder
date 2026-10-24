# Future Vornan customer portal — login design baseline

Saved October 24, 2026. Marcus approved these concepts and explicitly requested retaining them for the future customer portal. These are generated design mocks, not implemented authentication or a deployment authorization for customer access.

## Screens

1. [Sign in](01-sign-in.png): email address, Keep me signed in on this device, Send sign-in link, or Continue with Google. Request an invitation provides an access path for customers without an account.
2. [Check your email](02-check-email.png): confirms the entered address, uses neutral account-existence wording, offers resend and a different email.
3. [Accept invitation](03-accept-invitation.png): identifies the customer and invited email; supports accepting the emailed invitation or using the matching Google identity.

## Approved visual direction

Use the established compact Vornan login treatment: official black Vornan + Scout lockup, Plus Jakarta Sans Medium/ExtraBold, Stone #F3F7F1 background, Forest #39523B, Zinnia #ABC65F accent, Night #191818 text, white panel and restrained border/shadow. No top-left Vornan/Pathfinder text, glass styling, marketing side panel, Welcome back assumption, or generic approved-account guidance. The company/email context on invitations is purposeful.

Source branding: assets/brand/Vornan-Brand-Guidelines.pdf and assets/brand/vornan-logo-and-wordmark.png. Generated logo likenesses must be replaced with the exact supplied asset when implemented. Layout target was 1366 × 768; generated images are concept rasters, not verified CSS dimensions. Use actual responsive sizing and accessible contrast/focus in implementation.

## Proposed customer journey

Existing member: email → send link → check email → redeem link → authorized customer workspace. Google is an alternate sign-in route. New member: customer invitation email → invitation landing → accept using a validated invitation or matching Google identity → authorized customer workspace. Invitation identifies company and email; creating an identity alone must not grant workspace access.

Keep me signed in must control real session persistence, not just save an address. Invitation redemption, membership, provider account linking, expiry/revocation, single-use rules, delivery/resend limits, wrong-account handling, recovery and customer data authorization require a separate design and engineering pass. Do not infer those implementations from these images. Password sign-in was not selected for the initial customer direction.

## Scope boundary

The October 24 internal release contains Google-only internal sign-in presentation and startup fixes. These customer concepts remain future work: no email authentication, invitations, public signup, customer permissions or new provider configuration is enabled by saving them.

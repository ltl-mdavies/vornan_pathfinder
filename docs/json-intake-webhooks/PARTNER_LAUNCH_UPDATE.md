# Partner launch update — 2026-09-28

Marcus shared Andy's email accepting the sent draft and reporting successful local receiver checks against its fixtures and signature example. This is partner-reported validation, not a deployed end-to-end test. Andy will provide the receiver URL after his automated/manual checks. Original sent documents remain immutable.

## Shipping is required at launch

Andy explicitly requires `shipment.updated` and `order.shipped` at launch because LTL will initially purchase labels and his customers need tracking. Promote these existing draft event shapes from follow-up scope into launch acceptance. Hold/resume/cancellation remain deferred. No envelope, X-Pathfinder header, HMAC, revision or retry change is requested.

The local event producer currently supports only `order.received`, `order.action_required` and `order.confirmed`. Shipping implementation, authoritative source mapping and end-to-end verification remain open; this document does not claim activation.

Required next shipping work:

Live source inspection of two Marcus-supplied orders is recorded in [SHIPPING_SOURCE_VERIFICATION.md](SHIPPING_SOURCE_VERIFICATION.md). It confirms package-versus-line report differences and identifies an unresolved completion discrepancy; it does not establish launch readiness.

- Bind authoritative shipment records to the verified customer, receipt, Lift association, external line IDs and shipped quantities. Use stable shipment identities and committed revisions; preserve existing outbox signing/retry/deduplication behavior.
- Emit package-level tracking/state/corrections through `shipment.updated`. Label creation or receipt of a prepaid label is not evidence of dispatch.
- Emit `order.shipped` only when all expected non-cancelled quantities are authoritatively accounted for as shipped. Unknown completeness must not be inferred from a tracking number, one package or a missing row.
- Support tracking regardless of who purchased the label. For prepaid labels, verify how Andy's tracking/carrier/package references reach the authoritative shipping record. The current source label URL alone is insufficient; do not infer tracking from a URL or silently change the accepted intake contract. Any needed explicit fields require a reviewed additive contract update.
- Test partial/multiple packages, corrections, duplicate/out-of-order events, retries/recovery, tenant isolation, purchased and prepaid labels, and withheld full-shipment events when evidence is incomplete. Delivery progress requires a verified source before being promised.

## Sandbox access and secure handoff

Andy requested a test signing secret/key ID and sandbox intake URL/credentials. The checked-in intake router remains unmounted and local/test-only; no deployed sandbox URL or active credentials have been verified. Fixture secrets are public test vectors and must never be issued as real credentials.

Provision test-only inbound credentials separately from outbound webhook signing keys. Bind them to the correct integration/store/customer scope and record revocation/rotation ownership. Register Andy's reviewed receiver URL through trusted configuration. Verify deployed sandbox health, authentication/isolation and a sanctioned round trip before describing access as ready.

After provisioning, deliver secrets through a recipient-scoped secure share with expiration (single-use access where supported), not ordinary email/chat/SMS. Normal email can carry the non-secret key ID, sandbox URL and instructions. Do not paste secrets into this repository or the email draft. No secret was generated, shared or sent by this update.

## Artwork and support address

Accept Andy's RGB-derived PDF as a validation sample with its profile intact. Retain exact original bytes and verify the supplied approval/file checksum. Separately assess color/profile and production acceptance: current metadata inspection does not establish RIP/color suitability and should not convert the approved original.

`pathfinder@vornan.co` is the fixed initial internal intake-notification recipient in `apps/api/src/intake-assurance.ts`, documented by Intake Assurance. It is not Andy's webhook destination or a credential recipient. Mailbox delivery, ownership and monitoring are not established by that code and need operational confirmation.

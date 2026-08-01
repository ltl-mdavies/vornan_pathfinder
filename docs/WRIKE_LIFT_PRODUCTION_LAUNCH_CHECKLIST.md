# Wrike to Lift production launch checklist

This runbook covers the first supervised production submissions from a Wrike Placard Order through Pathfinder to Lift. It is intentionally reusable across orders and does not contain customer files, URLs, credentials, or payload values.

## 1. Prepare the route

- Confirm the Wrike Import Method is active and points to the intended campaign folder, ready status, Print Vendor field, workbook rules, product-resolution rules, and output route.
- Confirm every positive-quantity workbook line resolves to an active Lift product. Blank and zero-quantity rows must remain excluded.
- Confirm required field mappings and derived composites, including the line-description composition, are saved for every configured workbook section.
- Confirm Lift has mapped Pathfinder's generic order fields for the artwork folder, source order grid, and reference proof.
- Confirm the selected target environment and submit profile are the intended supervised target. Never infer the target from a browser-supplied destination.

## 2. Generate and review one preview

- Run the non-submit Wrike intake for the exact approved task.
- Review the canonical order, line count, quantities, resolved product identifiers and Lift product names.
- Review the generated Lift payload, including the three generic URL fields when present.
- Require exactly one qualified order workbook and no more than one qualified reference PDF.
- Refresh submit certification after the last mapping, payload, route, publication, or target change.
- Record the displayed reviewed-payload fingerprint. A changed payload, request, or document set must produce a different fingerprint and require a new review.

## 3. Open a bounded submission window

- Enable only the gates required for this exact supervised submit window.
- Keep automatic polling, Wrike write-back, customer/public Proof actions, and unrelated Lift write capabilities disabled.
- Keep `AllowLiveCustomerSubmit=false` unless a separately reviewed launch explicitly requires otherwise.
- Confirm immutable document publication is enabled only when the reviewed order includes Pathfinder delivery URLs.
- Confirm both `go.vornan.co` URLs return the exact files with HTTP 200, no redirect, and no authentication challenge.

## 4. Submit exactly once

- Use the reviewed job's **Submit to Lift** action only after certification is green.
- Pathfinder must revalidate the current S3 object version, immutable metadata, publication expiry, HTTP 200 response, no redirect, and content length immediately before the Lift request.
- Pathfinder must durably reserve the exact reviewed attempt before transport. Only the reservation winner may call Lift.
- Never manufacture a new idempotency key or retry an identical reviewed payload.
- Treat timeouts, transport errors, throttling, 5xx responses, or accepted responses without a Lift order number as **Submission Uncertain**. Do not resend them automatically or manually.

## 5. Reconcile the result

- For a confirmed response, record the Lift order number and use the configured Lift order lookup to verify the created order.
- Confirm the expected line count, products, quantities, descriptions, artwork-folder value, and source-document fields in Lift.
- The current Lift read API does not prove that Lift downloaded the attachments. During supervised launch, confirm attachment ingestion in Lift with the integration owner.
- For an uncertain attempt, preserve the attempt and published documents, inspect Lift using the exact external/order identity, and resolve the attempt before generating another preview.
- For a deterministic rejected request, correct the cause and generate a new preview and reviewed fingerprint. Do not reuse the rejected payload blindly.

## 6. Close the window

- Restore temporary Wrike discovery, evidence, manual-intake, and document-publication gates to their intended production posture.
- Confirm no unintended Wrike write, Lift call, Proof action, or background job occurred.
- Preserve the job, reviewed fingerprint, submit attempt, sanitized document-preflight evidence, and audit history.
- Confirm direct delivery URLs follow the configured retention policy; do not extend retention through retries or preview replays.

## Stop conditions

Stop without submitting when any of these is true:

- unresolved or inactive product mappings;
- unexpected workbook section, header, positive-quantity line, or line count;
- missing or duplicated order-grid/reference-proof URL in the Lift payload;
- document publication expired, changed version, changed metadata, redirected, or did not return HTTP 200;
- reviewed-payload fingerprint is missing or changed;
- an existing attempt for the same reviewed fingerprint is uncertain or otherwise already sent;
- target, company, credentials, gate state, or Lift mapping cannot be positively identified.

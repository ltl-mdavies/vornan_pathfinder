# Sticker Press controlled artwork delivery — October 16

Approved scope: publish the three retained original PDFs, review the final Lift payload, and enable the existing SPM-D2611133 job for a controlled test. This does not authorize pressing Submit to create a Lift order.

## Publication and payload

Three originals published and downloaded over HTTPS; exact SHA-256 and byte counts match retained approval evidence. No conversion, tagging, or preview substitution. Objects use versioned `d/ja_<evidence hash>/ARTWORK.pdf` keys in the existing delivery bucket; immutable manifests use a separate `json-intake/artwork-publications/` prefix in source evidence storage. Existing CloudFront `d/*` origin and access control are unchanged.

The direct URLs are bearer-access links. They are not signed URLs and the CDN does not enforce an exact expiry timestamp. The existing enabled 14-day S3 lifecycle applies to `d/`; deletion is asynchronous. Recorded conservative retention deadline is October 30. The reviewed submit window ends October 23 at 23:59:59 UTC, and final preflight refuses later submission. Retained private originals remain separate. A later window requires publication/evidence review and a new reviewed fingerprint; preflight never silently republishes.

Final payload: customer 174094, PO SPM-D2611133, three lines D2611133-1 through -3, product 374549 from the customer product map, White Bopp (Sticker), Gloss Laminate (.75 mil), inch dimensions and original checksums. No calculated prices or invented due dates. Customer product identity is not embedded in the reusable output template.

Private payload SHA-256 (stable JSON): `5ca2f354cb72af5f136063ac3ec0743a735fbed0921083888bfc1f40a2375afd`. Private payload, publication manifests, before snapshots and conditional activation plan are under `outputs/stickerpress-artwork-2026-10-16/`, excluded from Git.

## Submission safeguards

Optional JSON artwork binding is included in the existing reviewed-request fingerprint. The JSON bridge fails closed if the binding is missing, malformed, belongs to another receipt/customer/route/profile/line, replaces an original with a preview, or has an expired review window. The final check validates the authoritative manifest, current S3 object version, metadata, exact downloaded bytes, and unchanged job within a 30-second deadline. It makes no writes. Existing Wrike and prepaid paths retain their behavior and fingerprint compatibility vector when this binding is absent.

The scoped activation transaction updates only this existing Waiting job, the new Ecomm route, and the new Ecomm template status. Other profiles on the new Ecomm route are disabled; only the Sticker Press test profile is enabled. Current exact data and receipt-pointer conditions prevent overwriting concurrent changes. No source receipt, webhook, High End Work route, connection credential, scheduler, or global submit gate changes. Normal API certification must refresh the real current masked request before the UI offers submit.

## Release baseline and review

Fresh main baseline: `5f7393309b0a90af734f3ffe5ff9405d543cd33e`. Live API artifact: `api/pathfinder-api-lambda-5bb4c166a058267bfa98e6dc485fc01e0a429213.zip`; downloaded archive SHA matches live Lambda CodeSha256 `vzQHlmwL4e9MrS7qlGCpR7+oZVd9s62hoqyVfRdEnGk=`. Exact prior package and current stack/environment snapshots retained privately for rollback.

Full deployed-to-candidate review: additive JSON intake/webhook modules were previously merged but deployed only in isolated sandbox functions. Shared API changes introduce optional prepaid/artwork preflight and fingerprint fields, extract the unchanged High End seed into lift-output-templates, add optional ecommerce canonical registry fields, and export explicit ecommerce projection helpers. Existing generic Lift generator and transport remain unchanged. The pdf-lib dependency is for isolated artwork workers; no pdf-lib/parser/sandbox Lambda entrypoint appears in the packaged shared API. Intervening Status work changes the shared frontend renderer and synthetic tests, not the API runtime; no frontend deployment is planned.

Validation before release: root typecheck/build; workspace tests (746 API tests before the added deadline test, all passing); 166 deployment contract tests; API and Proof packaging; 17 synthetic browser regressions. New focused tests cover immutable retry, wrong/missing/stale bindings, swapped lines, preview substitution, corrupt manifest/version/download, legacy fingerprint compatibility and stalled-storage deadline. Exact final candidate CI and deployment evidence are recorded after release below.

API-only release uses the current live CloudFormation template plus one read-only IAM statement: s3:GetObject on source-evidence/json-intake/artwork-publications/*. Existing source-evidence permission is wrike/* only. Preserve all existing parameters except LambdaCodeS3Key. Review the change set for exactly API function Code and API role Policies; no replacement or other resource change. Do not run the broad deployment script with historical defaults. Rollback uses the same code-key-only operation with the verified prior artifact. Configuration activation rollback disables only the new Ecomm route/profile and returns only the unsubmitted test job to Waiting, preserving current shared target settings and published evidence.

## Outcome

Publication and read-only activation rehearsal completed. Shared API deployment and activation are pending at this commit. No Lift order has been submitted.

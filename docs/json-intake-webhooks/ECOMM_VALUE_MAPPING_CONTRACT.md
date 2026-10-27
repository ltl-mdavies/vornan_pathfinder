# Shared Ecomm output value mapping — coordination contract

Prepared October 27 with Pathfinder UX and Development. This is an implementation contract for the next shared slice, not an activated service.

## Ownership and current state

UX's CVO policy register and CSV-backed lookup references exist in its isolated review preview. Sticker Press currently uses backend preparation-specific mappings. Neither is a shared production mapping service. Product bindings and business evidence belong upstream; the reusable Ecomm template serializes resolved values and must not acquire customer-specific constants. High End Work is outside this migration.

UX owns visible mapping/review requirements; Development coordinates shared backend schema and release; JSON Intake owns source adaptation and receipt/job provenance. Jason confirms destination field/ID behavior. Do not independently replace either map with a second competing global registry.

## Required mapping record

Version and immutable mapping identity; target system/company/interface/template; destination field path and wire type; customer/route/product applicability where necessary; canonical source value and explicit aliases; destination label and ID; Active/retired state; evidence source and SHA256; confirmation date/owner; effective version. Separate material identity, product identity and LOV identity namespaces even when all are decimal IDs.

Resolution must reject missing, ambiguous, inactive or incompatible values. Scope precedence must be explicit and unique; there is no arbitrary first-match or global fallback. Preserve source business values separately from destination IDs. Record applied mapping IDs/version/hash with every new prepared job and include that snapshot in reviewed submission integrity. A mapping update does not rewrite existing or uncertain jobs; refresh only an unsubmitted draft through explicit re-review.

## Known destination contracts

| Output path | Semantic value | Lift wire value | Scope/evidence |
| --- | --- | --- | --- |
| lines[].product_id | Sticker Press Sticker | string 374549 | Andy's approved single-product binding |
| lines[].production.material | White Bopp (Sticker) | string 355948 | Confirmed Materials Library identity |
| lines[].production.material | Clear Bopp (Sticker) | string 362180 | Confirmed Materials Library identity |
| lines[].production.laminate | Gloss Laminate (.75 mil) | string 354498 | Confirmed Materials Library identity |
| lines[].production.laminate | Matte Laminate (.71 mil) | string 354757 | Confirmed Materials Library identity |
| lines[].approval.proof_status | Approved | string 5217817 | ecomm_product_status.csv; Marcus confirms bypass trigger |
| lines[].approval.proof_status | Pending | string 5217816 | Same CSV; never permission to bypass |

Approval CSV SHA256: d7f75e973995c71e427a94c430b5e882295cfea9c098680305ea6546a954c312. UX confirms CVO uses the same two approval identities, but each workflow must independently verify approval against the exact production artwork. Do not infer approval merely from customer/product membership or a numeric source value.

Jason's exact receiving paths and ID types still require the fresh interface test. Existing canonical approval source path is `lines[].proof_status`, rendered as `lines[].approval.proof_status`. The distinction between source and output paths is intentional.

## Shared migration acceptance

Current main has route-level `ValueNormalizationRule` and `applyValueNormalizationToLiftPayload` in `packages/lift-adapter/src/index.ts`: the resolver picks the first matching rule, skips missing values, and supports pass-through/default behavior. These semantics are insufficient for the strict identity contract above without further validation; do not activate a new shared identity map by merely filling that table. Inventory field traversal and all call sites before choosing whether to extend or wrap it. Prove parity with the existing Sticker Press mapping and CVO preview on independent fixtures; then bind both to a single versioned resolver. Inspect canonical types rather than inserting IDs into booleans: UX reports white-ink boolean versus LOV IDs 1/2, plus spacing and roll-method LOV projections needing explicit destination treatment. Do not broaden this approval change to those unresolved fields.

Test conflicting scopes, explicit aliases, missing/retired mappings, source immutability, stale mapping version at submit, existing-job replay, numeric-string serialization and High End Work byte-for-byte output regression. Expose source label, resolved destination label/ID, version and actionable error in UX; keep implementation metadata out of customer-facing order flows.

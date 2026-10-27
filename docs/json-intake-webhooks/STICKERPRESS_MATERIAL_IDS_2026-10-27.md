# Sticker Press material and laminate IDs

Marcus approved the following Materials Library name→Lift material identity mappings on October27. They supersede the earlier White BOPP Sticker / Gloss text aliases for new Sticker Press preparation:

| Incoming field | Incoming name | Output field | Lift ID |
| --- | --- | --- | --- |
| material | White Bopp (Sticker) | lines[].production.material | 355948 |
| material | Clear Bopp (Sticker) | lines[].production.material | 362180 |
| finish | Gloss Laminate (.75 mil) | lines[].production.laminate | 354498 |
| finish | Matte Laminate (.71 mil) | lines[].production.laminate | 354757 |

IDs serialize as decimal strings under the existing canonical/template field contract. No material_id/laminate_id fields or duplicate display-name fields are added. Product ID374549 stays unchanged. Jason's import interface must consume these values as material identities; earlier text-alias import results do not prove the new ID-based import end to end.

Source: MaterialsLibrary_DB live-sheet verification relayed by Pathfinder UX, October27, and Marcus's explicit mapping approval in the JSON Intake chat. Sticker substrates SUB-WB-13/SUB-CB-13; standard finishing FIN-LAM-GLOSS-0p75/FIN-LAM-MAT-0p71. No new material/product compatibility inference or heavy-laminate substitutions.

Implementation is upstream in mapStickerPressReceiptToCanonical, scoped to customer174094, integration stickerpress-sandbox, store ltlco, environment test, Ecomm route and product374549. Original receipt/source_line values, artwork, pricing, fingerprint and retained assets are untouched. Existing canonical laminate takes precedence over legacy finish; missing/unrecognized values stop new preparation with an explicit mapping error. Other source aliases need separate review. Historical intake/replay remains readable; the durable operator returns existing jobs without rebuilding them, including previously submitted text-alias snapshots.

New jobs record production_mapping_version=stickerpress-material-ids-2026-10-27-v1, included in their configuration hash. The provenance field is optional for historical jobs. Generic Ecomm/High End templates, product mapping, target, route and connection records are unchanged. This operator preview/new-job preparation source is not mounted in live API/workers; no shared service deployment or production mutation is required. Use merged source for the next controlled preparation. No order submission, callback or rewrite of A0233832 is part of this change.

Verification: all four material/laminate combinations survive Ecomm payload generation as IDs; missing/unrecognized values reject; precedence, original source/configuration immutability, unchanged product, tenant/route boundaries and historical job replay are tested. Focused37 tests and API typecheck pass; complete PR CI is required before merge. A fresh controlled Lift import remains the receiving-interface verification step.

# Pathfinder UX ownership and review

Effective October 29, 2026, by Marcus's explicit direction in Pathfinder UX.

## Ownership

Pathfinder UX owns UI/UX design and continuity decisions across Pathfinder Development, Customer Price Sheet & Portal, Vornan Proof Development, and Pathfinder JSON Intake & Webhooks. Feature implementation stays with its owning chat. Catalog, price sheet, customer portal and their CVO integration work now belong to Customer Price Sheet & Portal; Pathfinder UX remains the design reviewer rather than the feature-building chat.

| Chat | ID (host: local) | Responsibility |
|---|---|---|
| Pathfinder UX | 01a16a35-2fc7-7a62-8945-f6c7f25a1638 | Design authority, visual and interaction continuity, UX approval |
| Customer Price Sheet & Portal | 01a16ef3-ff67-7952-9be7-30aa2e177d22 | Catalog/price sheet/portal feature and data work; catalog-driven CVO review |
| Pathfinder Development | 019fed7e-564d-7080-9719-ac8c8bcf334c | Main app implementation, integration and releases |
| Vornan Proof Development | 019fed7e-564b-7141-992d-bf856a4ca509 | Proof implementation and lifecycle |
| Pathfinder JSON Intake & Webhooks | 01a0e8a0-6bf4-7be3-8739-becb814ba52c | Intake/webhook implementation and contracts |

## Required review process

All UI/UX work in these chats requires Pathfinder UX approval. Bring proposed screens/flows to UX before treating design choices as final; submit the implemented result for approval before merge or deployment. Existing approved patterns can be reused, but their application in changed screens still needs review. Pure backend work without user-visible design/interaction changes can continue independently.

A review packet should include the problem, affected screens and roles, before/after screenshots or a runnable preview, key interactions and states, and any deviations from approved patterns. Include 1366×768 and a larger desktop view for relevant desktop screens. Cover loading, empty, error, disabled, validation, unsaved changes and recovery states where applicable. Keep the packet proportional to the change.

Record approval with the reviewing chat, date, exact screenshots/artifact or source revision, approved scope and any required fixes. Approval of one slice does not approve later design drift. No response is not approval. UX approval does not authorize production release, resolve business mappings, or lift submission holds. Marcus remains the final product decision-maker and may explicitly revise this process.

Messages to other chats must follow tool authorization requirements. Marcus explicitly requested distributing this handoff and ownership plan; this document is not a blanket authorization for unrelated autonomous messaging. If a later chat cannot directly request review, prepare the packet for Marcus to bring here. This is a documented workflow, not an automated enforcement gate.

## Approved design baseline

- Vornan branding and Vornan.co provide brand continuity; Proof is the primary clean UI reference. Consult assets/brand/Vornan-Brand-Guidelines.pdf in the current source checkout and approved app styles.
- Plus Jakarta Sans, Forest/Stone/Zinnia palette, restrained decoration, consistent navigation and component behavior.
- Preserve vertical working space. Compact headings/toolbars; real table content takes priority over ornamental headings, filler and developer explanations.
- Comfortable spacing and clear hierarchy, not maximum density everywhere. Scale evenly from 1366×768 to larger browsers.
- Tasteful KPI/charts belong on overview screens when the data helps the task.
- Consistent customer tab order: Overview, Jobs, Proof, Catalog, Import methods, Output product map, Manual import, Settings. Intake exceptions belong with import workflows unless a later approved design changes this. Preserve role/feature restrictions without reordering the remaining tabs.
- Catalog list and cards, density choices, search/filtering and remembered per-view page size (list default 50; cards default 24). Finishing is subdued metadata near material, not a competing green heading.

Companion transfer: docs/handoffs/2026-10-29-customer-price-sheet-portal.md.

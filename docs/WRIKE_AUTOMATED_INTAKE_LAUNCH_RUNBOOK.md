# Wrike automated intake launch runbook

This runbook covers the production launch boundary for Momentara Placard Orders. It is intentionally separate from shipping-file intake, Proof actions, and public customer actions.

## Production behavior

- Pathfinder checks the configured GPA Campaigns scope every 15 minutes.
- Every eligible Placard Order is handled as an independent order candidate. More than one order in a polling window produces separate preview jobs.
- Scheduled intake captures the qualified workbook and one qualified reference-proof PDF, stores immutable evidence, and publishes direct HTTP 200 copies through `go.vornan.co`.
- Scheduled intake creates preview jobs only. It never submits an order to Lift.
- Exact evidence replays reuse the existing preview instead of creating a duplicate.
- One failed candidate does not prevent other candidates in the same bounded polling run from being prepared.
- EventBridge does not automatically retry a failed invocation. The next 15-minute poll can safely re-evaluate eligible evidence.

## Status-link writeback

Automatic status writeback is independently default-disabled. When enabled, it applies only to jobs first created by scheduled polling for the exact configured customer and Import Method.

After an operator submits a prepared job and Pathfinder confirms a Lift order number, a later poll can post one Wrike comment:

```text
Larger Than Life print order created successfully via Pathfinder.
Lift order #A0000000.
View live order status: https://status.vornan.co/…
Contract: C000000
```

The comment is durably claimed before transport. A posted, failed, or submission-uncertain writeback is never automatically retried. Historical jobs and manual imports are excluded.

## Contract Number fanout

The Lift output template can map one canonical value to more than one destination field. For Momentara:

1. Keep the existing destination Contract Number field mapped to `order.contract_number`.
2. Map the destination PO Number field to the same canonical value, `order.contract_number`.
3. Save the output template and generate a fresh preview.
4. Confirm the preview payload contains the same contract value in both destination fields before submitting.

This is output-template configuration, not a Momentara-specific code rule. Other targets can fan out a canonical order value the same way.

## Final pre-launch rehearsal

1. Confirm customer `284619` and Import Method `method-1784901795973` are active.
2. Confirm the GPA Campaigns folder, Placard Order ready status, Print Vendor rule, workbook structure, product mappings, and output route are saved.
3. Deploy the scheduler and automatic writeback parameters as `false` first.
4. Verify the production API remains healthy and no schedule rule exists.
5. Enable scheduled intake for the exact customer and Import Method, with evidence capture, preview creation, and document publication enabled.
6. Keep automatic status writeback disabled for the first poll.
7. Allow the pending order to be discovered by the 15-minute schedule; do not prepare it manually first.
8. Confirm exactly one preview job appears with the expected contract, workbook, reference PDF, line count, product resolution, `go.vornan.co` document URLs, and Contract Number fanout.
9. Submit the order only after the payload review and normal operator confirmation.
10. Confirm the Lift order number and direct attachment downloads.
11. Enable automatic status writeback, or use the existing exact-task manual writeback for this final test.
12. Confirm exactly one comment appears on the matching Wrike Placard Order and its status link loads.
13. Leave scheduled intake enabled for launch only after a second poll proves the same Wrike evidence is replayed and no duplicate job/comment is created.

## Rollback

Set `WrikeScheduledIntakeEnabled=false` and `WrikeScheduledStatusWritebackEnabled=false`. This removes the EventBridge rule and Lambda invoke permission without deleting captured evidence, preview jobs, audit state, or existing Wrike comments.

## Deferred shipping intake

Shipping Information remains a separate, default-inactive intake lifecycle. Its future implementation will locate the campaign's Shipping Information task, capture its qualified XLSX attachment, publish it through `go.vornan.co`, and update configurable Lift order-header fields. Shipping availability is not required for initial order creation and does not block the Monday order-intake launch.

# Pathfinder Origin Acknowledgement Model

This note records how Pathfinder should communicate with origin systems when an order is received before downstream target submission is complete.

## Principle

Pathfinder should separate these events:

- `Received by Pathfinder`: the origin system successfully delivered an order to Pathfinder.
- `Accepted by Target`: the downstream target, such as Lift ERP, accepted the rendered submit request.
- `Completed`: any later production/order lifecycle status after target acceptance.

An origin system should not receive a final success response just because Pathfinder received the order. A downstream target can still reject the order because of product mapping, credentials, duplicate external IDs, customer IDs, payload shape, or target availability.

## Recommended Inbound API Behavior

For API, webhook, or automated imports:

- Return `202 Accepted` when Pathfinder receives and persists the inbound order/job.
- Include stable identifiers:
  - `pathfinder_job_id`
  - `pathfinder_canonical_order_id` when available
  - origin `source_record_id`
  - current Pathfinder state
- Do not block the origin request while waiting for Lift unless a specific synchronous integration requires that contract.
- If the inbound payload cannot be persisted at all, return a synchronous `4xx` or `5xx` with a clear error.

## Downstream Submit Failure

If Pathfinder receives the order but Lift submit fails:

- Keep the Pathfinder job.
- Mark the job `Submit Failed`.
- Persist a Submit Attempt with:
  - masked request
  - raw target response when available
  - translated operator message
  - suggested action
  - retryable flag
- Surface the job in a failure queue for manual correction and replay.

## Optional Outbound Notification

When the origin platform supports callbacks, Pathfinder can later send:

- `received`
- `submit_failed`
- `submitted`
- `completed`

Until callback behavior is explicitly configured per origin/import method, operators should resolve and replay downstream submit failures inside Pathfinder without assuming the origin system was notified.


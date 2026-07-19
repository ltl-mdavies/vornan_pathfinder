# Lift Order Name Strategy

## Implementation Status

The first configuration/resolution slice is implemented in the current working tree. It targets canonical `order.order_title`, preserves the existing Lift JSON mapping, provides an Import Method live preview, and keeps historical methods in disabled legacy pass-through until explicitly enabled. Cross-job reservations and real Lift submission remain out of scope pending confirmation of Lift's uniqueness contract.

## Recommendation

Treat the Lift order name as a resolved canonical value, not as an output-template-only expression.

Pathfinder should use the existing canonical `order.order_title` as the resolved order-name destination. The current Lift adapter already emits that value as `order.order_title`, and the seeded output template already maps `{{order.order_title}}` into the Lift JSON. Add a separate canonical `order.order_name` only if the verified Lift contract proves that the required unique name is a different payload field.

The recommended default is **customer value with deterministic composite fallback**:

1. Use the customer-provided order name when it is mapped, valid, and available.
2. Otherwise compose a name from stable canonical values such as destination customer code, external order ID, and an optional customer order/ship date.
3. Apply an optional configured prefix or suffix.
4. Normalize and validate the final value against confirmed Lift character and length constraints.
5. Detect duplicates within the current import so a conflicting candidate cannot be submitted silently.

Example:

```text
MOM-30904511-20260623
```

The external order ID should normally carry the uniqueness signal. A customer/date component improves global scoping and readability, but the current processing timestamp should not be used by default because retries would generate a different order name.

## Proposed Import Method Setup

Add an **Order Name Resolution** step to Import Methods after field mapping and before preview:

- Strategy:
  - `Customer-provided value`
  - `Composite value`
  - `Customer value, then composite fallback` (recommended)
- Customer-provided canonical field/source mapping.
- Ordered composite components selected from mapped canonical fields.
- Optional static prefix and suffix.
- Separator, casing, whitespace, and date-format controls.
- Confirmed Lift maximum length and allowed-character policy.
- Live example using the current sample/detected input row.
- Clear final canonical value and output-template destination preview.

Suggested persisted configuration:

```json
{
  "strategy": "provided_then_composite",
  "provided_field": "order.order_title",
  "components": [
    { "field": "customer.destination_customer_id" },
    { "field": "order.external_order_id" },
    { "field": "order.ship_date", "format": "yyyyMMdd", "optional": true }
  ],
  "prefix": "",
  "suffix": "",
  "separator": "-",
  "case": "upper",
  "duplicate_behavior": "block"
}
```

Composite components should reference canonical paths rather than raw workbook columns. That keeps the rule stable when a customer's source header changes and makes the relationship between input mapping, canonical data, and output mapping explicit.

The resolver runs after source-to-canonical field mapping and writes its final value to `order.order_title`. The output template then continues to control the exact Lift payload destination. This preserves existing mapping behavior while allowing customer-specific naming rules.

## Uniqueness And Retry Safety

Lift uniqueness should be handled as an idempotency problem as well as a formatting problem.

- The first implementation should detect and block duplicate resolved names within the current import/job.
- Keep the resolved title in preview jobs and submit snapshots for audit and replay.
- A retry with the same source data must resolve to the same title.
- Add a persistent reservation keyed by target/company and normalized name only when Lift's real uniqueness scope and lookup behavior are confirmed.
- A later reservation layer should associate the name with the canonical order ID, external order ID, and Pathfinder job.
- If another canonical order owns a reserved candidate, append a short deterministic suffix or block for operator review according to route policy.
- Use an atomic/conditional DynamoDB write for that later reservation layer so concurrent imports cannot reserve the same name.
- If Lift exposes a reliable name lookup, use it as a preflight check, but do not rely on a remote lookup alone for concurrency control.

Avoid random values and current timestamps as the primary collision solution. They make retries non-idempotent and make it harder to determine whether two Lift orders came from the same customer order.

## Canonical And Output Mapping

The initial canonical and output flow is:

```text
Customer fields -> canonical field mapping -> order-name resolver
  -> order.order_title -> output template -> Lift order.order_title
```

Implementation steps:

1. Keep ordinary source field mapping able to populate `order.order_title` directly.
2. Run the configured resolver after source-to-canonical mapping so it can preserve or replace that value according to strategy.
3. Validate the resolved value and current-import uniqueness before generating the payload preview.
4. Retain the existing Lift adapter and seeded output-template mapping.
5. Show the final canonical value and Lift output path in the Import Method preview.

Only if Lift confirms a distinct required field:

1. Add the core canonical field `order.order_name` with aliases such as `Order Name` and `Lift Order Name`.
2. Add the exact Lift payload field to the Lift adapter and seeded output template.
3. Redirect the resolver and preview to that new canonical/output destination.

Do not replace `order.external_order_id`: it remains the source identity and Lift `Ext_ID`/header match.

## Delivery Slices

1. Add Import Method order-name configuration and a live preview targeting `order.order_title`.
2. Resolve the title during canonical generation and preserve the existing output-template/Lift preview flow.
3. Add validation for provided, composite, fallback, retry, current-import duplicates, truncation, and legacy-method behavior.
4. Confirm Lift's exact uniqueness scope, maximum length, character rules, and lookup behavior.
5. Add local and DynamoDB-backed reservations with deterministic collision handling only if the confirmed contract requires cross-job enforcement.
6. Enable the rule for a sandbox route before any real Lift submit.

Real Lift submission remains out of scope until the payload contract and collision behavior are verified.

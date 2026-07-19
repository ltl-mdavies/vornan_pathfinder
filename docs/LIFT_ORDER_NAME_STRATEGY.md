# Lift Order Identity Strategy

## Implemented Approach

Pathfinder treats the readable Lift order name and Lift `Ext_ID` as two separate concerns.

### Readable order name

The Import Method resolves a value into canonical `order.order_title`, which the existing output template emits as Lift JSON `order.order_title`.

The recommended pattern is:

```text
<customer order, contract, or PO value> - <configured text> - <submission date>
```

Example:

```text
123987 - Empirical Web Order - 20260819
```

Composite components are ordered and can be either:

- a canonical field such as `order.external_order_id`, `order.contract_number`, or `order.po_number`;
- operator-entered fixed text such as `Empirical Web Order`;
- a canonical date such as `source.submitted_at`, formatted as `yyyyMMdd`.

The customer-provided, composite, and customer-value-with-composite-fallback strategies remain available. Existing Import Methods retain legacy pass-through until explicitly enabled.

Pathfinder does not ask operators to configure an unverified Lift naming contract. Maximum length remains unset unless a verified value is known.

### Duplicate-name retries

The initial resolved name is deterministic and remains unchanged across ordinary retries. Pathfinder only changes it after Lift explicitly classifies the response as a duplicate order-name failure.

After that response, Pathfinder prepares—not automatically submits—the next job attempt with an incrementing suffix:

```text
123987 - Empirical Web Order - 20260819
123987 - Empirical Web Order - 20260819-1
123987 - Empirical Web Order - 20260819-2
```

Authentication, endpoint, payload, product, timeout, and duplicate-`Ext_ID` failures do not change the order name.

## Pathfinder Order Number and Lift Ext_ID

Pathfinder now treats its own Order Number as the safe default identity for new Import Methods. It is intentionally separate from the readable order name and from identifiers supplied by the customer.

The recommended flow is:

1. Reserve one compact `PF` number when a preview job is created.
2. Persist that number with the job snapshot.
3. Write the same number to Lift request header `Ext_ID` and JSON body `order.ext_id`.
4. Reuse it for every retry of that job.
5. Retain the customer's order number, PO number, and contract number as canonical references and optional readable-name components.

Production reservations use a dedicated DynamoDB table and a conditional insert on the Order Number key. That makes uniqueness global across customers and submissions rather than relying only on timestamp/random collision probability. Local development maintains the same non-reuse behavior within the running process and also checks persisted jobs.

New Import Methods default to this `pathfinder_generated` strategy. Previously saved methods retain their existing strategy, including the legacy `customer_order_id` option. The legacy option remains available for an integration whose source order number is independently guaranteed unique in Lift.

The Pathfinder Order Number remains compact because existing Lift integrations commonly use short external IDs, but Pathfinder does not claim or enforce an unverified Lift maximum length.

Whichever strategy is selected, the Lift adapter writes the identical value to:

- request header `Ext_ID`;
- JSON body `order.ext_id`.

The primary Import Method screen recommends the Pathfinder-managed choice. Customer-title composition, formatting, and the legacy ID choice remain available without making them part of the everyday setup path.

## Data Flow

```text
Customer fields -> canonical mapping -> order-name resolver -> order.order_title
                                |                         -> Lift order.order_title
                                |
                                +-> Ext_ID strategy -> header Ext_ID + body order.ext_id
```

No real Lift submission is enabled by this work. Duplicate-name suffix preparation runs only after a genuine or explicit mock Lift rejection and still requires the operator to request the next submit attempt.

# Artwork Inspection Provider Contract

**Status:** Proposed provider-neutral contract

**Audience:** Pathfinder domain, API, provider-adapter, and operations implementers

**Authorization:** Documentation only; no provider call or runtime activation

## 1. Contract goals

The provider boundary allows Pathfinder to request a technical inspection of one immutable artwork version without coupling the catalog to one engine, protocol, or product name.

The contract must:

- accept structured product specifications instead of deriving expected size from filenames;
- preserve exact artwork, policy, adapter, and engine identity;
- support asynchronous submission and reconciliation;
- normalize a small common evidence vocabulary while retaining a private native report;
- distinguish provider state and technical verdict from human approval and business release;
- degrade safely when inspection is disabled or unavailable;
- support a future provider through a new adapter rather than shared-domain migration.

## 2. Normative rules

1. Pathfinder **MUST** authorize customer scope and asset safety before dispatch.
2. A request **MUST** bind an immutable artwork object version and SHA-256.
3. A request **MUST** bind an immutable specification and inspection-policy revision.
4. Filename parsing **MUST NOT** supply authoritative expected dimensions or scale.
5. Signed access URLs **MUST NOT** be persisted or logged.
6. A provider verdict **MUST NOT** set human approval, business release, Proof decision, or order eligibility.
7. A provider timeout after possible acceptance **MUST** enter reconciliation; it **MUST NOT** trigger blind resubmission.
8. A rerun against a different policy, adapter, or engine **MUST** create a new inspection record.
9. Provider-native reports **MUST** remain private, encrypted, access-controlled, and checksum-bound.
10. Inspection-disabled behavior **MUST** remain a successful catalog path, not an error.

## 3. TypeScript-facing port

The future pure contract package should expose a port comparable to:

```ts
export interface ArtworkInspectionProvider {
  descriptor(): Promise<InspectionProviderDescriptor>;

  submit(
    request: InspectionRequest,
    context: InspectionCallContext
  ): Promise<InspectionSubmission>;

  reconcile(
    reference: ProviderInspectionReference,
    context: InspectionCallContext
  ): Promise<InspectionObservation>;

  cancel?(
    reference: ProviderInspectionReference,
    context: InspectionCallContext
  ): Promise<InspectionObservation>;

  normalizeWebhook?(
    input: VerifiedProviderWebhook
  ): Promise<InspectionObservation>;
}
```

The orchestrator depends on this interface. It does not import a provider implementation.

## 4. Descriptor and capabilities

```ts
export interface InspectionProviderDescriptor {
  provider_key: string;
  display_name: string;
  adapter_version: string;
  engine_versions: string[];
  capabilities: {
    accepted_content_types: string[];
    maximum_bytes: number;
    maximum_pages: number | null;
    supports_async: boolean;
    supports_webhooks: boolean;
    supports_polling: boolean;
    supports_cancellation: boolean;
    supports_multi_page: boolean;
    priorities: Array<"normal" | "high">;
  };
}
```

`provider_key` is a stable registry/configuration identity. `display_name` is replaceable branding. Neither value may determine shared table, route, event, queue, object-key, or package names.

The adapter must reject requests outside declared capabilities before dispatch. Capability data is evidence, not permission; customer/workflow policy must also allow the request.

## 5. Request contract

```ts
export interface InspectionRequest {
  inspection_id: string;
  idempotency_key: string;
  customer_scope: {
    customer_id: string;
    catalog_id: string;
    catalog_product_id: string;
    workflow: "catalog" | "proof_shadow";
  };
  priority: "normal" | "high";
  asset: {
    artwork_asset_id: string;
    artwork_version_id: string;
    object_version_id: string;
    sha256: string;
    content_type: string;
    content_length: number;
  };
  specification: {
    specification_revision_id: string;
    width: number;
    height: number;
    units: "in" | "mm" | "cm";
    artwork_scale: {
      numerator: number;
      denominator: number;
    };
    target_dpi: number;
    bleed?: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  policy_revision_id: string;
  requested_engine_revision: string | null;
}
```

The adapter may receive transient credentials and a short-lived object-access mechanism through `InspectionCallContext`. Those values are call material only and do not enter the domain request, audit record, queue body, or result.

## 6. Submission and reference

```ts
export interface InspectionSubmission {
  status: "accepted" | "running" | "completed" | "rejected";
  provider_reference: string | null;
  observation: InspectionObservation | null;
  accepted_at: string | null;
}

export interface ProviderInspectionReference {
  inspection_id: string;
  provider_key: string;
  provider_reference: string;
  idempotency_key: string;
}
```

A provider reference is internal. Public/operator DTOs receive the Pathfinder inspection ID and safe status only.

## 7. Status and verdict

```ts
export type InspectionStatus =
  | "queued"
  | "running"
  | "reconciling"
  | "completed"
  | "failed"
  | "unavailable"
  | "cancelled";

export type InspectionVerdict =
  | "pass"
  | "warn"
  | "fail"
  | "indeterminate";
```

Status describes orchestration/provider progress. Verdict describes normalized technical evidence only.

Valid terminal combinations include:

| Status | Verdict | Meaning |
|---|---|---|
| `completed` | `pass` | Provider completed and found no policy-mapped technical concern. |
| `completed` | `warn` | Provider completed and found non-blocking or advisory concerns. |
| `completed` | `fail` | Provider completed and found a policy-mapped technical failure. |
| `completed` | `indeterminate` | Provider completed but common evidence cannot support pass/warn/fail. |
| `failed` | `null` | Deterministic technical/provider failure; no verdict. |
| `unavailable` | `null` | Provider could not be reached or used within the bounded window. |
| `cancelled` | `null` | Cancellation was recorded; prior observations remain retained. |

`reconciling` is nonterminal and represents a possibly accepted submission with an uncertain current outcome.

## 8. Observation and normalized evidence

```ts
export interface InspectionObservation {
  status: InspectionStatus;
  verdict: InspectionVerdict | null;
  provider_reference: string | null;
  provider_key: string;
  adapter_version: string;
  engine_revision: string | null;
  policy_revision_id: string;
  metrics: NormalizedInspectionMetric[];
  findings: NormalizedInspectionFinding[];
  native_report: {
    private_report_ref: string;
    sha256: string;
    schema_version: string;
  } | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: InspectionError | null;
}

export interface NormalizedInspectionMetric {
  key: string;
  value: number | string | boolean;
  unit: string | null;
  page: number | null;
}

export interface NormalizedInspectionFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message_key: string;
  page: number | null;
  region: Record<string, number> | null;
}
```

The initial common vocabulary should remain deliberately small. Adapter mapping is versioned. Provider-specific detail stays in the immutable native report rather than forcing every provider into an unstable universal schema.

## 9. Error contract

```ts
export interface InspectionError {
  category:
    | "provider_disabled"
    | "provider_unavailable"
    | "rate_limited"
    | "input_rejected"
    | "unsupported_content"
    | "timeout"
    | "submission_uncertain"
    | "authentication_failed"
    | "provider_error"
    | "normalization_failed"
    | "cancelled";
  reason_code: string;
  retry_disposition: "never" | "bounded" | "reconcile";
  correlation_id: string;
  occurred_at: string;
}
```

Errors are sanitized. Raw provider payloads, exception traces, credentials, URLs, storage identities, file content, and customer-sensitive artwork text are excluded from API responses and standard logs.

## 10. Idempotency, retry, and reconciliation

The idempotency key must deterministically bind:

- inspection ID;
- artwork-version checksum;
- specification revision;
- policy revision;
- provider key;
- adapter version;
- requested engine revision.

Rules:

1. Queue delivery may retry before provider acceptance.
2. Deterministic input rejection is not retried.
3. Transient pre-acceptance failures use bounded exponential backoff with jitter, a maximum attempt count, and a maximum message age.
4. Timeout or disconnect after possible acceptance becomes `reconciling`.
5. Reconciliation uses the provider reference or idempotency key before any resubmission is considered.
6. Ambiguity stops automatic progress and enters an operator-visible reconciliation path.
7. DLQ messages retain only safe identifiers and require operator reconciliation.
8. Cancellation is best effort and append-only.

## 11. Policy and provider selection

`InspectionPolicyRevision` is Pathfinder-owned and immutable. It must include at least:

- customer and workflow scope;
- mode: `disabled`, `advisory`, or `required`;
- provider key and optional engine constraint;
- normal/high priority selection;
- accepted content/size/page constraints;
- timeout, retry, and maximum-age limits;
- versioned mapping from native outcomes/findings to common verdicts;
- activation and expiration timestamps where bounded;
- author/reviewer audit.

Platform environment flags can disable dispatch globally or bound a pilot, but they are not the durable source of ordinary customer policy.

When policy is `disabled`, Pathfinder records `inspection_evidence=not_requested` and returns a usable artwork version if all asset-safety checks pass. When a configured provider is unavailable, the artwork version remains intact; advisory mode reports unavailable evidence without converting it to rejection.

## 12. Security and data handling

- Provider credentials belong in the existing target/environment secret-management pattern or an equivalent dedicated provider-secret boundary.
- Adapter roles receive least privilege for only the required object version and result location.
- Queue payloads use opaque IDs; they do not contain signed URLs or native reports.
- Native reports use private, versioned storage and checksum binding.
- All provider calls use correlation IDs and sanitized audit milestones.
- Customer ID is never a telemetry metric dimension where that would expose tenancy.
- Webhooks require signature verification, replay protection, timestamp bounds, payload limits, and provider-reference/customer reconciliation before normalization.
- Polling uses bounded intervals and terminates at policy deadline.

## 13. Priority and runtime isolation

The initial catalog workflow uses asynchronous `normal` priority. A future Proof shadow workflow may request `high` priority through the same contract, but queue/runtime activation remains a separate Proof-owned checkpoint.

Large files and CPU/memory-intensive rendering should run in an isolated container worker with:

- queue-controlled concurrency;
- per-job CPU, memory, scratch-space, object-size, page, and runtime limits;
- bounded downloads and no unrestricted network egress;
- queue-age, failure, DLQ, runtime, bytes-processed, and cost alarms;
- no unbounded automatic retry.

The API Lambda orchestrates and records work; it does not execute the inspection engine.

## 14. Contract acceptance criteria

A future implementation is conformant only when automated tests prove:

- a safe artwork version remains usable with inspection disabled;
- customer/specification/object/checksum mismatches fail closed before dispatch;
- idempotent redelivery does not create a duplicate provider job;
- post-acceptance timeout enters reconciliation without resubmission;
- new policy/adapter/engine runs preserve earlier evidence;
- provider failure cannot corrupt catalog or asset state;
- internal/public DTOs exclude credentials, signed URLs, object keys, and native payloads;
- no provider verdict changes human approval, business release, Proof, or Lift state;
- a second mock adapter implements the port without changing shared entities.

## Appendix A: First adapter facts and normalization

The first candidate adapter uses the working provider name **PixelGuard** and planning baseline `pixelguard-v1-handoff` at commit `a11c620ba3e9587e99d996443cc65ad108dea0ae`.

Initial provider-specific mapping, subject to direct code/licensing/fixture verification:

- native `PASS` maps to normalized `pass`;
- native `NEEDS WORK` is retained in the private native report and initially maps to normalized `warn` under the advisory pilot policy;
- Prepress-approved target DPI values are `40`, `72`, `150`, and `300`;
- AI-generated notes are not ingested;
- file export is not part of the adapter;
- the provider receives structured target dimensions and scale from Pathfinder;
- the provider must expose a deterministic headless entrypoint independent of Streamlit session/UI state.

The provider key should be a stable internal registry value with a separately configurable display name. A later rename must not require shared-domain, route, resource, event, or storage migration.

## Appendix B: Future adapter compatibility

A future Durst Workflow adapter may use synchronous APIs, asynchronous jobs, polling, or webhooks according to its declared capabilities. It supplies its own credentials, native report, engine revision, and versioned normalization map while implementing the same port. No catalog, artwork-version, inspection-policy, readiness, or shared API entity changes are permitted solely to add that adapter.

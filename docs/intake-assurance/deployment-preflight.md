# Offline deployment and rollback evidence checks

This read-only tool checks internal consistency of supplied evidence. It performs
no AWS, HTTP, GitHub, deployment, change-set, provider or workflow action. Passing
is **not** evidence of production provenance, a successful CloudFormation validation,
or authorization to deploy or activate. The existing hand-maintained API deployment
workflow remains held for Intake Assurance release.

Run the synthetic example locally:

```sh
node scripts/intake-deployment-preflight.mjs docs/intake-assurance/deployment-preflight.example.json
```

The example contains only synthetic settings. For later separately authorized
production preparation, supply a private JSON evidence packet with these fields:

| Field | Required evidence |
| --- | --- |
| `schema_version` | Exactly `1`. |
| `deployed_template` | Complete authoritative deployed template as a parsed JSON object, preserving its full content. |
| `candidate_template` | Complete proposed template as a parsed JSON object. |
| `current_parameters` | Full deployed parameter inventory; every deployed parameter exactly once with its string `ParameterValue`. Existing NoEcho masking is retained. Optional AWS `ResolvedValue` is accepted as opaque string metadata. |
| `candidate_parameters` | Every candidate template parameter exactly once. Use `UsePreviousValue: true` for unchanged existing parameters; use explicit string values only for declared changes/new parameters. |
| `rollback_parameters` | Every original deployed parameter exactly once, for use with the exact original deployed template. Explicitly restore changed original values; use previous values only for unchanged parameters. |
| `intended_parameter_changes` | Map of precisely intended changed/new parameter names to explicit string values. This is declared intent, not approval. |
| `current_environment` | Complete resolved deployed Lambda environment map, with string values. |
| `candidate_environment` | Complete resolved proposed Lambda environment map. |
| `rollback_environment` | Complete resolved rollback map, exactly equal to the current map. |
| `intended_environment_changes` | Map of intended additions/replacements to string values, or removals to `null`. |
| `evidence_sha256` | Exact field-to-digest map for the ten evidence fields above, excluding schema version and the digest map itself. |

Canonical digests use SHA-256 over UTF-8 `JSON.stringify` of recursively key-sorted
objects; array order is preserved. Digests must be 64 lowercase hexadecimal
characters. The module exports `evidenceDigest(value)` for packet preparation.
Bind each input to its independently collected/approved source before preparing
this map. The hashes catch accidental mixing or stale edits, but anyone able to
rewrite the packet and hashes can create a self-consistent packet: they do not
prove authenticity, collection time, stack identity or approval. Do not use the
synthetic fixture helper to manufacture production evidence.

The CLI requires strict JSON and rejects duplicate object keys. No source file,
parameter name/value, environment key/value, template excerpt, file path, raw parser
error or digest is printed. Success returns only counts, environment byte totals,
explicit `deployment_authorized: false`, and outstanding check categories. Failures
return a fixed diagnostic code and a nonzero exit status. Keep real packets outside
the repository: they can contain sensitive parameters and environment values even
though output is sanitized.

## Enforced preservation and rollback rules

- All three parameter inventories must be complete, unique and free of unknown
  keys. The candidate covers the entire candidate parameter set, including new
  parameters; rollback covers exactly the original set. No fallback to defaults.
- Every existing unchanged parameter, especially NoEcho, must use previous-value
  semantics. Both value forms, false previous-value flags and implicit omission
  are rejected. NoEcho changes/additions are unsupported by this preparatory tool.
- New parameters require explicit declared values even when the template has a
  default. Changed parameters must match declared intent exactly. A rollback of a
  changed original parameter must contain its original value, not `UsePreviousValue`
  (which would retain the newly deployed value). Masked restoration values fail.
- Removal of existing parameters, type changes, NoEcho changes, template transforms
  and parameter types beyond String/Number/CommaDelimitedList/List<Number> are
  unsupported and rejected. SSM parameter indirection is intentionally unsupported;
  the tool cannot prove the stability of externally resolved values.
- Candidate environment additions, removals and replacements must exactly match
  declared intent. Rollback must reproduce the complete original map. All three
  maps must contain resolved strings and fit the 4,096-byte UTF-8 key/value limit.
  Recognizable unresolved dynamic references or tokens are rejected.

## Required checks outside this tool

The validator does not evaluate resource intrinsics, parameter constraints or
CloudFormation rules, nor derive effective environment values from the template.
It cannot establish that environment maps are complete representations of the
actual function, that artifacts match a runtime, or that resources can be safely
reverted. Those require independently collected evidence and separate review.

Review the exact nonexecuting change set, parameter constraints, artifact provenance,
actual stack/function identity and freshness, runtime/template compatibility, Admin
Vite inputs, auth/customer pairing, table retention/import/name posture, IAM,
operational bounds, ownership and activation gates. A retained table can remain
outside stack management after rollback; restoring parameters alone is not a data
or resource rollback. Restore the original runtime and full environment together,
including legacy budget entries when reverting to a pre-compact runtime. Keep all
storage records and preserve separate deployment/publication/activation approvals.

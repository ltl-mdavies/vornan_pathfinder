import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import type {
  ProofDecisionCanonicalIntent,
  ProofDecisionLedgerRecord
} from "@pathfinder/proof-domain";
import type { LiftProofingApprovalAuthenticationEnvelope } from "../src/proofing-approval-auth-envelope.ts";
import {
  LiftProofingApprovalAttemptError,
  prepareLiftProofingApprovalAttempt,
  reconcileLiftProofingApprovalObservation,
  type LiftProofingApprovalAttemptContract
} from "../src/proofing-approval-attempt-contract.ts";
import {
  buildLiftProofingApprovalExecutionPlan,
  type LiftProofingApprovalExecutionPlan
} from "../src/proofing-approval-plan.ts";

const CREATED_AT = "2026-07-24T12:00:00.000Z";
const NOW = new Date("2026-07-24T12:05:00.000Z");
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const SYNTHETIC_JWT_HEADER = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
const SYNTHETIC_JWT_CLAIMS =
  "{\"iss\":\"https://www.lifterp.com/synthetic-proofing-client\",\"aud\":\"https://www.lifterp.com\",\"iat\":1784894400,\"exp\":1784895000}";
const SYNTHETIC_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3d3dy5saWZ0ZXJwLmNvbS9zeW50aGV0aWMtcHJvb2ZpbmctY2xpZW50IiwiYXVkIjoiaHR0cHM6Ly93d3cubGlmdGVycC5jb20iLCJpYXQiOjE3ODQ4OTQ0MDAsImV4cCI6MTc4NDg5NTAwMH0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function intent(overrides: Partial<ProofDecisionCanonicalIntent> = {}) {
  return {
    decision: "approve",
    order_number: "A00000000",
    task_id: "task-synthetic-0001",
    attachment_id: "proofing-synthetic-0001",
    participant_id: "participant-synthetic-0001",
    grant_id: "grant-synthetic-0001",
    expected_task_version: 7,
    expected_version_id: "version-synthetic-0001",
    feedback_fingerprint: "feedback-synthetic-0001",
    note: "Approved after reviewing the synthetic fixture.",
    ...overrides
  } satisfies ProofDecisionCanonicalIntent;
}

function record(options: {
  intent?: ProofDecisionCanonicalIntent;
  outcome?: ProofDecisionLedgerRecord["outcome"];
  record_version?: number;
  created_at?: string;
  updated_at?: string;
  expires_at_epoch?: number;
  canonical_body_hash?: string;
} = {}): ProofDecisionLedgerRecord {
  const canonicalIntent = options.intent ?? intent();
  const createdAt = options.created_at ?? CREATED_AT;
  return {
    idempotency_key: "idempotency-synthetic-sentinel-0001",
    canonical_body_hash:
      options.canonical_body_hash ??
      createHash("sha256").update(JSON.stringify(canonicalIntent)).digest("hex"),
    intent: canonicalIntent,
    outcome: options.outcome ?? "prepared",
    prepared_audit_event_id: `paudit_decision-${"a".repeat(64)}`,
    record_version: options.record_version ?? 1,
    created_at: createdAt,
    updated_at: options.updated_at ?? createdAt,
    expires_at_epoch:
      options.expires_at_epoch ??
      Math.floor(Date.parse(createdAt) / 1_000) + THIRTY_DAYS_SECONDS
  };
}

function plan(
  ledgerRecord = record(),
  companyId = "company-synthetic-001"
): LiftProofingApprovalExecutionPlan {
  return buildLiftProofingApprovalExecutionPlan({
    company_id: companyId,
    prepared: {
      idempotency_key: ledgerRecord.idempotency_key,
      canonical_body_hash: ledgerRecord.canonical_body_hash,
      intent: ledgerRecord.intent,
      outcome: "prepared"
    }
  });
}

function authentication(
  approvalPlan = plan(),
  options: {
    signature_character?: string;
    client_id?: string;
    claims_json?: string;
  } = {}
): LiftProofingApprovalAuthenticationEnvelope {
  const clientId = options.client_id ?? "synthetic-proofing-client";
  const claimsJson = options.claims_json ?? SYNTHETIC_JWT_CLAIMS;
  const compact = [
    Buffer.from(SYNTHETIC_JWT_HEADER).toString("base64url"),
    Buffer.from(claimsJson).toString("base64url"),
    (options.signature_character ?? "A").repeat(43)
  ].join(".");
  return {
    kind: "lift_proofing_approval_authentication_envelope",
    request: {
      method: approvalPlan.request.method,
      path: approvalPlan.request.path,
      headers: {
        content_type: {
          name: "Content-Type",
          value: "application/json"
        },
        authorization: {
          name: "Authorization",
          scheme: "Bearer",
          value: `Bearer ${compact}`
        },
        client_id: {
          name: "Lift-ERP-Client-Id",
          value: clientId
        }
      },
      body: approvalPlan.request.body,
      canonical_body_json: approvalPlan.request.canonical_body_json,
      canonical_body_sha256: approvalPlan.request.canonical_body_sha256
    },
    jwt: {
      header_json: SYNTHETIC_JWT_HEADER,
      claims_json: claimsJson,
      compact,
      compact_sha256: createHash("sha256").update(compact).digest("hex"),
      lifetime_policy: "caller_supplied_unconfirmed"
    },
    execution_boundary: {
      credential_source: "injected",
      credential_retention: "none",
      transport: "not_implemented",
      persistence: "not_implemented",
      response_execution: "not_implemented"
    }
  };
}

function baselineAttempt() {
  const ledgerRecord = record();
  const approvalPlan = plan(ledgerRecord);
  return prepareLiftProofingApprovalAttempt({
    record: ledgerRecord,
    plan: approvalPlan,
    authentication: authentication(approvalPlan),
    now: NOW
  });
}

function expectFailure(
  action: () => unknown,
  code: LiftProofingApprovalAttemptError["code"]
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingApprovalAttemptError);
    assert.equal(error.code, code);
    return true;
  });
}

test("builds a pinned deterministic sanitized approval attempt", () => {
  const baseline = baselineAttempt();
  const replay = baselineAttempt();

  assert.deepEqual(baseline, replay);
  assert.equal(
    baseline.attempt_id,
    "pattempt_77192b267105bd8e770ad0712136513b9053ea4f3dfee1a8a0a90c41440372b0"
  );
  assert.deepEqual(baseline.ledger_directive, {
    expected_outcome: "prepared",
    expected_record_version: 1,
    canonical_body_hash: record().canonical_body_hash,
    required_next_outcome: "submission_uncertain"
  });
  assert.deepEqual(baseline.execution_boundary, {
    persist_before_transport: true,
    persistence: "not_implemented",
    transport: "not_implemented",
    automatic_retry: false,
    confirmation: "not_implemented"
  });
  for (const fingerprint of [
    baseline.record_fingerprint,
    baseline.request_fingerprint,
    baseline.authentication_fingerprint
  ]) {
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
  }

  const serialized = JSON.stringify(baseline);
  for (const sensitive of [
    record().idempotency_key,
    record().intent.note as string,
    record().intent.participant_id,
    record().intent.grant_id,
    record().intent.task_id,
    record().intent.attachment_id,
    "synthetic-proofing-client",
    SYNTHETIC_JWT,
    "Authorization",
    "Bearer"
  ]) {
    assert.doesNotMatch(serialized, new RegExp(sensitive));
  }
});

test("binds the exact record, request, authentication envelope, and record version", () => {
  const baseline = baselineAttempt();

  const nextVersionRecord = record({ record_version: 2 });
  const nextVersionPlan = plan(nextVersionRecord);
  const nextVersion = prepareLiftProofingApprovalAttempt({
    record: nextVersionRecord,
    plan: nextVersionPlan,
    authentication: authentication(nextVersionPlan),
    now: NOW
  });
  const changedCompanyPlan = plan(record(), "company-synthetic-002");
  const changedCompany = prepareLiftProofingApprovalAttempt({
    record: record(),
    plan: changedCompanyPlan,
    authentication: authentication(changedCompanyPlan),
    now: NOW
  });
  const changedAuthentication = prepareLiftProofingApprovalAttempt({
    record: record(),
    plan: plan(),
    authentication: authentication(plan(), { signature_character: "B" }),
    now: NOW
  });

  assert.notEqual(nextVersion.attempt_id, baseline.attempt_id);
  assert.notEqual(nextVersion.record_fingerprint, baseline.record_fingerprint);
  assert.notEqual(changedCompany.attempt_id, baseline.attempt_id);
  assert.notEqual(changedCompany.request_fingerprint, baseline.request_fingerprint);
  assert.notEqual(changedAuthentication.attempt_id, baseline.attempt_id);
  assert.notEqual(
    changedAuthentication.authentication_fingerprint,
    baseline.authentication_fingerprint
  );
  assert.equal(changedCompany.ledger_directive.canonical_body_hash, baseline.ledger_directive.canonical_body_hash);
});

test("fails closed for stale, non-prepared, malformed, or cross-bound ledger records", () => {
  const staleCreatedAt = "2026-06-01T00:00:00.000Z";
  const cases: Array<{
    value: ProofDecisionLedgerRecord;
    code: LiftProofingApprovalAttemptError["code"];
  }> = [
    { value: record({ outcome: "confirmed" }), code: "ledger_record_invalid" },
    {
      value: record({
        created_at: staleCreatedAt,
        updated_at: staleCreatedAt
      }),
      code: "ledger_record_stale"
    },
    {
      value: record({ expires_at_epoch: 1_784_894_400 + THIRTY_DAYS_SECONDS + 1 }),
      code: "ledger_record_invalid"
    },
    {
      value: record({ canonical_body_hash: "0".repeat(64) }),
      code: "ledger_record_invalid"
    },
    {
      value: record({
        created_at: "2026-07-24T12:06:00.000Z",
        updated_at: "2026-07-24T12:06:00.000Z"
      }),
      code: "ledger_record_invalid"
    }
  ];
  for (const candidate of cases) {
    expectFailure(
      () =>
        prepareLiftProofingApprovalAttempt({
          record: candidate.value,
          plan: plan(),
          authentication: authentication(plan()),
          now: NOW
        }),
      candidate.code
    );
  }

  const changedIntentRecord = record({
    intent: intent({ attachment_id: "proofing-synthetic-0002" })
  });
  expectFailure(
    () =>
      prepareLiftProofingApprovalAttempt({
        record: changedIntentRecord,
        plan: plan(),
        authentication: authentication(plan()),
        now: NOW
      }),
    "approval_plan_mismatch"
  );
});

test("fails closed for tampered approval plans and authentication envelopes", () => {
  const approvalPlanMutations: Array<(value: LiftProofingApprovalExecutionPlan) => void> = [
    (value) => {
      value.request.path =
        "/order-management/companies/company-synthetic-001/proofing/other-proof";
    },
    (value) => {
      value.request.canonical_body_sha256 = "0".repeat(64);
    },
    (value) => {
      value.target.proofing_id = "other-proof";
    }
  ];
  for (const mutate of approvalPlanMutations) {
    const candidate = structuredClone(plan());
    mutate(candidate);
    expectFailure(
      () =>
        prepareLiftProofingApprovalAttempt({
          record: record(),
          plan: candidate,
          authentication: authentication(candidate),
          now: NOW
        }),
      "approval_plan_mismatch"
    );
  }

  const envelopeMutations: Array<
    (value: LiftProofingApprovalAuthenticationEnvelope) => void
  > = [
    (value) => {
      value.request.path =
        "/order-management/companies/company-synthetic-001/proofing/other-proof";
    },
    (value) => {
      value.request.headers.authorization.value = "Bearer invalid";
    },
    (value) => {
      value.jwt.compact_sha256 = "0".repeat(64);
    },
    (value) => {
      value.request.headers.client_id.value = "other-client";
    },
    (value) => {
      value.jwt.claims_json =
        "{\"iss\":\"https://www.lifterp.com/synthetic-proofing-client\",\"aud\":\"https://www.lifterp.com\",\"iat\":1784894400,\"exp\":1784894700}";
    }
  ];
  for (const mutate of envelopeMutations) {
    const candidate = structuredClone(authentication());
    mutate(candidate);
    expectFailure(
      () =>
        prepareLiftProofingApprovalAttempt({
          record: record(),
          plan: plan(),
          authentication: candidate,
          now: NOW
        }),
      "authentication_envelope_mismatch"
    );
  }

  for (const claimsJson of [
    "{\"iss\":\"https://www.lifterp.com/synthetic-proofing-client\",\"aud\":\"https://www.lifterp.com\",\"iat\":1784894760,\"exp\":1784895000}",
    "{\"iss\":\"https://www.lifterp.com/synthetic-proofing-client\",\"aud\":\"https://www.lifterp.com\",\"iat\":1784894400,\"exp\":1787572801}"
  ]) {
    expectFailure(
      () =>
        prepareLiftProofingApprovalAttempt({
          record: record(),
          plan: plan(),
          authentication: authentication(plan(), { claims_json: claimsJson }),
          now: NOW
        }),
      "authentication_envelope_mismatch"
    );
  }
});

test("never confirms or retries an observed response and only directs read-after-write", () => {
  const attempt = baselineAttempt();
  for (const status of [200, 201, 204, 299]) {
    const directive = reconcileLiftProofingApprovalObservation({
      attempt,
      observation: {
        status,
        body: {
          token: "synthetic-response-token-that-must-not-cross",
          signed_url: "https://customer.example.invalid/private"
        }
      }
    });
    assert.equal(directive.observation.confirmed, false);
    assert.equal(directive.observation.retryable, false);
    assert.deepEqual(directive.ledger_directive, {
      expected_outcome: "submission_uncertain",
      next_outcome: "reconciling",
      action: "authoritative_read_after_write_required"
    });
    assert.deepEqual(directive.execution_boundary, {
      confirmed: false,
      automatic_retry: false,
      persistence: "not_implemented",
      authoritative_read: "not_implemented"
    });
    assert.doesNotMatch(JSON.stringify(directive), /synthetic-response-token|customer\.example/);
  }

  for (const status of [100, 301, 400, 408, 425, 429, 500, 599, undefined]) {
    const directive = reconcileLiftProofingApprovalObservation({
      attempt,
      observation: { status }
    });
    assert.equal(directive.observation.confirmed, false);
    assert.equal(directive.observation.retryable, false);
    assert.deepEqual(directive.ledger_directive, {
      expected_outcome: "submission_uncertain",
      next_outcome: null,
      action: "manual_review_required"
    });
    assert.equal(directive.execution_boundary.automatic_retry, false);
  }
});

test("rejects a tampered attempt before producing a reconciliation directive", () => {
  const mutations: Array<(value: LiftProofingApprovalAttemptContract) => void> = [
    (value) => {
      value.attempt_id = `pattempt_${"0".repeat(64)}`;
    },
    (value) => {
      value.record_fingerprint = "0".repeat(64);
    },
    (value) => {
      value.ledger_directive.expected_record_version += 1;
    },
    (value) => {
      value.execution_boundary.automatic_retry = true as false;
    }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(baselineAttempt());
    mutate(candidate);
    expectFailure(
      () =>
        reconcileLiftProofingApprovalObservation({
          attempt: candidate,
          observation: { status: 200 }
        }),
      "attempt_contract_invalid"
    );
  }
});

test("keeps the attempt contract unexported, unroutable, unpersisted, and untransported", async () => {
  const attemptSource = await readFile(
    new URL("../src/proofing-approval-attempt-contract.ts", import.meta.url),
    "utf8"
  );
  const rootAdapterSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const runtimeConfigSource = await readFile(
    new URL("../../../apps/api/src/proof/runtime-config.ts", import.meta.url),
    "utf8"
  );
  const appsSourceRoot = new URL("../../../apps/", import.meta.url);
  const appSourceFiles = (await readdir(appsSourceRoot, { recursive: true })).filter(
    (path) => path.endsWith(".ts") || path.endsWith(".tsx")
  );
  const appRuntimeSources = await Promise.all(
    appSourceFiles.map(async (path) => ({
      path,
      source: await readFile(new URL(path, appsSourceRoot), "utf8")
    }))
  );

  assert.doesNotMatch(rootAdapterSource, /proofing-approval-attempt-contract/);
  for (const source of appRuntimeSources) {
    assert.doesNotMatch(
      source.source,
      /proofing-approval-attempt-contract/,
      `Unexpected runtime approval-attempt import in ${source.path}`
    );
  }
  assert.match(runtimeConfigSource, /approve: false/);
  assert.match(runtimeConfigSource, /revision: false/);
  assert.match(runtimeConfigSource, /undo: false/);
  assert.match(runtimeConfigSource, /lift_writes_enabled: false/);

  assert.doesNotMatch(
    attemptSource,
    /buildLiftProofingApprovalAuthenticationEnvelope|createHmac|signing_key|client_secret|clientSecret/
  );
  assert.doesNotMatch(
    attemptSource,
    /\bfetch\s*\(|process\.env|SecretsManager|DynamoDB|TransactWrite|PutItem|UpdateItem/
  );
  assert.doesNotMatch(
    attemptSource,
    /\bexpress\b|\bRouter\b|runtime-config|decision-ledger-store|decision-atomicity/
  );
});

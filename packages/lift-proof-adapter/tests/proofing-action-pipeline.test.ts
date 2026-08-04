import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  buildLiftProofingActionExecutionPlan,
  LIFT_PROOFING_ACTIONS,
  LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES,
  LiftProofingActionPlanError,
  type LiftProofingAction,
  type LiftProofingActionExecutionPlan,
  type LiftProofingPreparedActionIntent,
  type LiftProofingPreparedActionRecord
} from "../src/proofing-action-plan.ts";
import {
  buildLiftProofingActionAuthenticationEnvelope,
  LiftProofingActionAuthenticationError,
  type LiftProofingActionAuthenticationEnvelope
} from "../src/proofing-action-auth-envelope.ts";
import {
  LiftProofingActionAttemptError,
  prepareLiftProofingActionAttempt,
  reconcileLiftProofingActionObservation,
  type LiftProofingActionAttemptContract
} from "../src/proofing-action-attempt-contract.ts";

const CREATED_AT = "2026-07-26T12:00:00.000Z";
const NOW = new Date("2026-07-26T12:05:00.000Z");
const REVISED_ART_URL =
  "https://art.example.invalid/revised/proof.pdf?fixture=synthetic";
const EXPECTED_CANONICAL_HASHES: Record<
  LiftProofingAction,
  { intent: string; request: string; body: string }
> = {
  APPROVE: {
    intent: "c59bb54cfad8ce3f226757d04123352bdf715d5df6348436d33899a828e7ce34",
    request: "79454af891f91f3338f33ad7aab2957596be3e1a3107bf6c323f43dfa7df5faf",
    body:
      "{\"approve\":true,\"comment\":\"Reviewed the current proof and feedback.\",\"userName\":\"VORNAN_PROOF\"}"
  },
  REJECT: {
    intent: "b12bf09f9016b6ceb7c8ac5a332865dce39a1bd3469e1142239441b634ce89b3",
    request: "fa81bc9129fcde2924a74e748af68a9b1318bb6a62105cb46b3110776b01e2ed",
    body:
      "{\"approve\":false,\"comment\":\"Reviewed the current proof and feedback.\",\"rejectReason\":\"REJECT\",\"userName\":\"VORNAN_PROOF\"}"
  },
  SEND_BACK_TO_ARTIST: {
    intent: "32c6bc3bcefd8a139ee61988342faa331481d6d2acf151e3fe835216867def3c",
    request: "589e40b3110decd595940bff187dc9d4bc0b5cf1226405baee76d7698d7a594d",
    body:
      "{\"approve\":false,\"comment\":\"Reviewed the current proof and feedback.\",\"rejectReason\":\"SEND_BACK_TO_ARTIST\",\"userName\":\"VORNAN_PROOF\"}"
  },
  CANCEL_LINE: {
    intent: "b513e5ae5d018f32ed8082896f9225a7f74a61f5f6a4e7fe630ed648ff65a4d5",
    request: "ba21a524b4440ab07dd40974d08b222b2f6fcdecad65e041602dee0230b5f733",
    body:
      "{\"approve\":false,\"comment\":\"Reviewed the current proof and feedback.\",\"rejectReason\":\"CANCEL_LINE\",\"userName\":\"VORNAN_PROOF\"}"
  },
  REVISED_ART_WILL_BE_SENT: {
    intent: "263107c6a01198402946c21158a588ff751a117c5219e9539044244a300c2838",
    request: "ff978ef7cc19f5bf3dc065bc154bc8c1be86d45f3b41ddced42f35afe7925394",
    body:
      "{\"approve\":false,\"artUrl\":\"https://art.example.invalid/revised/proof.pdf?fixture=synthetic\",\"comment\":\"Reviewed the current proof and feedback.\",\"rejectReason\":\"REVISED_ART_WILL_BE_SENT\",\"upload\":true,\"userName\":\"VORNAN_PROOF\"}"
  }
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    );
  }
  return value;
}

function canonicalHash(intent: LiftProofingPreparedActionIntent) {
  return createHash("sha256")
    .update(JSON.stringify(stableJsonValue(intent)))
    .digest("hex");
}

function preparedRecord(
  action: LiftProofingAction,
  overrides: Partial<LiftProofingPreparedActionIntent> = {},
  recordOverrides: Partial<LiftProofingPreparedActionRecord> = {}
): LiftProofingPreparedActionRecord {
  const intent: LiftProofingPreparedActionIntent = {
    action,
    company_id: "91",
    order_number: "A00000000",
    task_id: "task-internal-sentinel",
    attachment_id: "proofing-synthetic-0001",
    participant_id: "participant-internal-sentinel",
    grant_id: "grant-internal-sentinel",
    expected_task_version: 7,
    expected_version_id: "version-internal-sentinel",
    feedback_fingerprint: "feedback-internal-sentinel",
    note: "Reviewed the current proof and feedback.",
    revised_art_url:
      action === "REVISED_ART_WILL_BE_SENT" ? REVISED_ART_URL : null,
    ...overrides
  };
  return {
    idempotency_key: `idempotency-${action.toLowerCase()}-synthetic-0001`,
    canonical_body_hash: canonicalHash(intent),
    intent,
    outcome: "prepared",
    prepared_audit_event_id: `paudit_decision-${"a".repeat(64)}`,
    record_version: 3,
    created_at: CREATED_AT,
    updated_at: "2026-07-26T12:01:00.000Z",
    expires_at_epoch:
      Math.floor(Date.parse(CREATED_AT) / 1_000) + 30 * 24 * 60 * 60,
    ...recordOverrides
  };
}

function planFor(action: LiftProofingAction) {
  return buildLiftProofingActionExecutionPlan({
    prepared: preparedRecord(action)
  });
}

function syntheticKey() {
  return Uint8Array.from({ length: 32 }, (_, index) => index + 11);
}

function authenticationFor(
  plan: LiftProofingActionExecutionPlan,
  overrides: {
    synthetic_client_id?: string;
    synthetic_signing_key_bytes?: Uint8Array;
    iat?: number;
    exp?: number;
  } = {}
) {
  return buildLiftProofingActionAuthenticationEnvelope({
    plan,
    synthetic_client_id:
      overrides.synthetic_client_id ?? "synthetic-proofing-client",
    synthetic_signing_key_bytes:
      overrides.synthetic_signing_key_bytes ?? syntheticKey(),
    iat:
      overrides.iat ??
      Math.floor(new Date("2026-07-26T12:04:00.000Z").getTime() / 1_000),
    exp:
      overrides.exp ??
      Math.floor(new Date("2026-07-26T12:10:00.000Z").getTime() / 1_000)
  });
}

function attemptFor(action: LiftProofingAction) {
  const record = preparedRecord(action);
  const plan = buildLiftProofingActionExecutionPlan({ prepared: record });
  const authentication = authenticationFor(plan);
  return prepareLiftProofingActionAttempt({
    record,
    plan,
    authentication,
    now: NOW
  });
}

function expectPlanFailure(
  action: () => unknown,
  code: LiftProofingActionPlanError["code"]
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingActionPlanError);
    assert.equal(error.code, code);
    return true;
  });
}

function expectAuthenticationFailure(
  action: () => unknown,
  code: LiftProofingActionAuthenticationError["code"]
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingActionAuthenticationError);
    assert.equal(error.code, code);
    return true;
  });
}

function expectAttemptFailure(
  action: () => unknown,
  code: LiftProofingActionAttemptError["code"]
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingActionAttemptError);
    assert.equal(error.code, code);
    return true;
  });
}

test("builds deterministic plans for approval and every documented rejection reason", () => {
  const plans = Object.fromEntries(
    LIFT_PROOFING_ACTIONS.map((action) => [action, planFor(action)])
  ) as Record<LiftProofingAction, LiftProofingActionExecutionPlan>;

  assert.deepEqual(plans.APPROVE.request.body, {
    approve: true,
    userName: "VORNAN_PROOF",
    comment: "Reviewed the current proof and feedback."
  });
  for (const action of ["REJECT", "SEND_BACK_TO_ARTIST", "CANCEL_LINE"] as const) {
    assert.deepEqual(plans[action].request.body, {
      approve: false,
      userName: "VORNAN_PROOF",
      rejectReason: action,
      comment: "Reviewed the current proof and feedback."
    });
  }
  assert.deepEqual(plans.REVISED_ART_WILL_BE_SENT.request.body, {
    approve: false,
    userName: "VORNAN_PROOF",
    rejectReason: "REVISED_ART_WILL_BE_SENT",
    artUrl: REVISED_ART_URL,
    upload: true,
    comment: "Reviewed the current proof and feedback."
  });

  for (const action of LIFT_PROOFING_ACTIONS) {
    const plan = plans[action];
    assert.equal(
      preparedRecord(action).canonical_body_hash,
      EXPECTED_CANONICAL_HASHES[action].intent
    );
    assert.equal(
      plan.request.canonical_body_json,
      EXPECTED_CANONICAL_HASHES[action].body
    );
    assert.equal(
      plan.request.canonical_body_sha256,
      EXPECTED_CANONICAL_HASHES[action].request
    );
    assert.deepEqual(plan, planFor(action));
    assert.equal(plan.action, action);
    assert.equal(plan.target.company_id, "91");
    assert.equal(plan.target.proofing_id, "proofing-synthetic-0001");
    assert.equal(
      plan.request.path,
      "/order-management/companies/91/proofing/proofing-synthetic-0001"
    );
    assert.deepEqual(
      plan.request.required_header_names,
      LIFT_PROOFING_ACTION_REQUIRED_HEADER_NAMES
    );
    assert.match(plan.request.canonical_body_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(plan.execution_boundary, {
      jwt_policy: "authoritative_confirmation_required",
      jwt_compact_serialization: "not_implemented",
      jwt_signing: "not_implemented",
      credentials: "not_accessed",
      persistence: "not_implemented",
      transport: "not_implemented",
      response_execution: "not_implemented",
      response_contract: "unconfirmed",
      automatic_retry: false
    });
  }
  assert.equal(
    new Set(
      LIFT_PROOFING_ACTIONS.map(
        (action) => plans[action].request.canonical_body_sha256
      )
    ).size,
    LIFT_PROOFING_ACTIONS.length
  );
});

test("requires one safe HTTPS art URL only for revised-art rejection", () => {
  for (const unsafe of [
    null,
    "http://art.example.invalid/revised.pdf",
    "https://user:pass@art.example.invalid/revised.pdf",
    "https://art.example.invalid/revised.pdf#fragment",
    "https://localhost/revised.pdf",
    "https://127.0.0.1/revised.pdf",
    "https://single-label/revised.pdf"
  ]) {
    expectPlanFailure(
      () =>
        buildLiftProofingActionExecutionPlan({
          prepared: preparedRecord("REVISED_ART_WILL_BE_SENT", {
            revised_art_url: unsafe as string | null
          })
        }),
      "prepared_record_invalid"
    );
  }

  for (const action of ["APPROVE", "REJECT", "SEND_BACK_TO_ARTIST", "CANCEL_LINE"] as const) {
    expectPlanFailure(
      () =>
        buildLiftProofingActionExecutionPlan({
          prepared: preparedRecord(action, {
            revised_art_url: REVISED_ART_URL
          })
        }),
      "prepared_record_invalid"
    );
  }

  const extendedIntent = {
    ...preparedRecord("REVISED_ART_WILL_BE_SENT").intent,
    upload_bytes: "synthetic-file-content",
    multipart_parts: [1, 2]
  };
  expectPlanFailure(
    () =>
      buildLiftProofingActionExecutionPlan({
        prepared: {
          ...preparedRecord("REVISED_ART_WILL_BE_SENT"),
          intent: extendedIntent,
          canonical_body_hash: createHash("sha256")
            .update(JSON.stringify(stableJsonValue(extendedIntent)))
            .digest("hex")
        } as unknown as LiftProofingPreparedActionRecord
      }),
    "prepared_record_invalid"
  );
});

test("keeps Lift payloads sanitized and excludes internal decision context", () => {
  for (const action of LIFT_PROOFING_ACTIONS) {
    const record = preparedRecord(action);
    const plan = buildLiftProofingActionExecutionPlan({ prepared: record });
    const serializedPlan = JSON.stringify(plan);
    const serializedBody = JSON.stringify(plan.request.body);
    for (const sensitive of [
      record.idempotency_key,
      record.canonical_body_hash,
      record.intent.order_number,
      record.intent.task_id,
      record.intent.participant_id,
      record.intent.grant_id,
      record.intent.expected_version_id,
      record.intent.feedback_fingerprint,
      record.prepared_audit_event_id,
      "reviewer@example.invalid",
      "client-secret-sentinel"
    ]) {
      assert.doesNotMatch(serializedPlan, new RegExp(sensitive));
      assert.doesNotMatch(serializedBody, new RegExp(sensitive));
    }
  }
});

test("builds deterministic synthetic authentication envelopes for every action", () => {
  const compactTokens = new Set<string>();
  for (const action of LIFT_PROOFING_ACTIONS) {
    const plan = planFor(action);
    const envelope = authenticationFor(plan);
    const replay = authenticationFor(plan);
    assert.deepEqual(envelope, replay);
    assert.equal(envelope.action, action);
    assert.deepEqual(envelope.request.body, plan.request.body);
    assert.equal(
      envelope.request.canonical_body_sha256,
      plan.request.canonical_body_sha256
    );
    assert.match(
      envelope.request.headers.authorization.value,
      /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
    assert.equal(
      envelope.execution_boundary.credential_source,
      "injected_synthetic_fixture"
    );
    assert.equal(envelope.execution_boundary.credential_retention, "none");
    assert.equal("synthetic_signing_key_bytes" in envelope, false);
    assert.equal("client_secret" in envelope, false);
    compactTokens.add(envelope.jwt.compact);
  }
  assert.equal(compactTokens.size, 1);
});

test("authentication fails closed for cross-action, cross-target, and body tampering", () => {
  const mutations: Array<(plan: LiftProofingActionExecutionPlan) => void> = [
    (plan) => {
      plan.action = "CANCEL_LINE";
    },
    (plan) => {
      plan.target.company_id = "92";
    },
    (plan) => {
      plan.target.proofing_id = "proofing-synthetic-0002";
    },
    (plan) => {
      plan.request.canonical_body_sha256 = "0".repeat(64);
    },
    (plan) => {
      plan.request.path =
        "/order-management/companies/91/proofing/proofing-synthetic-0002";
    },
    (plan) => {
      (plan.request.body as { comment?: string }).comment = "Tampered.";
    }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(planFor("REJECT"));
    mutate(candidate);
    expectAuthenticationFailure(
      () => authenticationFor(candidate),
      "action_plan_invalid"
    );
  }
});

test("binds attempts to the exact current record, action plan, and authentication envelope", () => {
  const attempts = new Map<LiftProofingAction, LiftProofingActionAttemptContract>();
  for (const action of LIFT_PROOFING_ACTIONS) {
    const attempt = attemptFor(action);
    assert.deepEqual(attempt, attemptFor(action));
    assert.equal(attempt.action, action);
    assert.equal(attempt.ledger_directive.required_next_outcome, "submission_uncertain");
    assert.deepEqual(attempt.execution_boundary, {
      persist_before_transport: true,
      persistence: "not_implemented",
      transport: "not_implemented",
      automatic_retry: false,
      confirmation: "not_implemented"
    });
    attempts.set(action, attempt);
  }
  assert.equal(
    new Set([...attempts.values()].map((attempt) => attempt.attempt_id)).size,
    LIFT_PROOFING_ACTIONS.length
  );

  const record = preparedRecord("REJECT");
  const plan = buildLiftProofingActionExecutionPlan({ prepared: record });
  const authentication = authenticationFor(plan);
  const otherRecord = preparedRecord("CANCEL_LINE");
  expectAttemptFailure(
    () =>
      prepareLiftProofingActionAttempt({
        record: otherRecord,
        plan,
        authentication,
        now: NOW
      }),
    "action_plan_mismatch"
  );

  const tamperedAuthentication = structuredClone(authentication);
  tamperedAuthentication.request.path =
    "/order-management/companies/91/proofing/proofing-synthetic-0002";
  expectAttemptFailure(
    () =>
      prepareLiftProofingActionAttempt({
        record,
        plan,
        authentication: tamperedAuthentication,
        now: NOW
      }),
    "authentication_envelope_mismatch"
  );
});

test("fails closed for stale, cross-version, malformed, and TTL-extended records", () => {
  const baseline = preparedRecord("REJECT");
  const cases: Array<{
    record: LiftProofingPreparedActionRecord;
    now: Date;
    code: LiftProofingActionAttemptError["code"];
  }> = [
    {
      record: {
        ...baseline,
        expires_at_epoch: Math.floor(NOW.getTime() / 1_000)
      },
      now: NOW,
      code: "prepared_record_invalid"
    },
    {
      record: baseline,
      now: new Date("2026-08-26T12:00:00.000Z"),
      code: "prepared_record_stale"
    },
    {
      record: {
        ...baseline,
        created_at: "2026-07-26T12:06:00.000Z",
        updated_at: "2026-07-26T12:06:00.000Z",
        expires_at_epoch:
          Math.floor(new Date("2026-07-26T12:06:00.000Z").getTime() / 1_000) +
          30 * 24 * 60 * 60
      },
      now: NOW,
      code: "prepared_record_stale"
    },
    {
      record: {
        ...baseline,
        record_version: 0
      },
      now: NOW,
      code: "prepared_record_invalid"
    },
    {
      record: {
        ...baseline,
        canonical_body_hash: "0".repeat(64)
      },
      now: NOW,
      code: "prepared_record_invalid"
    }
  ];

  for (const candidate of cases) {
    const plan = buildLiftProofingActionExecutionPlan({
      prepared:
        candidate.code === "prepared_record_stale"
          ? candidate.record
          : baseline
    });
    const authentication = authenticationFor(plan);
    expectAttemptFailure(
      () =>
        prepareLiftProofingActionAttempt({
          record: candidate.record,
          plan,
          authentication,
          now: candidate.now
        }),
      candidate.code
    );
  }
});

test("never confirms or automatically retries any observed response", () => {
  const attempt = attemptFor("REVISED_ART_WILL_BE_SENT");
  for (const observation of [
    { status: 200 },
    { status: 204 },
    { status: 400 },
    { status: 404 },
    { status: 409 },
    { status: 429 },
    { status: 500 },
    { status: 302 },
    {},
    { status: 999 }
  ]) {
    const directive = reconcileLiftProofingActionObservation({
      attempt,
      observation
    });
    assert.equal(directive.execution_boundary.confirmed, false);
    assert.equal(directive.execution_boundary.automatic_retry, false);
    if (Number(observation.status) >= 200 && Number(observation.status) <= 299) {
      assert.deepEqual(directive.ledger_directive, {
        expected_outcome: "submission_uncertain",
        next_outcome: "reconciling",
        action: "authoritative_read_after_write_required"
      });
    } else {
      assert.deepEqual(directive.ledger_directive, {
        expected_outcome: "submission_uncertain",
        next_outcome: null,
        action: "manual_review_required"
      });
    }
  }
});

test("rejects a tampered attempt before producing a reconciliation directive", () => {
  const mutations: Array<(attempt: LiftProofingActionAttemptContract) => void> = [
    (attempt) => {
      attempt.action = "CANCEL_LINE";
    },
    (attempt) => {
      attempt.attempt_id = `paction_${"0".repeat(64)}`;
    },
    (attempt) => {
      attempt.ledger_directive.expected_record_version += 1;
    },
    (attempt) => {
      attempt.execution_boundary.automatic_retry = true as false;
    }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(attemptFor("REJECT"));
    mutate(candidate);
    expectAttemptFailure(
      () =>
        reconcileLiftProofingActionObservation({
          attempt: candidate,
          observation: { status: 200 }
        }),
      "attempt_contract_invalid"
    );
  }
});

test("keeps the generalized action pipeline package-local and capability-dark", async () => {
  const sourceNames = [
    "proofing-action-plan.ts",
    "proofing-action-auth-envelope.ts",
    "proofing-action-attempt-contract.ts"
  ];
  const sources = await Promise.all(
    sourceNames.map(async (name) => ({
      name,
      source: await readFile(new URL(`../src/${name}`, import.meta.url), "utf8")
    }))
  );
  const rootAdapterSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const runtimeConfigSource = await readFile(
    new URL("../../../apps/api/src/proof/runtime-config.ts", import.meta.url),
    "utf8"
  );
  const appsSourceRoot = new URL("../../../apps/", import.meta.url);
  const appSourceFiles = (await readdir(appsSourceRoot, { recursive: true }))
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));

  for (const name of sourceNames) {
    assert.doesNotMatch(rootAdapterSource, new RegExp(name.replace(/\.ts$/, "")));
  }
  for (const path of appSourceFiles) {
    const source = await readFile(new URL(path, appsSourceRoot), "utf8");
    assert.doesNotMatch(
      source,
      /proofing-action-(?:plan|auth-envelope|attempt-contract)/,
      `Unexpected generalized Proof action runtime import in ${path}`
    );
  }
  assert.match(runtimeConfigSource, /approve: false/);
  assert.match(runtimeConfigSource, /revision: false/);
  assert.match(runtimeConfigSource, /undo: false/);
  assert.match(runtimeConfigSource, /lift_writes_enabled: false/);

  for (const { name, source } of sources) {
    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|process\.env|SecretsManager|DynamoDB|TransactWrite|PutItem|UpdateItem/
    );
    assert.doesNotMatch(
      source,
      /\bexpress\b|\bRouter\b|runtime-config|decision-ledger-store|decision-atomicity/
    );
    assert.doesNotMatch(
      source,
      /FormData|multipart|createReadStream|readFile|Blob|File\b/,
      `Unexpected upload primitive in ${name}`
    );
  }
});

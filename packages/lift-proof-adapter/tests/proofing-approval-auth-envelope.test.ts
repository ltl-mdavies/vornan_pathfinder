import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import type {
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract
} from "@pathfinder/proof-domain";
import {
  buildLiftProofingApprovalAuthenticationEnvelope,
  LiftProofingApprovalAuthenticationError
} from "../src/proofing-approval-auth-envelope.ts";
import {
  buildLiftProofingApprovalExecutionPlan,
  type LiftProofingApprovalExecutionPlan
} from "../src/proofing-approval-plan.ts";
import { LiftProofingDecisionContractError } from "../src/proofing-decision-contract.ts";

function preparedApproval(
  overrides: Partial<ProofDecisionCanonicalIntent> = {}
): ProofDecisionIntegrityContract {
  const intent: ProofDecisionCanonicalIntent = {
    decision: "approve",
    order_number: "A00000000",
    task_id: "task-internal-sentinel",
    attachment_id: "proofing-synthetic-0001",
    participant_id: "participant-internal-sentinel",
    grant_id: "grant-internal-sentinel",
    expected_task_version: 7,
    expected_version_id: "version-internal-sentinel",
    feedback_fingerprint: "feedback-internal-sentinel",
    note: "Approved after reviewing the current feedback.",
    ...overrides
  };
  return {
    idempotency_key: "idempotency-internal-sentinel-0001",
    canonical_body_hash: createHash("sha256").update(JSON.stringify(intent)).digest("hex"),
    intent,
    outcome: "prepared"
  };
}

function syntheticPlan() {
  return buildLiftProofingApprovalExecutionPlan({
    company_id: "company-synthetic-001",
    prepared: preparedApproval()
  });
}

function syntheticKey() {
  return Uint8Array.from({ length: 32 }, (_, index) => index + 1);
}

function baselineEnvelope(overrides: {
  plan?: LiftProofingApprovalExecutionPlan;
  client_id?: string;
  signing_key_bytes?: Uint8Array;
  iat?: number;
  exp?: number;
} = {}) {
  return buildLiftProofingApprovalAuthenticationEnvelope({
    plan: overrides.plan ?? syntheticPlan(),
    client_id: overrides.client_id ?? "synthetic-proofing-client",
    signing_key_bytes: overrides.signing_key_bytes ?? syntheticKey(),
    iat: overrides.iat ?? 1_721_750_400,
    exp: overrides.exp ?? 1_721_750_700
  });
}

function expectAuthenticationFailure(
  action: () => unknown,
  code: LiftProofingApprovalAuthenticationError["code"]
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingApprovalAuthenticationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("builds a pinned deterministic synthetic HS256 approval envelope", () => {
  const baseline = baselineEnvelope();
  const replay = baselineEnvelope();
  const expectedCompact =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3d3dy5saWZ0ZXJwLmNvbS9zeW50aGV0aWMtcHJvb2ZpbmctY2xpZW50IiwiYXVkIjoiaHR0cHM6Ly93d3cubGlmdGVycC5jb20iLCJpYXQiOjE3MjE3NTA0MDAsImV4cCI6MTcyMTc1MDcwMH0.hYQXJ17Jc_yuUItFby5nt-MKKPbo6itx7sl2lQanaKQ";

  assert.deepEqual(baseline, replay);
  assert.deepEqual(baseline.jwt, {
    header_json: "{\"alg\":\"HS256\",\"typ\":\"JWT\"}",
    claims_json:
      "{\"iss\":\"https://www.lifterp.com/synthetic-proofing-client\",\"aud\":\"https://www.lifterp.com\",\"iat\":1721750400,\"exp\":1721750700}",
    compact: expectedCompact,
    compact_sha256: "d25683ae4791b7a941cb1aeeb614f07817781a1293fee9ef8ad74bb8e856787a",
    lifetime_policy: "caller_supplied_unconfirmed"
  });
  assert.equal(baseline.request.headers.authorization.value, `Bearer ${expectedCompact}`);
  assert.deepEqual(baseline.request.headers.client_id, {
    name: "Lift-ERP-Client-Id",
    value: "synthetic-proofing-client"
  });
  assert.deepEqual(baseline.request.headers.content_type, {
    name: "Content-Type",
    value: "application/json"
  });
  assert.equal(baseline.request.method, "PUT");
  assert.equal(
    baseline.request.path,
    "/order-management/companies/company-synthetic-001/proofing/proofing-synthetic-0001"
  );
  assert.deepEqual(baseline.request.body, syntheticPlan().request.body);
  assert.equal(
    baseline.request.canonical_body_sha256,
    syntheticPlan().request.canonical_body_sha256
  );
  assert.deepEqual(baseline.execution_boundary, {
    credential_source: "injected",
    credential_retention: "none",
    transport: "not_implemented",
    persistence: "not_implemented",
    response_execution: "not_implemented"
  });
});

test("binds the token to injected identity, key bytes, and explicit timestamps", () => {
  const baseline = baselineEnvelope();
  const changedClient = baselineEnvelope({ client_id: "synthetic-proofing-client-2" });
  const changedKey = syntheticKey();
  changedKey[31] ^= 0xff;
  const changedSigningKey = baselineEnvelope({ signing_key_bytes: changedKey });
  const changedTime = baselineEnvelope({
    iat: 1_721_750_401,
    exp: 1_721_750_701
  });

  assert.notEqual(changedClient.jwt.compact, baseline.jwt.compact);
  assert.notEqual(changedSigningKey.jwt.compact, baseline.jwt.compact);
  assert.notEqual(changedTime.jwt.compact, baseline.jwt.compact);
  for (const changed of [changedClient, changedSigningKey, changedTime]) {
    assert.deepEqual(changed.request.body, baseline.request.body);
    assert.equal(
      changed.request.canonical_body_sha256,
      baseline.request.canonical_body_sha256
    );
  }
});

test("does not retain or mutate injected signing material", () => {
  const rawKeyText = "synthetic-signing-key-material-0001";
  const key = new TextEncoder().encode(rawKeyText);
  const before = [...key];
  const envelope = baselineEnvelope({ signing_key_bytes: key });
  const serialized = JSON.stringify(envelope);

  assert.deepEqual([...key], before);
  assert.doesNotMatch(serialized, new RegExp(rawKeyText));
  assert.equal("signing_key_bytes" in envelope, false);
  assert.equal("client_secret" in envelope, false);
  assert.match(envelope.request.headers.authorization.value, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("fails closed on malformed plans, signing keys, identities, and times", () => {
  const planMutations: Array<(plan: LiftProofingApprovalExecutionPlan) => void> = [
    (plan) => {
      plan.request.canonical_body_sha256 = "0".repeat(64);
    },
    (plan) => {
      plan.request.canonical_body_json = "{}";
    },
    (plan) => {
      plan.request.path =
        "/order-management/companies/company-synthetic-001/proofing/another-proof";
    },
    (plan) => {
      (plan.request.required_header_names as unknown as string[])[1] = "X-Unsafe";
    },
    (plan) => {
      (plan.request.body as { approve: boolean }).approve = false;
    }
  ];

  for (const mutate of planMutations) {
    const plan = JSON.parse(JSON.stringify(syntheticPlan())) as LiftProofingApprovalExecutionPlan;
    mutate(plan);
    expectAuthenticationFailure(
      () => baselineEnvelope({ plan }),
      "approval_plan_invalid"
    );
  }

  for (const signingKey of [
    new Uint8Array(0),
    new Uint8Array(31),
    new Uint8Array(4_097)
  ]) {
    expectAuthenticationFailure(
      () => baselineEnvelope({ signing_key_bytes: signingKey }),
      "signing_key_invalid"
    );
  }
  expectAuthenticationFailure(
    () => baselineEnvelope({
      signing_key_bytes: "not-bytes" as unknown as Uint8Array
    }),
    "signing_key_invalid"
  );

  assert.throws(
    () => baselineEnvelope({ client_id: "invalid/client" }),
    (error: unknown) =>
      error instanceof LiftProofingDecisionContractError &&
      error.code === "identifier_invalid"
  );
  assert.throws(
    () => baselineEnvelope({ iat: 100, exp: 100 }),
    (error: unknown) =>
      error instanceof LiftProofingDecisionContractError &&
      error.code === "jwt_time_invalid"
  );
});

test("keeps authentication signing isolated from every executable runtime entry graph", async () => {
  const authSource = await readFile(
    new URL("../src/proofing-approval-auth-envelope.ts", import.meta.url),
    "utf8"
  );
  const rootAdapterSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const runtimeConfigSource = await readFile(
    new URL("../../../apps/api/src/proof/runtime-config.ts", import.meta.url),
    "utf8"
  );
  const appsSourceRoot = new URL("../../../apps/", import.meta.url);
  const appSourceFiles = (await readdir(appsSourceRoot, { recursive: true }))
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
  const appRuntimeSources = await Promise.all(
    appSourceFiles.map(async (path) => ({
      path,
      source: await readFile(new URL(path, appsSourceRoot), "utf8")
    }))
  );

  assert.doesNotMatch(rootAdapterSource, /proofing-approval-auth-envelope/);
  for (const source of appRuntimeSources) {
    assert.doesNotMatch(
      source.source,
      /proofing-approval-auth-envelope/,
      `Unexpected runtime authentication-envelope import in ${source.path}`
    );
  }
  assert.match(runtimeConfigSource, /approve: false/);
  assert.match(runtimeConfigSource, /revision: false/);
  assert.match(runtimeConfigSource, /undo: false/);
  assert.match(runtimeConfigSource, /lift_writes_enabled: false/);

  assert.match(authSource, /createHmac\("sha256"/);
  assert.doesNotMatch(authSource, /\bfetch\s*\(|process\.env|secrets-store|runtime-config/);
  assert.doesNotMatch(
    authSource,
    /\bexpress\b|\bRouter\b|decision-ledger|decision-atomicity|DynamoDB|SecretsManager/
  );
  assert.doesNotMatch(authSource, /client_secret|clientSecret|PATHFINDER_/);
});

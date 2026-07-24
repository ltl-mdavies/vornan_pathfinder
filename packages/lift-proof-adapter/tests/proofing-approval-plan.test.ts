import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import type {
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract
} from "@pathfinder/proof-domain";
import {
  buildLiftProofingApprovalExecutionPlan,
  LIFT_PROOFING_APPROVAL_QUANTITY,
  LIFT_PROOFING_APPROVAL_REQUIRED_HEADER_NAMES,
  LIFT_PROOFING_APPROVAL_USER_NAME,
  LiftProofingApprovalPlanError
} from "../src/proofing-approval-plan.ts";

function preparedApproval(
  overrides: Partial<ProofDecisionCanonicalIntent> = {}
): ProofDecisionIntegrityContract {
  const intent: ProofDecisionCanonicalIntent = {
    decision: "approve",
    order_number: "A00000000",
    task_id: "task-internal-sentinel",
    attachment_id: "proofing-attachment-9748544",
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

function expectFailure(
  action: () => unknown,
  code: LiftProofingApprovalPlanError["code"]
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingApprovalPlanError);
    assert.equal(error.code, code);
    return true;
  });
}

test("builds a deterministic synthetic approval plan bound to the current attachment", () => {
  const baseline = buildLiftProofingApprovalExecutionPlan({
    company_id: "company-91",
    prepared: preparedApproval()
  });
  const replay = buildLiftProofingApprovalExecutionPlan({
    company_id: "company-91",
    prepared: preparedApproval()
  });

  assert.deepEqual(baseline, replay);
  assert.equal(LIFT_PROOFING_APPROVAL_QUANTITY, 1);
  assert.equal(LIFT_PROOFING_APPROVAL_USER_NAME, "VORNAN_PROOF");
  assert.deepEqual(LIFT_PROOFING_APPROVAL_REQUIRED_HEADER_NAMES, [
    "Content-Type",
    "Authorization",
    "Lift-ERP-Client-Id"
  ]);
  assert.deepEqual(baseline, {
    kind: "lift_proofing_approval",
    target: {
      company_id: "company-91",
      proofing_id: "proofing-attachment-9748544"
    },
    request: {
      method: "PUT",
      path: "/order-management/companies/company-91/proofing/proofing-attachment-9748544",
      required_header_names: LIFT_PROOFING_APPROVAL_REQUIRED_HEADER_NAMES,
      body: {
        approve: true,
        userName: "VORNAN_PROOF",
        approveQuantity: 1,
        comment: "Approved after reviewing the current feedback."
      },
      canonical_body_json:
        "{\"approve\":true,\"approveQuantity\":1,\"comment\":\"Approved after reviewing the current feedback.\",\"userName\":\"VORNAN_PROOF\"}",
      canonical_body_sha256: "3d1fe0550ef9d8368f58d8c140bc1982280d61c0479a873117efbf656a47e2cf"
    },
    execution_boundary: {
      jwt_policy: "authoritative_confirmation_required",
      jwt_compact_serialization: "not_implemented",
      jwt_signing: "not_implemented",
      credentials: "not_accessed",
      transport: "not_implemented",
      response_execution: "not_implemented",
      response_contract: "unconfirmed"
    }
  });
  assert.match(baseline.request.canonical_body_sha256, /^[a-f0-9]{64}$/);
});

test("omits an absent note and changes the canonical body digest deterministically", () => {
  const withComment = buildLiftProofingApprovalExecutionPlan({
    company_id: "91",
    prepared: preparedApproval()
  });
  const withoutComment = buildLiftProofingApprovalExecutionPlan({
    company_id: "91",
    prepared: preparedApproval({ note: null })
  });

  assert.deepEqual(withoutComment.request.body, {
    approve: true,
    userName: "VORNAN_PROOF",
    approveQuantity: 1
  });
  assert.equal(
    withoutComment.request.canonical_body_json,
    "{\"approve\":true,\"approveQuantity\":1,\"userName\":\"VORNAN_PROOF\"}"
  );
  assert.notEqual(
    withoutComment.request.canonical_body_sha256,
    withComment.request.canonical_body_sha256
  );
});

test("never copies internal identity, version, idempotency, email, or secret fields into the Lift plan", () => {
  const prepared = preparedApproval();
  const plan = buildLiftProofingApprovalExecutionPlan({
    company_id: "91",
    prepared
  });
  const serializedPlan = JSON.stringify(plan);
  const serializedPayload = JSON.stringify(plan.request.body);

  for (const sensitiveSentinel of [
    prepared.idempotency_key,
    prepared.canonical_body_hash,
    prepared.intent.order_number,
    prepared.intent.task_id,
    prepared.intent.participant_id,
    prepared.intent.grant_id,
    prepared.intent.expected_version_id,
    prepared.intent.feedback_fingerprint,
    "reviewer@example.invalid",
    "client-secret-sentinel"
  ]) {
    assert.doesNotMatch(serializedPlan, new RegExp(sensitiveSentinel));
    assert.doesNotMatch(serializedPayload, new RegExp(sensitiveSentinel));
  }

  const extendedIntent = {
    ...prepared.intent,
    reviewer_email: "reviewer@example.invalid",
    client_secret: "client-secret-sentinel"
  };
  expectFailure(
    () => buildLiftProofingApprovalExecutionPlan({
      company_id: "91",
      prepared: {
        ...prepared,
        intent: extendedIntent,
        canonical_body_hash: createHash("sha256")
          .update(JSON.stringify(extendedIntent))
          .digest("hex")
      } as unknown as ProofDecisionIntegrityContract
    }),
    "prepared_contract_invalid"
  );
});

test("fails closed for malformed prepared contracts and canonical hash drift", () => {
  const prepared = preparedApproval();
  expectFailure(
    () => buildLiftProofingApprovalExecutionPlan({
      company_id: "91",
      prepared: {
        ...prepared,
        canonical_body_hash: "0".repeat(64)
      }
    }),
    "canonical_hash_mismatch"
  );
  expectFailure(
    () => buildLiftProofingApprovalExecutionPlan({
      company_id: "91",
      prepared: {
        ...prepared,
        outcome: "confirmed"
      } as unknown as ProofDecisionIntegrityContract
    }),
    "prepared_contract_invalid"
  );
  const unnormalizedIntent = {
    ...prepared.intent,
    note: "  Not normalized.  "
  };
  expectFailure(
    () => buildLiftProofingApprovalExecutionPlan({
      company_id: "91",
      prepared: {
        ...prepared,
        intent: unnormalizedIntent,
        canonical_body_hash: createHash("sha256")
          .update(JSON.stringify(unnormalizedIntent))
          .digest("hex")
      }
    }),
    "prepared_contract_invalid"
  );
});

test("keeps the approval plan unexported, unroutable, unsigned, credential-free, and untransported", async () => {
  const planSource = await readFile(
    new URL("../src/proofing-approval-plan.ts", import.meta.url),
    "utf8"
  );
  const rootAdapterSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const appsSourceRoot = new URL("../../../apps/", import.meta.url);
  const appSourceFiles = (await readdir(appsSourceRoot, { recursive: true }))
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
  const appRuntimeSources = await Promise.all(
    appSourceFiles.map(async (path) => ({
      path,
      source: await readFile(new URL(path, appsSourceRoot), "utf8")
    }))
  );

  assert.doesNotMatch(rootAdapterSource, /proofing-approval-plan/);
  for (const source of appRuntimeSources) {
    assert.doesNotMatch(
      source.source,
      /proofing-approval-plan/,
      `Unexpected runtime approval-plan import in ${source.path}`
    );
  }
  assert.doesNotMatch(planSource, /\bfetch\s*\(|process\.env|createHmac|jsonwebtoken|jose/);
  assert.doesNotMatch(planSource, /client_secret|clientSecret|\bsignedJwt\b|authorizationValue/);
  assert.doesNotMatch(
    planSource,
    /\bexpress\b|\bRouter\b|runtime-config|decision-ledger|decision-atomicity|secrets-store/
  );
  assert.doesNotMatch(planSource, /Bearer\s+[A-Za-z0-9._~-]+/);
});

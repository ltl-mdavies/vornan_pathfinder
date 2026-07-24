import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  buildLiftProofingDecisionPath,
  buildLiftProofingDecisionRequestContract,
  buildLiftProofingUnsignedJwtContract,
  classifyLiftProofingDecisionResponse,
  LIFT_PROOFING_DECISION_HEADER_REQUIREMENTS,
  LIFT_PROOFING_DECISION_METHOD,
  LIFT_PROOFING_DECISION_PATH_TEMPLATE,
  LIFT_PROOFING_JWT_AUDIENCE,
  LIFT_PROOFING_JWT_HEADER,
  LIFT_PROOFING_REJECT_REASONS,
  LiftProofingDecisionContractError,
  normalizeLiftProofingDecisionBody
} from "../src/proofing-decision-contract.ts";

function expectFailure(action: () => unknown, code: LiftProofingDecisionContractError["code"]) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof LiftProofingDecisionContractError);
    assert.equal(error.code, code);
    return true;
  });
}

test("pins the documented method, path, and header requirements without constructing credentials", () => {
  assert.equal(LIFT_PROOFING_DECISION_METHOD, "PUT");
  assert.equal(
    LIFT_PROOFING_DECISION_PATH_TEMPLATE,
    "/order-management/companies/{company_id}/proofing/{proofing_id}"
  );
  assert.deepEqual(LIFT_PROOFING_DECISION_HEADER_REQUIREMENTS, {
    content_type: {
      name: "Content-Type",
      value: "application/json"
    },
    authorization: {
      name: "Authorization",
      scheme: "Bearer"
    },
    client_id: {
      name: "Lift-ERP-Client-Id"
    }
  });
  assert.equal(
    buildLiftProofingDecisionPath("company-91", "proofing:9748544"),
    "/order-management/companies/company-91/proofing/proofing%3A9748544"
  );
  expectFailure(
    () => buildLiftProofingDecisionPath("../company", "proofing-1"),
    "identifier_invalid"
  );
});

test("models deterministic unsigned HS256 JWT requirements without serializing or signing", () => {
  const baseline = buildLiftProofingUnsignedJwtContract({
    client_id: "qa-proofing-client",
    iat: 1_721_750_400,
    exp: 1_721_750_700
  });
  const replay = buildLiftProofingUnsignedJwtContract({
    client_id: "qa-proofing-client",
    iat: 1_721_750_400,
    exp: 1_721_750_700
  });

  assert.deepEqual(baseline, replay);
  assert.deepEqual(baseline.header, LIFT_PROOFING_JWT_HEADER);
  assert.deepEqual(baseline.claims, {
    iss: "https://www.lifterp.com/qa-proofing-client",
    aud: LIFT_PROOFING_JWT_AUDIENCE,
    iat: 1_721_750_400,
    exp: 1_721_750_700
  });
  assert.equal(baseline.serialization, "not_implemented");
  assert.equal(baseline.signing, "not_implemented");

  expectFailure(
    () => buildLiftProofingUnsignedJwtContract({
      client_id: "qa/proofing",
      iat: 1,
      exp: 2
    }),
    "identifier_invalid"
  );
  for (const [iat, exp] of [[1, 1], [2, 1], [-1, 1], [1.5, 2]]) {
    expectFailure(
      () => buildLiftProofingUnsignedJwtContract({
        client_id: "qa-proofing-client",
        iat,
        exp
      }),
      "jwt_time_invalid"
    );
  }
});

test("normalizes only the documented approval body fields", () => {
  assert.deepEqual(
    normalizeLiftProofingDecisionBody({
      approve: true,
      userName: "  Reviewer Name  ",
      approveQuantity: 12,
      comment: "  Ready for production.  "
    }),
    {
      approve: true,
      userName: "Reviewer Name",
      approveQuantity: 12,
      comment: "Ready for production."
    }
  );
  assert.deepEqual(
    normalizeLiftProofingDecisionBody({
      approve: true,
      userName: "Reviewer Name"
    }),
    {
      approve: true,
      userName: "Reviewer Name"
    }
  );

  for (const approveQuantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "12"]) {
    expectFailure(
      () => normalizeLiftProofingDecisionBody({
        approve: true,
        userName: "Reviewer Name",
        approveQuantity
      }),
      "approve_quantity_invalid"
    );
  }
  expectFailure(
    () => normalizeLiftProofingDecisionBody({
      approve: true,
      userName: "Reviewer Name",
      credential: "must-not-be-accepted"
    }),
    "body_invalid"
  );
});

test("validates every documented rejection reason and revised-art conditional field", () => {
  for (const rejectReason of LIFT_PROOFING_REJECT_REASONS.filter(
    (candidate) => candidate !== "REVISED_ART_WILL_BE_SENT"
  )) {
    assert.deepEqual(
      normalizeLiftProofingDecisionBody({
        approve: false,
        userName: "Reviewer Name",
        rejectReason,
        comment: "Please revise."
      }),
      {
        approve: false,
        userName: "Reviewer Name",
        rejectReason,
        comment: "Please revise."
      }
    );
  }

  assert.deepEqual(
    normalizeLiftProofingDecisionBody({
      approve: false,
      userName: "Reviewer Name",
      rejectReason: "REVISED_ART_WILL_BE_SENT",
      artUrl: "https://artwork.example.invalid/revised-art.pdf",
      upload: true
    }),
    {
      approve: false,
      userName: "Reviewer Name",
      rejectReason: "REVISED_ART_WILL_BE_SENT",
      artUrl: "https://artwork.example.invalid/revised-art.pdf",
      upload: true
    }
  );

  expectFailure(
    () => normalizeLiftProofingDecisionBody({
      approve: false,
      userName: "Reviewer Name",
      rejectReason: "REVISED_ART_WILL_BE_SENT"
    }),
    "revised_art_url_required"
  );
  for (const artUrl of [
    "http://artwork.example.invalid/revised.pdf",
    "https://user:password@artwork.example.invalid/revised.pdf",
    "https://artwork.example.invalid/revised.pdf#token"
  ]) {
    expectFailure(
      () => normalizeLiftProofingDecisionBody({
        approve: false,
        userName: "Reviewer Name",
        rejectReason: "REVISED_ART_WILL_BE_SENT",
        artUrl
      }),
      "revised_art_url_required"
    );
  }
  for (const revisedField of [
    { artUrl: "https://artwork.example.invalid/revised.pdf" },
    { upload: false }
  ]) {
    expectFailure(
      () => normalizeLiftProofingDecisionBody({
        approve: false,
        userName: "Reviewer Name",
        rejectReason: "REJECT",
        ...revisedField
      }),
      "revised_art_fields_invalid"
    );
  }
  expectFailure(
    () => normalizeLiftProofingDecisionBody({
      approve: false,
      userName: "Reviewer Name",
      rejectReason: "UNSUPPORTED"
    }),
    "reject_reason_invalid"
  );
});

test("rejects malformed, unbounded, and control-character body values", () => {
  for (const body of [null, [], {}, { approve: "true", userName: "Reviewer" }]) {
    expectFailure(() => normalizeLiftProofingDecisionBody(body), "body_invalid");
  }
  for (const userName of ["", "x".repeat(257), "bad\u0000name"]) {
    expectFailure(
      () => normalizeLiftProofingDecisionBody({
        approve: true,
        userName
      }),
      "user_name_invalid"
    );
  }
  for (const comment of [null, "x".repeat(2_001), "bad\u0000comment"]) {
    expectFailure(
      () => normalizeLiftProofingDecisionBody({
        approve: true,
        userName: "Reviewer Name",
        comment
      }),
      "comment_invalid"
    );
  }
});

test("builds a non-executable request descriptor and leaves every response unclassified", () => {
  const request = buildLiftProofingDecisionRequestContract({
    company_id: "company-91",
    proofing_id: "9748544",
    body: {
      approve: true,
      userName: "Reviewer Name"
    }
  });

  assert.deepEqual(request, {
    method: "PUT",
    path: "/order-management/companies/company-91/proofing/9748544",
    required_headers: LIFT_PROOFING_DECISION_HEADER_REQUIREMENTS,
    body: {
      approve: true,
      userName: "Reviewer Name"
    },
    response_contract: "unconfirmed"
  });
  assert.equal("url" in request, false);
  assert.equal("headers" in request, false);

  for (const observation of [
    { status: 200, content_type: "application/json", body: { success: true } },
    { status: 204, body: null },
    { status: 400, body: { error: "invalid" } },
    { status: 500, body: "unavailable" },
    {}
  ]) {
    assert.deepEqual(classifyLiftProofingDecisionResponse(observation), {
      classification: "unclassified",
      confirmed: false,
      retryable: false,
      reason: "authoritative_response_contract_required"
    });
  }
});

test("keeps the protocol contract absent from runtime entry graphs and write capability flags false", async () => {
  const contractSource = await readFile(
    new URL("../src/proofing-decision-contract.ts", import.meta.url),
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

  assert.doesNotMatch(rootAdapterSource, /proofing-decision-contract/);
  for (const source of appRuntimeSources) {
    assert.doesNotMatch(
      source.source,
      /proofing-decision-contract/,
      `Unexpected runtime contract import in ${source.path}`
    );
  }
  assert.match(runtimeConfigSource, /approve: false/);
  assert.match(runtimeConfigSource, /revision: false/);
  assert.match(runtimeConfigSource, /undo: false/);
  assert.match(runtimeConfigSource, /lift_writes_enabled: false/);

  assert.doesNotMatch(contractSource, /\bfetch\s*\(|process\.env|createHmac|jsonwebtoken|jose/);
  assert.doesNotMatch(contractSource, /client_secret|clientSecret|\bsignedJwt\b|authorizationValue/);
  assert.doesNotMatch(contractSource, /\bexpress\b|\bRouter\b|runtime-config|decision-ledger|decision-atomicity/);
});

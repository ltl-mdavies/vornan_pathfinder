import assert from "node:assert/strict";
import test from "node:test";

import {
  ScheduledUncertainReconciliationError,
  selectScheduledUncertainAttempt,
  verifyScheduledUncertainProviderOrder
} from "../src/wrike-scheduled-reconciliation.js";

function job(contract = "C316981", lineCount = 11) {
  return {
    job_id: "job_20260826165801_4e2284",
    customer_id: "284619",
    submit_customer_id: "284619",
    import_method_id: "method-momentara",
    target_order_number: null,
    updated_at: "2026-08-26T16:58:16.000Z",
    scheduled_wrike_intake: {
      source: "scheduled_polling" as const,
      task_id: "MAAAAAEOLm3h",
      import_method_id: "method-momentara"
    },
    source_evidence: { provider: "wrike", task_id: "MAAAAAEOLm3h" },
    lift_payload: {
      order: {
        ext_id: "PFMTAC7UY1272E",
        order_title: `${contract} - Momentara Web Order - 20260826`,
        po_number: contract,
        contract_number: contract,
        order_type: "High End Work"
      },
      lines: Array.from({ length: lineCount }, (_, index) => ({
        line_number: index + 1,
        unit_number: `UNIT-${index + 1}`,
        product_id: `PRODUCT-${index + 1}`,
        product_name: `Placard ${index + 1}`,
        quantity: index + 1,
        dimensions: { final_height: 10 + index, final_width: 20 + index }
      }))
    }
  };
}

function attempt() {
  return {
    attempt_id: "submit_b5d039",
    job_id: "job_20260826165801_4e2284",
    customer_id: "284619",
    state: "Submission Uncertain",
    transport_mode: "live",
    external_submit_enabled: true,
    ext_id: "PFMTAC7UY1272E",
    company_id: "91",
    idempotency_key: "submit-key",
    request_fingerprint: "request-fingerprint",
    response: { lift_order_id: null }
  };
}

function providerOrder(contract = "C316981", lineCount = 11) {
  return {
    rowset: [{
      ORDER_NUMBER: "A0229496",
      EXT_ID: "PFMTAC7UY1272E",
      COMPANY_ID: "91",
      CUSTOMER_ID: "284619",
      CUSTOMER_NAME: "Momentara",
      ORDER_TITLE: contract,
      PO_NUMBER: contract,
      CONTRACT_NUMBER: contract,
      CREATED_BY: "PATHFINDER",
      ORDER_TYPE_NAME: "High End Work",
      ORDER_STATUS: "Pending Art",
      LINES: Array.from({ length: lineCount }, (_, index) => ({
        LINE_NUMBER: index + 1,
        QUANTITY: index + 1,
        UNIT_NUMBER: `UNIT-${index + 1}`,
        PRODUCT_ID: `PRODUCT-${index + 1}`,
        PRODUCT_NAME: `Placard ${index + 1}`,
        PRINT_H_IN: 10 + index,
        PRINT_W_IN: 20 + index
      }))
    }]
  };
}

test("selects only the one exact live uncertain attempt and never a second transport", () => {
  assert.equal(
    selectScheduledUncertainAttempt({
      job: job(),
      attempts: [attempt()],
      expected_attempt_id: "submit_b5d039"
    }).attempt_id,
    "submit_b5d039"
  );
  assert.throws(
    () => selectScheduledUncertainAttempt({
      job: job(),
      attempts: [attempt(), { ...attempt(), attempt_id: "submit-second" }]
    }),
    (error) =>
      error instanceof ScheduledUncertainReconciliationError &&
      error.code === "attempt_ambiguous"
  );
});

test("strictly verifies the exact C316981 incident order and Lift's contract-title normalization", () => {
  const verified = verifyScheduledUncertainProviderOrder({
    job: job(),
    attempt: attempt(),
    order_number: "A0229496",
    provider_payload: providerOrder(),
    provider_company_id: "91",
    expected_order_type: "High End Work",
    fetched_at: "2026-08-26T17:10:00.000Z"
  });
  assert.equal(verified.order_number, "A0229496");
  assert.equal(verified.external_order_id, "PFMTAC7UY1272E");
  assert.equal(verified.customer_id, "284619");
  assert.equal(verified.line_count, 11);
  assert.equal(verified.submit_attempt_id, "submit_b5d039");
  assert.match(verified.line_fingerprint, /^[a-f0-9]{64}$/);
});

test("accepts the live AS360Orders shape only when its visible identities exactly bind the attempt", () => {
  const payload = providerOrder();
  delete (payload.rowset[0] as Record<string, unknown>).EXT_ID;
  delete (payload.rowset[0] as Record<string, unknown>).COMPANY_ID;
  delete (payload.rowset[0] as Record<string, unknown>).CONTRACT_NUMBER;
  const verified = verifyScheduledUncertainProviderOrder({
    job: job(),
    attempt: attempt(),
    order_number: "A0229496",
    provider_payload: payload,
    provider_company_id: "91",
    expected_order_type: "High End Work",
    fetched_at: "2026-08-26T23:50:00.000Z"
  });
  assert.equal(verified.external_order_id, "PFMTAC7UY1272E");
  assert.equal(verified.company_id, "91");
  assert.equal(verified.contract_number, "C316981");
});

test("reconciles AS360Orders product names with their rendered dimension suffix", () => {
  const payload = providerOrder();
  for (const line of payload.rowset[0]!.LINES) {
    line.PRODUCT_NAME = `${line.PRODUCT_NAME}-${line.PRINT_W_IN}x${line.PRINT_H_IN}`;
  }
  const verified = verifyScheduledUncertainProviderOrder({
    job: job(),
    attempt: attempt(),
    order_number: "A0229496",
    provider_payload: payload,
    provider_company_id: "91",
    expected_order_type: "High End Work",
    fetched_at: "2026-08-28T18:35:00.000Z"
  });
  assert.equal(verified.line_count, 11);
});

test("normalizes only spacing around Lift product-name hyphens", () => {
  const spacedJob = job();
  spacedJob.lift_payload.lines[0]!.product_name = "Ice Box - SL 40 Right Side (Aligned)";
  const payload = providerOrder();
  payload.rowset[0]!.LINES[0]!.PRODUCT_NAME = "Ice Box- SL 40 Right Side (Aligned)-20x10";
  const verified = verifyScheduledUncertainProviderOrder({
    job: spacedJob,
    attempt: attempt(),
    order_number: "A0229496",
    provider_payload: payload,
    provider_company_id: "91",
    expected_order_type: "High End Work",
    fetched_at: "2026-08-28T18:48:00.000Z"
  });
  assert.equal(verified.line_count, 11);
});

test("supports the exact C317014 six-line fixture without weakening its identity", () => {
  const secondJob = {
    ...job("C317014", 6),
    job_id: "job_20260826211301_b60000",
    source_evidence: { provider: "wrike", task_id: "MAAAAAEOhfy9" },
    scheduled_wrike_intake: {
      source: "scheduled_polling" as const,
      task_id: "MAAAAAEOhfy9",
      import_method_id: "method-momentara"
    },
    lift_payload: {
      ...job("C317014", 6).lift_payload,
      order: {
        ...job("C317014", 6).lift_payload.order,
        ext_id: "PFMTALBSP726F8"
      }
    }
  };
  const secondAttempt = {
    ...attempt(),
    attempt_id: "submit_a39831",
    job_id: secondJob.job_id,
    ext_id: "PFMTALBSP726F8"
  };
  const payload = providerOrder("C317014", 6);
  payload.rowset[0]!.ORDER_NUMBER = "A0229542";
  payload.rowset[0]!.EXT_ID = "PFMTALBSP726F8";
  const verified = verifyScheduledUncertainProviderOrder({
    job: secondJob,
    attempt: secondAttempt,
    order_number: "A0229542",
    provider_payload: payload,
    provider_company_id: "91",
    expected_order_type: "High End Work",
    fetched_at: "2026-08-26T21:20:00.000Z"
  });
  assert.equal(verified.line_count, 6);
  assert.equal(verified.external_order_id, "PFMTALBSP726F8");
});

test("fails closed for Ext_ID, customer, contract, line, missing, and ambiguous matches", () => {
  const cases: Array<[string, (payload: ReturnType<typeof providerOrder>) => void]> = [
    ["external_id_mismatch", (payload) => { payload.rowset[0]!.EXT_ID = "OTHER"; }],
    ["customer_mismatch", (payload) => { payload.rowset[0]!.CUSTOMER_ID = "1249"; }],
    ["order_title_mismatch", (payload) => { payload.rowset[0]!.ORDER_TITLE = "OTHER"; }],
    ["contract_mismatch", (payload) => { payload.rowset[0]!.CONTRACT_NUMBER = "C000000"; }],
    ["line_identity_mismatch", (payload) => { payload.rowset[0]!.LINES[0]!.PRODUCT_NAME = "Different product-20x10"; }],
    ["line_identity_mismatch", (payload) => { payload.rowset[0]!.LINES[0]!.QUANTITY = 999; }]
  ];
  for (const [code, mutate] of cases) {
    const payload = providerOrder();
    mutate(payload);
    assert.throws(
      () => verifyScheduledUncertainProviderOrder({
        job: job(),
        attempt: attempt(),
        order_number: "A0229496",
        provider_payload: payload,
        provider_company_id: "91",
        expected_order_type: "High End Work",
        fetched_at: "2026-08-26T17:10:00.000Z"
      }),
      (error) => error instanceof ScheduledUncertainReconciliationError && error.code === code
    );
  }
  assert.throws(
    () => verifyScheduledUncertainProviderOrder({
      job: job(), attempt: attempt(), order_number: "A0229496",
      provider_payload: { rowset: [] }, provider_company_id: "91",
      expected_order_type: "High End Work", fetched_at: "2026-08-26T17:10:00.000Z"
    }),
    (error) => error instanceof ScheduledUncertainReconciliationError && error.code === "provider_order_missing"
  );
  const duplicate = providerOrder();
  duplicate.rowset.push(structuredClone(duplicate.rowset[0]!));
  assert.throws(
    () => verifyScheduledUncertainProviderOrder({
      job: job(), attempt: attempt(), order_number: "A0229496",
      provider_payload: duplicate, provider_company_id: "91",
      expected_order_type: "High End Work", fetched_at: "2026-08-26T17:10:00.000Z"
    }),
    (error) => error instanceof ScheduledUncertainReconciliationError && error.code === "provider_order_ambiguous"
  );
});

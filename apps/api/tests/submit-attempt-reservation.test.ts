import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { SubmitAttempt } from "../src/store.js";

let testDirectory = "";
let reserveSubmitAttempt: typeof import("../src/store.ts")["reserveSubmitAttempt"];
let persistSubmitAttempt: typeof import("../src/store.ts")["persistSubmitAttempt"];
let listSubmitAttemptsForJob: typeof import("../src/store.ts")["listSubmitAttemptsForJob"];

const customer = {
  lift_customer_id: "submit-reservation-customer",
  customer_name: "Submit Reservation Customer",
  customer_number: null,
  customer_type: null,
  customer_status: "Regular",
  sales_rep: null,
  default_invoice_email_address: null,
  created_date: null,
  crm_id: null,
  terms: null,
  terms_status: null,
  credit_limit: null,
  credit_hold: null,
  unpaid_total: null,
  available_credit: null
};

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-submit-reservation-test-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = join(testDirectory, "store.json");
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  const store = await import("../src/store.ts");
  reserveSubmitAttempt = store.reserveSubmitAttempt;
  persistSubmitAttempt = store.persistSubmitAttempt;
  listSubmitAttemptsForJob = store.listSubmitAttemptsForJob;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

function uncertainAttempt(): SubmitAttempt {
  return {
    attempt_id: `submit_${"a".repeat(64)}`,
    idempotency_key: `job-reservation:route:profile:${"b".repeat(64)}`,
    customer_id: customer.lift_customer_id,
    customer_name: customer.customer_name,
    job_id: "job-reservation",
    output_route_id: "route-reservation",
    output_route_name: "Reservation Route",
    submit_profile_id: "profile-reservation",
    submit_profile_name: "Reservation Profile",
    submit_mode: "sandbox_customer",
    sandbox: true,
    state: "Submission Uncertain",
    transport_mode: "live",
    external_submit_enabled: true,
    request_fingerprint: "b".repeat(64),
    endpoint_url: "https://lift.invalid/create_order",
    ext_id: "PF-RESERVATION",
    company_id: "91",
    submit_request_masked: {} as SubmitAttempt["submit_request_masked"],
    certification: {
      can_submit: true,
      external_submit_enabled: true,
      summary: "Synthetic reservation",
      items: []
    },
    blocking_items: [],
    response: {
      status: "not_sent",
      http_status: null,
      lift_order_id: null,
      message: "Reserved before transport",
      raw_body: null,
      received_at: "2026-08-01T12:00:00.000Z"
    },
    created_at: "2026-08-01T12:00:00.000Z",
    updated_at: "2026-08-01T12:00:00.000Z"
  };
}

test("serializes concurrent reservations so exactly one caller may transport", async () => {
  const attempt = uncertainAttempt();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => reserveSubmitAttempt(customer, structuredClone(attempt)))
  );
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results.every((result) => result.attempt.attempt_id === attempt.attempt_id), true);
  assert.equal((await listSubmitAttemptsForJob(customer, attempt.job_id)).length, 1);

  const finalized = await persistSubmitAttempt(customer, {
    ...attempt,
    state: "Submission Uncertain",
    response: {
      ...attempt.response,
      status: "error",
      message: "Synthetic timeout"
    },
    updated_at: "2026-08-01T12:00:10.000Z"
  });
  const replay = await reserveSubmitAttempt(customer, structuredClone(attempt));
  assert.equal(replay.created, false);
  assert.equal(replay.attempt.response.message, finalized.response.message);
});

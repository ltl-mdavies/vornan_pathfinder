import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeWrikeOrderRehearsal,
  getWrikeOrderRehearsalConfig,
  wrikeOrderRehearsalConfirmationPhrase,
  WrikeOrderRehearsalError
} from "../src/wrike-order-rehearsal.js";

const now = new Date("2026-07-31T16:00:00.000Z");
const readyConfig = {
  enabled: true,
  customer_id: "284619",
  import_method_id: "method-wrike-placard",
  task_id: "IEDEMOORDER",
  expires_at: "2026-07-31T20:00:00.000Z"
} as const;

test("authorizes only the exact bounded rehearsal tuple and confirmation phrase", () => {
  assert.deepEqual(
    authorizeWrikeOrderRehearsal({
      config: readyConfig,
      customer_id: "284619",
      import_method_id: "method-wrike-placard",
      task_id: "IEDEMOORDER",
      confirmation_phrase: wrikeOrderRehearsalConfirmationPhrase("IEDEMOORDER"),
      now
    }),
    {
      customer_id: "284619",
      import_method_id: "method-wrike-placard",
      task_id: "IEDEMOORDER",
      expires_at: "2026-07-31T20:00:00.000Z"
    }
  );
});

test("normalizes harmless task whitespace while preserving the exact bounded identity", () => {
  assert.equal(
    authorizeWrikeOrderRehearsal({
      config: readyConfig,
      customer_id: "284619",
      import_method_id: "method-wrike-placard",
      task_id: "  IEDEMOORDER  ",
      confirmation_phrase: wrikeOrderRehearsalConfirmationPhrase("IEDEMOORDER"),
      now
    }).task_id,
    "IEDEMOORDER"
  );
});

test("fails closed before rehearsal when disabled, incomplete, expired, or overlong", () => {
  const cases = [
    { config: { ...readyConfig, enabled: false }, message: /disabled/i },
    { config: { ...readyConfig, task_id: null }, message: /exact customer/i },
    { config: { ...readyConfig, expires_at: "2026-07-31T15:59:59.000Z" }, message: /expired/i },
    { config: { ...readyConfig, expires_at: "2026-08-01T16:00:01.000Z" }, message: /24 hours/i }
  ];
  for (const item of cases) {
    assert.throws(
      () =>
        authorizeWrikeOrderRehearsal({
          config: item.config,
          customer_id: "284619",
          import_method_id: "method-wrike-placard",
          task_id: "IEDEMOORDER",
          confirmation_phrase: wrikeOrderRehearsalConfirmationPhrase("IEDEMOORDER"),
          now
        }),
      item.message
    );
  }
});

test("rejects cross-customer, cross-method, cross-task, and confirmation drift", () => {
  const cases = [
    { customer_id: "other-customer", statusCode: 403 },
    { import_method_id: "other-method", statusCode: 403 },
    { task_id: "IEOTHER", statusCode: 403 },
    { confirmation_phrase: "PREPARE", statusCode: 400 }
  ];
  for (const item of cases) {
    assert.throws(
      () =>
        authorizeWrikeOrderRehearsal({
          config: readyConfig,
          customer_id: item.customer_id ?? "284619",
          import_method_id: item.import_method_id ?? "method-wrike-placard",
          task_id: item.task_id ?? "IEDEMOORDER",
          confirmation_phrase:
            item.confirmation_phrase ?? wrikeOrderRehearsalConfirmationPhrase("IEDEMOORDER"),
          now
        }),
      (error) =>
        error instanceof WrikeOrderRehearsalError && error.statusCode === item.statusCode
    );
  }
});

test("reports only bounded fingerprints for task binding drift", () => {
  assert.throws(
    () => authorizeWrikeOrderRehearsal({
      config: readyConfig,
      customer_id: "284619",
      import_method_id: "method-wrike-placard",
      task_id: "IEOTHER",
      confirmation_phrase: wrikeOrderRehearsalConfirmationPhrase("IEDEMOORDER"),
      now
    }),
    (error) => {
      assert.ok(error instanceof WrikeOrderRehearsalError);
      assert.deepEqual(error.bindingDiagnostic, {
        binding: "task_id",
        expected_fingerprint: "1b08dcfd21fff9f4",
        received_fingerprint: "e75aad6702c8facd",
        expected_length: 11,
        received_length: 7,
        received_type: "string"
      });
      const serialized = JSON.stringify(error.bindingDiagnostic);
      assert.equal(serialized.includes("IEDEMOORDER"), false);
      assert.equal(serialized.includes("IEOTHER"), false);
      return true;
    }
  );

  assert.throws(
    () => authorizeWrikeOrderRehearsal({
      config: readyConfig,
      customer_id: "284619",
      import_method_id: "method-wrike-placard",
      task_id: undefined,
      confirmation_phrase: wrikeOrderRehearsalConfirmationPhrase("IEDEMOORDER"),
      now
    }),
    (error) =>
      error instanceof WrikeOrderRehearsalError &&
      error.bindingDiagnostic?.received_type === "missing" &&
      error.bindingDiagnostic.received_length === 0
  );
});

test("normalizes safe environment configuration without leaking malformed values", () => {
  assert.deepEqual(
    getWrikeOrderRehearsalConfig({
      PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL: "true",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_CUSTOMER_ID: " 284619 ",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_IMPORT_METHOD_ID: " method-wrike-placard ",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_TASK_ID: "bad task id",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_EXPIRES_AT: "not-a-date"
    }),
    {
      enabled: true,
      customer_id: "284619",
      import_method_id: "method-wrike-placard",
      task_id: null,
      expires_at: null
    }
  );
});

test("reads the exact rehearsal tuple from the compact Lambda scope", () => {
  assert.deepEqual(
    getWrikeOrderRehearsalConfig({
      PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL: "true",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_SCOPE:
        "284619|method-wrike-placard|IEDEMOORDER|2026-07-31T20:00:00.000Z",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_CUSTOMER_ID: "ignored-customer",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_TASK_ID: "ignored-task"
    }),
    readyConfig
  );

  assert.deepEqual(
    getWrikeOrderRehearsalConfig({
      PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL: "true",
      PATHFINDER_WRIKE_ORDER_REHEARSAL_SCOPE: "malformed|scope"
    }),
    {
      enabled: true,
      customer_id: null,
      import_method_id: null,
      task_id: null,
      expires_at: null
    }
  );
});

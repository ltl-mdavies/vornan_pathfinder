import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PUBLIC_STATUS_POLL_MS,
  publicStatusPollDelay,
  shouldPollPublicStatus
} from "../src/live-refresh.js";

test("uses a bounded server-directed polling interval", () => {
  assert.equal(publicStatusPollDelay(undefined), DEFAULT_PUBLIC_STATUS_POLL_MS);
  assert.equal(publicStatusPollDelay(1), 15_000);
  assert.equal(publicStatusPollDelay(30), 30_000);
  assert.equal(publicStatusPollDelay(300), 60_000);
});

test("polls only while the status page is visible", () => {
  assert.equal(shouldPollPublicStatus("visible"), true);
  assert.equal(shouldPollPublicStatus("hidden"), false);
});

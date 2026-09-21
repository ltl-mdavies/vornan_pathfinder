import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PUBLIC_STATUS_EXPIRED_TOKEN_RETENTION_DAYS,
  DEFAULT_PUBLIC_STATUS_TOKEN_DAYS,
  publicStatusTokenDeadlines
} from "../src/public-status-token-policy.js";

test("keeps status links active for 60 days and retains recovery metadata afterward", () => {
  const deadlines = publicStatusTokenDeadlines({ now: new Date("2026-09-21T12:00:00.000Z") });

  assert.equal(DEFAULT_PUBLIC_STATUS_TOKEN_DAYS, 60);
  assert.equal(DEFAULT_PUBLIC_STATUS_EXPIRED_TOKEN_RETENTION_DAYS, 90);
  assert.equal(deadlines.expires_at, "2026-11-20T12:00:00.000Z");
  assert.equal(deadlines.expires_at_epoch, Date.parse(deadlines.expires_at) / 1000);
  assert.equal(
    deadlines.purge_at_epoch,
    Date.parse("2027-02-18T12:00:00.000Z") / 1000
  );
});

test("normalizes invalid and fractional day configuration safely", () => {
  const deadlines = publicStatusTokenDeadlines({
    now: new Date("2026-09-21T12:00:00.000Z"),
    activeDays: 7.9,
    expiredRetentionDays: "invalid"
  });

  assert.equal(deadlines.expires_at, "2026-09-28T12:00:00.000Z");
  assert.equal(deadlines.purge_at_epoch, Date.parse("2026-12-27T12:00:00.000Z") / 1000);
});

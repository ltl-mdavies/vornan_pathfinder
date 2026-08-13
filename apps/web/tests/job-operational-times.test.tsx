import assert from "node:assert/strict";
import test from "node:test";
import {
  displayLiftCreated,
  rankRecentOperationalJobs
} from "../src/job-operational-times";

test("date-only Lift creation is displayed as a date without a fabricated 8 PM time", () => {
  const displayed = displayLiftCreated("2026-08-13", "date", {
    locale: "en-US",
    timeZone: "America/New_York"
  });
  assert.equal(displayed, "Aug 13");
  assert.doesNotMatch(displayed ?? "", /8:00|Aug 12/);
});

test("exact Pathfinder submit confirmation displays the actual local time", () => {
  assert.equal(
    displayLiftCreated("2026-08-13T14:28:17.997Z", "timestamp", {
      locale: "en-US",
      timeZone: "America/New_York"
    }),
    "Aug 13, 10:28 AM"
  );
});

test("recent jobs lead with triage then rank confirmed orders by Lift creation", () => {
  const common = {
    updated_at: "2026-08-13T15:00:00.000Z",
    last_activity_at: "2026-08-13T14:00:00.000Z"
  };
  const jobs = [
    {
      id: "older-confirmed",
      state: "Order Confirmed",
      target_order_number: "A1",
      target_order_created_at: "2026-08-12T15:00:00.000Z",
      created_at: "2026-08-12T14:00:00.000Z",
      ...common
    },
    {
      id: "failed",
      state: "Submit Failed",
      target_order_number: null,
      target_order_created_at: null,
      created_at: "2026-08-11T14:00:00.000Z",
      ...common,
      last_activity_at: "2026-08-13T14:30:00.000Z"
    },
    {
      id: "newer-confirmed",
      state: "Order Confirmed",
      target_order_number: "A2",
      target_order_created_at: "2026-08-13T14:28:17.997Z",
      created_at: "2026-08-13T14:28:10.000Z",
      ...common
    }
  ];
  assert.deepEqual(
    rankRecentOperationalJobs(jobs, 5, new Date("2026-08-13T16:00:00.000Z")).map((job) => job.id),
    ["failed", "newer-confirmed", "older-confirmed"]
  );
});

test("confirmed orders without Lift creation evidence fall back to Pathfinder intake", () => {
  const jobs = [
    {
      id: "older",
      state: "Order Confirmed",
      target_order_number: "A1",
      target_order_created_at: null,
      created_at: "2026-08-12T14:00:00.000Z",
      updated_at: "2026-08-13T15:00:00.000Z"
    },
    {
      id: "newer",
      state: "Order Confirmed",
      target_order_number: "A2",
      target_order_created_at: null,
      created_at: "2026-08-13T14:00:00.000Z",
      updated_at: "2026-08-13T15:00:00.000Z"
    }
  ];
  assert.deepEqual(rankRecentOperationalJobs(jobs).map((job) => job.id), ["newer", "older"]);
});

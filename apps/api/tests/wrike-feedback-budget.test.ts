import assert from "node:assert/strict";
import test from "node:test";
import { createWrikeFeedbackBudget, validateWrikeFeedbackLimits } from "../src/wrike-feedback-budget.js";

test("explicit bounded limits and one request counter cover OAuth, reads and writes", async () => {
  for (const limits of [{ max_requests: NaN, max_elapsed_ms: 10 }, { max_requests: 257, max_elapsed_ms: 10 },
    { max_requests: 1, max_elapsed_ms: 0 }, { max_requests: 1, max_elapsed_ms: 120001 }]) assert.throws(() => validateWrikeFeedbackLimits(limits));
  let calls = 0;
  const budget = createWrikeFeedbackBudget({ max_requests: 3, max_elapsed_ms: 1000 }, {
    fetchImpl: async () => { calls++; return Response.json({}); }
  });
  for (const url of ["https://synthetic.invalid/oauth", "https://synthetic.invalid/task", "https://synthetic.invalid/comment"]) await budget.fetch(url);
  assert.equal(budget.report().provider_requests, 3);
  await assert.rejects(budget.fetch("https://synthetic.invalid/extra"), /budget exhausted/);
  assert.equal(calls, 3);
  assert.equal(budget.report().exhausted, "requests");
});

test("one elapsed deadline persists across calls and prevents late provider dispatch", async () => {
  let now = 0; let calls = 0;
  const budget = createWrikeFeedbackBudget({ max_requests: 10, max_elapsed_ms: 100 }, {
    monotonicNow: () => now, fetchImpl: async () => { calls++; return Response.json({}); }
  });
  now = 99;
  await budget.fetch("https://synthetic.invalid/task");
  now = 100;
  await assert.rejects(budget.fetch("https://synthetic.invalid/comment"), /budget exhausted/);
  assert.equal(calls, 1);
  assert.equal(budget.report().exhausted, "elapsed");
});

test("aggregate deadline aborts an in-flight request instead of restarting per fetch", async () => {
  const budget = createWrikeFeedbackBudget({ max_requests: 10, max_elapsed_ms: 20 }, {
    fetchImpl: async (_input, init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({})), 1000);
      const abort = () => { clearTimeout(timer); reject(new Error("aborted")); };
      if (init!.signal!.aborted) abort();
      else init!.signal!.addEventListener("abort", abort, { once: true });
    })
  });
  await assert.rejects(budget.fetch("https://synthetic.invalid/task"));
  assert.equal(budget.report().exhausted, "elapsed");
  assert.equal(budget.report().provider_requests, 1);
});

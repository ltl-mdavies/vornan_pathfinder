export interface WrikeFeedbackLimits { max_requests: number; max_elapsed_ms: number }
export interface WrikeFeedbackBudgetReport {
  provider_requests: number; elapsed_ms: number; exhausted: "requests" | "elapsed" | null;
}
export function validateWrikeFeedbackLimits(limits: WrikeFeedbackLimits) {
  if (!Number.isInteger(limits.max_requests) || limits.max_requests < 1 || limits.max_requests > 256 ||
    !Number.isInteger(limits.max_elapsed_ms) || limits.max_elapsed_ms < 1 || limits.max_elapsed_ms > 120_000) {
    throw new Error("Wrike feedback requires explicit request (1–256) and elapsed-time (1–120000 ms) limits");
  }
}
/** One budget spans both discovery passes, OAuth, metadata and comment transport. */
export function createWrikeFeedbackBudget(limits: WrikeFeedbackLimits, options: {
  monotonicNow?: () => number; fetchImpl?: typeof fetch;
} = {}) {
  validateWrikeFeedbackLimits(limits);
  const now = options.monotonicNow ?? (() => performance.now());
  const started = now();
  const deadline = AbortSignal.timeout(limits.max_elapsed_ms);
  let requests = 0;
  let exhausted: WrikeFeedbackBudgetReport["exhausted"] = null;
  const elapsed = () => Math.max(0, now() - started);
  function check() {
    if (deadline.aborted || elapsed() >= limits.max_elapsed_ms) exhausted = "elapsed";
    if (exhausted) throw new Error("Wrike feedback provider budget exhausted");
  }
  function canRequest() {
    check();
    if (requests >= limits.max_requests) {
      exhausted = "requests";
      throw new Error("Wrike feedback provider budget exhausted");
    }
  }
  const fetchImpl: typeof fetch = async (input, init) => {
    canRequest();
    requests++;
    const inputSignal = input instanceof Request ? input.signal : undefined;
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(15_000),
      ...(init?.signal ? [init.signal] : inputSignal ? [inputSignal] : [])]);
    try {
      const response = await (options.fetchImpl ?? fetch)(input, { ...init, signal });
      check();
      return response;
    } finally {
      if (deadline.aborted || elapsed() >= limits.max_elapsed_ms) exhausted = "elapsed";
    }
  };
  return { check, canRequest, fetch: fetchImpl,
    report: (): WrikeFeedbackBudgetReport => ({ provider_requests: requests, elapsed_ms: Math.ceil(elapsed()),
      exhausted: deadline.aborted || elapsed() >= limits.max_elapsed_ms ? "elapsed" : exhausted }) };
}

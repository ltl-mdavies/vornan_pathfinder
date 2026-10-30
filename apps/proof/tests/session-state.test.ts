import assert from "node:assert/strict";
import test from "node:test";
import {
  createFailClosedSessionTerminator,
  focusProofTerminalState,
  ProofAccessExchangeError,
  proofEntryState,
  sessionExpiryDelay,
  sessionSecondsRemaining,
  sessionWarningVisible
} from "../src/session-state.ts";
import { watchProofAccessNavigation } from "../src/session-state.ts";

test("exchange errors preserve their stage without retaining credentials or claiming transient failure is expiry", () => {
  const rejected = new ProofAccessExchangeError(true);
  assert.equal(rejected.name, "ProofAccessExchangeError");
  assert.match(rejected.message, /invalid, expired, or has already been used/);
  const unavailable = new ProofAccessExchangeError(false);
  assert.match(unavailable.message, /couldn’t open/);
  assert.doesNotMatch(unavailable.message, /expired|already been used/);
  assert.equal("cause" in rejected, false);
  assert.equal("token" in rejected, false);
});

test("new access navigation reloads once without replaying workspace refreshes", () => {
  let listener: (() => void) | undefined;
  let reloads = 0;
  const location = { hash: "#/session-ended", reload: () => { reloads += 1; } };
  const dispose = watchProofAccessNavigation({
    location,
    addEventListener: (_type, callback) => { listener = callback; },
    removeEventListener: (_type, callback) => { assert.equal(callback, listener); listener = undefined; }
  });
  assert.equal(reloads, 0, "initial document load belongs to normal bootstrap");
  for (const hash of ["#/proof", "#/session-ended", "#/link-unavailable"]) {
    location.hash = hash;
    listener!();
  }
  assert.equal(reloads, 0, "normal route/quiet-refresh behavior is unchanged");
  location.hash = `#/access/${"A".repeat(43)}`;
  listener!();
  listener!();
  assert.equal(reloads, 1);
  dispose();
  assert.equal(listener, undefined);
});

test("malformed access navigation also reaches fail-closed bootstrap", () => {
  let listener: (() => void) | undefined;
  let reloads = 0;
  watchProofAccessNavigation({
    location: { hash: "#/access/invalid", reload: () => { reloads += 1; } },
    addEventListener: (_type, callback) => { listener = callback; },
    removeEventListener: () => undefined
  });
  listener!();
  assert.equal(reloads, 1);
  assert.deepEqual(proofEntryState("#/access/invalid"), { kind: "link_unavailable" });
});

test("classifies valid fragment tokens without accepting malformed token shapes", () => {
  const token = "A".repeat(43);
  assert.deepEqual(proofEntryState(`#/access/${token}`), { kind: "access_token", token });
  assert.deepEqual(proofEntryState("#/access/short"), { kind: "link_unavailable" });
  assert.deepEqual(proofEntryState(`#/access/${"A".repeat(43)}?leak=true`), { kind: "link_unavailable" });
});

test("keeps link-unavailable and session-ended routes distinct", () => {
  assert.deepEqual(proofEntryState("#/link-unavailable"), { kind: "link_unavailable" });
  assert.deepEqual(proofEntryState("#/session-ended"), { kind: "session_ended" });
  assert.deepEqual(proofEntryState("#/proof"), { kind: "workspace" });
});

test("computes a bounded session expiry delay", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");
  assert.equal(sessionExpiryDelay("2026-07-20T12:30:00.000Z", now), 30 * 60 * 1000);
  assert.equal(sessionExpiryDelay("2026-07-20T11:59:00.000Z", now), 0);
  assert.equal(sessionExpiryDelay("invalid", now), 0);
});

test("shows a one-minute warning with a whole-second countdown", () => {
  const now = Date.parse("2026-07-20T12:00:00.250Z");
  assert.equal(sessionSecondsRemaining("2026-07-20T12:01:00.000Z", now), 60);
  assert.equal(sessionWarningVisible("2026-07-20T12:01:00.000Z", now), true);
  assert.equal(sessionWarningVisible("2026-07-20T12:01:01.000Z", now), false);
  assert.equal(sessionWarningVisible("2026-07-20T11:59:00.000Z", now), false);
});

test("hides proof data immediately before starting remote cleanup once", async () => {
  const events: string[] = [];
  let finishCleanup: (() => void) | null = null;
  const terminate = createFailClosedSessionTerminator(
    () => new Promise<void>((resolve) => {
      events.push("remote-started");
      finishCleanup = resolve;
    }),
    () => events.push("local-ended")
  );

  const cleanup = terminate();
  assert.deepEqual(events, ["local-ended", "remote-started"]);
  assert.equal(terminate(), null);
  assert.deepEqual(events, ["local-ended", "remote-started"]);
  finishCleanup!();
  await cleanup;
});

test("keeps the terminal state fail-closed when remote cleanup fails", async () => {
  let localEnded = false;
  const rejected = createFailClosedSessionTerminator(
    async () => { throw new Error("network unavailable"); },
    () => { localEnded = true; }
  );
  await rejected();
  assert.equal(localEnded, true);

  localEnded = false;
  const threwSynchronously = createFailClosedSessionTerminator(
    () => { throw new Error("cookie unavailable"); },
    () => { localEnded = true; }
  );
  await threwSynchronously();
  assert.equal(localEnded, true);
});

test("moves focus to a connected terminal state without allowing focus failures to escape", () => {
  const focusOptions: Array<{ preventScroll?: boolean }> = [];
  assert.equal(focusProofTerminalState({
    isConnected: true,
    focus: (options) => focusOptions.push(options ?? {})
  }), true);
  assert.deepEqual(focusOptions, [{ preventScroll: true }]);

  let detachedFocused = false;
  assert.equal(focusProofTerminalState({
    isConnected: false,
    focus: () => { detachedFocused = true; }
  }), false);
  assert.equal(detachedFocused, false);

  assert.equal(focusProofTerminalState({
    isConnected: true,
    focus: () => { throw new Error("focus unavailable"); }
  }), false);
  assert.equal(focusProofTerminalState(null), false);
});

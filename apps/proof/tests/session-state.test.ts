import assert from "node:assert/strict";
import test from "node:test";
import { createFailClosedSessionTerminator, proofEntryState, sessionExpiryDelay } from "../src/session-state.ts";

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

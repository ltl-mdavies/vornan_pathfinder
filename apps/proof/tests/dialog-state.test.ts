import assert from "node:assert/strict";
import test from "node:test";
import { restoreProofDialogFocus } from "../src/dialog-state.ts";

test("restores dialog focus only to a connected target", () => {
  const calls: Array<FocusOptions | undefined> = [];
  assert.equal(restoreProofDialogFocus({
    isConnected: true,
    focus: (options) => calls.push(options)
  }), true);
  assert.deepEqual(calls, [{ preventScroll: true }]);

  assert.equal(restoreProofDialogFocus({
    isConnected: false,
    focus: () => assert.fail("detached targets must not receive focus")
  }), false);
  assert.equal(restoreProofDialogFocus(null), false);
});

test("allows the caller to fall back when focus restoration fails", () => {
  assert.equal(restoreProofDialogFocus({
    focus: () => { throw new Error("focus target is no longer available"); }
  }), false);
});

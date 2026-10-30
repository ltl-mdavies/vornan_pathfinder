import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ProofSettingsDraftController, ProofSettingsWriteError, proofSettingsNavigationState, proofSettingsResponseUncertain, type ProofSettingsResult } from "../src/proof-settings-draft";
import type { CustomerProofCapabilityPolicy as Policy } from "../src/ProofCustomerCapabilitySetup";

const policy = (patch: Partial<Policy> = {}): Policy => ({ access_mode: "view_only", review_experience: "simple", customer_identity: null,
  order_overrides: [], updated_at: "2026-10-30T10:00:00Z", updated_by: "fixture", ...patch });
const saved = (patch: Partial<Policy> = {}): ProofSettingsResult => ({ policy: policy({ updated_at: "2026-10-30T10:01:00Z", ...patch }) });
const defaults = { kind: "defaults", value: { access_mode: "disabled", review_experience: "simple" } } as const;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("every editable field participates in the customer-scoped guard; discard is local", () => {
  for (const patch of [{ accessMode: "disabled" }, { experience: "advanced" }, { orderNumber: "A0232139" }, { overrideAccess: "disabled" }, { overrideExperience: "advanced" }, { identityOrderNumber: "A0232139" }] as const) {
    const draft = new ProofSettingsDraftController("A", policy());
    draft.edit(patch);
    assert.equal(proofSettingsNavigationState("A", draft.getSnapshot()), "confirm");
    assert.equal(proofSettingsNavigationState("B", draft.getSnapshot()), "clear");
    const snapshot = draft.getSnapshot(); // Keep editing does not change controller state.
    assert.equal(draft.getSnapshot(), snapshot);
    assert.equal(draft.discard(), true);
    assert.equal(draft.getSnapshot().dirty, false);
    assert.equal(draft.getSnapshot().inputs.accessMode, "view_only");
  }
});

test("pending synchronously blocks double submits, edits, checks, and discard until completion", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); const response = deferred<ProofSettingsResult>(); let writes = 0;
  draft.edit({ accessMode: "disabled" });
  const task = draft.run(defaults, async (_, version) => { writes++; assert.equal(version, policy().updated_at); return response.promise; });
  assert.equal(proofSettingsNavigationState("A", draft.getSnapshot()), "pending");
  assert.equal(draft.discard(), false);
  draft.edit({ accessMode: "review" });
  await draft.run(defaults, async () => { writes++; return saved(); });
  await draft.checkSaved(async () => { throw new Error("must not read while pending"); });
  assert.equal(writes, 1); assert.equal(draft.getSnapshot().inputs.accessMode, "disabled");
  response.resolve({ ...saved({ access_mode: "disabled" }), notice: "2 active review links were revoked so the new setting applies immediately." }); await task;
  assert.equal(draft.getSnapshot().dirty, false); assert.equal(draft.getSnapshot().pending, false);
  assert.match(draft.getSnapshot().message!, /2 active review links were revoked/);
});

test("known failure retains all entries and does not mark the baseline saved", async () => {
  const draft = new ProofSettingsDraftController("A", policy());
  draft.edit({ accessMode: "disabled", orderNumber: "A0232139", identityOrderNumber: "A0232139" });
  const before = draft.getSnapshot().inputs;
  await draft.run(defaults, async () => { throw new ProofSettingsWriteError("Validation failed", false); });
  assert.deepEqual(draft.getSnapshot().inputs, before);
  assert.equal(draft.getSnapshot().dirty, true); assert.equal(draft.getSnapshot().unconfirmed, false);
  assert.equal(draft.getSnapshot().message, "Validation failed");
});

test("uncertain results cannot be retried; read failure or mismatch does not invent a failed outcome", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); let writes = 0;
  draft.edit({ accessMode: "disabled" });
  await draft.run(defaults, async () => { writes++; throw new Error("lost response"); });
  await draft.run(defaults, async () => { writes++; return saved(); });
  assert.equal(writes, 1); assert.equal(draft.getSnapshot().unconfirmed, true);
  await draft.checkSaved(async () => { throw new Error("offline"); });
  assert.equal(draft.getSnapshot().unconfirmed, true);
  await draft.checkSaved(async () => saved());
  assert.equal(draft.getSnapshot().unconfirmed, true); assert.equal(draft.getSnapshot().dirty, true);
  draft.refresh(saved({ access_mode: "disabled" }).policy);
  assert.equal(draft.getSnapshot().unconfirmed, true, "background poll is not explicit confirmation");
  draft.discard();
  assert.equal(draft.getSnapshot().unconfirmed, true, "local discard must not erase an uncertain operation");
  await draft.run(defaults, async () => { writes++; return saved(); });
  assert.equal(writes, 1);
  await draft.checkSaved(async () => saved({ access_mode: "disabled" }));
  assert.equal(draft.getSnapshot().unconfirmed, false); assert.equal(draft.getSnapshot().dirty, false);
});

test("mismatched successful response is uncertain, not a confirmed save", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); draft.edit({ accessMode: "disabled" });
  await draft.run(defaults, async () => saved());
  assert.equal(draft.getSnapshot().unconfirmed, true); assert.equal(draft.getSnapshot().dirty, true);
});

test("malformed successful payload or read cannot replace the confirmed baseline", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); draft.edit({ accessMode: "disabled" });
  const malformed = { policy: { access_mode: "disabled", review_experience: "simple", updated_at: "not-a-date" } as Policy };
  await draft.run(defaults, async () => malformed);
  assert.equal(draft.getSnapshot().unconfirmed, true);
  await draft.checkSaved(async () => malformed);
  assert.equal(draft.getSnapshot().unconfirmed, true); assert.equal(draft.getSnapshot().canUseChecked, false);
  draft.discard(); assert.equal(draft.getSnapshot().inputs.accessMode, "view_only");
});

test("explicit use of checked settings unlocks without replay and retains the previous attempt", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); let writes = 0;
  draft.edit({ accessMode: "disabled" });
  await draft.run(defaults, async () => { writes++; throw new Error("offline"); });
  draft.useCheckedSettings(); assert.equal(draft.getSnapshot().unconfirmed, true, "requires an authoritative read first");
  const read = deferred<ProofSettingsResult>(); const task = draft.checkSaved(() => read.promise);
  draft.useCheckedSettings(); assert.equal(draft.getSnapshot().unconfirmed, true, "cannot resolve a pending read");
  read.resolve(saved({ access_mode: "review" })); await task;
  assert.equal(draft.getSnapshot().canUseChecked, true);
  draft.useCheckedSettings();
  assert.equal(writes, 1); assert.equal(draft.getSnapshot().unconfirmed, false); assert.equal(draft.getSnapshot().dirty, false);
  assert.equal(draft.getSnapshot().inputs.accessMode, "review"); assert.deepEqual(draft.getSnapshot().previousAttempt, defaults);
  assert.match(draft.getSnapshot().message!, /earlier request may still complete/);
  draft.refresh(policy({ access_mode: "disabled", updated_at: "2026-10-30T10:02:00Z" }));
  assert.equal(draft.getSnapshot().inputs.accessMode, "disabled", "late server change remains authoritative");
});

test("background update invalidates the checked-settings recovery choice", async () => {
  const draft = new ProofSettingsDraftController("A", policy());
  draft.edit({ accessMode: "disabled" }); await draft.run(defaults, async () => { throw new Error("offline"); });
  await draft.checkSaved(async () => saved());
  draft.refresh(policy({ updated_at: "2026-10-30T10:03:00Z", access_mode: "review" }));
  draft.useCheckedSettings(); assert.equal(draft.getSnapshot().unconfirmed, true); assert.equal(draft.getSnapshot().canUseChecked, false);
});

test("background policy change never resets an edited draft; explicit read rebases without writing", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); draft.edit({ accessMode: "disabled" });
  draft.refresh(saved({ access_mode: "review" }).policy);
  assert.equal(draft.getSnapshot().inputs.accessMode, "disabled"); assert.equal(draft.getSnapshot().changedRemotely, true);
  await draft.checkSaved(async () => saved({ access_mode: "review" }));
  assert.equal(draft.getSnapshot().inputs.accessMode, "disabled"); assert.equal(draft.getSnapshot().dirty, true);
  await draft.run(defaults, async (_, version) => { assert.equal(version, saved().policy.updated_at); return saved({ access_mode: "disabled" }); });
  assert.equal(draft.getSnapshot().dirty, false);
});

test("clean drafts track background settings; discarded dirty drafts use latest confirmed policy", () => {
  const draft = new ProofSettingsDraftController("A", policy());
  draft.refresh(saved({ access_mode: "review" }).policy); assert.equal(draft.getSnapshot().inputs.accessMode, "review");
  draft.edit({ accessMode: "disabled" }); draft.discard(); assert.equal(draft.getSnapshot().inputs.accessMode, "review");
});

test("a late success or stale refresh cannot roll back newer confirmed settings", async () => {
  const draft = new ProofSettingsDraftController("A", policy()); const response = deferred<ProofSettingsResult>();
  draft.edit({ accessMode: "disabled" }); const task = draft.run(defaults, () => response.promise);
  draft.refresh(policy({ access_mode: "review", updated_at: "2026-10-30T10:05:00Z" }));
  response.resolve(saved({ access_mode: "disabled" })); await task;
  assert.equal(draft.getSnapshot().inputs.accessMode, "review");
  assert.match(draft.getSnapshot().message!, /Newer saved settings/);
  draft.refresh(policy()); assert.equal(draft.getSnapshot().inputs.accessMode, "review");
});

test("verification/removal are executed operations, not drafts to undo; unrelated inputs survive", async () => {
  const draft = new ProofSettingsDraftController("A", policy());
  draft.edit({ accessMode: "disabled", identityOrderNumber: "A0232139", orderNumber: "A0232000" });
  const identity = { proof_customer_id: "A", verified_order_number: "A0232139", verified_at: "2026-10-30T10:01:00Z", verified_by: "fixture" };
  await draft.run({ kind: "identity", orderNumber: "A0232139" }, async () => saved({ customer_identity: identity }));
  assert.equal(draft.getSnapshot().inputs.identityOrderNumber, ""); assert.equal(draft.getSnapshot().inputs.orderNumber, "A0232000");
  assert.equal(draft.getSnapshot().inputs.accessMode, "disabled");
  await draft.run({ kind: "remove", orderNumber: "A0232000" }, async () => saved({ customer_identity: identity }));
  assert.equal(draft.getSnapshot().inputs.orderNumber, "A0232000");
  draft.discard(); assert.equal(draft.getSnapshot().dirty, false);
});

test("failed identity/override retain fields; confirmed override resets its entire form only", async () => {
  const draft = new ProofSettingsDraftController("A", policy());
  draft.edit({ orderNumber: "A0232139", overrideExperience: "advanced", identityOrderNumber: "A0232000" });
  const operation = { kind: "override", orderNumber: "A0232139", value: { access_mode: "review", review_experience: "advanced" } } as const;
  await draft.run(operation, async () => { throw new ProofSettingsWriteError("Conflict", false); });
  assert.equal(draft.getSnapshot().inputs.orderNumber, "A0232139");
  await draft.run({ kind: "identity", orderNumber: "A0232000" }, async () => { throw new ProofSettingsWriteError("Invalid", false); });
  assert.equal(draft.getSnapshot().inputs.identityOrderNumber, "A0232000");
  await draft.run(operation, async () => saved({ order_overrides: [{ order_number: operation.orderNumber, ...operation.value, updated_at: saved().policy.updated_at, updated_by: "fixture" }] }));
  assert.equal(draft.getSnapshot().inputs.orderNumber, ""); assert.equal(draft.getSnapshot().inputs.overrideExperience, "simple");
  assert.equal(draft.getSnapshot().inputs.identityOrderNumber, "A0232000");
});

test("late completion belongs only to its original customer's controller", async () => {
  const a = new ProofSettingsDraftController("A", policy()), b = new ProofSettingsDraftController("B", policy());
  const response = deferred<ProofSettingsResult>(); a.edit({ accessMode: "disabled" }); b.edit({ orderNumber: "A0232000" });
  const task = a.run(defaults, () => response.promise); const bBefore = b.getSnapshot();
  response.resolve(saved({ access_mode: "disabled" })); await task;
  assert.equal(b.getSnapshot(), bBefore); assert.equal(a.getSnapshot().dirty, false);
});

test("only known rejection statuses are safe failures; 5xx, 408 and malformed 2xx remain uncertain", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(proofSettingsResponseUncertain(status), false);
  for (const status of [200, 202, 408, 500, 502, 503, 504]) assert.equal(proofSettingsResponseUncertain(status), true);
});

test("App wires customer-scoped navigation, beforeunload and response isolation without replacing existing guards", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /customerId === selectedCustomerIdRef.current && workspaceEpoch === workspaceRequestIdRef.current/);
  assert.match(app, /updatedWorkspace.customer\?\.lift_customer_id !== customerId/);
  assert.match(app, /scope: "import-method" \| "target" \| "proof-settings"/);
  assert.match(app, /if \(methodSaveInFlight.current\)/);
  assert.match(app, /if \(activeGlobalView === "Targets" && selectedTarget && selectedTargetHasUnsavedChanges\)/);
  assert.match(app, /window.addEventListener\("beforeunload", handleBeforeUnload\)/);
  assert.match(app, /proofNeedsProtection/);
  assert.match(app, /key=\{selectedCustomerId\}\s+draft=\{customerProofDraft\(\)!\}/);
  assert.match(app, /leavePrompt.scope !== "proof-settings" && leavePrompt.scope !== "catalog" \? <button className="primary-button"/);
  assert.match(app, /does not undo a saved change/);
});

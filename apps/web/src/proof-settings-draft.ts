import type { CustomerProofCapabilityPolicy as Policy, CustomerProofAccessMode, CustomerProofReviewExperience } from "./ProofCustomerCapabilitySetup";

export type ProofSettingsValues = Pick<Policy, "access_mode" | "review_experience">;
export interface ProofSettingsResult { policy: Policy; notice?: string }
export type ProofSettingsOperation =
  | { kind: "defaults"; value: ProofSettingsValues }
  | { kind: "override"; orderNumber: string; value: ProofSettingsValues }
  | { kind: "remove"; orderNumber: string }
  | { kind: "identity"; orderNumber: string };

export interface ProofSettingsInputs {
  accessMode: CustomerProofAccessMode;
  experience: CustomerProofReviewExperience;
  orderNumber: string;
  overrideAccess: CustomerProofAccessMode;
  overrideExperience: CustomerProofReviewExperience;
  identityOrderNumber: string;
}
export interface ProofSettingsGuardState {
  customerId: string;
  dirty: boolean;
  pending: boolean;
  unconfirmed: boolean;
}
export class ProofSettingsWriteError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

export function validProofSettingsPolicy(value: unknown): value is Policy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Policy;
  const validAccess = (access: unknown) => ["disabled", "view_only", "review"].includes(String(access));
  const validExperience = (experience: unknown) => ["simple", "advanced"].includes(String(experience));
  return validAccess(policy.access_mode) && validExperience(policy.review_experience)
    && typeof policy.updated_at === "string" && Number.isFinite(Date.parse(policy.updated_at))
    && Array.isArray(policy.order_overrides) && policy.order_overrides.every(item => item && typeof item.order_number === "string" && validAccess(item.access_mode) && validExperience(item.review_experience))
    && (policy.customer_identity === null || Boolean(policy.customer_identity && typeof policy.customer_identity.proof_customer_id === "string"
      && typeof policy.customer_identity.verified_order_number === "string" && Number.isFinite(Date.parse(policy.customer_identity.verified_at))));
}

function initialInputs(policy: Policy): ProofSettingsInputs {
  return { accessMode: policy.access_mode, experience: policy.review_experience,
    orderNumber: "", overrideAccess: "review", overrideExperience: "simple", identityOrderNumber: "" };
}
function defaultsDirty(inputs: ProofSettingsInputs, policy: Policy) {
  return inputs.accessMode !== policy.access_mode || inputs.experience !== policy.review_experience;
}
export function proofSettingsPolicyOlder(candidate: Policy, current: Policy) {
  return Date.parse(candidate.updated_at) < Date.parse(current.updated_at);
}
export function proofSettingsOperationMatches(policy: Policy, operation: ProofSettingsOperation) {
  const matches = (value: ProofSettingsValues | undefined) => value?.access_mode === ("value" in operation ? operation.value.access_mode : null)
    && value?.review_experience === ("value" in operation ? operation.value.review_experience : null);
  switch (operation.kind) {
    case "defaults": return matches(policy);
    case "override": return matches(policy.order_overrides.find(item => item.order_number === operation.orderNumber));
    case "remove": return !policy.order_overrides.some(item => item.order_number === operation.orderNumber);
    case "identity": return policy.customer_identity?.verified_order_number === operation.orderNumber;
  }
}

/** Customer-owned, in-memory only. Survives a Settings unmount so an uncertain write
 * cannot become a blind retry on return. Never persists credentials or changes access. */
export class ProofSettingsDraftController {
  private listeners = new Set<() => void>();
  private baseline: Policy;
  private latest: Policy;
  private unresolved: ProofSettingsOperation | null = null;
  private checkedPolicy: Policy | null = null;
  private state: ProofSettingsGuardState & { inputs: ProofSettingsInputs; message: string | null; error: boolean; changedRemotely: boolean; canUseChecked: boolean; previousAttempt: ProofSettingsOperation | null };
  constructor(readonly customerId: string, policy: Policy) {
    this.baseline = this.latest = policy;
    this.state = { customerId, dirty: false, pending: false, unconfirmed: false,
      inputs: initialInputs(policy), message: null, error: false, changedRemotely: false, canUseChecked: false, previousAttempt: null };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<typeof this.state>) {
    const next = { ...this.state, ...patch };
    next.dirty = defaultsDirty(next.inputs, this.baseline) || Boolean(next.inputs.orderNumber || next.inputs.identityOrderNumber)
      || next.inputs.overrideAccess !== "review" || next.inputs.overrideExperience !== "simple";
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
  edit(patch: Partial<ProofSettingsInputs>) {
    if (this.state.pending || this.state.unconfirmed) return;
    this.publish({ inputs: { ...this.state.inputs, ...patch }, message: null, error: false });
  }
  refresh(policy: Policy) {
    if (policy.updated_at === this.latest.updated_at || proofSettingsPolicyOlder(policy, this.latest)) return;
    this.latest = policy;
    this.checkedPolicy = null;
    // Polls never confirm a write or silently rebase an operator's unsaved intent.
    if (this.state.dirty || this.state.pending || this.state.unconfirmed) {
      this.publish({ changedRemotely: policy.updated_at !== this.baseline.updated_at, canUseChecked: false });
      return;
    }
    this.baseline = policy;
    this.publish({ inputs: initialInputs(policy), changedRemotely: false });
  }
  discard() {
    if (this.state.pending) return false;
    this.baseline = this.latest;
    this.publish({ inputs: initialInputs(this.latest), changedRemotely: false, message: null, error: false });
    // Discard is only local. It cannot undo a verification/removal or forget an uncertain request.
    return true;
  }
  private confirm(policy: Policy, operation: ProofSettingsOperation, notice?: string) {
    const newerPolicy = proofSettingsPolicyOlder(policy, this.latest);
    if (newerPolicy) policy = this.latest;
    const inputs = { ...this.state.inputs };
    const preserveDefaults = operation.kind !== "defaults" && defaultsDirty(inputs, this.baseline);
    if (!preserveDefaults) { inputs.accessMode = policy.access_mode; inputs.experience = policy.review_experience; }
    if (operation.kind === "override") {
      inputs.orderNumber = ""; inputs.overrideAccess = "review"; inputs.overrideExperience = "simple";
    }
    if (operation.kind === "identity") inputs.identityOrderNumber = "";
    this.baseline = this.latest = policy;
    this.unresolved = null;
    this.checkedPolicy = null;
    this.publish({ inputs, unconfirmed: false, changedRemotely: false, error: false, canUseChecked: false,
      message: (notice ?? (operation.kind === "identity" ? "Proof identity verified." : operation.kind === "remove" ? "Order exception removed." : "Proof settings saved."))
        + (newerPolicy ? " Newer saved settings are shown. Review them before making another change." : "") });
  }
  async run(operation: ProofSettingsOperation, execute: (operation: ProofSettingsOperation, expectedVersion: string) => Promise<ProofSettingsResult>) {
    if (this.state.pending || this.state.unconfirmed) return;
    this.publish({ pending: true, message: null, error: false });
    try {
      const { policy, notice } = await execute(operation, this.baseline.updated_at);
      if (!validProofSettingsPolicy(policy) || !proofSettingsOperationMatches(policy, operation)) throw new ProofSettingsWriteError("The saved result could not be confirmed.", true);
      this.confirm(policy, operation, notice);
    } catch (error) {
      const uncertain = !(error instanceof ProofSettingsWriteError) || error.uncertain;
      this.unresolved = uncertain ? operation : null;
      this.publish({ unconfirmed: uncertain, error: true, message: uncertain
        ? "We couldn’t confirm the result. Check saved settings before trying again. Your entries are kept."
        : error instanceof Error ? error.message : "Settings could not be saved. Your entries are kept." });
    } finally { this.publish({ pending: false }); }
  }
  async checkSaved(read: () => Promise<ProofSettingsResult>) {
    if (this.state.pending) return;
    this.checkedPolicy = null;
    this.publish({ pending: true, message: null, error: false, canUseChecked: false });
    try {
      const { policy } = await read();
      if (!validProofSettingsPolicy(policy)) throw new Error("Invalid settings read");
      if (proofSettingsPolicyOlder(policy, this.latest)) throw new Error("Stale settings read");
      this.latest = policy;
      if (this.unresolved) {
        if (proofSettingsOperationMatches(policy, this.unresolved)) this.confirm(policy, this.unresolved);
        else {
          this.checkedPolicy = policy;
          this.publish({ error: true, canUseChecked: true, message: "The requested change is not confirmed. You can check again, or use the settings just checked. The earlier request may still complete." });
        }
      } else {
        const inputs = defaultsDirty(this.state.inputs, this.baseline) ? this.state.inputs
          : { ...this.state.inputs, accessMode: policy.access_mode, experience: policy.review_experience };
        this.baseline = policy;
        this.publish({ inputs, changedRemotely: false, error: false, message: "Saved settings checked. Review your entries before saving." });
      }
    } catch {
      this.publish({ error: true, message: "Saved settings could not be checked. Your entries are kept. Please try again." });
    } finally { this.publish({ pending: false }); }
  }
  useCheckedSettings() {
    if (this.state.pending || !this.unresolved || !this.checkedPolicy) return;
    const previousAttempt = this.unresolved;
    this.baseline = this.latest = this.checkedPolicy;
    this.checkedPolicy = null;
    this.unresolved = null;
    this.publish({ inputs: initialInputs(this.baseline), unconfirmed: false, canUseChecked: false, changedRemotely: false, previousAttempt, error: false,
      message: "Using the settings just checked. The earlier request may still complete. Review the settings before making another change." });
  }
}

export function proofSettingsNavigationState(customerId: string, guard?: ProofSettingsGuardState | null) {
  if (!guard || guard.customerId !== customerId) return "clear";
  return guard.pending ? "pending" : guard.dirty || guard.unconfirmed ? "confirm" : "clear";
}

/** Known validation/auth/conflict failures did not apply the request. Gateway/server
 * errors and malformed successes may follow a completed write: never retry them automatically. */
export function proofSettingsResponseUncertain(status: number) {
  return ![400, 401, 403, 404, 409, 422, 429].includes(status);
}

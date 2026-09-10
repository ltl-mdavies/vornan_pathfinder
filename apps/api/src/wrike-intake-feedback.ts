import { normalizeWrikeStatusLabel, WRIKE_ORDER_INTENT_LABEL, verifyWrikeTaskTriggerStatus, readWrikeCurrentWorkbookVersions, postWrikeTaskComment, WrikeConnectionError, type WrikeOAuthCredentials } from "@pathfinder/wrike-adapter";
import { assessWrikeFeedbackFreshness } from "./wrike-intake-freshness.js";
import type { IntakeAttempt, IntakeLedger } from "./intake-assurance.js";
import type { IntakeDeliveryLedger } from "./intake-delivery.js";
import { dispatchIntakeDelivery } from "./intake-dispatch.js";
import type { IntakeSweepScope, IntakeSweepFence } from "./intake-recovery-sweep.js";
import type { readWrikeIntakeFeedbackScope, readIntakeRecoverySnapshot } from "./store.js";
import { projectWrikeAssuranceOutcome } from "./wrike-intake-assurance.js";

/** Concrete Wrike adapter with injected persistence for synthetic QA. No transport retries. */
export async function dispatchWrikeIntakeFeedback(args: {
  enabled: boolean; scope: IntakeSweepScope; attempt_id: string; intake: IntakeLedger; receipts: IntakeDeliveryLedger;
  loadScope: () => ReturnType<typeof readWrikeIntakeFeedbackScope>;
  snapshot: () => ReturnType<typeof readIntakeRecoverySnapshot>;
  loadCredentials: () => Promise<WrikeOAuthCredentials>;
  saveCredentials: (credentials: WrikeOAuthCredentials) => Promise<void>;
  verify?: typeof verifyWrikeTaskTriggerStatus; post?: typeof postWrikeTaskComment;
  currentWorkbooks?: typeof readWrikeCurrentWorkbookVersions;
  canDispatch?: () => boolean; fence?: () => IntakeSweepFence; now?: () => Date;
}) {
  const verify = args.verify ?? verifyWrikeTaskTriggerStatus;
  const post = args.post ?? postWrikeTaskComment;
  const providerOptions = { now: args.now, fetch_impl: ((input, init) => fetch(input, { ...init,
    signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]) })) as typeof fetch };
  async function evidenceAllows(attempt: IntakeAttempt) {
    // Only unmapped-product evidence is durably classified by today's job adapter.
    // Other correction templates await equally strong current-evidence checks.
    if (attempt.reason !== "unmapped_product" || attempt.signal.provider !== "wrike" || attempt.signal.connection_id !== args.scope.connection_id ||
      attempt.signal.intent_key !== WRIKE_ORDER_INTENT_LABEL) return false;
    const snapshot = await args.snapshot();
    const related = snapshot.jobs.filter(job => job.customer_id === args.scope.customer_id && job.source_evidence?.provider === "wrike" &&
      job.source_evidence.task_id === attempt.signal.source_id && job.source_evidence.connection_id === args.scope.connection_id);
    if (related.length !== 1 || related[0]!.import_method_id !== args.scope.import_method_id) return false;
    // Any transport history or existing order suppresses customer correction, including blocked attempts.
    if (related[0]!.target_order_number || snapshot.submits.some(row => row.customer_id === args.scope.customer_id && row.job_id === related[0]!.job_id)) return false;
    const outcome = projectWrikeAssuranceOutcome({ attempt, import_method_id: args.scope.import_method_id, jobs: snapshot.jobs, submits: snapshot.submits });
    return outcome.state === "customer_action_required" && outcome.reason === attempt.reason && outcome.job_id === attempt.job_id;
  }
  return dispatchIntakeDelivery({ enabled: args.enabled, customer_id: args.scope.customer_id, attempt_id: args.attempt_id, kind: "source_feedback",
    intake: args.intake, receipts: args.receipts, canDispatch: args.canDispatch, fence: args.fence, now: args.now,
    send: async () => { throw new Error("Wrike feedback requires preflight"); },
    prepareTransport: async (payload, attempt) => {
      if (payload.kind !== "source_feedback" || !await evidenceAllows(attempt)) return null;
      const saved = await args.loadScope();
      const config = saved.method.source_config.wrike;
      if (saved.customer_id !== args.scope.customer_id || saved.connection.connection_id !== args.scope.connection_id || saved.connection.provider !== "wrike" || saved.connection.status !== "Active" ||
        saved.method.import_method_id !== args.scope.import_method_id || saved.method.source !== "Wrike" || saved.method.status !== "Active" ||
        !config || config.connection_id !== args.scope.connection_id || !config.trigger_status_id || normalizeWrikeStatusLabel(config.trigger_status_label) !== normalizeWrikeStatusLabel(WRIKE_ORDER_INTENT_LABEL)) return null;
      let credentials = await args.loadCredentials();
      if (credentials.scope !== "wsReadWrite") return null;
      let taskUpdatedAt: string | null = null;
      const freshSource = async () => {
        const metadata = await (args.currentWorkbooks ?? readWrikeCurrentWorkbookVersions)(credentials, payload.task_id, config, providerOptions);
        credentials = metadata.credentials;
        await args.saveCredentials(credentials);
        const snapshot = await args.snapshot();
        const job = snapshot.jobs.find(row => row.customer_id === args.scope.customer_id && row.job_id === attempt.job_id);
        return !!job && assessWrikeFeedbackFreshness(job, metadata.attachments, taskUpdatedAt) === "current";
      };
      try {
        const checked = await verify(credentials, { task_id: payload.task_id, trigger_status_id: config.trigger_status_id, trigger_status_label: config.trigger_status_label }, providerOptions);
        credentials = checked.credentials;
        taskUpdatedAt = checked.task_updated_at;
        await args.saveCredentials(credentials);
        if (checked.task_id !== payload.task_id || checked.trigger_status_id !== config.trigger_status_id || !await evidenceAllows(attempt) || !await freshSource()) return null;
      } catch (error) {
        if (error instanceof WrikeConnectionError && error.rotated_credentials) await args.saveCredentials(error.rotated_credentials);
        throw error;
      }
      return async () => {
        // Final durable evidence check also covers a submit occurring during preflight/claim.
        try {
          if (!await evidenceAllows(attempt) || !await freshSource()) throw new Error("Feedback evidence changed after claim");
          const result = await post(credentials, { task_id: payload.task_id, text: payload.text }, providerOptions);
          await args.saveCredentials(result.credentials);
          return { provider_message_id: result.comment.comment_id };
        } catch (error) {
          if (error instanceof WrikeConnectionError && error.rotated_credentials) await args.saveCredentials(error.rotated_credentials);
          throw error;
        }
      };
    }
  });
}

import { discoverScopedWrikeIntakeTasks, WrikeConnectionError, type WrikeOAuthCredentials, type WrikeSourceConfig } from "@pathfinder/wrike-adapter";
import { createWrikeProviderBudget, type WrikeProviderLimits, type WrikeProviderBudgetReport } from "./wrike-provider-budget.js";

/** The entire upstream scan is budgeted before a manual caller filters its task. */
export async function discoverWrikeCaptureScope(args: {
  credentials: WrikeOAuthCredentials; source: WrikeSourceConfig; limits: WrikeProviderLimits;
  mode: "manual" | "scheduled" | "manual_batch";
  saveCredentials: (credentials: WrikeOAuthCredentials) => Promise<void>;
  report?: (report: WrikeProviderBudgetReport & { mode: "manual" | "scheduled" | "manual_batch" }) => void;
  discover?: typeof discoverScopedWrikeIntakeTasks; fetchImpl?: typeof fetch; monotonicNow?: () => number; now?: () => Date;
}) {
  const budget = createWrikeProviderBudget(args.limits, { fetchImpl: args.fetchImpl, monotonicNow: args.monotonicNow });
  try {
    const result = await (args.discover ?? discoverScopedWrikeIntakeTasks)(args.credentials, args.source,
      { fetch_impl: budget.fetch, now: args.now, max_pages: 10, max_tasks: 10000 });
    // Preserve a returned rotation even if the budget expired during response parsing.
    await args.saveCredentials(result.credentials);
    budget.check();
    return result;
  } catch (error) {
    if (error instanceof WrikeConnectionError && error.rotated_credentials) await args.saveCredentials(error.rotated_credentials);
    throw error;
  } finally {
    const report = { mode: args.mode, ...budget.report() };
    if (args.report) args.report(report);
    else console.log(JSON.stringify({ event: "wrike_intake_discovery_budget", ...report }));
  }
}

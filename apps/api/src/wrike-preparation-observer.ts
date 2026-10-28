import type { WrikeManualIntakeResult } from "./wrike-manual-intake.js";
import { IntakePreparationFailure, type IntakeObservation } from "./intake-diagnostics.js";
import { recordIntakeDiagnostic } from "./intake-diagnostics-store.js";

/** Passive observer: never changes preparation's result/error or transport/retry behavior. */
export async function observeWrikePreparation(
  identity: Omit<IntakeObservation, "error" | "job_ids">,
  prepare: () => Promise<WrikeManualIntakeResult>,
  record = recordIntakeDiagnostic,
  warn: (event: string) => void = console.warn
) {
  const save = async (observation: IntakeObservation) => {
    try { await record(observation); }
    catch { warn(JSON.stringify({ event: "intake_diagnostic_persistence_failed", customer_id: identity.customer_id,
      import_method_id: identity.import_method_id, task_id: identity.task_id })); }
  };
  let result: WrikeManualIntakeResult;
  try { result = await prepare(); }
  catch (error) { await save({ ...identity, error }); throw error; }
  const jobs = result.workbooks.map(row => row.job_id).filter((id): id is string => Boolean(id));
  if (result.summary.blocked_count) {
    const failure = result.workbooks.find(row => row.preview_status === "Blocked");
    await save({ ...identity, error: new IntakePreparationFailure(failure?.failure_code ?? "preparation_failed", failure?.failure_stage === "unknown" ? "preparation" : failure?.failure_stage ?? "preparation"), job_ids: jobs });
  } else if (jobs.length && result.summary.workbook_count > 0) {
    await save({ ...identity, job_ids: jobs });
  }
  return result;
}

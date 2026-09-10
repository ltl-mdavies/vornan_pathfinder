import { createHash } from "node:crypto";
import { WRIKE_ORDER_INTENT_LABEL } from "@pathfinder/wrike-adapter";
import { intakeAttemptId, type IntakeSignal } from "./intake-assurance.js";

export interface WrikeIntentScope {
  customer_id: string; connection_id: string; import_method_id: string; task_id: string; trigger_status_id: string;
}
export interface WrikeIntentObservation {
  task_id: string; custom_status_id: string; source_updated_at: string; observed_at: string;
  scope_verified: boolean; identity_matches: boolean;
}
export interface WrikeIntentCursor {
  schema_version: 1; cursor_id: string; scope: WrikeIntentScope; revision: number;
  generation: number; in_intent: boolean; last_status_id: string;
  source_updated_at: string; observed_at: string;
  entry_observed_at: string | null; entry_source_updated_at: string | null; attempt_id: string | null;
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value)) throw new Error("Invalid Wrike intent identity");
}
function time(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid Wrike intent timestamp");
  return Date.parse(value);
}
export function wrikeIntentCursorId(scope: WrikeIntentScope) {
  const parts = [scope.customer_id, scope.connection_id, scope.import_method_id, scope.task_id, scope.trigger_status_id];
  parts.forEach(identifier);
  return `wrike-intent_${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}
/** An identity proposal only: this module never authorizes preparation or submission. */
export function wrikeIntentSignal(cursor: WrikeIntentCursor): IntakeSignal | null {
  if (cursor.generation === 0 || !cursor.entry_observed_at) return null;
  return { schema_version: 1, customer_id: cursor.scope.customer_id, provider: "wrike", connection_id: cursor.scope.connection_id,
    source_id: cursor.scope.task_id, intent_key: WRIKE_ORDER_INTENT_LABEL,
    intent_occurrence: `${wrikeIntentCursorId(cursor.scope)}:${cursor.generation}`, observed_at: cursor.entry_observed_at };
}
export function validateWrikeIntentCursor(value: unknown, scope: WrikeIntentScope): WrikeIntentCursor {
  const row = value as WrikeIntentCursor | null;
  const id = wrikeIntentCursorId(scope);
  if (!row || row.schema_version !== 1 || !row.scope || row.cursor_id !== id || wrikeIntentCursorId(row.scope) !== id ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.generation) || row.generation < 0 ||
    row.generation > Math.floor((row.revision + 1) / 2) || typeof row.in_intent !== "boolean") throw new Error("Invalid persisted Wrike intent cursor");
  identifier(row.last_status_id);
  if (row.in_intent !== (row.last_status_id === scope.trigger_status_id) || time(row.source_updated_at) > time(row.observed_at)) throw new Error("Invalid persisted Wrike intent observation");
  if (row.generation === 0) {
    if (row.in_intent || row.entry_observed_at !== null || row.entry_source_updated_at !== null || row.attempt_id !== null) throw new Error("Invalid persisted initial Wrike intent");
  } else {
    if (time(row.entry_observed_at) > time(row.observed_at) || time(row.entry_source_updated_at) > time(row.entry_observed_at) ||
      time(row.entry_source_updated_at) > time(row.source_updated_at) ||
      (!row.in_intent && (time(row.entry_source_updated_at) >= time(row.source_updated_at) ||
        time(row.entry_observed_at) >= time(row.observed_at) || row.generation > Math.floor(row.revision / 2))) ||
      row.attempt_id !== intakeAttemptId(wrikeIntentSignal(row)!)) throw new Error("Invalid persisted Wrike intent generation");
    if (row.revision === 1 && (row.entry_observed_at !== row.observed_at || row.entry_source_updated_at !== row.source_updated_at)) throw new Error("Invalid persisted first Wrike entry");
  }
  return row;
}
/** Only exact, qualified observations may arm an exit; absence from discovery is not an exit. */
export function observeWrikeIntent(current: WrikeIntentCursor | null, scope: WrikeIntentScope, observation: WrikeIntentObservation): WrikeIntentCursor {
  const id = wrikeIntentCursorId(scope);
  if (current) validateWrikeIntentCursor(current, scope);
  identifier(observation.custom_status_id);
  if (observation.task_id !== scope.task_id || observation.scope_verified !== true || observation.identity_matches !== true) throw new Error("Unverified Wrike intent scope");
  const updated = time(observation.source_updated_at); const observed = time(observation.observed_at);
  if (updated > observed) throw new Error("Wrike intent source timestamp is in the future");
  const inIntent = observation.custom_status_id === scope.trigger_status_id;
  if (current) {
    if (updated < time(current.source_updated_at) || observed < time(current.observed_at)) throw new Error("Stale Wrike intent observation");
    const statusChanged = observation.custom_status_id !== current.last_status_id;
    if (statusChanged && (updated <= time(current.source_updated_at) || observed <= time(current.observed_at))) throw new Error("Ambiguous Wrike intent status transition");
    if (!statusChanged && updated === time(current.source_updated_at) && observed === time(current.observed_at)) return current;
  }
  const enters = inIntent && !current?.in_intent;
  const next: WrikeIntentCursor = { schema_version: 1, cursor_id: id, scope: { ...scope }, revision: (current?.revision ?? 0) + 1,
    generation: (current?.generation ?? 0) + (enters ? 1 : 0), in_intent: inIntent, last_status_id: observation.custom_status_id,
    source_updated_at: observation.source_updated_at, observed_at: observation.observed_at,
    entry_observed_at: enters ? observation.observed_at : current?.entry_observed_at ?? null,
    entry_source_updated_at: enters ? observation.source_updated_at : current?.entry_source_updated_at ?? null, attempt_id: null };
  const signal = wrikeIntentSignal(next);
  next.attempt_id = signal ? intakeAttemptId(signal) : null;
  return validateWrikeIntentCursor(next, scope);
}

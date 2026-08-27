import { liftRows } from "@pathfinder/proof-domain";
import {
  readLiftFocusedProofReport,
  readLiftProofDetailedReportStatus,
  startLiftProofDetailedReport
} from "@pathfinder/lift-proof-adapter";
import type { ProofAccessSession, ProofOrder, ProofTask } from "@pathfinder/proof-domain";
import { readTargetEnvironmentProofingApiRuntimeCredentials } from "../lift-proofing-credentials.js";
import { recordProofAuditEvent, type ProofAuditContext } from "./audit-service.js";
import { readProofActionTargetConfig } from "./action-target-store.js";
import { getProofRuntimeConfig, type ProofRuntimeConfig } from "./runtime-config.js";
import { getProofOrder } from "./store.js";
import {
  createProofDetailedReportRecord,
  getProofDetailedReportRecord,
  proofDetailedReportRecordId,
  saveProofDetailedReportRecord,
  type ProofDetailedReportRecord
} from "./detailed-report-store.js";

const TARGET_ID = "lift-standard-graphics";
const ENVIRONMENT_ID = "env-lift-prod";
const CUSTOMER_ID = "1249";
const POLL_WINDOW_MS = 60_000;

export class ProofDetailedReportError extends Error {
  constructor(public readonly code: "not_allowed" | "stale" | "unavailable" | "provider_failed", message: string) {
    super(message);
    this.name = "ProofDetailedReportError";
  }
}

type Definition = { definition_id: string; label: string | null; report_id: string | null; report_url: string | null };

function recordObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function identifier(value: unknown) {
  const candidate = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(candidate) ? candidate : null;
}

function text(value: unknown, max = 160) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const candidate = String(value).trim();
  return candidate && candidate.length <= max && !/[\u0000-\u001f\u007f]/.test(candidate) ? candidate : null;
}

function safeUrl(value: unknown) {
  const candidate = text(value, 8_192);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function detailedReportDefinitions(raw: unknown): Definition[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  const container = recordObject(parsed);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container?.DETAILED_REPORT) ? container.DETAILED_REPORT : [];
  return rows.flatMap((candidate) => {
    const row = recordObject(candidate);
    const definitionId = identifier(row?.DEFINITION_ID ?? row?.definition_id);
    if (!row || !definitionId) return [];
    return [{
      definition_id: definitionId,
      label: text(row.DEFINITION_LABEL ?? row.definition_label),
      report_id: identifier(row.REPORT_ID ?? row.report_id),
      report_url: safeUrl(row.REPORT_URL ?? row.report_url)
    }];
  });
}

function lineAndAttachmentMatch(row: Record<string, unknown>, task: ProofTask) {
  return identifier(row.ORDER_LINE_ID ?? row.order_line_id) === task.order_line_id &&
    identifier(row.ATTACHMENT_ID ?? row.attachment_id) === task.attachment_id;
}

function currentBinding(order: ProofOrder, session: ProofAccessSession, taskId: string, definitionId: string) {
  if (
    session.scope !== "review" ||
    session.capability?.proof_customer_id !== CUSTOMER_ID ||
    order.customer_id !== CUSTOMER_ID ||
    order.order_number !== session.order_number
  ) {
    throw new ProofDetailedReportError("not_allowed", "Detailed reports are not available for this proof.");
  }
  const task = order.tasks.find((candidate) => candidate.task_id === taskId);
  if (!task || !task.order_line_id || !task.attachment_id || !task.current_version?.current || !task.current_version.version_id) {
    throw new ProofDetailedReportError("stale", "This proof has been updated. Please refresh and try again.");
  }
  const normalizedDefinitionId = identifier(definitionId);
  if (!normalizedDefinitionId) throw new ProofDetailedReportError("unavailable", "A detailed report is not available for this proof.");
  return { task, definition_id: normalizedDefinitionId };
}

function publicRecord(record: ProofDetailedReportRecord) {
  return {
    record_id: record.record_id,
    definition_id: record.definition_id,
    label: record.definition_label,
    state: record.state,
    view_url: record.state === "ready" ? `/api/public/proof/detailed-reports/${encodeURIComponent(record.record_id)}/view` : null
  };
}

function auditContext(session: ProofAccessSession, correlationId: string): ProofAuditContext {
  return { actor_type: "customer_session", actor_id: session.session_id, correlation_id: correlationId, source: "public_api" };
}

function activeEnvironment(target: Awaited<ReturnType<typeof readProofActionTargetConfig>>) {
  const environment = target?.environments.find((candidate) => candidate.environment_id === ENVIRONMENT_ID && candidate.role === "PROD" && candidate.status === "Active");
  if (!environment) throw new ProofDetailedReportError("not_allowed", "Detailed reports are temporarily unavailable.");
  return environment;
}

export interface ProofDetailedReportServiceDependencies {
  runtimeConfig?: () => ProofRuntimeConfig;
  getOrder?: typeof getProofOrder;
  readTarget?: typeof readProofActionTargetConfig;
  readCredentials?: typeof readTargetEnvironmentProofingApiRuntimeCredentials;
  focusedRead?: typeof readLiftFocusedProofReport;
  start?: typeof startLiftProofDetailedReport;
  status?: typeof readLiftProofDetailedReportStatus;
  getRecord?: typeof getProofDetailedReportRecord;
  createRecord?: typeof createProofDetailedReportRecord;
  saveRecord?: typeof saveProofDetailedReportRecord;
  audit?: typeof recordProofAuditEvent;
  now?: () => Date;
}

export function createProofDetailedReportService(dependencies: ProofDetailedReportServiceDependencies = {}) {
  const runtimeConfig = dependencies.runtimeConfig ?? getProofRuntimeConfig;
  const getOrder = dependencies.getOrder ?? getProofOrder;
  const readTarget = dependencies.readTarget ?? readProofActionTargetConfig;
  const readCredentials = dependencies.readCredentials ?? readTargetEnvironmentProofingApiRuntimeCredentials;
  const focusedRead = dependencies.focusedRead ?? readLiftFocusedProofReport;
  const start = dependencies.start ?? startLiftProofDetailedReport;
  const status = dependencies.status ?? readLiftProofDetailedReportStatus;
  const getRecord = dependencies.getRecord ?? getProofDetailedReportRecord;
  const createRecord = dependencies.createRecord ?? createProofDetailedReportRecord;
  const saveRecord = dependencies.saveRecord ?? saveProofDetailedReportRecord;
  const audit = dependencies.audit ?? recordProofAuditEvent;
  const now = dependencies.now ?? (() => new Date());

  async function binding(session: ProofAccessSession, taskId: string, definitionId: string) {
    const order = await getOrder(session.order_number);
    if (!order) throw new ProofDetailedReportError("not_allowed", "Detailed reports are not available for this proof.");
    const current = currentBinding(order, session, taskId, definitionId);
    const focused = await focusedRead(current.task.order_line_id!, { config: runtimeConfig().read });
    const row = liftRows(focused.payload).find((candidate) => lineAndAttachmentMatch(candidate, current.task));
    const definition = row ? detailedReportDefinitions(row.DETAILED_REPORT ?? row.detailed_report)
      .find((candidate) => candidate.definition_id === current.definition_id) ?? null : null;
    if (!definition) throw new ProofDetailedReportError("unavailable", "A detailed report is not available for this proof.");
    return { order, task: current.task, definition };
  }

  async function getOrCreateReadyRecord(input: { session: ProofAccessSession; task: ProofTask; definition: Definition; order: ProofOrder; correlation_id: string }) {
    const recordId = proofDetailedReportRecordId({
      customer_id: CUSTOMER_ID, order_number: input.order.order_number, order_line_id: input.task.order_line_id!, attachment_id: input.task.attachment_id!, definition_id: input.definition.definition_id
    });
    const existing = await getRecord(input.order.order_number, recordId);
    const timestamp = now().toISOString();
    const base: ProofDetailedReportRecord = existing ?? {
      record_id: recordId, customer_id: CUSTOMER_ID, order_number: input.order.order_number, task_id: input.task.task_id,
      order_line_id: input.task.order_line_id!, attachment_id: input.task.attachment_id!, version_id: input.task.current_version!.version_id,
      definition_id: input.definition.definition_id, definition_label: input.definition.label, report_id: null, state: "unavailable",
      created_at: timestamp, updated_at: timestamp, generation_deadline_at: null
    };
    if (input.definition.report_id && input.definition.report_url) {
      const ready = { ...base, definition_label: input.definition.label, report_id: input.definition.report_id, state: "ready" as const, updated_at: timestamp, generation_deadline_at: null };
      await saveRecord(ready);
      return ready;
    }
    return existing;
  }

  async function begin(input: { session: ProofAccessSession; task_id: string; definition_id: string; correlation_id: string }) {
    const current = await binding(input.session, input.task_id, input.definition_id);
    const existingOrReady = await getOrCreateReadyRecord({ ...current, session: input.session, correlation_id: input.correlation_id });
    if (existingOrReady?.state === "ready" || (existingOrReady && ["generation_started", "running"].includes(existingOrReady.state))) return publicRecord(existingOrReady);
    const timestamp = now();
    const reserved: ProofDetailedReportRecord = {
      record_id: proofDetailedReportRecordId({ customer_id: CUSTOMER_ID, order_number: current.order.order_number, order_line_id: current.task.order_line_id!, attachment_id: current.task.attachment_id!, definition_id: current.definition.definition_id }),
      customer_id: CUSTOMER_ID, order_number: current.order.order_number, task_id: current.task.task_id, order_line_id: current.task.order_line_id!, attachment_id: current.task.attachment_id!, version_id: current.task.current_version!.version_id,
      definition_id: current.definition.definition_id, definition_label: current.definition.label, report_id: null, state: "generation_started", created_at: timestamp.toISOString(), updated_at: timestamp.toISOString(), generation_deadline_at: new Date(timestamp.getTime() + POLL_WINDOW_MS).toISOString()
    };
    try { await createRecord(reserved); } catch (error) {
      const replay = await getRecord(current.order.order_number, reserved.record_id);
      if (replay) return publicRecord(replay);
      throw error;
    }
    await audit({ action: "proof.detailed_report_generation_started", order_number: current.order.order_number, task_id: current.task.task_id, order_line_id: current.task.order_line_id, attachment_id: current.task.attachment_id, grant_id: input.session.grant_id, participant_id: input.session.participant_id, metadata: { detailed_report_state: "generation_started" }, context: auditContext(input.session, input.correlation_id) });
    try {
      const environment = activeEnvironment(await readTarget(TARGET_ID));
      const credentials = await readCredentials(TARGET_ID, ENVIRONMENT_ID);
      const result = await start({ base_url: environment.endpoint_url, credentials, order_number: current.order.order_number, order_line_id: current.task.order_line_id!, attachment_id: current.task.attachment_id!, definition_id: current.definition.definition_id, timeout_ms: runtimeConfig().read.timeout_ms, now: timestamp });
      const next: ProofDetailedReportRecord = { ...reserved, report_id: result.report_id, state: result.report_url ? "ready" : "running", updated_at: now().toISOString(), generation_deadline_at: result.report_url ? null : reserved.generation_deadline_at };
      await saveRecord(next);
      return publicRecord(next);
    } catch {
      const failed = { ...reserved, state: "failed" as const, updated_at: now().toISOString() };
      await saveRecord(failed);
      throw new ProofDetailedReportError("provider_failed", "We’re still preparing your report. Try again shortly.");
    }
  }

  async function check(input: { session: ProofAccessSession; task_id: string; definition_id: string; correlation_id: string }) {
    const current = await binding(input.session, input.task_id, input.definition_id);
    const recordId = proofDetailedReportRecordId({ customer_id: CUSTOMER_ID, order_number: current.order.order_number, order_line_id: current.task.order_line_id!, attachment_id: current.task.attachment_id!, definition_id: current.definition.definition_id });
    const record = await getRecord(current.order.order_number, recordId);
    if (!record) throw new ProofDetailedReportError("unavailable", "A detailed report is not available for this proof.");
    if (record.state === "ready" || record.state === "failed" || record.state === "timed_out" || !record.report_id) return publicRecord(record);
    if (!record.generation_deadline_at || Date.parse(record.generation_deadline_at) <= now().getTime()) {
      const timedOut = { ...record, state: "timed_out" as const, updated_at: now().toISOString() };
      await saveRecord(timedOut);
      await audit({ action: "proof.detailed_report_timed_out", order_number: current.order.order_number, task_id: current.task.task_id, order_line_id: current.task.order_line_id, attachment_id: current.task.attachment_id, grant_id: input.session.grant_id, participant_id: input.session.participant_id, metadata: { detailed_report_state: "timed_out" }, context: auditContext(input.session, input.correlation_id) });
      return publicRecord(timedOut);
    }
    try {
      const environment = activeEnvironment(await readTarget(TARGET_ID));
      const credentials = await readCredentials(TARGET_ID, ENVIRONMENT_ID);
      const result = await status({ base_url: environment.endpoint_url, credentials, order_number: current.order.order_number, order_line_id: current.task.order_line_id!, attachment_id: current.task.attachment_id!, report_id: record.report_id, timeout_ms: runtimeConfig().read.timeout_ms });
      const next = { ...record, state: result.report_url ? "ready" as const : "running" as const, updated_at: now().toISOString(), generation_deadline_at: result.report_url ? null : record.generation_deadline_at };
      await saveRecord(next);
      await audit({ action: next.state === "ready" ? "proof.detailed_report_ready" : "proof.detailed_report_status_observed", order_number: current.order.order_number, task_id: current.task.task_id, order_line_id: current.task.order_line_id, attachment_id: current.task.attachment_id, grant_id: input.session.grant_id, participant_id: input.session.participant_id, metadata: { detailed_report_state: next.state }, context: auditContext(input.session, input.correlation_id) });
      return publicRecord(next);
    } catch { return publicRecord({ ...record, state: "failed" }); }
  }

  async function view(input: { session: ProofAccessSession; task_id: string; definition_id: string; record_id: string; correlation_id: string }) {
    const current = await binding(input.session, input.task_id, input.definition_id);
    const record = await getRecord(current.order.order_number, input.record_id);
    if (!record || record.task_id !== current.task.task_id || record.version_id !== current.task.current_version?.version_id || record.state !== "ready" || !record.report_id) {
      throw new ProofDetailedReportError("stale", "This detailed report is no longer available.");
    }
    const environment = activeEnvironment(await readTarget(TARGET_ID));
    const credentials = await readCredentials(TARGET_ID, ENVIRONMENT_ID);
    const result = await status({ base_url: environment.endpoint_url, credentials, order_number: current.order.order_number, order_line_id: current.task.order_line_id!, attachment_id: current.task.attachment_id!, report_id: record.report_id, timeout_ms: runtimeConfig().read.timeout_ms });
    if (!result.report_url) throw new ProofDetailedReportError("provider_failed", "We’re still preparing your report. Try again shortly.");
    await audit({ action: "proof.detailed_report_view_redirected", order_number: current.order.order_number, task_id: current.task.task_id, order_line_id: current.task.order_line_id, attachment_id: current.task.attachment_id, grant_id: input.session.grant_id, participant_id: input.session.participant_id, metadata: { detailed_report_state: "ready" }, context: auditContext(input.session, input.correlation_id) });
    return result.report_url;
  }
  async function viewByRecord(input: { session: ProofAccessSession; record_id: string; correlation_id: string }) {
    const order = await getOrder(input.session.order_number);
    if (!order) throw new ProofDetailedReportError("not_allowed", "Detailed reports are not available for this proof.");
    if (input.session.capability?.proof_customer_id !== CUSTOMER_ID || order.customer_id !== CUSTOMER_ID) {
      throw new ProofDetailedReportError("not_allowed", "Detailed reports are not available for this proof.");
    }
    for (const task of order.tasks) {
      if (!task.order_line_id || !task.attachment_id || !task.current_version?.current) continue;
      for (const definition of detailedReportDefinitions(task.current_version.detailed_report)) {
        const recordId = proofDetailedReportRecordId({ customer_id: CUSTOMER_ID, order_number: order.order_number, order_line_id: task.order_line_id, attachment_id: task.attachment_id, definition_id: definition.definition_id });
        if (recordId === input.record_id) {
          return view({ ...input, task_id: task.task_id, definition_id: definition.definition_id });
        }
      }
    }
    throw new ProofDetailedReportError("stale", "This detailed report is no longer available.");
  }
  return { begin, check, view, viewByRecord };
}

export const proofDetailedReportService = createProofDetailedReportService();

import type { ProofOrder, ProofTask } from "@pathfinder/proof-domain";

export type QueueState = "pending" | "waiting" | "changes" | "approved" | "reference" | "cancel_requested" | "revision_pending" | "unavailable";
export interface ProofQueueLine {
  id: string; orderNumber: string; orderTitle: string | null; customerId: string; customer: string;
  lineNumber: string | null; product: string; state: QueueState; creativeCount: number;
  since: string | null; lastSynced: string; stale: boolean;
  stateCounts: Partial<Record<QueueState, number>>;
}

function taskState(task: ProofTask): QueueState {
  if (task.decision_context?.action === "CANCEL_LINE") return "cancel_requested";
  if (task.decision_context?.action === "REVISED_ART_WILL_BE_SENT") return "revision_pending";
  if (task.decision_context) return "changes";
  if (task.state === "pending" && task.actionable) return "pending";
  if (task.state === "waiting" || task.state === "revised") return "waiting";
  if (task.state === "approved" || task.state === "reference") return task.state;
  return "unavailable";
}

/** Read the authoritative normalized state, never advance an approval or infer it from a badge. */
export function projectProofQueue(order: ProofOrder, now = Date.now()): ProofQueueLine[] {
  if (!order.customer_id || order.health === "missing") return [];
  const groups = new Map<string, ProofTask[]>();
  for (const task of order.tasks) {
    const line = order.lines.find(candidate => candidate.order_line_id === task.order_line_id);
    if (task.archived_at || task.state === "cancelled" || line?.cancelled) continue;
    const key = task.order_line_id ?? `task:${task.task_id}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()].map(([id, tasks]) => {
    const states = tasks.map(taskState);
    const stateCounts: Partial<Record<QueueState, number>> = {};
    for (const state of states) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    const state = (["pending", "changes", "cancel_requested", "revision_pending", "waiting", "unavailable", "approved", "reference"] as QueueState[]).find(candidate => states.includes(candidate))!;
    const dates = tasks.map(task => task.updated_at).filter(date => Number.isFinite(Date.parse(date))).sort();
    const age = now - Date.parse(order.last_synced_at);
    return {
      id: `${order.order_number}:${id}`, orderNumber: order.order_number, orderTitle: order.order_title,
      customerId: order.customer_id!, customer: order.customer_name ?? order.customer_id!,
      lineNumber: tasks[0]!.line_number, product: tasks[0]!.product_name ?? "Unnamed line", state, stateCounts,
      creativeCount: tasks.filter(task => task.current_version !== null).length,
      since: dates.at(-1) ?? null, lastSynced: order.last_synced_at,
      stale: !Number.isFinite(age) || age > 15 * 60_000 || order.health === "stale" || order.health === "error"
    };
  });
}

import type { ProofTask } from "./types";
import { isApprovedProofState, isOpenProofState, isReviewedProofState, proofStatePresentation } from "./lifecycle-state";

export type QueueFilter = "open" | "all" | "approved";
export type QueueNavigationKey = "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End";

export interface ProofLineGroup {
  group_id: string;
  line_number: string | null;
  product_name: string | null;
  quantity: number | null;
  tasks: ProofTask[];
  open_count: number;
  reviewed_count: number;
}

export interface ProofLineQueueSummary {
  review_label: string;
  proof_count_label: string;
  tone: "open" | "approved" | "reference" | "waiting" | "updating" | "attention" | "mixed";
  status_segments: { label: string; tone: Exclude<ProofLineQueueSummary["tone"], "mixed"> }[];
}

export function proofLineQueueSummary(group: ProofLineGroup): ProofLineQueueSummary {
  const versionIds = new Set<string>();
  for (const task of group.tasks) {
    for (const version of task.versions) versionIds.add(version.version_id);
    if (task.current_version) versionIds.add(task.current_version.version_id);
  }
  const waitingCount = group.tasks.filter((task) => task.state === "waiting").length;
  const updatingCount = group.tasks.filter((task) => task.state === "revised").length;
  const awaitingReviewCount = group.tasks.filter((task) => task.state === "pending").length;
  const approvedCount = group.tasks.filter((task) => isApprovedProofState(task.state)).length;
  const referenceCount = group.tasks.filter((task) => task.state === "reference").length;
  const attentionCount = group.tasks.filter((task) => ["cancelled", "missing", "error"].includes(task.state)).length;
  const awaitingProof = waitingCount > 0;
  const proofCount = awaitingProof
    ? versionIds.size
    : group.tasks.filter((task) => Boolean(task.current_version)).length;
  const rawSegments = [
    awaitingReviewCount ? { label: `${awaitingReviewCount} Awaiting review`, tone: "open" as const } : null,
    updatingCount ? { label: `${updatingCount} Awaiting updated proof`, tone: "updating" as const } : null,
    waitingCount ? { label: `${waitingCount} ${proofCount > 0 ? "Awaiting new proof" : "Awaiting proof"}`, tone: "waiting" as const } : null,
    approvedCount ? { label: `${approvedCount} Approved`, tone: "approved" as const } : null,
    referenceCount ? { label: `${referenceCount} Reference`, tone: "reference" as const } : null,
    attentionCount ? { label: `${attentionCount} Needs attention`, tone: "attention" as const } : null
  ].filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));
  const statusSegments = rawSegments.length === 1
    ? [{ ...rawSegments[0]!, label: rawSegments[0]!.label.replace(/^1 /, "") }]
    : rawSegments;
  const reviewLabel = statusSegments.map((segment) => segment.label).join(" · ");
  const tone = statusSegments.length > 1
    ? "mixed"
    : approvedCount
      ? "approved"
      : referenceCount
        ? "reference"
        : updatingCount
          ? "updating"
          : waitingCount
            ? "waiting"
            : attentionCount
              ? "attention"
              : "open";
  const proofCountLabel = awaitingProof
    ? proofCount > 0 ? `${proofCount} prior ${proofCount === 1 ? "proof" : "proofs"}` : "Proof pending"
    : `${proofCount} ${proofCount === 1 ? "proof" : "proofs"}`;
  return { review_label: reviewLabel, proof_count_label: proofCountLabel, tone, status_segments: statusSegments };
}

export function groupProofTasksByLine(tasks: ProofTask[]): ProofLineGroup[] {
  const groups = new Map<string, ProofLineGroup>();
  for (const task of tasks) {
    const groupId = task.line_number ? `line-${task.line_number}` : `task-${task.task_id}`;
    const existing = groups.get(groupId);
    if (existing) {
      existing.tasks.push(task);
      if (isOpenProofState(task.state)) existing.open_count += 1;
      if (isReviewedProofState(task.state)) existing.reviewed_count += 1;
      continue;
    }
    groups.set(groupId, {
      group_id: groupId,
      line_number: task.line_number,
      product_name: task.product_name,
      quantity: task.quantity,
      tasks: [task],
      open_count: isOpenProofState(task.state) ? 1 : 0,
      reviewed_count: isReviewedProofState(task.state) ? 1 : 0
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    tasks: [...group.tasks].sort((left, right) => left.sibling_index - right.sibling_index)
  }));
}

export function lineGroupForTask(groups: ProofLineGroup[], taskId: string | null) {
  return groups.find((group) => group.tasks.some((task) => task.task_id === taskId)) ?? groups[0] ?? null;
}

export function filterProofTasks(tasks: ProofTask[], filter: QueueFilter) {
  if (filter === "open") {
    return tasks.filter((task) => isOpenProofState(task.state));
  }
  if (filter === "approved") {
    return tasks.filter((task) => isApprovedProofState(task.state));
  }
  return tasks;
}

export function queueFilterLabel(filter: QueueFilter) {
  switch (filter) {
    case "approved":
      return "Approved";
    case "all":
      return "All";
    default:
      return "Open";
  }
}

export function searchProofTasks(tasks: ProofTask[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return tasks;
  return tasks.filter((task) => {
    const searchable = [
      task.line_number,
      task.product_name,
      task.current_version?.filename,
      task.state,
      proofStatePresentation(task.state).label
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  });
}

export function selectedVisibleTask(tasks: ProofTask[], selectedTaskId: string | null) {
  return tasks.find((task) => task.task_id === selectedTaskId) ?? tasks[0] ?? null;
}

export function queueNavigationTarget(
  tasks: ProofTask[],
  selectedTaskId: string | null,
  key: QueueNavigationKey
) {
  if (!tasks.length) return null;
  if (key === "Home") return tasks[0]!.task_id;
  if (key === "End") return tasks[tasks.length - 1]!.task_id;

  const currentIndex = Math.max(0, tasks.findIndex((task) => task.task_id === selectedTaskId));
  const offset = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
  const targetIndex = (currentIndex + offset + tasks.length) % tasks.length;
  return tasks[targetIndex]!.task_id;
}

export function queueEmptyMessage(filter: QueueFilter, tasks: ProofTask[], query = "") {
  if (!tasks.length) {
    return {
      title: "No proofs are available yet",
      detail: "Vornan will make proof files available here when they are ready."
    };
  }
  if (query.trim()) {
    return {
      title: "No proofs match your search",
      detail: "Try a product, line, filename, or status using different words."
    };
  }
  if (filter === "open") {
    return {
      title: "No open proofs",
      detail: "There are no proofs waiting for review in this order."
    };
  }
  return {
    title: "No proofs match this view",
    detail: "Choose another queue filter to see available proof files."
  };
}

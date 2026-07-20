import type { ProofTask } from "./types";
import { isOpenProofState, isReviewedProofState, proofStatePresentation } from "./lifecycle-state";

export type QueueFilter = "open" | "all" | "history";
export type QueueNavigationKey = "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End";

export function filterProofTasks(tasks: ProofTask[], filter: QueueFilter) {
  if (filter === "open") {
    return tasks.filter((task) => isOpenProofState(task.state));
  }
  if (filter === "history") {
    return tasks.filter((task) => isReviewedProofState(task.state));
  }
  return tasks;
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

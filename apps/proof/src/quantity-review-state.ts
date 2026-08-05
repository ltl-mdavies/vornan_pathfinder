import type { ProofTask } from "./types";
import { summarizeQuantityAssignment } from "./quantity-assignment";

export type SavedQuantityDraft = {
  group_id: string;
  line_number: string | null;
  line_quantity: number;
  values: Record<string, string>;
  saved_at: string;
};

export type QuantityTransformationLine = {
  task_id: string;
  filename: string;
  quantity: number;
  resulting_line_number: string;
};

export type QuantityTransformationSummary = {
  source_line_number: string | null;
  source_line_quantity: number;
  lines: QuantityTransformationLine[];
};

export function saveQuantityDraft(input: {
  groupId: string;
  tasks: ProofTask[];
  values: Record<string, string>;
  now: Date;
}): SavedQuantityDraft {
  const lineQuantity = input.tasks[0]?.quantity ?? null;
  const summary = summarizeQuantityAssignment(lineQuantity, input.tasks.map((task) => task.task_id), input.values);
  if (input.tasks.length < 1 || lineQuantity === null || !summary.complete || !Number.isFinite(input.now.getTime())) {
    throw new Error("A complete staged quantity assignment is required before saving.");
  }
  return {
    group_id: input.groupId,
    line_number: input.tasks[0]?.line_number ?? null,
    line_quantity: lineQuantity,
    values: Object.fromEntries(input.tasks.map((task) => [task.task_id, input.values[task.task_id] ?? ""])),
    saved_at: input.now.toISOString()
  };
}

export function quantityDraftMatches(
  draft: SavedQuantityDraft | null | undefined,
  tasks: ProofTask[],
  values: Record<string, string>
) {
  if (!draft || draft.line_quantity !== tasks[0]?.quantity || draft.line_number !== (tasks[0]?.line_number ?? null)) return false;
  return tasks.length === Object.keys(draft.values).length
    && tasks.every((task) => draft.values[task.task_id] === (values[task.task_id] ?? ""));
}

export function buildDemoTransformationSummary(
  tasks: ProofTask[],
  values: Record<string, string>
): QuantityTransformationSummary {
  const sourceLine = tasks[0]?.line_number ?? null;
  const parsedSourceLine = Number(sourceLine);
  return {
    source_line_number: sourceLine,
    source_line_quantity: tasks[0]?.quantity ?? 0,
    lines: tasks.map((task, index) => ({
      task_id: task.task_id,
      filename: task.current_version?.filename ?? `Creative ${index + 1}`,
      quantity: Number(values[task.task_id] ?? 0),
      resulting_line_number: Number.isSafeInteger(parsedSourceLine)
        ? String(parsedSourceLine + index)
        : `${sourceLine ?? "Line"}.${index + 1}`
    }))
  };
}

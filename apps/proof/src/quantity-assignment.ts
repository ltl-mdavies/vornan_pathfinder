export type QuantityAssignmentSummary = {
  assigned: number;
  remaining: number | null;
  complete: boolean;
  invalid_task_ids: string[];
};

function parsedQuantity(value: string) {
  if (value === "") return { valid: true, quantity: 0 };
  if (!/^\d+$/.test(value)) return { valid: false, quantity: 0 };
  const quantity = Number(value);
  return Number.isSafeInteger(quantity)
    ? { valid: true, quantity }
    : { valid: false, quantity: 0 };
}

export function summarizeQuantityAssignment(
  lineQuantity: number | null,
  taskIds: string[],
  values: Record<string, string>
): QuantityAssignmentSummary {
  const validLineQuantity = lineQuantity !== null && Number.isSafeInteger(lineQuantity) && lineQuantity >= 0;
  let assigned = 0;
  const invalidTaskIds: string[] = [];

  for (const taskId of taskIds) {
    const parsed = parsedQuantity(values[taskId] ?? "");
    if (!parsed.valid || (validLineQuantity && parsed.quantity > lineQuantity)) {
      invalidTaskIds.push(taskId);
      continue;
    }
    assigned += parsed.quantity;
  }

  const remaining = validLineQuantity ? lineQuantity - assigned : null;
  return {
    assigned,
    remaining,
    complete: validLineQuantity && invalidTaskIds.length === 0 && remaining === 0,
    invalid_task_ids: invalidTaskIds
  };
}

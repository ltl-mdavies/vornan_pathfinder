/** Only durable confirmation evidence qualifies; creation/update time is never a substitute. */
export type CustomerOrderSummary = {
  customer_id: string;
  status: "confirmed" | "none" | "date_unavailable";
  order_number?: string;
  confirmed_at?: string;
};

export function customerOrderAccumulator(customerIds: readonly string[]) {
  const eligible = new Set(customerIds);
  const orders = new Map<string, Map<string, number | null>>();
  return {
    add(value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stored job");
      const job = value as Record<string, unknown>;
      if (typeof job.customer_id !== "string" || typeof job.state !== "string") throw new Error("Invalid job identity");
      if (!eligible.has(job.customer_id) || job.archived_at || job.state === "Archived" || job.sandbox === true) return;
      // Failed/ambiguous submissions never become successful orders merely by having a reference.
      if (!["Order Confirmed", "Completed"].includes(job.state)) return;
      if (typeof job.target_order_number !== "string" || !job.target_order_number.trim()) throw new Error("Confirmed job has no order reference");
      const raw = job.order_confirmed_at;
      const time = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : NaN;
      const date = Number.isFinite(time) ? time : null;
      const customer = orders.get(job.customer_id) ?? new Map<string, number | null>();
      const key = job.target_order_number.trim();
      // Re-association/retry records must not make the same order look newly placed.
      const previous = customer.get(key);
      customer.set(key, previous === undefined ? date : previous === null || date === null ? null : Math.min(previous, date));
      orders.set(job.customer_id, customer);
    },
    finish(): CustomerOrderSummary[] {
      return [...eligible].sort().map(customer_id => {
        const entries = [...(orders.get(customer_id)?.entries() ?? [])];
        if (!entries.length) return { customer_id, status: "none" };
        // A confirmed but undated historical record prevents a trustworthy latest-order claim.
        if (entries.some(([, date]) => date === null)) return { customer_id, status: "date_unavailable" };
        entries.sort((a, b) => b[1]! - a[1]! || a[0].localeCompare(b[0]));
        return { customer_id, status: "confirmed", order_number: entries[0]![0], confirmed_at: new Date(entries[0]![1]!).toISOString() };
      });
    }
  };
}

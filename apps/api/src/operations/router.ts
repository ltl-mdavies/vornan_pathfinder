import { Router } from "express";
import { listWorkspaceCustomerIds, listOperationsCustomers } from "../store.js";
import { projectProofQueue } from "./proof-queue.js";
import { decodeQueueCursor, readProofQueuePage } from "./proof-queue-store.js";

export function createOperationsRouter(deps: {
  enabled?: boolean; list?: typeof readProofQueuePage;
  customers?: () => Promise<Array<{ lift_customer_id: string; customer_status?: string | null }>>;
  workspaceIds?: () => Promise<string[]>;
} = {}) {
  const router = Router();
  router.get("/customer-workspaces", async (_req, res) => {
    if (!(deps.enabled ?? process.env.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE === "true")) { res.sendStatus(404); return; }
    res.set("Cache-Control", "no-store");
    try {
      // Existence is independent of the customer's Lift status or intake configuration.
      const ids = await (deps.workspaceIds ?? listWorkspaceCustomerIds)();
      res.json({ workspace_customer_ids: [...new Set(ids)].sort(), checked_at: new Date().toISOString() });
    } catch { res.status(503).json({ error: "Pathfinder setup status could not be checked. Refresh to retry." }); }
  });
  router.get("/proof-queue", async (req, res) => {
    if (!(deps.enabled ?? process.env.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE === "true")) { res.sendStatus(404); return; }
    res.set("Cache-Control", "no-store");
    const customer = typeof req.query.customer === "string" ? req.query.customer : "";
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    try {
      if (customer.length > 80 || (req.query.cursor !== undefined && !cursor)) throw new Error();
      decodeQueueCursor(cursor, customer);
    } catch { res.status(400).json({ error: "Invalid queue request." }); return; }
    try {
      const customers = await (deps.customers ?? listOperationsCustomers)();
      // Missing status is not evidence of active customer eligibility.
      const active = new Set(customers.filter(c => c.customer_status?.toLowerCase() === "active").map(c => c.lift_customer_id));
      if (customer && !active.has(customer)) { res.status(403).json({ error: "The customer is not active in Pathfinder." }); return; }
      const page = await (deps.list ?? readProofQueuePage)(customer, cursor);
      const lines = page.orders.filter(order => order.customer_id && active.has(order.customer_id) && (!customer || customer === order.customer_id)).flatMap(order => projectProofQueue(order));
      res.json({ lines, next_cursor: page.next_cursor, checked_at: new Date().toISOString(), coverage: "cached_orders_only" });
    } catch { res.status(503).json({ error: "Proof queue could not be loaded. Existing proof access is unchanged." }); }
  });
  return router;
}

import { Router } from "express";
import { listWorkspaceCustomerIds, listOperationsCustomers, listCustomerOrderSummaries } from "../store.js";
import { projectProofQueue } from "./proof-queue.js";
import { decodeQueueCursor, readProofQueuePage } from "./proof-queue-store.js";
import { decodeDiagnosticCursor, readIntakeDiagnostics } from "../intake-diagnostics-store.js";

export function createOperationsRouter(deps: {
  enabled?: boolean; list?: typeof readProofQueuePage;
  customers?: () => Promise<Array<{ lift_customer_id: string; customer_status?: string | null }>>;
  workspaceIds?: () => Promise<string[]>;
  customerOrders?: typeof listCustomerOrderSummaries;
  diagnostics?: typeof readIntakeDiagnostics;
} = {}) {
  const router = Router();
  router.get("/customer-orders", async (_req, res) => {
    if (!(deps.enabled ?? process.env.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE === "true")) { res.sendStatus(404); return; }
    res.set("Cache-Control", "no-store");
    try {
      const ids = [...new Set(await (deps.workspaceIds ?? listWorkspaceCustomerIds)())];
      const items = await (deps.customerOrders ?? listCustomerOrderSummaries)(ids);
      res.json({ items: items.filter(row => ids.includes(row.customer_id)), checked_at: new Date().toISOString(), coverage: "persisted_confirmed_non_archived_production_jobs", timestamp_source: "pathfinder_confirmation" });
    } catch { res.status(503).json({ error: "Customer order history is unavailable. Refresh to retry." }); }
  });
  router.get("/intake-diagnostics", async (req, res) => {
    if (!(deps.enabled ?? process.env.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE === "true")) { res.sendStatus(404); return; }
    res.set("Cache-Control", "no-store");
    const customer = typeof req.query.customer === "string" ? req.query.customer : "";
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const state = req.query.state === undefined || req.query.state === "open" ? "open" : req.query.state === "all" ? "all" : null;
    try {
      if ((req.query.customer !== undefined && typeof req.query.customer !== "string") || customer.length > 80 ||
          (req.query.cursor !== undefined && !cursor) || !state) throw new Error();
      decodeDiagnosticCursor(cursor, customer, state);
    } catch { res.status(400).json({ error: "Invalid intake diagnostic request." }); return; }
    try {
      const eligible = [...new Set((await (deps.customers ?? listOperationsCustomers)()).map(row => row.lift_customer_id))];
      if (customer && !eligible.includes(customer)) { res.status(403).json({ error: "The customer does not have a Pathfinder workspace." }); return; }
      const page = await (deps.diagnostics ?? readIntakeDiagnostics)(eligible, customer, cursor, state!);
      res.json({ ...page, items: page.items.filter(row => eligible.includes(row.customer_id) && (!customer || row.customer_id === customer)),
        checked_at: new Date().toISOString(), coverage: "recorded_preparation_observations" });
    } catch { res.status(503).json({ error: "Intake diagnostics are unavailable. An empty list must not be interpreted as successful intake." }); }
  });
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
      // This reader already restricts to saved Pathfinder workspaces. Lift's status
      // (e.g. "Regular") is not a Pathfinder activation flag or Proof capability.
      const eligible = new Set(customers.map(c => c.lift_customer_id));
      if (customer && !eligible.has(customer)) { res.status(403).json({ error: "The customer does not have a Pathfinder workspace." }); return; }
      const page = await (deps.list ?? readProofQueuePage)(customer, cursor);
      const lines = page.orders.filter(order => order.customer_id && eligible.has(order.customer_id) && (!customer || customer === order.customer_id)).flatMap(order => projectProofQueue(order));
      res.json({ lines, next_cursor: page.next_cursor, checked_at: new Date().toISOString(), coverage: "cached_orders_only" });
    } catch { res.status(503).json({ error: "Proof queue could not be loaded. Existing proof access is unchanged." }); }
  });
  return router;
}

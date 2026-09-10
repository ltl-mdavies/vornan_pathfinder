import { Router } from "express";
import { buildIntakeExceptionsPage, IntakeQueryError, type IntakePage } from "./intake-exceptions.js";

/** Mount behind Pathfinder's existing /api authentication middleware. */
export function createIntakeExceptionsRouter(args: {
  enabled: boolean;
  customer_ids: string[];
  list: (customerId: string, limit: number, cursor?: string) => Promise<IntakePage>;
  now?: () => Date;
}) {
  const router = Router();
  router.get("/customers/:customerId/intake-exceptions", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!args.enabled || !args.customer_ids.includes(req.params.customerId)) {
      res.status(423).json({ error: "Intake Exceptions is disabled for this customer." });
      return;
    }
    try {
      if ((req.query.limit !== undefined && typeof req.query.limit !== "string") ||
        (req.query.cursor !== undefined && typeof req.query.cursor !== "string") ||
        (typeof req.query.limit === "string" && !/^[1-9][0-9]{0,2}$/.test(req.query.limit))) {
        throw new IntakeQueryError("Invalid intake query");
      }
      const page = await args.list(req.params.customerId, req.query.limit === undefined ? 50 : Number(req.query.limit), req.query.cursor as string | undefined);
      res.json(buildIntakeExceptionsPage(page, (args.now ?? (() => new Date()))().toISOString()));
    } catch (error) {
      res.status(error instanceof IntakeQueryError ? 400 : 503).json({
        error: error instanceof IntakeQueryError ? "Invalid intake page request." : "Intake Exceptions is temporarily unavailable."
      });
    }
  });
  return router;
}

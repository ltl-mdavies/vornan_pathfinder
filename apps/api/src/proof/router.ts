import { Router, type Request, type Response } from "express";
import { InvalidLiftOrderNumberError, LiftOrderNotFoundError, normalizeLiftOrderNumber } from "@pathfinder/proof-domain";
import { LiftProofReadError } from "@pathfinder/lift-proof-adapter";
import { assertLiftProofWritesDisabled, getProofRuntimeConfig } from "./runtime-config.js";
import { getProofGrantById, getProofOrder, listProofAuditEvents, listProofParticipants } from "./store.js";
import { syncProofOrder } from "./service.js";
import { proofOrderIsStale } from "./sync-queue.js";
import {
  createProofGrant,
  listOrderProofGrants,
  ProofAccessFeatureDisabledError,
  ProofAccessValidationError,
  ProofOrderNotSynchronizedError,
  updateProofGrant
} from "./access-service.js";
import type { ProofAuditContext } from "./audit-service.js";
import { ProofGrantNotFoundError, sendProofGrantLinkEmail } from "./email-service.js";

function operatorAuditContext(req: Request, res: Response): ProofAuditContext {
  const authUser = res.locals.authUser as { uid?: unknown } | undefined;
  return {
    actor_type: "operator",
    actor_id: typeof authUser?.uid === "string" ? authUser.uid : "local-operator",
    correlation_id: req.header("x-request-id") ?? undefined,
    source: "operator"
  };
}

function errorStatus(error: unknown) {
  if (error instanceof InvalidLiftOrderNumberError) {
    return 400;
  }
  if (error instanceof LiftOrderNotFoundError) {
    return 404;
  }
  if (error instanceof LiftProofReadError) {
    return error.status === 404 ? 404 : 502;
  }
  if (error instanceof ProofAccessFeatureDisabledError) {
    return 503;
  }
  if (error instanceof ProofAccessValidationError) {
    return 400;
  }
  if (error instanceof ProofGrantNotFoundError) {
    return 404;
  }
  if (error instanceof ProofOrderNotSynchronizedError) {
    return 409;
  }
  if (error instanceof Error && error.message === "Proof audit cursor is invalid.") {
    return 400;
  }
  return 500;
}

export interface ProofAdminRouterDependencies {
  getOrderForGrant?: typeof getProofOrder;
  syncOrderForGrant?: typeof syncProofOrder;
  createGrant?: typeof createProofGrant;
  orderIsStale?: typeof proofOrderIsStale;
}

export function createProofAdminRouter(dependencies: ProofAdminRouterDependencies = {}) {
  const router = Router();
  const getOrderForGrant = dependencies.getOrderForGrant ?? getProofOrder;
  const syncOrderForGrant = dependencies.syncOrderForGrant ?? syncProofOrder;
  const createGrant = dependencies.createGrant ?? createProofGrant;
  const orderIsStale = dependencies.orderIsStale ?? proofOrderIsStale;

  router.get("/health/lift", (_req, res) => {
    assertLiftProofWritesDisabled();
    const config = getProofRuntimeConfig();
    res.json({
      phase: config.phase,
      storage_driver: config.storage_driver,
      core_table_configured: Boolean(config.core_table_name),
      audit_table_configured: Boolean(config.audit_table_name),
      lift_reads: {
        order_host: new URL(config.read.order_read_url).host,
        report_host: new URL(config.read.proof_report_read_url).host,
        timeout_ms: config.read.timeout_ms,
        concurrency: config.read.concurrency,
        proof_readable_min_step: config.read.proof_readable_min_step,
        custom_auth_configured: false
      },
      sync: {
        queue_configured: Boolean(config.sync.queue_url),
        stale_after_minutes: config.sync.stale_after_minutes,
        automatic_refresh_max_inactive_days: config.sync.automatic_refresh_max_inactive_days
      },
      access: {
        edge_secret_configured: Boolean(config.access.edge_shared_secret),
        public_base_host: new URL(config.access.public_base_url).host,
        grant_ttl_days: config.access.grant_ttl_days,
        session_ttl_minutes: config.access.session_ttl_minutes
      },
      feature_flags: config.feature_flags,
      qa_lifecycle: config.qa_lifecycle
    });
  });

  router.post("/orders/:orderNumber/sync", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const result = await syncProofOrder(req.params.orderNumber, { audit_context: operatorAuditContext(req, res) });
      res.json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : "Vornan Proof sync failed."
      });
    }
  });

  router.get("/orders/:orderNumber", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const orderNumber = normalizeLiftOrderNumber(req.params.orderNumber);
      const order = await getProofOrder(orderNumber);
      if (!order) {
        res.status(404).json({ error: `Proof order ${orderNumber} has not been synchronized.` });
        return;
      }
      res.json({ order, feature_flags: getProofRuntimeConfig().feature_flags });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : "Vornan Proof inspection failed."
      });
    }
  });

  router.get("/orders/:orderNumber/grants", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      res.json({ grants: await listOrderProofGrants(req.params.orderNumber) });
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Proof grants could not be listed." });
    }
  });

  router.get("/orders/:orderNumber/audit", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const orderNumber = normalizeLiftOrderNumber(req.params.orderNumber);
      const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : undefined;
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json(await listProofAuditEvents(orderNumber, { limit, cursor }));
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Proof audit could not be read." });
    }
  });

  router.get("/grants/:grantId/participants", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      if (!(await getProofGrantById(req.params.grantId))) {
        res.status(404).json({ error: "Proof grant was not found." });
        return;
      }
      const participants = (await listProofParticipants(req.params.grantId))
        .sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at));
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json({ participants });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : "Proof reviewers could not be listed."
      });
    }
  });

  router.post("/orders/:orderNumber/grants", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      if (!getProofRuntimeConfig().feature_flags.grant_creation) {
        throw new ProofAccessFeatureDisabledError("grant creation");
      }
      const orderNumber = normalizeLiftOrderNumber(req.params.orderNumber);
      const cached = await getOrderForGrant(orderNumber);
      if (!cached || orderIsStale(cached.last_synced_at)) {
        await syncOrderForGrant(orderNumber, { audit_context: operatorAuditContext(req, res) });
      }
      const result = await createGrant({
        order_number: orderNumber,
        label: typeof req.body?.label === "string" ? req.body.label : null,
        scope: req.body?.scope,
        expires_at: typeof req.body?.expires_at === "string" ? req.body.expires_at : null,
        audit_context: operatorAuditContext(req, res)
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Proof access could not be granted." });
    }
  });

  router.patch("/grants/:grantId", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const requestedAction = req.body?.action;
      if (requestedAction !== undefined && !["update", "revoke", "regenerate"].includes(requestedAction)) {
        throw new ProofAccessValidationError("Proof grant action must be update, revoke, or regenerate.");
      }
      const result = await updateProofGrant(req.params.grantId, {
        action: requestedAction,
        label: typeof req.body?.label === "string" || req.body?.label === null ? req.body.label : undefined,
        expires_at:
          typeof req.body?.expires_at === "string" || req.body?.expires_at === null ? req.body.expires_at : undefined
      }, new Date(), operatorAuditContext(req, res));
      if (!result) {
        res.status(404).json({ error: "Proof grant was not found." });
        return;
      }
      res.json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Proof access could not be revoked." });
    }
  });

  router.post("/grants/:grantId/email", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      if (typeof req.body?.recipient_email !== "string" || typeof req.body?.access_url !== "string") {
        throw new ProofAccessValidationError("Recipient email and the one-time Proof access link are required.");
      }
      const delivery = await sendProofGrantLinkEmail({
        grant_id: req.params.grantId,
        recipient_email: req.body.recipient_email,
        access_url: req.body.access_url,
        audit_context: operatorAuditContext(req, res)
      });
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json({ delivery });
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Proof link email could not be sent." });
    }
  });

  return router;
}

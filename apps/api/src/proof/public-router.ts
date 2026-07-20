import { Router, type Request } from "express";
import { toPublicProofOrder, toPublicProofTaskHistory } from "@pathfinder/proof-domain";
import {
  endProofSession,
  exchangeProofToken,
  ProofAccessDeniedError,
  ProofAccessFeatureDisabledError,
  ProofAccessValidationError,
  validateProofCsrf,
  validateProofSession
} from "./access-service.js";
import { assertLiftProofWritesDisabled, getProofRuntimeConfig } from "./runtime-config.js";
import { getProofOrder, listProofParticipants } from "./store.js";
import { proofAutomaticRefreshState, queueProofSync } from "./sync-queue.js";
import { identifyProofParticipant, publicProofActivity, publicProofParticipant } from "./participant-service.js";
import { acknowledgeProofFeedback, proofFeedbackStates as loadProofFeedbackStates } from "./feedback-service.js";

export const PROOF_SESSION_COOKIE = "vornan_proof_session";
export const PROOF_SESSION_COOKIE_PATH = "/api/public/proof";
export const PROOF_CSRF_COOKIE = "vornan_proof_csrf";
export const PROOF_CSRF_COOKIE_PATH = "/";

class ProofCsrfDeniedError extends Error {
  constructor() {
    super("Proof request CSRF validation failed.");
    this.name = "ProofCsrfDeniedError";
  }
}

function cookieValue(req: Request, name: string) {
  const cookies = req.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(parts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function deny(res: Parameters<Parameters<Router["get"]>[1]>[1]) {
  res.status(401).json({ error: "This proof access link is invalid or has expired." });
}

function requireCsrf(req: Request, session: Awaited<ReturnType<typeof validateProofSession>>["session"]) {
  const header = req.get("x-vornan-proof-csrf") ?? "";
  const cookie = cookieValue(req, PROOF_CSRF_COOKIE) ?? "";
  if (!header || header !== cookie || !validateProofCsrf(session, header)) {
    throw new ProofCsrfDeniedError();
  }
}

function handlePublicError(error: unknown, res: Parameters<Parameters<Router["get"]>[1]>[1], fallback: string) {
  if (error instanceof ProofAccessDeniedError) {
    deny(res);
    return;
  }
  if (error instanceof ProofCsrfDeniedError) {
    res.status(403).json({ error: "This proof request could not be verified." });
    return;
  }
  if (error instanceof ProofAccessValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ProofAccessFeatureDisabledError) {
    res.status(503).json({ error: "Proof access is not available." });
    return;
  }
  res.status(500).json({ error: fallback });
}

interface ProofPublicRouterDependencies {
  queueSync?: typeof queueProofSync;
}

export function createProofPublicRouter(dependencies: ProofPublicRouterDependencies = {}) {
  const router = Router();
  const enqueueSync = dependencies.queueSync ?? queueProofSync;

  router.use((_req, res, next) => {
    assertLiftProofWritesDisabled();
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  router.post("/sessions", async (req, res) => {
    try {
      const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
      const { raw_session: rawSession, raw_csrf: rawCsrf, session } = await exchangeProofToken(rawToken);
      const maxAge = Math.max(0, Date.parse(session.expires_at) - Date.now());
      res.cookie(PROOF_SESSION_COOKIE, rawSession, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: PROOF_SESSION_COOKIE_PATH,
        maxAge
      });
      res.cookie(PROOF_CSRF_COOKIE, rawCsrf, {
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        path: PROOF_CSRF_COOKIE_PATH,
        maxAge
      });
      res.status(201).json({ authenticated: true, expires_at: session.expires_at });
    } catch (error) {
      handlePublicError(error, res, "Proof access could not be established.");
    }
  });

  router.get("/order", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession);
      const order = await getProofOrder(session.order_number);
      if (!order) {
        deny(res);
        return;
      }
      const participants = await listProofParticipants(session.grant_id);
      const participant = session.participant_id
        ? participants.find((candidate) => candidate.participant_id === session.participant_id) ?? null
        : null;
      const publicOrder = toPublicProofOrder(order, session.scope);
      const feedbackStates = new Map(
        (await loadProofFeedbackStates(order, session)).map((state) => [state.task_id, state])
      );
      const automaticRefresh = proofAutomaticRefreshState(order);
      const refresh = automaticRefresh.eligible
        ? await enqueueSync(order.order_number, "stale_public_read").catch(() => ({ queued: false as const }))
        : { queued: false as const };
      res.json({
        order: {
          ...publicOrder,
          health: automaticRefresh.stale && publicOrder.health === "active" ? "stale" : publicOrder.health,
          tasks: publicOrder.tasks.map((task) => ({ ...task, ...feedbackStates.get(task.task_id) }))
        },
        refresh_queued: refresh.queued,
        session_expires_at: session.expires_at,
        participant: participant ? publicProofParticipant(participant) : null,
        activity: publicProofActivity(participants)
      });
    } catch (error) {
      handlePublicError(error, res, "Proof details could not be loaded.");
    }
  });

  router.get("/tasks/:taskId/history", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession);
      const order = await getProofOrder(session.order_number);
      if (!order) {
        deny(res);
        return;
      }
      const task = order.tasks.find((candidate) => candidate.task_id === req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "The selected proof is not available in this review session." });
        return;
      }
      res.json(toPublicProofTaskHistory(task));
    } catch (error) {
      handlePublicError(error, res, "Proof file history could not be loaded.");
    }
  });

  router.post("/participants", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession);
      requireCsrf(req, session);
      const existingParticipant = Boolean(session.participant_id);
      const { participant } = await identifyProofParticipant({
        session,
        display_name: req.body?.display_name,
        email: req.body?.email,
        correlation_id: req.get("x-request-id") ?? undefined
      });
      res.status(existingParticipant ? 200 : 201).json({ participant: publicProofParticipant(participant) });
    } catch (error) {
      handlePublicError(error, res, "Reviewer identity could not be saved.");
    }
  });

  router.post("/tasks/:taskId/feedback-acknowledgements", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession);
      requireCsrf(req, session);
      const order = await getProofOrder(session.order_number);
      if (!order) {
        deny(res);
        return;
      }
      const { acknowledgement, created } = await acknowledgeProofFeedback({
        order,
        session,
        task_id: req.params.taskId,
        correlation_id: req.get("x-request-id") ?? undefined
      });
      res.status(created ? 201 : 200).json({
        feedback: {
          required: true,
          acknowledged: true,
          acknowledged_at: acknowledgement.acknowledged_at
        }
      });
    } catch (error) {
      handlePublicError(error, res, "Proof feedback could not be acknowledged.");
    }
  });

  router.post("/order/refresh", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession);
      requireCsrf(req, session);
      const refresh = await enqueueSync(session.order_number, "public_refresh");
      if (!refresh.queued) {
        res.setHeader("Retry-After", "30");
        res.status(503).json({ error: "Proof refresh is temporarily unavailable." });
        return;
      }
      res.setHeader("Retry-After", "3");
      res.status(202).json({ refresh_queued: true });
    } catch (error) {
      handlePublicError(error, res, "Proof refresh could not be requested.");
    }
  });

  router.delete("/sessions/current", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession);
      requireCsrf(req, session);
      await endProofSession(rawSession);
      res.clearCookie(PROOF_SESSION_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: PROOF_SESSION_COOKIE_PATH
      });
      res.clearCookie(PROOF_CSRF_COOKIE, {
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        path: PROOF_CSRF_COOKIE_PATH
      });
      res.status(204).end();
    } catch (error) {
      handlePublicError(error, res, "Proof session could not be ended.");
    }
  });

  router.get("/health", (_req, res) => {
    const config = getProofRuntimeConfig();
    res.json({ phase: config.phase, public_read: config.feature_flags.public_read, decisions_enabled: false });
  });

  return router;
}

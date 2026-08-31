import { Router, type Request } from "express";
import { toPublicProofOrder, toPublicProofTaskHistory } from "@pathfinder/proof-domain";
import {
  createProofShare,
  endProofSession,
  exchangeProofToken,
  extendProofSession,
  getProofSessionForLogout,
  listProofShares,
  mayManageProofShares,
  ProofAccessDeniedError,
  ProofAccessFeatureDisabledError,
  ProofAccessValidationError,
  revokeProofShare,
  validateProofCsrf,
  validateProofSession
} from "./access-service.js";
import { assertLiftProofWritesDisabled, getProofRuntimeConfig } from "./runtime-config.js";
import { getProofOrder, listProofParticipants } from "./store.js";
import { proofAutomaticRefreshState, queueProofSync } from "./sync-queue.js";
import { identifyProofParticipant, publicProofActivity, publicProofParticipant } from "./participant-service.js";
import { acknowledgeProofFeedback, proofFeedbackStates as loadProofFeedbackStates } from "./feedback-service.js";
import { PROOF_EXPECTED_DENIAL_LOCAL } from "./telemetry.js";
import {
  ProofCustomerApprovalError,
  proofCustomerApprovalService
} from "./customer-approval-service.js";
import { ProofDecisionIntegrityError } from "./decision-contract.js";
import { ProofDecisionLedgerError } from "./decision-ledger.js";
import {
  ProofAssetUploadServiceError,
  createProofAssetUploadService,
  type ProofAssetUploadFinalizeRequest,
  type ProofAssetUploadPrepareRequest,
  type ProofAssetUploadStatusRequest
} from "./asset-upload-service.js";
import type { ProofCustomerCapabilityAuthorityReader } from "./customer-capability-authority.js";
import { ProofDetailedReportError, proofDetailedReportService } from "./detailed-report-service.js";

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

function requireCsrf(req: Request, session: Parameters<typeof validateProofCsrf>[0]) {
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
  if (error instanceof ProofDecisionIntegrityError) {
    res.status(error.code.includes("stale") || error.code.includes("mismatch") ? 409 : 400).json({ error: error.message });
    return;
  }
  if (error instanceof ProofDecisionLedgerError) {
    res.status(error.code === "concurrent_update" ? 409 : 500).json({
      error: error.code === "concurrent_update"
        ? "This proof decision is already being processed."
        : "The proof decision could not be persisted safely."
    });
    return;
  }
  if (error instanceof ProofCustomerApprovalError) {
    const status = error.code === "disabled"
      ? 503
      : error.code === "conflict" || error.code === "stale" || error.code === "already_attempted"
        ? 409
        : error.code === "not_allowed"
          ? 403
          : 400;
    if (status === 503 || status === 403) res.locals[PROOF_EXPECTED_DENIAL_LOCAL] = true;
    res.status(status).json({ error: error.message });
    return;
  }
  if (error instanceof ProofAssetUploadServiceError) {
    const status = error.code === "disabled"
      ? 503
      : error.code === "unauthenticated" || error.code === "not_allowed"
        ? 403
        : error.code === "stale" || error.code === "conflict"
          ? 409
          : error.code === "storage_failed"
            ? 502
            : 400;
    if (status === 503 || status === 403) res.locals[PROOF_EXPECTED_DENIAL_LOCAL] = true;
    res.status(status).json({ error: error.message });
    return;
  }
  if (error instanceof ProofDetailedReportError) {
    const status = error.code === "not_allowed" ? 403 : error.code === "stale" ? 409 : error.code === "provider_failed" ? 502 : 400;
    if (status === 403) res.locals[PROOF_EXPECTED_DENIAL_LOCAL] = true;
    res.status(status).json({ error: error.message });
    return;
  }
  if (error instanceof ProofAccessFeatureDisabledError) {
    res.locals[PROOF_EXPECTED_DENIAL_LOCAL] = true;
    res.status(503).json({ error: "Proof access is not available." });
    return;
  }
  res.status(500).json({ error: fallback });
}

interface ProofPublicRouterDependencies {
  queueSync?: typeof queueProofSync;
  approveProof?: typeof proofCustomerApprovalService.approve;
  requestProofChanges?: typeof proofCustomerApprovalService.requestChanges;
  prepareRevisionAsset?: ReturnType<typeof createProofAssetUploadService>["prepare"];
  revisionAssetStatus?: ReturnType<typeof createProofAssetUploadService>["status"];
  finalizeRevisionAsset?: ReturnType<typeof createProofAssetUploadService>["finalize"];
  detailedReportBegin?: typeof proofDetailedReportService.begin;
  detailedReportCheck?: typeof proofDetailedReportService.check;
  detailedReportView?: typeof proofDetailedReportService.viewByRecord;
  readCustomerCapabilityWorkspace?: ProofCustomerCapabilityAuthorityReader;
}

export function createProofPublicRouter(dependencies: ProofPublicRouterDependencies = {}) {
  const router = Router();
  const enqueueSync = dependencies.queueSync ?? queueProofSync;
  const approveProof = dependencies.approveProof ?? proofCustomerApprovalService.approve;
  const requestProofChanges = dependencies.requestProofChanges ?? proofCustomerApprovalService.requestChanges;
  const revisionAssets = createProofAssetUploadService();
  const prepareRevisionAsset = dependencies.prepareRevisionAsset ?? revisionAssets.prepare;
  const revisionAssetStatus = dependencies.revisionAssetStatus ?? revisionAssets.status;
  const finalizeRevisionAsset = dependencies.finalizeRevisionAsset ?? revisionAssets.finalize;
  const detailedReportBegin = dependencies.detailedReportBegin ?? proofDetailedReportService.begin;
  const detailedReportCheck = dependencies.detailedReportCheck ?? proofDetailedReportService.check;
  const detailedReportView = dependencies.detailedReportView ?? proofDetailedReportService.viewByRecord;
  const readCustomerCapabilityWorkspace = dependencies.readCustomerCapabilityWorkspace;

  function revisionActor(session: Awaited<ReturnType<typeof validateProofSession>>["session"]) {
    if (
      !getProofRuntimeConfig().feature_flags.revision_upload ||
      !getProofRuntimeConfig().feature_flags.public_read
    ) {
      throw new ProofAssetUploadServiceError(
        "disabled",
        "Customer revised-art uploads are not enabled."
      );
    }
    if (
      session.scope !== "review" ||
      session.capability?.access_mode !== "review" ||
      !/^\d{1,20}$/.test(session.capability?.proof_customer_id ?? "") ||
      !session.participant_id
    ) {
      throw new ProofAssetUploadServiceError(
        "unauthenticated",
        "Identify the reviewer in a review-enabled session first."
      );
    }
    return {
      actor_type: "customer_session" as const,
      actor_id: session.session_id,
      source: "public_api" as const,
      grant_id: session.grant_id,
      participant_id: session.participant_id,
      proof_customer_id: session.capability.proof_customer_id
    };
  }

  function shareActor(
    session: Awaited<ReturnType<typeof validateProofSession>>["session"],
    grant: Awaited<ReturnType<typeof validateProofSession>>["grant"]
  ) {
    if (!mayManageProofShares(grant)) {
      throw new ProofAccessFeatureDisabledError("shared access");
    }
    if (!session.participant_id) {
      throw new ProofAccessValidationError("Identify yourself before managing shared links.");
    }
    return {
      actor_type: "customer_session" as const,
      actor_id: session.session_id,
      participant_id: session.participant_id,
      correlation_id: undefined,
      source: "public_api" as const
    };
  }

  router.use((_req, res, next) => {
    assertLiftProofWritesDisabled();
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  router.post("/sessions", async (req, res) => {
    try {
      const previousRawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
      const { raw_session: rawSession, raw_csrf: rawCsrf, session } = await exchangeProofToken(
        rawToken,
        new Date(),
        readCustomerCapabilityWorkspace
      );
      if (previousRawSession && previousRawSession !== rawSession) {
        await endProofSession(previousRawSession).catch(() => undefined);
      }
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
      const { session, grant } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      const order = await getProofOrder(session.order_number);
      if (!order) {
        deny(res);
        return;
      }
      const participants = await listProofParticipants(session.grant_id);
      const participant = session.participant_id
        ? participants.find((candidate) => candidate.participant_id === session.participant_id) ?? null
        : null;
      const automaticRefresh = proofAutomaticRefreshState(order);
      const proofRuntime = getProofRuntimeConfig();
      const revisionUploadEnabled =
        session.scope === "review" &&
        grant.capability?.access_mode === "review" &&
        proofRuntime.feature_flags.public_read &&
        proofRuntime.feature_flags.revision_upload;
      const publicOrder = toPublicProofOrder(order, session.scope, {
        include_asset_urls: !automaticRefresh.stale,
        decisions_enabled:
          proofRuntime.feature_flags.approve &&
          proofRuntime.feature_flags.public_read &&
          grant.capability?.access_mode === "review",
        revision_action_enabled: revisionUploadEnabled,
        share_access_enabled: mayManageProofShares(grant) && Boolean(participant),
        review_experience: grant.capability?.review_experience ?? "simple"
      });
      const feedbackStates = new Map(
        (await loadProofFeedbackStates(order, session)).map((state) => [state.task_id, state])
      );
      const refresh = automaticRefresh.eligible
        ? await enqueueSync(order.order_number, "stale_public_read").catch(() => ({ queued: false as const }))
        : { queued: false as const };
      res.json({
        order: {
          ...publicOrder,
          access: {
            ...publicOrder.access,
            revision_upload_enabled: revisionUploadEnabled
          },
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
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
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
      const automaticRefresh = proofAutomaticRefreshState(order);
      res.json(toPublicProofTaskHistory(task, {
        include_asset_urls: !automaticRefresh.stale,
        // A replacement proof receives a new Lift attachment ID and the old
        // attachment becomes archived. Keep that same-line sequence together
        // without conflating proofs that are concurrently active on the line.
        prior_tasks: task.order_line_id
          ? order.archived_tasks.filter((candidate) => candidate.order_line_id === task.order_line_id)
          : []
      }));
    } catch (error) {
      handlePublicError(error, res, "Proof file history could not be loaded.");
    }
  });

  router.post("/participants", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
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

  router.get("/shares", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session, grant } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      shareActor(session, grant);
      res.json({ shares: await listProofShares(grant) });
    } catch (error) {
      handlePublicError(error, res, "Shared links could not be loaded.");
    }
  });

  router.post("/shares", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session, grant } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const auditContext = shareActor(session, grant);
      const created = await createProofShare({
        parent_grant: grant,
        parent_session: session,
        scope: req.body?.scope,
        expires_in_hours: req.body?.expires_in_hours,
        label: req.body?.label,
        description: req.body?.description,
        audit_context: { ...auditContext, correlation_id: req.get("x-request-id") ?? undefined }
      });
      res.status(201).json(created);
    } catch (error) {
      handlePublicError(error, res, "Shared link could not be created.");
    }
  });

  router.delete("/shares/:grantId", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session, grant } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const auditContext = shareActor(session, grant);
      const revoked = await revokeProofShare({
        parent_grant: grant,
        grant_id: req.params.grantId,
        audit_context: { ...auditContext, correlation_id: req.get("x-request-id") ?? undefined }
      });
      if (!revoked) {
        res.status(404).json({ error: "This shared link is not available." });
        return;
      }
      res.json({ share: revoked });
    } catch (error) {
      handlePublicError(error, res, "Shared link could not be turned off.");
    }
  });

  router.post("/tasks/:taskId/feedback-acknowledgements", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
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

  router.post("/tasks/:taskId/detailed-reports/:definitionId", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const report = await detailedReportBegin({
        session, task_id: req.params.taskId, definition_id: req.params.definitionId,
        correlation_id: req.get("x-request-id") ?? `proof-detailed-report-${session.session_id}`
      });
      res.status(report.state === "generation_started" ? 201 : 200).json({ report });
    } catch (error) {
      handlePublicError(error, res, "Detailed report generation could not be started.");
    }
  });

  router.get("/tasks/:taskId/detailed-reports/:definitionId", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      const report = await detailedReportCheck({
        session, task_id: req.params.taskId, definition_id: req.params.definitionId,
        correlation_id: req.get("x-request-id") ?? `proof-detailed-report-${session.session_id}`
      });
      res.json({ report });
    } catch (error) {
      handlePublicError(error, res, "Detailed report status could not be loaded.");
    }
  });

  router.get("/detailed-reports/:recordId/view", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      // This is the only public API response intentionally loaded in the Proof UI.
      // It remains session-bound and redirects only to the report URL resolved by Lift.
      res.removeHeader("X-Frame-Options");
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
      const location = await detailedReportView({
        session, record_id: req.params.recordId,
        correlation_id: req.get("x-request-id") ?? `proof-detailed-report-${session.session_id}`
      });
      res.redirect(302, location);
    } catch (error) {
      handlePublicError(error, res, "Detailed report could not be opened.");
    }
  });

  router.post("/tasks/:taskId/decisions/approve", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const result = await approveProof({
        session,
        request: {
          task_id: req.params.taskId,
          attachment_id: req.body?.attachment_id,
          expected_task_version: req.body?.expected_task_version,
          expected_version_id: req.body?.expected_version_id,
          idempotency_key: req.body?.idempotency_key,
          note: req.body?.note
        },
        correlation_id: req.get("x-request-id") ?? `proof-customer-${session.session_id}`
      });
      res.status(result.status === "new" ? 201 : 200).json({ decision: result });
    } catch (error) {
      handlePublicError(error, res, "Proof approval could not be completed.");
    }
  });

  router.post("/tasks/:taskId/decisions/request-changes", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const result = await requestProofChanges({
        session,
        request: {
          task_id: req.params.taskId,
          attachment_id: req.body?.attachment_id,
          expected_task_version: req.body?.expected_task_version,
          expected_version_id: req.body?.expected_version_id,
          idempotency_key: req.body?.idempotency_key,
          note: req.body?.note
        },
        correlation_id: req.get("x-request-id") ?? `proof-customer-${session.session_id}`
      });
      res.status(result.status === "new" ? 201 : 200).json({ decision: result });
    } catch (error) {
      handlePublicError(error, res, "Proof change request could not be completed.");
    }
  });

  router.post("/tasks/:taskId/revised-assets/uploads/prepare", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const result = await prepareRevisionAsset({
        request: {
          order_number: session.order_number,
          task_id: req.params.taskId,
          attachment_id: req.body?.attachment_id,
          idempotency_key: req.body?.idempotency_key,
          original_filename: req.body?.original_filename,
          content_type: req.body?.content_type,
          content_length: req.body?.content_length,
          sha256: req.body?.sha256
        } as ProofAssetUploadPrepareRequest,
        actor_context: revisionActor(session),
        correlation_id: req.get("x-request-id") ?? `proof-revision-${session.session_id}`
      });
      res.status(result.status === "new" ? 201 : 200).json(result);
    } catch (error) {
      handlePublicError(error, res, "Revised artwork upload could not be prepared.");
    }
  });

  router.get("/revised-assets/uploads/:assetId", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      revisionActor(session);
      const result = await revisionAssetStatus({
        request: {
          order_number: session.order_number,
          asset_id: req.params.assetId
        } as ProofAssetUploadStatusRequest
      });
      res.json(result);
    } catch (error) {
      handlePublicError(error, res, "Revised artwork status could not be loaded.");
    }
  });

  router.post("/revised-assets/uploads/finalize", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const result = await finalizeRevisionAsset({
        request: {
          order_number: session.order_number,
          asset_id: req.body?.asset_id
        } as ProofAssetUploadFinalizeRequest,
        actor_context: revisionActor(session),
        correlation_id: req.get("x-request-id") ?? `proof-revision-${session.session_id}`
      });
      res.json(result);
    } catch (error) {
      handlePublicError(error, res, "Revised artwork upload could not be finalized.");
    }
  });

  router.post("/order/refresh", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
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

  router.post("/sessions/current/extend", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const { session } = await validateProofSession(rawSession, new Date(), readCustomerCapabilityWorkspace);
      requireCsrf(req, session);
      const extended = await extendProofSession(rawSession);
      const maxAge = Math.max(0, Date.parse(extended.expires_at) - Date.now());
      res.cookie(PROOF_SESSION_COOKIE, rawSession, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: PROOF_SESSION_COOKIE_PATH,
        maxAge
      });
      const rawCsrf = cookieValue(req, PROOF_CSRF_COOKIE) ?? "";
      res.cookie(PROOF_CSRF_COOKIE, rawCsrf, {
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        path: PROOF_CSRF_COOKIE_PATH,
        maxAge
      });
      res.json({ extended: true, expires_at: extended.expires_at });
    } catch (error) {
      handlePublicError(error, res, "Proof session could not be continued.");
    }
  });

  router.delete("/sessions/current", async (req, res) => {
    try {
      const rawSession = cookieValue(req, PROOF_SESSION_COOKIE) ?? "";
      const session = await getProofSessionForLogout(rawSession);
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
    res.json({
      phase: config.phase,
      public_read: config.feature_flags.public_read,
      decisions_enabled: config.feature_flags.public_read && config.feature_flags.approve,
      ltl_demo_qa: {
        active: config.ltl_demo_qa.active,
        allowed_customer_id: config.ltl_demo_qa.allowed_customer_id,
        allowed_order_count: config.ltl_demo_qa.allowed_order_numbers.length,
        activation_expires_at: config.ltl_demo_qa.activation_expires_at,
        session_ttl_minutes: config.ltl_demo_qa.session_ttl_minutes,
        automatic_retry: false
      }
    });
  });

  return router;
}

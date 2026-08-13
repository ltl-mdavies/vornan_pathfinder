import { Router, type Request, type Response } from "express";
import { InvalidLiftOrderNumberError, LiftOrderNotFoundError, normalizeLiftOrderNumber } from "@pathfinder/proof-domain";
import { LiftProofReadError } from "@pathfinder/lift-proof-adapter";
import { assertLiftProofWritesDisabled, getProofRuntimeConfig } from "./runtime-config.js";
import { getProofOperatorActionQaConfig } from "./operator-action-config.js";
import { getProofGrantById, getProofOrder, listProofAuditEvents, listProofParticipants } from "./store.js";
import { syncProofOrder } from "./service.js";
import { proofOrderIsStale } from "./sync-queue.js";
import {
  createProofGrant,
  listOrderProofGrants,
  ProofAccessFeatureDisabledError,
  ProofGrantCohortDeniedError,
  ProofAccessValidationError,
  ProofOrderNotSynchronizedError,
  updateProofGrant
} from "./access-service.js";
import type { ProofAuditContext } from "./audit-service.js";
import { ProofGrantNotFoundError, sendProofGrantLinkEmail } from "./email-service.js";
import {
  createProofOperatorActionService,
  ProofOperatorActionError,
  type ProofOperatorActionRequest
} from "./operator-action-service.js";
import {
  createProofAssetUploadService,
  ProofAssetUploadServiceError,
  type ProofAssetUploadFinalizeRequest,
  type ProofAssetUploadPrepareRequest,
  type ProofAssetUploadStatusRequest
} from "./asset-upload-service.js";
import { getProofAssetUploadRuntimeConfig } from "./asset-upload-config.js";
import { getProofAssetPublicationRuntimeConfig } from "./asset-publication-config.js";
import { createProofAssetPublicationService } from "./asset-publication-service.js";
import { ProofAssetVerificationPublicationError } from "./asset-verification-publication.js";
import {
  resolveCustomerProofCapabilityForOrder,
  type ResolvedCustomerProofCapability
} from "../store.js";

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
  if (error instanceof ProofGrantCohortDeniedError) {
    return 403;
  }
  if (error instanceof ProofGrantNotFoundError) {
    return 404;
  }
  if (error instanceof ProofOrderNotSynchronizedError) {
    return 409;
  }
  if (error instanceof ProofOperatorActionError) {
    if (error.code === "unauthenticated") return 401;
    if (error.code === "not_allowed") return 403;
    if (error.code === "conflict" || error.code === "stale" || error.code === "already_attempted") {
      return 409;
    }
    if (error.code === "disabled") return 503;
    return 400;
  }
  if (error instanceof ProofAssetUploadServiceError) {
    if (error.code === "unauthenticated") return 401;
    if (error.code === "not_allowed") return 403;
    if (error.code === "conflict" || error.code === "stale") return 409;
    if (error.code === "disabled") return 503;
    if (error.code === "storage_failed") return 502;
    return 400;
  }
  if (error instanceof ProofAssetVerificationPublicationError) {
    if (error.code === "not_found") return 404;
    if (error.code === "cross_bound" || error.code === "conflict") return 409;
    if (error.code === "publication_failed" || error.code === "delivery_failed") return 503;
    return 400;
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
  operatorActionService?: ReturnType<typeof createProofOperatorActionService>;
  assetUploadService?: ReturnType<typeof createProofAssetUploadService>;
  assetPublicationService?: ReturnType<typeof createProofAssetPublicationService>;
  resolveCustomerCapability?: (
    orderNumber: string
  ) => Promise<ResolvedCustomerProofCapability>;
}

export function createProofAdminRouter(dependencies: ProofAdminRouterDependencies = {}) {
  const router = Router();
  const getOrderForGrant = dependencies.getOrderForGrant ?? getProofOrder;
  const syncOrderForGrant = dependencies.syncOrderForGrant ?? syncProofOrder;
  const createGrant = dependencies.createGrant ?? createProofGrant;
  const orderIsStale = dependencies.orderIsStale ?? proofOrderIsStale;
  const operatorActionService =
    dependencies.operatorActionService ?? createProofOperatorActionService();
  const assetUploadService =
    dependencies.assetUploadService ?? createProofAssetUploadService();
  const assetPublicationService =
    dependencies.assetPublicationService ?? createProofAssetPublicationService();
  const resolveCustomerCapability =
    dependencies.resolveCustomerCapability ?? resolveCustomerProofCapabilityForOrder;

  router.get("/health/lift", (_req, res) => {
    assertLiftProofWritesDisabled();
    const config = getProofRuntimeConfig();
    const operatorActionQa = getProofOperatorActionQaConfig();
    const assetUpload = getProofAssetUploadRuntimeConfig();
    const assetPublication = getProofAssetPublicationRuntimeConfig();
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
        session_ttl_minutes: config.access.session_ttl_minutes,
        durable_customer_authority: true,
        legacy_view_grant_cohort_configured: config.access.grant_allowed_customer_ids.length > 0,
        activation_expiry_configured: Boolean(config.access.read_only_activation_expires_at)
      },
      feature_flags: config.feature_flags,
      qa_lifecycle: config.qa_lifecycle,
      ltl_demo_qa: config.ltl_demo_qa,
      operator_action_qa: {
        enabled: operatorActionQa.enabled,
        allowed_customer_id: operatorActionQa.allowed_customer_id,
        allowed_company_id: operatorActionQa.allowed_company_id,
        allowed_order_numbers: operatorActionQa.allowed_order_numbers,
        activation_expires_at: operatorActionQa.activation_expires_at,
        jwt_ttl_seconds: operatorActionQa.jwt_ttl_seconds,
        advanced_quantity_allocation_enabled:
          operatorActionQa.advanced_quantity_allocation_enabled,
        target_id: "lift-standard-graphics",
        environment_id: "env-lift-prod",
        automatic_retry: false
      },
      revised_art_upload: {
        enabled: assetUpload.enabled,
        bucket_configured: Boolean(assetUpload.bucket_name),
        allowed_order_numbers: assetUpload.allowed_order_numbers,
        activation_expires_at: assetUpload.activation_expires_at,
        maximum_bytes: assetUpload.maximum_bytes,
        allowed_content_types: assetUpload.allowed_content_types,
        upload_ticket_seconds: assetUpload.upload_ticket_seconds,
        scan_enabled: false,
        publication_enabled: assetPublication.enabled,
        publication_allowed_order_numbers:
          assetPublication.allowed_order_numbers,
        publication_activation_expires_at:
          assetPublication.activation_expires_at,
        delivery_origin_configured:
          assetPublication.delivery_base_url === "https://go.vornan.co",
        revision_asset_resolver_ready: true,
        lift_resolution_enabled:
          operatorActionQa.enabled && assetPublication.enabled
      }
    });
  });

  const operatorUid = (res: Response) => {
    const authUser = res.locals.authUser as { uid?: unknown } | undefined;
    return typeof authUser?.uid === "string" ? authUser.uid : "";
  };

  const requireOperatorUid = (res: Response) => {
    const uid = operatorUid(res);
    if (!uid) {
      throw new ProofOperatorActionError(
        "unauthenticated",
        "Authenticated operator identity is required."
      );
    }
    return uid;
  };

  router.post("/operator-actions/prepare", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const result = await operatorActionService.prepare({
        request: req.body as ProofOperatorActionRequest,
        operator_uid: operatorUid(res),
        correlation_id: req.header("x-request-id") ?? `prepare-${Date.now()}`
      });
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.status(result.status === "new" ? 201 : 200).json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : "Proof action could not be prepared."
      });
    }
  });

  router.post("/operator-actions/execute", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const result = await operatorActionService.execute({
        request: req.body as ProofOperatorActionRequest,
        confirmation_phrase:
          typeof req.body?.confirmation_phrase === "string"
            ? req.body.confirmation_phrase
            : "",
        operator_uid: operatorUid(res),
        correlation_id: req.header("x-request-id") ?? `execute-${Date.now()}`
      });
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error: error instanceof Error ? error.message : "Proof action could not be executed."
      });
    }
  });

  router.post("/operator-assets/uploads/prepare", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    try {
      assertLiftProofWritesDisabled();
      const result = await assetUploadService.prepare({
        request: req.body as ProofAssetUploadPrepareRequest,
        operator_uid: operatorUid(res),
        correlation_id: req.header("x-request-id") ?? `asset-prepare-${Date.now()}`
      });
      res.status(result.status === "new" ? 201 : 200).json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error
            ? error.message
            : "Proof revised-art upload could not be prepared."
      });
    }
  });

  router.get("/operator-assets/uploads/:orderNumber/:assetId", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    try {
      assertLiftProofWritesDisabled();
      const result = await assetUploadService.status({
        request: {
          order_number: req.params.orderNumber,
          asset_id: req.params.assetId
        } as ProofAssetUploadStatusRequest
      });
      res.json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error
            ? error.message
            : "Proof revised-art upload status could not be inspected."
      });
    }
  });

  router.post("/operator-assets/uploads/finalize", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    try {
      assertLiftProofWritesDisabled();
      const result = await assetUploadService.finalize({
        request: req.body as ProofAssetUploadFinalizeRequest,
        operator_uid: operatorUid(res),
        correlation_id: req.header("x-request-id") ?? `asset-finalize-${Date.now()}`
      });
      res.json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error
            ? error.message
            : "Proof revised-art upload could not be finalized."
      });
    }
  });

  router.post("/operator-assets/publications", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    try {
      assertLiftProofWritesDisabled();
      requireOperatorUid(res);
      const result = await assetPublicationService.publishCleared({
        order_number:
          typeof req.body?.order_number === "string"
            ? req.body.order_number.trim().toUpperCase()
            : "",
        asset_id:
          typeof req.body?.asset_id === "string" ? req.body.asset_id.trim() : "",
        correlation_id:
          req.header("x-request-id") ?? `asset-publication-${Date.now()}`
      });
      res.status(result.status === "ready" ? 201 : 200).json(result);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error
            ? error.message
            : "Proof revised-art publication could not be completed."
      });
    }
  });

  router.post("/orders/:orderNumber/sync", async (req, res) => {
    try {
      assertLiftProofWritesDisabled();
      const result = await syncProofOrder(req.params.orderNumber, { audit_context: operatorAuditContext(req, res) });
      res.json({
        ...result,
        customer_capability: await resolveCustomerCapability(result.order.order_number)
      });
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
      res.json({
        order,
        feature_flags: getProofRuntimeConfig().feature_flags,
        customer_capability: await resolveCustomerCapability(order.order_number)
      });
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
      const customerCapability = await resolveCustomerCapability(orderNumber);
      if (
        customerCapability.association_status !== "associated" ||
        !customerCapability.pathfinder_customer_id ||
        !customerCapability.proof_customer_id ||
        !customerCapability.identity_verified_at ||
        !customerCapability.policy_updated_at ||
        customerCapability.source === "safe_default" ||
        customerCapability.access_mode === "disabled"
      ) {
        throw new ProofGrantCohortDeniedError();
      }
      const cached = await getOrderForGrant(orderNumber);
      let eligibleOrder = cached;
      if (!cached || !cached.customer_id || orderIsStale(cached.last_synced_at)) {
        eligibleOrder = (await syncOrderForGrant(orderNumber, {
          allowed_customer_ids: [customerCapability.proof_customer_id],
          audit_context: operatorAuditContext(req, res)
        })).order;
      }
      if (eligibleOrder?.customer_id !== customerCapability.proof_customer_id) {
        throw new ProofGrantCohortDeniedError();
      }
      const result = await createGrant({
        order_number: orderNumber,
        label: typeof req.body?.label === "string" ? req.body.label : null,
        scope: req.body?.scope,
        expires_at: typeof req.body?.expires_at === "string" ? req.body.expires_at : null,
        capability: {
          pathfinder_customer_id: customerCapability.pathfinder_customer_id,
          proof_customer_id: customerCapability.proof_customer_id,
          identity_verified_at: customerCapability.identity_verified_at,
          access_mode: customerCapability.access_mode,
          review_experience: customerCapability.review_experience,
          source: customerCapability.source,
          policy_updated_at: customerCapability.policy_updated_at
        },
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

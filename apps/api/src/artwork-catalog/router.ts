import { Router, type Request, type Response } from "express";
import { artworkCatalogActorFromAuthUser } from "./authority.js";
import {
  ArtworkCatalogApplicationError,
  type ArtworkCatalogRequestContext
} from "./contracts.js";
import type { ArtworkCatalogService } from "./service.js";

export interface ArtworkCatalogRouterDependencies {
  readonly service: ArtworkCatalogService;
}

function requestContext(req: Request, res: Response): ArtworkCatalogRequestContext {
  return Object.freeze({
    actor: artworkCatalogActorFromAuthUser(res.locals.authUser),
    correlation_id: req.header("x-request-id") ?? undefined
  });
}

function idempotencyKey(req: Request) {
  return req.header("idempotency-key") ?? "";
}

function errorStatus(error: ArtworkCatalogApplicationError) {
  if (error.code === "unauthenticated") return 401;
  if (error.code === "forbidden") return 403;
  if (error.code === "invalid_request") return 400;
  if (error.code === "not_found") return 404;
  if (error.code === "conflict") return 409;
  return 500;
}

function respondWithError(res: Response, error: unknown) {
  if (error instanceof ArtworkCatalogApplicationError) {
    res.status(errorStatus(error)).json({
      error: error.message,
      code: error.code
    });
    return;
  }
  res.status(500).json({
    error: "Artwork catalog request failed.",
    code: "persistence_failed"
  });
}

export function createArtworkCatalogRouter(dependencies: ArtworkCatalogRouterDependencies) {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    next();
  });

  router.post("/customers/:customerId/artwork-catalogs", async (req, res) => {
    try {
      const result = await dependencies.service.createCatalog({
        customer_id: req.params.customerId,
        idempotency_key: idempotencyKey(req),
        body: req.body,
        context: requestContext(req, res)
      });
      res.status(result.disposition === "created" ? 201 : 200).json(result);
    } catch (error) {
      respondWithError(res, error);
    }
  });

  router.get("/customers/:customerId/artwork-catalogs", async (req, res) => {
    try {
      const catalogs = await dependencies.service.listCatalogs({
        customer_id: req.params.customerId,
        context: requestContext(req, res)
      });
      res.json({ catalogs });
    } catch (error) {
      respondWithError(res, error);
    }
  });

  router.post(
    "/customers/:customerId/artwork-catalogs/:catalogId/products",
    async (req, res) => {
      try {
        const result = await dependencies.service.createProduct({
          customer_id: req.params.customerId,
          catalog_id: req.params.catalogId,
          idempotency_key: idempotencyKey(req),
          body: req.body,
          context: requestContext(req, res)
        });
        res.status(result.disposition === "created" ? 201 : 200).json(result);
      } catch (error) {
        respondWithError(res, error);
      }
    }
  );

  router.get(
    "/customers/:customerId/artwork-catalogs/:catalogId/products",
    async (req, res) => {
      try {
        const products = await dependencies.service.listProducts({
          customer_id: req.params.customerId,
          catalog_id: req.params.catalogId,
          context: requestContext(req, res)
        });
        res.json({ products });
      } catch (error) {
        respondWithError(res, error);
      }
    }
  );

  return router;
}

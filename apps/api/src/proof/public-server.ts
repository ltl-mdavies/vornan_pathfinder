import express from "express";
import { createProofPublicRouter } from "./public-router.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { proofPublicTelemetry } from "./telemetry.js";

export function createProofPublicApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(proofPublicTelemetry);
  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    next();
  });
  app.use((req, res, next) => {
    const edgeSecret = getProofRuntimeConfig().access.edge_shared_secret;
    if (edgeSecret && req.get("x-vornan-proof-edge") !== edgeSecret) {
      res.status(403).json({ error: "Proof access is not available." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "4kb", type: "application/json" }));
  app.use("/api/public/proof", createProofPublicRouter());
  return app;
}

export const proofPublicApp = createProofPublicApp();

if (!process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.PATHFINDER_RUNTIME !== "lambda") {
  const port = Number(process.env.PROOF_PUBLIC_PORT || 3109);
  proofPublicApp.listen(port, "127.0.0.1", () => {
    console.log(`Vornan Proof public API listening on http://127.0.0.1:${port}`);
  });
}

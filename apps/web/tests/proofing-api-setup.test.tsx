import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProofingApiSetup,
  proofingApiSaveLabel,
  proofingApiSavePayload,
  type ProofingApiConfiguration
} from "../src/ProofingApiSetup";

const configured: ProofingApiConfiguration = {
  base_url: "https://proofing.example.invalid/api",
  company_id: "company-91",
  client_id_configured: true,
  client_secret_configured: true,
  configured: true,
  updated_at: "2026-07-23T16:00:00.000Z",
  audit_events: []
};

test("omits blank write-only credentials from metadata-only saves and labels explicit replacement", () => {
  const metadataDraft = {
    base_url: configured.base_url ?? "",
    company_id: configured.company_id ?? "",
    client_id: "",
    client_secret: ""
  };
  assert.deepEqual(proofingApiSavePayload(metadataDraft), {
    base_url: configured.base_url,
    company_id: configured.company_id
  });
  assert.equal(proofingApiSaveLabel(configured, metadataDraft), "Save Proofing API");

  const replacementDraft = {
    ...metadataDraft,
    client_id: "replacement-client",
    client_secret: "replacement-secret"
  };
  assert.equal(proofingApiSaveLabel(configured, replacementDraft), "Replace credentials");
  assert.deepEqual(proofingApiSavePayload(replacementDraft), {
    base_url: configured.base_url,
    company_id: configured.company_id,
    client_id: "replacement-client",
    client_secret: "replacement-secret"
  });
});

test("renders a responsive write-only Proofing API setup without credential values", () => {
  const markup = renderToStaticMarkup(
    <ProofingApiSetup
      apiBaseUrl="https://api.pathfinder.example.invalid"
      targetId="lift-standard-graphics"
      environmentId="env-lift-qa1"
      environmentName="QA1"
    />
  );

  assert.match(markup, /Separate credential boundary/);
  assert.match(markup, />Proofing API</);
  assert.match(markup, /Environment-specific credentials for QA1/);
  assert.match(markup, /Proofing API Base URL/);
  assert.match(markup, /Company ID/);
  assert.match(markup, /Client ID/);
  assert.match(markup, /Client Secret/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="new-password"/);
  assert.match(markup, />Not configured</);
  assert.doesNotMatch(markup, /replacement-client|replacement-secret/);
});

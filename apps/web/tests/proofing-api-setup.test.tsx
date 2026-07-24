import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_PROOFING_API_ACTION_USER_NAME,
  ProofingApiSetup,
  proofingApiBaseUrlFromOrderEndpoint,
  proofingApiSaveLabel,
  proofingApiSavePayload,
  type ProofingApiConfiguration
} from "../src/ProofingApiSetup";

const configured: ProofingApiConfiguration = {
  base_url: "https://proofing.example.invalid/api",
  company_id: "company-91",
  action_user_name: DEFAULT_PROOFING_API_ACTION_USER_NAME,
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
    action_user_name: configured.action_user_name,
    client_id: "",
    client_secret: ""
  };
  assert.deepEqual(proofingApiSavePayload(metadataDraft), {
    base_url: configured.base_url,
    company_id: configured.company_id,
    action_user_name: DEFAULT_PROOFING_API_ACTION_USER_NAME
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
    action_user_name: DEFAULT_PROOFING_API_ACTION_USER_NAME,
    client_id: "replacement-client",
    client_secret: "replacement-secret"
  });
});

test("derives the environment Proofing API root only from a safe Lift create-order endpoint", () => {
  assert.equal(
    proofingApiBaseUrlFromOrderEndpoint("https://ltlco.lifterp.com/ords/api/lift/erp/api/create_order"),
    "https://ltlco.lifterp.com/ords/api/lift/erp"
  );
  assert.equal(
    proofingApiBaseUrlFromOrderEndpoint("http://ltlco.lifterp.com/ords/api/lift/erp/api/create_order"),
    ""
  );
  assert.equal(
    proofingApiBaseUrlFromOrderEndpoint("https://ltlco.lifterp.com/ords/api/lift/erp/order-management"),
    ""
  );
});

test("renders a responsive write-only Proofing API setup without credential values", () => {
  const markup = renderToStaticMarkup(
    <ProofingApiSetup
      apiBaseUrl="https://api.pathfinder.example.invalid"
      targetId="lift-standard-graphics"
      environmentId="env-lift-qa1"
      environmentName="QA1"
      orderEndpointUrl="https://ltlco.lifterp.com/ords/api/lift/erp/api/create_order"
      suggestedCompanyId="91"
    />
  );

  assert.match(markup, /Separate credential boundary/);
  assert.match(markup, />Proofing API</);
  assert.match(markup, /Environment-specific credentials for QA1/);
  assert.match(markup, /Proofing API Base URL/);
  assert.match(markup, /https:\/\/ltlco\.lifterp\.com\/ords\/api\/lift\/erp/);
  assert.match(markup, /Company ID/);
  assert.match(markup, /Lift Action User/);
  assert.match(markup, /VORNAN_PROOF/);
  assert.match(markup, /Sent as.*userName.*Lift attribution/);
  assert.match(markup, /Client ID/);
  assert.match(markup, /Client Secret/);
  assert.match(markup, /JWT · HS256/);
  assert.match(markup, /No Lift user password is used/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="new-password"/);
  assert.match(markup, />Not configured</);
  assert.doesNotMatch(markup, /replacement-client|replacement-secret/);
});

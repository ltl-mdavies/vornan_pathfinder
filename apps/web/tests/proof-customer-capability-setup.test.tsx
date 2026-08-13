import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProofCustomerCapabilitySetup,
  type CustomerProofCapabilityPolicy
} from "../src/ProofCustomerCapabilitySetup";

const policy: CustomerProofCapabilityPolicy = {
  access_mode: "review",
  review_experience: "advanced",
  customer_identity: {
    proof_customer_id: "1249",
    verified_order_number: "A0226753",
    verified_at: "2026-08-04T13:45:00.000Z",
    verified_by: "operator-test"
  },
  order_overrides: [{
    order_number: "A0226753",
    access_mode: "review",
    review_experience: "simple",
    updated_at: "2026-08-04T15:00:00.000Z",
    updated_by: "operator-test"
  }],
  updated_at: "2026-08-04T14:00:00.000Z",
  updated_by: "operator-test"
};

test("renders non-technical Proof access choices, explicit Advanced review, and bounded order exceptions", () => {
  const markup = renderToStaticMarkup(
    <ProofCustomerCapabilitySetup
      policy={policy}
      audit={[]}
      busy={false}
      onSave={async () => undefined}
      onVerifyIdentity={async () => undefined}
      onUpsertOverride={async () => undefined}
      onRemoveOverride={async () => undefined}
    />
  );

  assert.match(markup, /Choose how this customer uses Vornan Proof/);
  assert.match(markup, /Proof off/);
  assert.match(markup, /View only/);
  assert.match(markup, /Review enabled/);
  assert.match(markup, /Advanced is never automatic/);
  assert.match(markup, /Proof customer 1249/);
  assert.match(markup, /Verified from A0226753/);
  assert.match(markup, /Shows quantity allocation when multiple current creatives share one Lift line/);
  assert.match(markup, /Order exceptions/);
  assert.match(markup, /A0226753/);
  assert.match(markup, /simple review/);
});

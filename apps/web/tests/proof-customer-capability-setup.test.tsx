import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProofCustomerCapabilitySetup,
  type CustomerProofCapabilityPolicy
} from "../src/ProofCustomerCapabilitySetup";
import { ProofSettingsDraftController } from "../src/proof-settings-draft";

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
      draft={new ProofSettingsDraftController("1249", policy)}
      onExecute={async () => ({ policy })}
      onRead={async () => ({ policy })}
      onDraftStateChange={() => {}}
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

test("unconfirmed recovery remains visible after local discard and explains replacement before adoption", async () => {
  const draft = new ProofSettingsDraftController("1249", policy);
  draft.edit({ accessMode: "disabled" });
  await draft.run({ kind: "defaults", value: { access_mode: "disabled", review_experience: "simple" } }, async () => { throw new Error("lost reply"); });
  draft.discard();
  const render = () => renderToStaticMarkup(<ProofCustomerCapabilitySetup policy={policy} audit={[]} busy={false} draft={draft}
    onExecute={async () => ({ policy })} onRead={async () => ({ policy })} onDraftStateChange={() => {}}/>);
  assert.match(render(), /Check saved settings/);
  await draft.checkSaved(async () => ({ policy }));
  const markup = render();
  assert.match(markup, /replaces your local entries with the saved values/);
  assert.match(markup, /does not undo the earlier request/);
  assert.match(markup, /tabindex="-1"/);
  assert.match(markup, /proof-settings-feedback-actions/);
});

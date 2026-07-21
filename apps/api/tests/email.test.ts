import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicIntakeVerificationEmail,
  buildProofLinkEmail,
  configurationSetForCategory,
  replyToForCategory,
  sendTransactionalEmail
} from "../src/email.ts";

test("builds a branded order-dropbox verification code without exposing HTML", () => {
  process.env.PATHFINDER_STATUS_EMAIL_MODE = "log";
  const email = buildPublicIntakeVerificationEmail({
    to: "buyer@example.com",
    code: "482913",
    expiresAt: "2026-07-21T22:10:00.000Z",
    customerName: "Momentara <Demo>"
  });

  assert.equal(email.category, "intake_verification");
  assert.deepEqual(email.replyTo, ["orders@vornan.co"]);
  assert.match(email.subject, /Momentara/);
  assert.match(email.text, /482913/);
  assert.match(email.html, /Momentara &lt;Demo&gt;/);
  assert.doesNotMatch(email.html, /Momentara <Demo>/);
});

test("builds the view-only Proof link contract with the dedicated support reply-to", () => {
  process.env.PATHFINDER_STATUS_EMAIL_MODE = "log";
  delete process.env.PATHFINDER_PROOF_REPLY_TO;
  const email = buildProofLinkEmail({
    to: "reviewer@example.com",
    accessUrl: "https://proof.vornan.co/#/access/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    expiresAt: "2026-08-03T12:00:00.000Z",
    orderNumber: "A0221132",
    orderTitle: "Summer <launch>"
  });

  assert.equal(email.category, "proof_link");
  assert.deepEqual(email.replyTo, ["support@vornan.com"]);
  assert.equal(replyToForCategory("proof_link"), "support@vornan.com");
  assert.equal(configurationSetForCategory("proof_link"), undefined);
  assert.match(email.subject, /A0221132/);
  assert.match(email.text, /view-only/i);
  assert.match(email.html, /Summer &lt;launch&gt;/);
  assert.doesNotMatch(email.html, /Summer <launch>/);
});

test("log delivery never emits the raw Proof URL, bearer token, or recipient", async () => {
  process.env.PATHFINDER_STATUS_EMAIL_MODE = "log";
  const accessUrl = "https://proof.vornan.co/#/access/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
  const rawToken = accessUrl.split("/").at(-1)!;
  const recipient = "reviewer@example.com";
  const entries: unknown[][] = [];
  const prior = console.info;
  console.info = (...args: unknown[]) => entries.push(args);
  try {
    const result = await sendTransactionalEmail(buildProofLinkEmail({
      to: recipient,
      accessUrl,
      expiresAt: "2026-08-03T12:00:00.000Z",
      orderNumber: "A0221132"
    }));
    assert.deepEqual(result, { mode: "log", status: "logged" });
  } finally {
    console.info = prior;
  }

  const logged = JSON.stringify(entries);
  assert.equal(logged.includes(accessUrl), false);
  assert.equal(logged.includes(rawToken), false);
  assert.equal(logged.includes(recipient), false);
  assert.match(logged, /re\*\*\*@example\.com/);
  assert.match(logged, /proof_link/);
});

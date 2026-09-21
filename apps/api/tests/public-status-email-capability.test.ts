import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";

process.env.PATHFINDER_RUNTIME = "lambda";
process.env.PATHFINDER_STATUS_EMAIL_MODE = "log";
process.env.PATHFINDER_STATUS_REPLY_TO = "support@vornan.co";

const { app } = await import("../src/server.js");

test("public status email capability fails closed while delivery is in log mode", async () => {
  const response = await request(app).get("/public/status/email-capability").expect(200);

  assert.equal(response.body.available, false);
  assert.equal(response.body.order_identifier, "Lift order number");
  assert.equal(response.body.contact_email, "support@vornan.co");
  assert.match(response.body.message, /temporarily unavailable/i);
  await request(app)
    .post("/public/status/request-link")
    .send({ order_number: "A0229017", email: "buyer@empirical-inc.com" })
    .expect(503, {
      error: "Email delivery is temporarily unavailable. Contact Vornan for a new status link."
    });
});

test("public status email capability becomes available only in SES mode", async () => {
  process.env.PATHFINDER_STATUS_EMAIL_MODE = "ses";
  try {
    const response = await request(app).get("/public/status/email-capability").expect(200);
    assert.equal(response.body.available, true);
    assert.match(response.body.message, /can be delivered/i);
  } finally {
    process.env.PATHFINDER_STATUS_EMAIL_MODE = "log";
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const serverModuleUrl = new URL("../src/server.ts", import.meta.url).href;
const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;

function runScript(script: string, storePath: string, overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATHFINDER_REQUIRE_AUTH: "false",
      PATHFINDER_STORAGE_DRIVER: "local",
      PATHFINDER_LOCAL_STORE_PATH: storePath,
      AWS_LAMBDA_FUNCTION_NAME: "pathfinder-test",
      PATHFINDER_STATUS_EMAIL_MODE: "log",
      PATHFINDER_PUBLIC_INTAKE_RATE_LIMIT_MAX: "100",
      PATHFINDER_PUBLIC_INTAKE_EMAIL_VERIFICATION_RATE_LIMIT_MAX: "100",
      ...overrides
    },
    encoding: "utf8"
  });
}

test("customer intake email verification is fail-closed when delivery is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-intake-email-closed-"));
  try {
    const storePath = join(directory, "pathfinder.json");
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const request = (await import("supertest")).default;
      const { app } = await import(${JSON.stringify(serverModuleUrl)});
      const { getOrCreateWorkspace, updateImportMethod } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "284619",
        customer_name: "Empirical - Momentara",
        customer_number: "0000000960",
        customer_status: "Regular",
        default_invoice_email_address: "orders@momentara.example",
        contacts: []
      };
      await getOrCreateWorkspace(customer);
      const updated = await updateImportMethod(customer, "manual-xlsx", {
        public_intake: {
          enabled: true,
          headline: "Put your print order in motion.",
          instructions: "Upload an order.",
          require_email: true,
          require_email_verification: true,
          allowed_email_domains: ["momentara.example"],
          submit_profile_id: "live-customer",
          max_order_rows: 10
        }
      });
      const method = updated.import_methods.find((candidate) => candidate.import_method_id === "manual-xlsx");
      await request(app).get("/public/intake/" + method.public_intake.public_key).expect(503);
      await request(app)
        .post("/public/intake/" + method.public_intake.public_key + "/email-verification/request")
        .send({ email: "buyer@momentara.example" })
        .expect(503);
    `;
    const result = runScript(script, storePath, {
      PATHFINDER_PUBLIC_INTAKE_EMAIL_VERIFICATION_ENABLED: "false"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("customer intake verification expires, limits attempts, and consumes its token once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-intake-email-flow-"));
  try {
    const storePath = join(directory, "pathfinder.json");
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const request = (await import("supertest")).default;
      const { app } = await import(${JSON.stringify(serverModuleUrl)});
      const {
        getOrCreateWorkspace,
        listJobs,
        persistPublicIntakeEmailVerification,
        readStore,
        updateImportMethod
      } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "284619",
        customer_name: "Empirical - Momentara",
        customer_number: "0000000960",
        customer_status: "Regular",
        default_invoice_email_address: "orders@momentara.example",
        contacts: []
      };
      await getOrCreateWorkspace(customer);
      const updated = await updateImportMethod(customer, "manual-xlsx", {
        public_intake: {
          enabled: true,
          headline: "Put your print order in motion.",
          instructions: "Upload an order.",
          require_email: true,
          require_email_verification: true,
          allowed_email_domains: ["momentara.example"],
          submit_profile_id: "live-customer",
          max_order_rows: 10
        }
      });
      const method = updated.import_methods.find((candidate) => candidate.import_method_id === "manual-xlsx");
      const publicKey = method.public_intake.public_key;
      const config = await request(app).get("/public/intake/" + publicKey).expect(200);
      assert.equal(config.body.email_verification_required, true);

      await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/request")
        .send({ email: "buyer@wrong.example" })
        .expect(400);

      const challenge = await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/request")
        .send({ email: "buyer@momentara.example" })
        .expect(202);
      assert.match(challenge.body.debug_code, /^\\d{6}$/);
      assert.equal(challenge.body.email_masked, "bu***@momentara.example");

      await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/confirm")
        .send({ email: "buyer@momentara.example", challenge_id: challenge.body.challenge_id, code: "000000" })
        .expect(400);
      const confirmation = await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/confirm")
        .send({
          email: "buyer@momentara.example",
          challenge_id: challenge.body.challenge_id,
          code: challenge.body.debug_code
        })
        .expect(200);
      assert.ok(confirmation.body.verification_token);

      const pasteText = [
        "Order Number,PO Number,SKU,Qty,Product Name,Width,Height,Ship Method",
        "MOM-1001,PO-1001,ONE-SHEET,3,One Sheet Poster,30.375,46.375,UPS Ground"
      ].join("\\n");
      await request(app)
        .post("/public/intake/" + publicKey + "/preview")
        .send({ email: "buyer@momentara.example", paste_text: pasteText })
        .expect(400);
      await request(app)
        .post("/public/intake/" + publicKey + "/preview")
        .send({
          email: "buyer@momentara.example",
          paste_text: pasteText,
          email_verification_challenge_id: challenge.body.challenge_id,
          email_verification_token: confirmation.body.verification_token
        })
        .expect(200);
      await request(app)
        .post("/public/intake/" + publicKey + "/submit")
        .send({
          email: "buyer@momentara.example",
          paste_text: pasteText,
          email_verification_challenge_id: challenge.body.challenge_id,
          email_verification_token: confirmation.body.verification_token
        })
        .expect(201);
      await request(app)
        .post("/public/intake/" + publicKey + "/submit")
        .send({
          email: "buyer@momentara.example",
          paste_text: pasteText,
          email_verification_challenge_id: challenge.body.challenge_id,
          email_verification_token: confirmation.body.verification_token
        })
        .expect(400);
      assert.equal((await listJobs()).length, 1);

      const expiringChallenge = await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/request")
        .send({ email: "buyer@momentara.example" })
        .expect(202);
      const store = await readStore();
      const expiringRecord = store.public_intake_email_verifications.find(
        (record) => record.status === "Pending"
      );
      assert.ok(expiringRecord);
      await persistPublicIntakeEmailVerification({
        ...expiringRecord,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        expires_at_epoch: Math.floor(Date.now() / 1000) - 1
      });
      await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/confirm")
        .send({
          email: "buyer@momentara.example",
          challenge_id: expiringChallenge.body.challenge_id,
          code: expiringChallenge.body.debug_code
        })
        .expect(400);

      const exhaustedChallenge = await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/request")
        .send({ email: "buyer@momentara.example" })
        .expect(202);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app)
          .post("/public/intake/" + publicKey + "/email-verification/confirm")
          .send({ email: "buyer@momentara.example", challenge_id: exhaustedChallenge.body.challenge_id, code: "000000" })
          .expect(400);
      }
      await request(app)
        .post("/public/intake/" + publicKey + "/email-verification/confirm")
        .send({
          email: "buyer@momentara.example",
          challenge_id: exhaustedChallenge.body.challenge_id,
          code: exhaustedChallenge.body.debug_code
        })
        .expect(400);
    `;
    const result = runScript(script, storePath, {
      PATHFINDER_PUBLIC_INTAKE_EMAIL_VERIFICATION_ENABLED: "true",
      PATHFINDER_PUBLIC_INTAKE_EMAIL_DEBUG_RETURN_CODE: "true"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

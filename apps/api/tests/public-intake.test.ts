import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("published customer intake previews a saved method and creates an internal review job only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-public-intake-"));
  const storePath = join(directory, "pathfinder.json");

  try {
    const serverModuleUrl = new URL("../src/server.ts", import.meta.url).href;
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const request = (await import("supertest")).default;
      const { app } = await import(${JSON.stringify(serverModuleUrl)});
      const { getOrCreateWorkspace, listJobs, updateImportMethod } = await import(${JSON.stringify(storeModuleUrl)});

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
          headline: "Send your Momentara print order",
          instructions: "Upload the approved order workbook for Vornan review.",
          require_email: true,
          allowed_email_domains: ["momentara.example"],
          submit_profile_id: "live-customer",
          max_order_rows: 10
        }
      });
      const method = updated.import_methods.find((candidate) => candidate.import_method_id === "manual-xlsx");
      assert.ok(method.public_intake.public_key.length >= 20);
      const publicKey = method.public_intake.public_key;

      const config = await request(app).get("/public/intake/" + publicKey).expect(200);
      assert.equal(config.body.customer_name, "Empirical - Momentara");
      assert.equal(config.body.headline, "Send your Momentara print order");
      assert.equal(config.body.public_key, undefined);
      assert.equal(config.body.allowed_email_domains, undefined);
      assert.equal(config.body.output_route_id, undefined);

      const pasteText = [
        "Order Number,PO Number,SKU,Qty,Product Name,Width,Height,Ship Method",
        "MOM-1001,PO-1001,ONE-SHEET,3,One Sheet Poster,30.375,46.375,UPS Ground",
        "MOM-1001,PO-1001,PUMP-TOPPER,7,Pump Topper,20.13,12,UPS Ground"
      ].join("\\n");

      await request(app)
        .post("/public/intake/" + publicKey + "/preview")
        .send({ email: "person@wrong.example", paste_text: pasteText })
        .expect(400);

      const preview = await request(app)
        .post("/public/intake/" + publicKey + "/preview")
        .send({ email: "buyer@momentara.example", paste_text: pasteText })
        .expect(200);
      assert.equal(preview.body.order_row_count, 2);
      assert.equal(preview.body.rows[0].quantity, 3);
      assert.equal(Number(preview.body.rows[0].final_width), 30.375);
      assert.equal(Number(preview.body.rows[0].final_height), 46.375);

      const submitted = await request(app)
        .post("/public/intake/" + publicKey + "/submit")
        .send({ email: "buyer@momentara.example", paste_text: pasteText })
        .expect(201);
      assert.equal(submitted.body.status, "received");
      assert.equal(submitted.body.order_row_count, 2);
      assert.match(submitted.body.reference, /^PF/);

      const jobs = await listJobs();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].public_intake.channel, "customer_dropbox");
      assert.equal(jobs[0].public_intake.submitted_by_email, "buyer@momentara.example");
      assert.equal(jobs[0].submit_attempts, undefined);
      assert.notEqual(jobs[0].state, "Submitted");

      const disabled = await updateImportMethod(customer, "manual-xlsx", {
        public_intake: { ...method.public_intake, enabled: false }
      });
      assert.equal(disabled.import_methods[0].public_intake.public_key, publicKey);
      await request(app).get("/public/intake/" + publicKey).expect(404);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_RUNTIME: "lambda",
        PATHFINDER_REQUIRE_AUTH: "false",
        PATHFINDER_STORAGE_DRIVER: "local",
        PATHFINDER_LOCAL_STORE_PATH: storePath,
        PATHFINDER_PUBLIC_INTAKE_RATE_LIMIT_MAX: "50"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

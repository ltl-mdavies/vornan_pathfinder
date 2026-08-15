import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("manual preview overrides are request-local and validate before durable identity creation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-request-local-preview-"));
  const storePath = join(directory, "pathfinder.json");

  try {
    const serverModuleUrl = new URL("../src/server.ts", import.meta.url).href;
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const request = (await import("supertest")).default;
      const { app } = await import(${JSON.stringify(serverModuleUrl)});
      const {
        bulkUpsertProductMappings,
        getOrCreateWorkspace,
        listJobs,
        listProductMappings,
        listSubmitAttemptsForJob
      } = await import(${JSON.stringify(storeModuleUrl)});

      const customer = {
        lift_customer_id: "1249",
        customer_name: "LTL Demo",
        customer_number: "1249",
        customer_status: "Active",
        contacts: []
      };
      const before = await getOrCreateWorkspace(customer);
      const methodBefore = structuredClone(
        before.import_methods.find((candidate) => candidate.import_method_id === "manual-xlsx")
      );
      const route = before.output_routes.find(
        (candidate) => candidate.output_route_id === "route-ltl-lift-91-standard-graphics"
      );
      assert.ok(methodBefore);
      assert.ok(route);

      const timestamp = "2026-08-15T00:00:00.000Z";
      const productIds = ["138667", "138666", "138664"];
      const products = ["2-Sheet_Penn", "3-Sheet_Penn", "DirClock_Penn"];
      const productKeys = ["2_SHEET_PENN", "3_SHEET_PENN", "DIRCLOCK_PENN"];
      await bulkUpsertProductMappings(customer, products.map((product, index) => ({
        mapping_id: "mapping-pilot-" + (index + 1),
        output_route_id: route.output_route_id,
        target_id: route.target_id,
        target_template: route.output_template,
        source_scope_id: "Sheet 1::default",
        customer_product_key: productKeys[index],
        display_label: product,
        source_columns: ["Product"],
        product_identifier_type: "lift_product_id",
        product_identifier_value: productIds[index],
        lift_unit_number: null,
        lift_product_id: productIds[index],
        product_name: product,
        status: "Mapped",
        mapping_source: "Manual entry",
        source_file_name: "ltldemo-proof-pilot-2026-08-25.xlsx",
        last_seen_examples: [],
        created_at: timestamp,
        updated_at: timestamp
      })));
      const mappingsBefore = await listProductMappings(customer);
      const methodBaseline = structuredClone(
        (await getOrCreateWorkspace(customer)).import_methods.find(
          (candidate) => candidate.import_method_id === "manual-xlsx"
        )
      );

      const fieldMappings = [
        { sourceColumn: "ContractNumber", targetField: "order.external_order_id", required: true },
        { sourceColumn: "ContractNumber", targetField: "order.contract_number", required: false },
        { sourceColumn: "Product", targetField: "lines[].customer_sku", required: false },
        { sourceColumn: "Product", targetField: "lines[].product_name", required: false },
        { sourceColumn: "Quantity", targetField: "lines[].quantity", required: true },
        { sourceColumn: "Width", targetField: "lines[].dimensions.final_width", required: true },
        { sourceColumn: "Height", targetField: "lines[].dimensions.final_height", required: true },
        { sourceColumn: "Requested Ship Date", targetField: "order.ship_date", required: true },
        { sourceColumn: "Due Date", targetField: "order.due_date", required: true }
      ];
      const productResolution = {
        strategy: "derived_key",
        mode: "map_to_lift_unit",
        source_column: "Product",
        prefix: "",
        suffix: "",
        composite_columns: [],
        fallback_strategy: "none",
        direct_unit_number_column: null
      };
      const values = products.map((product, index) => ({
        ContractNumber: "LTL-PROOF-PILOT-0825",
        Product: product,
        Height: index === 2 ? 48 : 36,
        Width: index === 2 ? 18 : 24,
        Quantity: [10, 15, 20][index],
        "Requested Ship Date": "2026-08-25",
        "Due Date": "2026-08-25"
      }));
      const parsedRows = values.map((row, index) => ({
        sheet_name: "Sheet 1",
        row_number: index + 2,
        row_type: "order",
        scope_id: "Sheet 1::default",
        section_id: "default",
        section_label: "Sheet 1 order lines",
        line_kind: "print",
        values: row
      }));
      const requestBody = {
        import_method_id: "manual-xlsx",
        output_route_id: route.output_route_id,
        source_file_name: "ltldemo-proof-pilot-2026-08-25.xlsx",
        sheet_name: "Sheet 1",
        source_grid: { columns: Object.keys(values[0]), rows: values },
        source_sheets: [],
        parsed_order_rows: parsedRows,
        reference_rows: [],
        incomplete_rows: [],
        mappings: fieldMappings,
        submit_profile_id: "live-customer",
        product_resolution_config: productResolution,
        product_resolution_overrides: {},
        order_name_resolution_config: methodBaseline.order_name_resolution_config,
        ext_id_strategy: "pathfinder_generated"
      };

      const invalidDate = structuredClone(requestBody);
      invalidDate.source_grid.rows[0]["Due Date"] = "ASAP";
      invalidDate.parsed_order_rows[0].values["Due Date"] = "ASAP";
      await request(app).post("/api/customers/1249/jobs/preview").send(invalidDate).expect(400);
      assert.equal((await listJobs()).length, 0);

      const missingMapping = structuredClone(requestBody);
      missingMapping.source_grid.rows[2].Product = "Unmapped_Pilot_Product";
      missingMapping.parsed_order_rows[2].values.Product = "Unmapped_Pilot_Product";
      await request(app).post("/api/customers/1249/jobs/preview").send(missingMapping).expect(400);
      assert.equal((await listJobs()).length, 0);

      const preview = await request(app)
        .post("/api/customers/1249/jobs/preview")
        .send(requestBody);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.job.state, "Ready");
      assert.equal(preview.body.job.customer_id, "1249");
      assert.equal(preview.body.job.source_customer_id, "1249");
      assert.equal(preview.body.job.submit_customer_id, "1249");
      assert.equal(preview.body.job.submit_profile_id, "live-customer");
      assert.equal(preview.body.job.submit_mode, "live_customer");
      assert.equal(preview.body.job.sandbox, false);
      assert.deepEqual(
        preview.body.job.lift_payload.lines.map((line) => [line.product_id, line.quantity]),
        [["138667", 10], ["138666", 15], ["138664", 20]]
      );
      assert.equal(preview.body.job.canonical_order.order.ship_date, "2026-08-25");
      assert.equal(preview.body.job.canonical_order.order.due_date, "2026-08-25");
      assert.equal(preview.body.job.lift_payload.order.requested_ship_date, "08/25/2026");
      assert.equal(preview.body.job.lift_payload.order.due_date, "08/25/2026");
      assert.equal(preview.body.job.manual_preview_basis.mode, "request_local");
      assert.equal(preview.body.job.manual_preview_basis.product_resolution_config.source_column, "Product");
      assert.deepEqual(preview.body.job.manual_preview_basis.mappings, fieldMappings);

      const jobs = await listJobs();
      assert.equal(jobs.length, 1);
      assert.equal((await listSubmitAttemptsForJob(customer, jobs[0].job_id)).length, 0);
      assert.deepEqual(await listProductMappings(customer), mappingsBefore);
      const after = await getOrCreateWorkspace(customer);
      assert.deepEqual(
        after.import_methods.find((candidate) => candidate.import_method_id === "manual-xlsx"),
        methodBaseline
      );
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_RUNTIME: "lambda",
        PATHFINDER_REQUIRE_AUTH: "false",
        PATHFINDER_STORAGE_DRIVER: "local",
        PATHFINDER_LOCAL_STORE_PATH: storePath,
        PATHFINDER_ENABLE_LIFT_SUBMIT: "false"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual preview preflight runs before Pathfinder identity reservation", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/server.ts", import.meta.url), "utf8")
  );
  const start = source.indexOf("if (isRequestLocalManualPreview)");
  const reserve = source.indexOf("await reservePathfinderOrderNumber()", start);
  assert.ok(start > 0 && reserve > start);
  assert.match(source.slice(start, reserve), /preflightFailures/);
  assert.match(source.slice(start, reserve), /unresolvedProducts\.length/);
  assert.match(source.slice(start, reserve), /statusCode: 400/);
});

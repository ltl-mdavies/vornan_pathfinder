import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  evaluateProofCustomerBoundaryStack,
  proofCustomerBoundaryTargets
} from "./proof-customer-boundary-contract.mjs";
import {
  PROOF_SYNTHETIC_QA_MARKER,
  PROOF_SYNTHETIC_QA_ORDER_NUMBER
} from "../apps/api/src/proof/qa-fixture.js";

const CONFIRMATION = "VORNAN_PROOF_CUSTOMER_BOUNDARY_QA";
const stackName = process.env.PATHFINDER_PROOF_STACK_NAME?.trim() || "vornan-proof-dev";
const fixtureId = process.env.PATHFINDER_PROOF_QA_FIXTURE_ID?.trim() || "";
const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";

function requireExplicitApproval() {
  if (process.env.PATHFINDER_PROOF_BOUNDARY_QA_CONFIRM !== CONFIRMATION) {
    throw new Error(`Set PATHFINDER_PROOF_BOUNDARY_QA_CONFIRM=${CONFIRMATION} only after explicit approval.`);
  }
  if (stackName !== "vornan-proof-dev") {
    throw new Error("Customer-boundary QA is restricted to the vornan-proof-dev stack.");
  }
  if (!/^vpqa-[a-z0-9-]{8,48}$/.test(fixtureId)) {
    throw new Error("PATHFINDER_PROOF_QA_FIXTURE_ID must identify the retained purgeable vpqa-* fixture.");
  }
}

function awsJson(args: string[]) {
  return JSON.parse(execFileSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function loadStack() {
  const response = awsJson(["cloudformation", "describe-stacks", "--stack-name", stackName]);
  const stack = response.Stacks?.[0];
  if (!stack) throw new Error("The isolated Proof dev stack was not found.");
  const readiness = evaluateProofCustomerBoundaryStack(stack);
  if (!readiness.ready) {
    throw new Error(`Customer-boundary QA is blocked: ${readiness.unmet_gates.join(", ")}.`);
  }
  return { stack, targets: proofCustomerBoundaryTargets(stack) };
}

function configureIsolatedStore(targets: ReturnType<typeof proofCustomerBoundaryTargets>) {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME = "dev";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = targets.core_table;
  process.env.PATHFINDER_PROOF_AUDIT_TABLE = targets.audit_table;
  process.env.PATHFINDER_PROOF_PUBLIC_BASE_URL = targets.public_base_url;
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  process.env.PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS = "0";
  process.env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL = "false";
  process.env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ = "false";
  process.env.PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT = targets.activation_expires_at;
  process.env.PATHFINDER_PROOF_SYNC_QUEUE_URL = "";
  process.env.PATHFINDER_PROOF_EDGE_SHARED_SECRET = "";
  process.env.PATHFINDER_PROOF_ENABLE_APPROVE = "false";
  process.env.PATHFINDER_PROOF_ENABLE_REVISION = "false";
  process.env.PATHFINDER_PROOF_ENABLE_UNDO = "false";
  process.env.PATHFINDER_PROOF_ENABLE_LIFT_WRITES = "false";
}

async function jsonObject(response: Response, label: string) {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  return body as Record<string, any>;
}

async function expectStatus(response: Response, expected: number, label: string) {
  if (response.status !== expected) {
    throw new Error(`${label} expected HTTP ${expected} and received ${response.status}.`);
  }
  return response;
}

function exchangeCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  const combined = setCookies.join(", ");
  const sessionHeader = setCookies.find((value) => value.startsWith("vornan_proof_session=")) || combined;
  const csrfHeader = setCookies.find((value) => value.startsWith("vornan_proof_csrf=")) || combined;
  const session = combined.match(/(?:^|,\s*)vornan_proof_session=([^;]+)/)?.[1] || "";
  const csrf = combined.match(/(?:^|,\s*)vornan_proof_csrf=([^;]+)/)?.[1] || "";
  if (!session || !csrf) throw new Error("Proof exchange did not return both hardened session cookies.");
  assert.match(sessionHeader, /;\s*HttpOnly/i);
  assert.match(sessionHeader, /;\s*Secure/i);
  assert.match(sessionHeader, /;\s*SameSite=Lax/i);
  assert.match(sessionHeader, /;\s*Path=\/api\/public\/proof/i);
  assert.doesNotMatch(csrfHeader, /;\s*HttpOnly/i);
  assert.match(csrfHeader, /;\s*Secure/i);
  assert.match(csrfHeader, /;\s*SameSite=Lax/i);
  assert.match(csrfHeader, /;\s*Path=\//i);
  return {
    cookie: `vornan_proof_session=${session}; vornan_proof_csrf=${csrf}`,
    csrf: decodeURIComponent(csrf)
  };
}

function tokenFromAccessUrl(accessUrl: string) {
  const marker = "/#/access/";
  const index = accessUrl.indexOf(marker);
  const token = index >= 0 ? accessUrl.slice(index + marker.length) : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("The temporary view grant did not produce the expected fragment token.");
  }
  return token;
}

async function runCustomerBoundaryQa() {
  requireExplicitApproval();
  const { targets } = loadStack();
  configureIsolatedStore(targets);

  const store = await import("../apps/api/src/proof/store.js");
  const access = await import("../apps/api/src/proof/access-service.js");
  const fixture = await store.getProofOrder(PROOF_SYNTHETIC_QA_ORDER_NUMBER);
  assert.ok(fixture, "The retained purgeable synthetic aggregate is required before customer-boundary QA.");
  assert.equal(fixture.customer_name, PROOF_SYNTHETIC_QA_MARKER);
  assert.ok(fixture.order_title?.includes(fixtureId), "The cached synthetic aggregate does not match the approved fixture ID.");
  assert.equal(fixture.lines.length, 1);
  assert.equal(fixture.tasks.length, 1);

  const health = await expectStatus(
    await fetch(`${targets.public_base_url}/api/public/proof/health`, { redirect: "manual" }),
    200,
    "Proof boundary health"
  );
  const healthBody = await jsonObject(health, "Proof boundary health");
  assert.equal(healthBody.public_read, true);
  assert.equal(healthBody.decisions_enabled, false);

  await expectStatus(
    await fetch(`${targets.direct_api_url}/api/public/proof/health`, { redirect: "manual" }),
    403,
    "Direct Proof API bypass"
  );

  let grantId: string | null = null;
  let cookies: ReturnType<typeof exchangeCookies> | null = null;
  try {
    const created = await access.createProofGrant({
      order_number: PROOF_SYNTHETIC_QA_ORDER_NUMBER,
      label: `Customer-boundary QA ${fixtureId}`,
      scope: "view"
    });
    grantId = created.grant.grant_id;
    const token = tokenFromAccessUrl(created.access_url);

    const exchange = await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      redirect: "manual"
    }), 201, "One-time Proof token exchange");
    cookies = exchangeCookies(exchange);

    await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      redirect: "manual"
    }), 401, "Reused Proof token exchange");

    const orderResponse = await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/order`, {
      headers: { cookie: cookies.cookie },
      redirect: "manual"
    }), 200, "Scoped Proof order read");
    const orderBody = await jsonObject(orderResponse, "Scoped Proof order read");
    assert.equal(orderBody.order?.order_number, PROOF_SYNTHETIC_QA_ORDER_NUMBER);
    assert.equal(orderBody.order?.tasks?.length, 1);
    assert.equal(orderBody.order?.access?.decisions_enabled, false);
    assert.equal(JSON.stringify(orderBody).includes(PROOF_SYNTHETIC_QA_MARKER), false);

    const taskId = String(orderBody.order.tasks[0]?.task_id || "");
    assert.ok(taskId, "The scoped Proof order did not contain its single synthetic task.");
    await expectStatus(await fetch(
      `${targets.public_base_url}/api/public/proof/tasks/${encodeURIComponent(taskId)}/history`,
      { headers: { cookie: cookies.cookie }, redirect: "manual" }
    ), 200, "Scoped Proof history read");
    await expectStatus(await fetch(
      `${targets.public_base_url}/api/public/proof/tasks/not-in-this-order/history`,
      { headers: { cookie: cookies.cookie }, redirect: "manual" }
    ), 404, "Cross-task history denial");

    await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/participants`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies.cookie },
      body: JSON.stringify({
        display_name: "Synthetic Boundary Reviewer",
        email: "boundary-reviewer@example.invalid"
      }),
      redirect: "manual"
    }), 403, "Missing-CSRF reviewer denial");

    await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/participants`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookies.cookie,
        "x-vornan-proof-csrf": cookies.csrf
      },
      body: JSON.stringify({
        display_name: "Synthetic Boundary Reviewer",
        email: "boundary-reviewer@example.invalid"
      }),
      redirect: "manual"
    }), 201, "Scoped reviewer identity");

    await expectStatus(await fetch(
      `${targets.public_base_url}/api/public/proof/tasks/${encodeURIComponent(taskId)}/feedback-acknowledgements`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookies.cookie,
          "x-vornan-proof-csrf": cookies.csrf
        },
        body: "{}",
        redirect: "manual"
      }
    ), 201, "Scoped feedback acknowledgement");

    await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/sessions/current`, {
      method: "DELETE",
      headers: { cookie: cookies.cookie, "x-vornan-proof-csrf": cookies.csrf },
      redirect: "manual"
    }), 204, "Proof session logout");
    await expectStatus(await fetch(`${targets.public_base_url}/api/public/proof/order`, {
      headers: { cookie: cookies.cookie },
      redirect: "manual"
    }), 401, "Post-logout Proof denial");

    await access.revokeProofGrant(grantId);
    const audit = await store.listProofAuditEvents(PROOF_SYNTHETIC_QA_ORDER_NUMBER, { limit: 100 });
    const actions = new Set<string>(
      audit.events.filter((event) => event.grant_id === grantId).map((event) => event.action)
    );
    for (const action of [
      "proof.grant_created",
      "proof.session_exchanged",
      "proof.participant_identified",
      "proof.feedback_acknowledged",
      "proof.session_ended",
      "proof.grant_revoked"
    ]) {
      assert.ok(actions.has(action), `Expected customer-boundary audit action ${action}.`);
    }
    grantId = null;

    return {
      status: "passed",
      environment: "dev",
      stack: "vornan-proof-dev",
      fixture_id: fixtureId,
      customer_boundary: {
        one_time_exchange: true,
        secure_session: true,
        one_order_visible: true,
        task_history_scoped: true,
        participant_csrf_enforced: true,
        feedback_acknowledgement_scoped: true,
        logout_terminal: true,
        direct_api_bypass_rejected: true
      },
      guardrails: {
        link_email_enabled: false,
        decisions_enabled: false,
        lift_writes_enabled: false,
        custom_domain_configured: false
      },
      cleanup_required: true
    };
  } finally {
    if (grantId) await access.revokeProofGrant(grantId);
  }
}

runCustomerBoundaryQa()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`Vornan Proof customer-boundary QA failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  });

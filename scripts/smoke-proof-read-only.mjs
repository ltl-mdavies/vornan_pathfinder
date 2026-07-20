import { pathToFileURL } from "node:url";

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function configuredUrl(value, name, allowHttp) {
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
    throw new Error(`${name} must use HTTPS; HTTP is allowed only for an explicitly enabled localhost smoke test.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  return body;
}

function requireHeader(response, name, pattern) {
  const value = response.headers.get(name) ?? "";
  if (!pattern.test(value)) {
    throw new Error(`Missing or invalid ${name} response header.`);
  }
}

export async function runProofReadOnlySmoke(env = process.env, fetcher = fetch) {
  const allowHttp = enabled(env.PATHFINDER_PROOF_SMOKE_ALLOW_HTTP);
  const baseUrl = configuredUrl(env.PATHFINDER_PROOF_SMOKE_BASE_URL, "PATHFINDER_PROOF_SMOKE_BASE_URL", allowHttp);
  const expectedPublicRead = enabled(env.PATHFINDER_PROOF_EXPECT_PUBLIC_READ);

  const health = await fetcher(`${baseUrl}/api/public/proof/health`, { redirect: "manual" });
  if (health.status !== 200) {
    throw new Error(`Proof health smoke expected HTTP 200 and received ${health.status}.`);
  }
  requireHeader(health, "content-security-policy", /default-src 'none'/i);
  requireHeader(health, "strict-transport-security", /max-age=63072000/i);
  requireHeader(health, "referrer-policy", /^no-referrer$/i);
  requireHeader(health, "x-content-type-options", /^nosniff$/i);
  requireHeader(health, "x-frame-options", /^DENY$/i);
  requireHeader(health, "permissions-policy", /camera=\(\)/i);
  requireHeader(health, "x-request-id", /^[A-Za-z0-9_-]{1,80}$/);
  const healthBody = await responseJson(health, "Proof health smoke");
  if (healthBody.decisions_enabled !== false || healthBody.public_read !== expectedPublicRead) {
    throw new Error("Proof health flags do not match the read-only deployment expectation.");
  }

  const tokenExchange = await fetcher(`${baseUrl}/api/public/proof/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "A".repeat(43) }),
    redirect: "manual"
  });
  const expectedExchangeStatus = expectedPublicRead ? 401 : 503;
  if (tokenExchange.status !== expectedExchangeStatus) {
    throw new Error(`Invalid-token smoke expected HTTP ${expectedExchangeStatus} and received ${tokenExchange.status}.`);
  }
  const tokenBody = await responseJson(tokenExchange, "Invalid-token smoke");
  const serializedTokenBody = JSON.stringify(tokenBody).toLowerCase();
  if (["order_number", "customer_name", "attachment_id", "token_hash", "session_hash"].some((field) => serializedTokenBody.includes(field))) {
    throw new Error("Invalid-token response exposed an internal Proof field.");
  }

  const unauthenticatedOrder = await fetcher(`${baseUrl}/api/public/proof/order`, { redirect: "manual" });
  if (unauthenticatedOrder.status !== 401) {
    throw new Error(`Unauthenticated order smoke expected HTTP 401 and received ${unauthenticatedOrder.status}.`);
  }

  const unauthenticatedRefresh = await fetcher(`${baseUrl}/api/public/proof/order/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "manual"
  });
  if (unauthenticatedRefresh.status !== 401) {
    throw new Error(`Unauthenticated refresh smoke expected HTTP 401 and received ${unauthenticatedRefresh.status}.`);
  }

  for (const [method, path] of [
    ["POST", "/api/public/proof/orders/A0000000/approve"],
    ["PUT", "/api/public/proof/tasks/not-a-task"]
  ]) {
    const decisionProbe = await fetcher(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: "{}",
      redirect: "manual"
    });
    if (decisionProbe.status !== 404) {
      throw new Error(`Public decision-route probe ${method} ${path} expected HTTP 404 and received ${decisionProbe.status}.`);
    }
  }

  if (env.PATHFINDER_PROOF_SMOKE_DIRECT_API_URL?.trim()) {
    const directApiUrl = configuredUrl(
      env.PATHFINDER_PROOF_SMOKE_DIRECT_API_URL,
      "PATHFINDER_PROOF_SMOKE_DIRECT_API_URL",
      allowHttp
    );
    const direct = await fetcher(`${directApiUrl}/api/public/proof/health`, { redirect: "manual" });
    if (direct.status !== 403) {
      throw new Error(`Direct API bypass smoke expected HTTP 403 and received ${direct.status}.`);
    }
  }

  return {
    base_host: new URL(baseUrl).hostname,
    public_read_enabled: expectedPublicRead,
    decisions_enabled: false,
    direct_api_bypass_rejected: Boolean(env.PATHFINDER_PROOF_SMOKE_DIRECT_API_URL?.trim())
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProofReadOnlySmoke()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`Vornan Proof read-only smoke failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
      process.exitCode = 1;
    });
}

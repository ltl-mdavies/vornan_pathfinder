import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  BatchWriteItemCommand,
  DynamoDBClient,
  ScanCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient
} from "@aws-sdk/client-sqs";
import request from "supertest";
import { PROOF_SYNTHETIC_QA_MARKER, PROOF_SYNTHETIC_QA_ORDER_NUMBER } from "../apps/api/src/proof/qa-fixture.js";

const CONFIRMATION = "VORNAN_PROOF_SYNTHETIC_QA";
const command = process.argv[2] ?? "run";
const fixtureId = process.env.PATHFINDER_PROOF_QA_FIXTURE_ID?.trim() ?? "";
const stackName = process.env.PATHFINDER_PROOF_STACK_NAME?.trim() || "vornan-proof-dev";
const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
const dynamo = new DynamoDBClient({ region });
const sqs = new SQSClient({ region });

function requiredConfirmation() {
  if (process.env.PATHFINDER_PROOF_QA_CONFIRM !== CONFIRMATION) {
    throw new Error(`Set PATHFINDER_PROOF_QA_CONFIRM=${CONFIRMATION} for the purgeable synthetic lifecycle.`);
  }
  if (!/^vpqa-[a-z0-9-]{8,48}$/.test(fixtureId)) {
    throw new Error("PATHFINDER_PROOF_QA_FIXTURE_ID must be a bounded vpqa-* identifier.");
  }
}

function awsJson(args: string[]) {
  return JSON.parse(execFileSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function entries(items: Record<string, string>[] | undefined, key: string, value: string) {
  return Object.fromEntries((items ?? []).map((item) => [item[key], item[value]]));
}

function stackBoundary(requireSyntheticEnabled: boolean) {
  const response = awsJson(["cloudformation", "describe-stacks", "--stack-name", stackName]);
  const stack = response.Stacks?.[0];
  if (!stack || !/^(CREATE|UPDATE)_COMPLETE$/.test(stack.StackStatus ?? "")) {
    throw new Error("The dark Proof dev stack is not in a completed state.");
  }
  const parameters = entries(stack.Parameters, "ParameterKey", "ParameterValue");
  const outputs = entries(stack.Outputs, "OutputKey", "OutputValue");
  const expectedSynthetic = requireSyntheticEnabled ? "true" : parameters.SyntheticQaEnabled;
  if (
    parameters.EnvironmentName !== "dev"
    || parameters.PublicReadEnabled !== "false"
    || parameters.ReadOnlyQaConfirmed !== "false"
    || parameters.ProductionPublicReadApproved !== "false"
    || parameters.ProofDomainName !== ""
    || parameters.CertificateArn !== ""
    || parameters.SyntheticQaEnabled !== expectedSynthetic
  ) {
    throw new Error("The synthetic lifecycle requires the fully dark, alias-free Proof dev boundary.");
  }
  for (const name of [
    "ProofCoreTableName",
    "ProofAuditTableName",
    "ProofSyncQueueUrl",
    "ProofSyncDeadLetterQueueUrl"
  ]) {
    if (!outputs[name]) throw new Error(`Dark Proof stack output ${name} is required.`);
  }
  return {
    stack_id: stack.StackId as string,
    core_table: outputs.ProofCoreTableName,
    audit_table: outputs.ProofAuditTableName,
    queue_url: outputs.ProofSyncQueueUrl,
    dlq_url: outputs.ProofSyncDeadLetterQueueUrl
  };
}

function configureServiceEnvironment(boundary: ReturnType<typeof stackBoundary>) {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME = "dev";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = boundary.core_table;
  process.env.PATHFINDER_PROOF_AUDIT_TABLE = boundary.audit_table;
  process.env.PATHFINDER_PROOF_PUBLIC_BASE_URL = "https://proof.invalid";
  process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION = "true";
  process.env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ = "true";
  process.env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL = "false";
  process.env.PATHFINDER_PROOF_SYNC_QUEUE_URL = "";
  process.env.PATHFINDER_PROOF_EDGE_SHARED_SECRET = "";
  process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "console";
}

function parseStoredData(item: Record<string, AttributeValue>) {
  try {
    return item.data?.S ? JSON.parse(item.data.S) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function fixtureKeys(tableName: string, audit = false) {
  const keys: Array<{ pk: AttributeValue; sk: AttributeValue }> = [];
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const response = await dynamo.send(new ScanCommand({
      TableName: tableName,
      ProjectionExpression: "pk, sk, #data",
      FilterExpression: audit ? "pk = :order_pk" : "pk = :order_pk OR contains(#data, :order_number)",
      ExpressionAttributeNames: { "#data": "data" },
      ExpressionAttributeValues: {
        ":order_pk": { S: `ORDER#${PROOF_SYNTHETIC_QA_ORDER_NUMBER}` },
        ...(audit ? {} : { ":order_number": { S: PROOF_SYNTHETIC_QA_ORDER_NUMBER } })
      },
      ExclusiveStartKey: startKey
    }));
    for (const item of response.Items ?? []) {
      const pk = item.pk?.S ?? "";
      const data = parseStoredData(item);
      const fixtureOwned =
        pk === `ORDER#${PROOF_SYNTHETIC_QA_ORDER_NUMBER}`
        || data?.order_number === PROOF_SYNTHETIC_QA_ORDER_NUMBER;
      if (!fixtureOwned || !item.pk || !item.sk) {
        throw new Error("Synthetic purge selector encountered a non-fixture record.");
      }
      keys.push({ pk: item.pk, sk: item.sk });
    }
    startKey = response.LastEvaluatedKey;
  } while (startKey);
  return keys;
}

async function deleteKeys(tableName: string, keys: Array<{ pk: AttributeValue; sk: AttributeValue }>) {
  for (let index = 0; index < keys.length; index += 25) {
    const batch = keys.slice(index, index + 25);
    const response = await dynamo.send(new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: batch.map((key) => ({ DeleteRequest: { Key: key } }))
      }
    }));
    if ((response.UnprocessedItems?.[tableName]?.length ?? 0) > 0) {
      throw new Error("Synthetic fixture purge left unprocessed DynamoDB deletes.");
    }
  }
}

async function queueCounts(queueUrl: string) {
  const response = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: [
      "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible",
      "ApproximateNumberOfMessagesDelayed",
      "VisibilityTimeout"
    ]
  }));
  const number = (name: string) => Number(response.Attributes?.[name] ?? 0);
  return {
    visible: number("ApproximateNumberOfMessages"),
    in_flight: number("ApproximateNumberOfMessagesNotVisible"),
    delayed: number("ApproximateNumberOfMessagesDelayed"),
    visibility_timeout: number("VisibilityTimeout")
  };
}

async function waitUntil(label: string, check: () => Promise<boolean>, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function exchangeCredentials(exchange: request.Response) {
  const rawCookies = exchange.headers["set-cookie"];
  const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  const session = cookies.find((cookie: string) => cookie.startsWith("vornan_proof_session=")) ?? "";
  const csrfCookie = cookies.find((cookie: string) => cookie.startsWith("vornan_proof_csrf=")) ?? "";
  const csrf = csrfCookie.split(";")[0]!.split("=")[1] ?? "";
  return { cookie: `${session.split(";")[0]}; ${csrfCookie.split(";")[0]}`, csrf, session, csrfCookie };
}

async function sendFixture(queueUrl: string, outcome: "success" | "failure") {
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      order_number: PROOF_SYNTHETIC_QA_ORDER_NUMBER,
      reason: "synthetic_qa",
      qa_fixture: { fixture_id: fixtureId, outcome }
    }),
    MessageGroupId: `proof-${PROOF_SYNTHETIC_QA_ORDER_NUMBER}`,
    MessageDeduplicationId: `${fixtureId}-${outcome}`
  }));
}

async function runLifecycle() {
  requiredConfirmation();
  const boundary = stackBoundary(true);
  const [initialCore, initialAudit, initialQueue, initialDlq] = await Promise.all([
    fixtureKeys(boundary.core_table),
    fixtureKeys(boundary.audit_table, true),
    queueCounts(boundary.queue_url),
    queueCounts(boundary.dlq_url)
  ]);
  assert.equal(initialCore.length, 0, "Purge the prior synthetic core fixture before running again.");
  assert.equal(initialAudit.length, 0, "Purge the prior synthetic audit fixture before running again.");
  assert.deepEqual(
    { visible: initialQueue.visible, in_flight: initialQueue.in_flight, delayed: initialQueue.delayed },
    { visible: 0, in_flight: 0, delayed: 0 },
    "The isolated Proof refresh queue must be empty before synthetic QA."
  );
  assert.deepEqual(
    { visible: initialDlq.visible, in_flight: initialDlq.in_flight, delayed: initialDlq.delayed },
    { visible: 0, in_flight: 0, delayed: 0 },
    "The isolated Proof DLQ must be empty before synthetic QA."
  );

  configureServiceEnvironment(boundary);
  const store = await import("../apps/api/src/proof/store.js");
  const access = await import("../apps/api/src/proof/access-service.js");
  const { createProofPublicApp } = await import("../apps/api/src/proof/public-server.js");

  const originalVisibility = initialQueue.visibility_timeout;
  const metrics: Record<string, unknown>[] = [];
  const originalConsoleLog = console.log;
  console.log = (...values: unknown[]) => {
    try {
      const parsed = typeof values[0] === "string" ? JSON.parse(values[0]) : null;
      if (parsed?._aws?.CloudWatchMetrics) metrics.push(parsed);
    } catch {
      // The harness intentionally retains no unrelated console payload.
    }
  };

  try {
    await sqs.send(new SetQueueAttributesCommand({
      QueueUrl: boundary.queue_url,
      Attributes: { VisibilityTimeout: "5" }
    }));
    await sendFixture(boundary.queue_url, "success");
    await waitUntil("synthetic cached order", async () => Boolean(await store.getProofOrder(PROOF_SYNTHETIC_QA_ORDER_NUMBER)));
    const cached = await store.getProofOrder(PROOF_SYNTHETIC_QA_ORDER_NUMBER);
    assert.equal(cached?.customer_name, PROOF_SYNTHETIC_QA_MARKER);
    assert.equal(cached?.lines.length, 1);
    assert.equal(cached?.tasks.length, 1);
    assert.equal(cached?.tasks[0]?.order_line_id, cached?.lines[0]?.order_line_id);

    const created = await access.createProofGrant({
      order_number: PROOF_SYNTHETIC_QA_ORDER_NUMBER,
      label: `Synthetic lifecycle ${fixtureId}`
    });
    const rawToken = created.access_url.split("/").at(-1)!;
    const app = createProofPublicApp();
    const exchange = await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(201);
    const credentials = exchangeCredentials(exchange);
    assert.match(credentials.session, /HttpOnly/i);
    assert.match(credentials.session, /Secure/i);
    assert.match(credentials.session, /SameSite=Lax/i);
    assert.doesNotMatch(credentials.csrfCookie, /HttpOnly/i);
    await request(app).post("/api/public/proof/sessions").send({ token: rawToken }).expect(401);

    const order = await request(app).get("/api/public/proof/order").set("Cookie", credentials.cookie).expect(200);
    assert.equal(order.body.order.order_number, PROOF_SYNTHETIC_QA_ORDER_NUMBER);
    assert.equal(order.body.order.access.decisions_enabled, false);
    assert.deepEqual(order.body.order.counts, {
      pending: 1,
      regenerating: 0,
      waiting: 0,
      reviewed: 0,
      total: 1
    });
    assert.equal(JSON.stringify(order.body).includes(PROOF_SYNTHETIC_QA_MARKER), false);

    await request(app)
      .post("/api/public/proof/participants")
      .set("Cookie", credentials.cookie)
      .set("X-Vornan-Proof-CSRF", credentials.csrf)
      .send({ display_name: "Synthetic Reviewer", email: "synthetic-reviewer@example.invalid" })
      .expect(201);
    await request(app)
      .get(`/api/public/proof/tasks/${cached!.tasks[0]!.task_id}/history`)
      .set("Cookie", credentials.cookie)
      .expect(200);
    await request(app)
      .post(`/api/public/proof/tasks/${cached!.tasks[0]!.task_id}/feedback-acknowledgements`)
      .set("Cookie", credentials.cookie)
      .set("X-Vornan-Proof-CSRF", credentials.csrf)
      .send({})
      .expect(201);
    await request(app)
      .delete("/api/public/proof/sessions/current")
      .set("Cookie", credentials.cookie)
      .set("X-Vornan-Proof-CSRF", credentials.csrf)
      .expect(204);
    await request(app).get("/api/public/proof/order").set("Cookie", credentials.cookie).expect(401);
    await access.updateProofGrant(created.grant.grant_id, { action: "revoke" });

    await sendFixture(boundary.queue_url, "failure");
    await waitUntil("controlled failure in the Proof DLQ", async () => (await queueCounts(boundary.dlq_url)).visible >= 1);

    const audit = await store.listProofAuditEvents(PROOF_SYNTHETIC_QA_ORDER_NUMBER, { limit: 100 });
    const actionCounts = audit.events.reduce<Record<string, number>>((counts, event) => {
      counts[event.action] = (counts[event.action] ?? 0) + 1;
      return counts;
    }, {});
    for (const action of [
      "proof.sync_completed",
      "proof.review_ready",
      "proof.grant_created",
      "proof.session_exchanged",
      "proof.participant_identified",
      "proof.feedback_acknowledged",
      "proof.session_ended",
      "proof.grant_revoked",
      "proof.sync_failed"
    ]) {
      assert.ok((actionCounts[action] ?? 0) >= 1, `Expected synthetic audit action ${action}.`);
    }

    const operations = [...new Set(metrics.map((metric) => String(metric.Operation)))].sort();
    const dimensionNames = [...new Set(metrics.flatMap((metric) => {
      const definitions = (metric._aws as { CloudWatchMetrics?: { Dimensions?: string[][] }[] }).CloudWatchMetrics ?? [];
      return definitions.flatMap((definition) => definition.Dimensions ?? []).flat();
    }))].sort();
    assert.deepEqual(dimensionNames, ["Environment", "Operation", "Service"]);
    for (const operation of [
      "cached_order_read",
      "feedback_acknowledgement",
      "participant_identity",
      "session_logout",
      "task_history",
      "token_exchange"
    ]) {
      assert.ok(operations.includes(operation), `Expected bounded telemetry operation ${operation}.`);
    }

    const [coreKeys, auditKeys, dlq] = await Promise.all([
      fixtureKeys(boundary.core_table),
      fixtureKeys(boundary.audit_table, true),
      queueCounts(boundary.dlq_url)
    ]);
    return {
      fixture_id: fixtureId,
      fixture_order: PROOF_SYNTHETIC_QA_ORDER_NUMBER,
      marker: PROOF_SYNTHETIC_QA_MARKER,
      stack_id: boundary.stack_id,
      cached_aggregate: { lines: cached!.lines.length, tasks: cached!.tasks.length },
      grant_session: {
        one_time_exchange: true,
        secure_cookie: true,
        csrf_cookie: true,
        identified_participant: true,
        feedback_acknowledged: true,
        session_ended: true,
        grant_revoked: true
      },
      audit_action_counts: actionCounts,
      queue: { success_processed: true, controlled_failure_visible_in_dlq: dlq.visible >= 1 },
      telemetry: { operations, dimension_names: dimensionNames },
      fixture_records: { core: coreKeys.length, audit: auditKeys.length },
      cleanup_required: true
    };
  } finally {
    console.log = originalConsoleLog;
    await sqs.send(new SetQueueAttributesCommand({
      QueueUrl: boundary.queue_url,
      Attributes: { VisibilityTimeout: String(originalVisibility || 90) }
    }));
  }
}

async function deleteFixtureMessages(queueUrl: string) {
  let deleted = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 10,
      MessageSystemAttributeNames: ["ApproximateReceiveCount"]
    }));
    if (!(response.Messages?.length)) break;
    for (const message of response.Messages) {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(message.Body ?? "") as Record<string, unknown>;
      } catch {
        payload = null;
      }
      const qa = payload?.qa_fixture as Record<string, unknown> | undefined;
      if (
        payload?.order_number !== PROOF_SYNTHETIC_QA_ORDER_NUMBER
        || qa?.fixture_id !== fixtureId
      ) {
        if (message.ReceiptHandle) {
          await sqs.send(new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 0
          }));
        }
        throw new Error("Synthetic purge refused to delete a non-fixture queue message.");
      }
      if (message.ReceiptHandle) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
        deleted += 1;
      }
    }
  }
  return deleted;
}

async function purgeLifecycle() {
  requiredConfirmation();
  const boundary = stackBoundary(false);
  const [coreKeys, auditKeys] = await Promise.all([
    fixtureKeys(boundary.core_table),
    fixtureKeys(boundary.audit_table, true)
  ]);
  await deleteKeys(boundary.core_table, coreKeys);
  await deleteKeys(boundary.audit_table, auditKeys);
  const dlqDeleted = await deleteFixtureMessages(boundary.dlq_url);
  const [remainingCore, remainingAudit, queue, dlq] = await Promise.all([
    fixtureKeys(boundary.core_table),
    fixtureKeys(boundary.audit_table, true),
    queueCounts(boundary.queue_url),
    queueCounts(boundary.dlq_url)
  ]);
  assert.equal(remainingCore.length, 0);
  assert.equal(remainingAudit.length, 0);
  assert.equal(queue.visible + queue.in_flight + queue.delayed, 0);
  assert.equal(dlq.visible + dlq.in_flight + dlq.delayed, 0);
  return {
    fixture_id: fixtureId,
    fixture_order: PROOF_SYNTHETIC_QA_ORDER_NUMBER,
    deleted: { core: coreKeys.length, audit: auditKeys.length, dlq_messages: dlqDeleted },
    residual: { core: 0, audit: 0, queue: 0, dlq: 0 }
  };
}

if (!new Set(["run", "purge"]).has(command)) {
  throw new Error("Use proof-synthetic-lifecycle-qa.ts run or purge.");
}

const result = command === "run" ? await runLifecycle() : await purgeLifecycle();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

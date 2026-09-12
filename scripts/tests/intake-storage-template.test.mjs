import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTemplate, evaluateTemplate, environmentBytes } from "../intake-storage-template.mjs";

const template = parseTemplate(readFileSync(new URL("../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const tableId = "PathfinderIntakeAttemptsTable";
const envKey = "PATHFINDER_INTAKE_ATTEMPTS_TABLE";
const statements = (t) => t.Resources.PathfinderApiRole.Properties.Policies[0].PolicyDocument.Statement;
const variables = (t) => t.Resources.PathfinderApiFunction.Properties.Environment.Variables;
const bytes = (t) => environmentBytes(Object.fromEntries(Object.entries(variables(t)).map(([key, value]) => [key, String(value)])));
const off = evaluateTemplate(template);
const on = evaluateTemplate(template, { IntakeAssuranceStorageEnabled: "true" });

test("storage defaults off, with no table, env, output or table IAM", () => {
  assert.equal(template.Parameters.IntakeAssuranceStorageEnabled.Default, "false");
  assert.deepEqual(template.Parameters.IntakeAssuranceStorageEnabled.AllowedValues, ["true", "false"]);
  assert.ok(!(tableId in off.Resources));
  assert.ok(!(envKey in variables(off)));
  assert.ok(!("IntakeAssuranceTableName" in off.Outputs));
  assert.doesNotMatch(JSON.stringify(off), /IntakeAttempts|IntakeAssurance/);
});

test("enabled storage creates exactly one protected table and only scoped access", () => {
  assert.deepEqual(Object.keys(on.Resources).filter((key) => !(key in off.Resources)), [tableId]);
  const table = on.Resources[tableId];
  assert.equal(table.Type, "AWS::DynamoDB::Table");
  assert.equal(table.DeletionPolicy, "Retain");
  assert.equal(table.UpdateReplacePolicy, "Retain");
  assert.deepEqual(table.Properties, {
    DeletionProtectionEnabled: true,
    TableName: `${template.Parameters.DataTablePrefix.Default}-IntakeAttempts-${template.Parameters.EnvironmentName.Default}`,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "customer_id", AttributeType: "S" }, { AttributeName: "attempt_id", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "customer_id", KeyType: "HASH" }, { AttributeName: "attempt_id", KeyType: "RANGE" }],
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    SSESpecification: { SSEEnabled: true },
    Tags: [{ Key: "App", Value: "Pathfinder" }, { Key: "Environment", Value: "prod" }]
  });
  assert.equal(variables(on)[envKey], table.Properties.TableName);
  assert.equal(on.Outputs.IntakeAssuranceTableName.Value, table.Properties.TableName);
  const added = statements(on).filter((s) => !statements(off).some((other) => JSON.stringify(s) === JSON.stringify(other)));
  assert.deepEqual(added, [{ Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:TransactWriteItems", "dynamodb:ConditionCheckItem"], Resource: `arn:aws:dynamodb:us-east-1:123456789012:table/${table.Properties.TableName}` }]);
  const normalized = structuredClone(on);
  delete normalized.Resources[tableId];
  delete variables(normalized)[envKey];
  delete normalized.Outputs.IntakeAssuranceTableName;
  statements(normalized).splice(statements(normalized).findIndex((s) => s.Resource === added[0].Resource), 1);
  assert.deepEqual(normalized, off);
});

test("fixture environment stays within 4KB and disabled storage adds zero bytes", () => {
  const expectedDelta = Buffer.byteLength(envKey + variables(on)[envKey]);
  assert.equal(bytes(on) - bytes(off), expectedDelta);
  assert.ok(bytes(on) <= 4096, `Fixture environment uses ${bytes(on)} bytes`);
  assert.equal(environmentBytes({ KEY: "é" }), 5);
  assert.throws(() => environmentBytes({ KEY: 1 }), /strings/);
  assert.throws(() => environmentBytes(null), /map/);
  const custom = evaluateTemplate(template, { IntakeAssuranceStorageEnabled: "true", DataTablePrefix: "test", EnvironmentName: "staging" });
  assert.equal(variables(custom)[envKey], "test-IntakeAttempts-staging");
});

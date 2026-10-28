import assert from "node:assert/strict";
// Remove only this independently asserted additive feature for historical hashes.
// Keep those prior hashes unchanged so unrelated drift still fails validation.
export function withoutIntakeDiagnostics(template) {
  const prior = structuredClone(template);
  const table = prior.Resources.PathfinderIntakeDiagnosticsTable;
  assert.deepEqual(table, {
    Type: "AWS::DynamoDB::Table", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain",
    Properties: {
      DeletionProtectionEnabled: true, TableName: { Sub: "${DataTablePrefix}-IntakeDiagnostics-${EnvironmentName}" }, BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "customer_id", AttributeType: "S" }, { AttributeName: "diagnostic_id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "customer_id", KeyType: "HASH" }, { AttributeName: "diagnostic_id", KeyType: "RANGE" }],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, SSESpecification: { SSEEnabled: true },
      Tags: [{ Key: "App", Value: "Pathfinder" }, { Key: "Environment", Value: { Ref: "EnvironmentName" } }]
    }
  });
  delete prior.Resources.PathfinderIntakeDiagnosticsTable;
  const env = prior.Resources.PathfinderApiFunction.Properties.Environment.Variables;
  assert.deepEqual(env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE, { Ref: "PathfinderIntakeDiagnosticsTable" });
  delete env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE;
  const statements = prior.Resources.PathfinderApiRole.Properties.Policies[0].PolicyDocument.Statement;
  const matches = statements.filter(value => JSON.stringify(value).includes("PathfinderIntakeDiagnosticsTable"));
  assert.deepEqual(matches, [{ Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"], Resource: { GetAtt: "PathfinderIntakeDiagnosticsTable.Arn" } }]);
  statements.splice(statements.indexOf(matches[0]), 1);
  return prior;
}

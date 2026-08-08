import {
  DynamoDBClient,
  GetItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";

export interface ProofActionTargetEnvironment {
  environment_id: string;
  role: string;
  status: string;
  endpoint_url: string;
}

export interface ProofActionTargetConfig {
  target_id: string;
  adapter: string;
  environments: ProofActionTargetEnvironment[];
}

interface ProofActionTargetReader {
  send(command: GetItemCommand): Promise<{ Item?: Record<string, AttributeValue> }>;
}

let client: DynamoDBClient | null = null;

function dynamoClient() {
  client ??= new DynamoDBClient({});
  return client;
}

function parseTarget(item: Record<string, AttributeValue> | undefined): ProofActionTargetConfig | null {
  const data = item?.data?.S;
  if (!data) return null;
  const parsed = JSON.parse(data) as Partial<ProofActionTargetConfig>;
  if (
    typeof parsed.target_id !== "string" ||
    typeof parsed.adapter !== "string" ||
    !Array.isArray(parsed.environments)
  ) {
    return null;
  }
  return {
    target_id: parsed.target_id,
    adapter: parsed.adapter,
    environments: parsed.environments.filter(
      (environment): environment is ProofActionTargetEnvironment =>
        Boolean(environment) &&
        typeof environment.environment_id === "string" &&
        typeof environment.role === "string" &&
        typeof environment.status === "string" &&
        typeof environment.endpoint_url === "string"
    )
  };
}

export async function readProofActionTargetConfig(
  targetId: string,
  overrides: { tableName?: string; client?: ProofActionTargetReader } = {}
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(targetId)) {
    throw new Error("Proof action target ID is invalid.");
  }
  const tableName = (overrides.tableName ??
    process.env.PATHFINDER_PROOF_TARGETS_TABLE ??
    process.env.PATHFINDER_TARGETS_TABLE ??
    "").trim();
  if (!tableName) {
    throw new Error("The Proof action target table is not configured.");
  }
  const response = await (overrides.client ?? dynamoClient()).send(new GetItemCommand({
    TableName: tableName,
    Key: { target_id: { S: targetId } },
    ConsistentRead: true
  }));
  const target = parseTarget(response.Item);
  return target?.target_id === targetId ? target : null;
}

/** Only these workspace tables have a namespace representation. Targets and Proof are excluded. */
export const workspaceTableBindings = {
  customers: ["PATHFINDER_CUSTOMERS_TABLE", "Customers"],
  workspaces: ["PATHFINDER_CUSTOMER_WORKSPACES_TABLE", "CustomerWorkspaces"],
  import_methods: ["PATHFINDER_IMPORT_METHODS_TABLE", "ImportMethods"],
  output_routes: ["PATHFINDER_OUTPUT_ROUTES_TABLE", "OutputRoutes"],
  product_mappings: ["PATHFINDER_PRODUCT_MAPPINGS_TABLE", "ProductMappings"],
  jobs: ["PATHFINDER_JOBS_TABLE", "Jobs"],
  order_ids: ["PATHFINDER_ORDER_IDS_TABLE", "OrderIds"],
  submit_attempts: ["PATHFINDER_SUBMIT_ATTEMPTS_TABLE", "SubmitAttempts"]
} as const;
export type WorkspaceTableKey = keyof typeof workspaceTableBindings;
const keys = Object.keys(workspaceTableBindings) as WorkspaceTableKey[];
const validTable = (value: string) => /^[A-Za-z0-9_.-]{3,255}$/.test(value);

/** Pure, uncached resolver. Validate the complete supplied namespace before any caller starts I/O. */
export function resolveWorkspaceTables<K extends WorkspaceTableKey>(
  environment: Readonly<Record<string, string | undefined>>,
  required: readonly K[]
): Record<K, string> {
  const compact = environment.PATHFINDER_TABLE_NAMESPACE;
  let namespace: { prefix: string; stage: string } | undefined;
  if (compact !== undefined) {
    const parts = compact.split("|");
    if (parts.length !== 3 || parts[0] !== "1" || !/^[A-Za-z0-9-]+$/.test(parts[1] ?? "") ||
      !/^[a-z0-9-]+$/.test(parts[2] ?? "") || compact.length > 512) throw new Error("Invalid workspace table namespace");
    namespace = { prefix: parts[1]!, stage: parts[2]! };
  }
  const resolved: Partial<Record<WorkspaceTableKey, string>> = {};
  for (const key of keys) {
    const [binding, suffix] = workspaceTableBindings[key];
    const legacy = environment[binding];
    const derived = namespace ? `${namespace.prefix}-${suffix}-${namespace.stage}` : undefined;
    if ((legacy !== undefined && !validTable(legacy)) || (derived !== undefined && !validTable(derived)) ||
      (legacy !== undefined && derived !== undefined && legacy !== derived)) throw new Error("Invalid or conflicting workspace table configuration");
    resolved[key] = derived ?? legacy;
  }
  const result = {} as Record<K, string>;
  for (const key of required) {
    if (!keys.includes(key) || !resolved[key]) throw new Error("Required workspace table is not configured");
    result[key] = resolved[key]!;
  }
  return result;
}

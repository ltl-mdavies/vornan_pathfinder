import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalOrder, ProcessingState, ValidationMessage } from "@pathfinder/canonical";
import type { LiftCustomer } from "@pathfinder/customer-directory";
import {
  defaultLiftTargetConfig,
  type LiftOrderPayload,
  type LiftSubmitRequest,
  type LiftTargetConfig
} from "@pathfinder/lift-adapter";
import { buildDefaultMappings, sampleSourceGrid, type FieldMapping, type SourceGrid } from "@pathfinder/templates";

export type ImportMethodStatus = "Active" | "Draft" | "Paused";

export interface SavedFieldMappingTemplate {
  template_id: string;
  name: string;
  version: string;
  status: "Draft" | "Published" | "Archived";
  mappings: FieldMapping[];
  updated_at: string;
}

export interface ImportMethod {
  import_method_id: string;
  name: string;
  type: "Manual upload" | "API import" | "Manual paste" | "Scheduled";
  source: "XLSX" | "REST API" | "Clipboard" | "SFTP";
  status: ImportMethodStatus;
  target_id: string;
  target_template: string;
  template_id: string;
  mappings: FieldMapping[];
  last_run_at?: string | null;
  success_rate?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TargetConfig {
  target_id: string;
  name: string;
  adapter: LiftTargetConfig["destination_adapter"];
  format: "JSON";
  template: string;
  status: "Ready" | "Configured" | "Draft";
  lift: LiftTargetConfig;
  updated_at: string;
}

export interface ProcessingJobPreview {
  job_id: string;
  customer_id: string;
  customer_name: string;
  import_method_id: string;
  import_method_name: string;
  state: ProcessingState;
  source_file_name: string;
  sheet_name?: string | null;
  source_grid: SourceGrid;
  mappings: FieldMapping[];
  canonical_order: CanonicalOrder;
  canonical_validation: ValidationMessage[];
  lift_payload: LiftOrderPayload;
  lift_validation: ValidationMessage[];
  submit_request_masked: Omit<LiftSubmitRequest, "headers"> & {
    headers: Omit<LiftSubmitRequest["headers"], "Password"> & { Password: string };
  };
  created_at: string;
  updated_at: string;
}

export interface PathfinderCustomerWorkspace {
  customer: LiftCustomer;
  import_methods: ImportMethod[];
  templates: SavedFieldMappingTemplate[];
  jobs: ProcessingJobPreview[];
  primary_target_id: string;
  updated_at: string;
}

export interface PathfinderStore {
  version: 1;
  targets: Record<string, TargetConfig>;
  workspaces: Record<string, PathfinderCustomerWorkspace>;
  jobs: ProcessingJobPreview[];
}

const storePath = fileURLToPath(new URL("../../../data/pathfinder-store.local.json", import.meta.url));
const targetId = "lift-standard-graphics";
const manualImportMethodId = "manual-xlsx";

function now() {
  return new Date().toISOString();
}

function cloneDefaultLiftConfig(): LiftTargetConfig {
  return JSON.parse(JSON.stringify(defaultLiftTargetConfig)) as LiftTargetConfig;
}

function createSeedTarget(): TargetConfig {
  return {
    target_id: targetId,
    name: "Lift ERP",
    adapter: "lift-standard-graphics",
    format: "JSON",
    template: "Lift Standard Graphics Order",
    status: "Ready",
    lift: cloneDefaultLiftConfig(),
    updated_at: now()
  };
}

function createSeedMethod(timestamp: string): ImportMethod {
  const mappings = buildDefaultMappings(sampleSourceGrid.columns);

  return {
    import_method_id: manualImportMethodId,
    name: "Manual XLSX",
    type: "Manual upload",
    source: "XLSX",
    status: "Active",
    target_id: targetId,
    target_template: "Lift Standard Graphics Order",
    template_id: "template_manual_xlsx_v1",
    mappings,
    last_run_at: null,
    success_rate: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

function createWorkspace(customer: LiftCustomer): PathfinderCustomerWorkspace {
  const timestamp = now();
  const method = createSeedMethod(timestamp);

  return {
    customer,
    import_methods: [method],
    templates: [
      {
        template_id: method.template_id,
        name: "Manual XLSX Field Mapping",
        version: "1.0.0",
        status: "Draft",
        mappings: method.mappings,
        updated_at: timestamp
      }
    ],
    jobs: [],
    primary_target_id: targetId,
    updated_at: timestamp
  };
}

function createSeedStore(): PathfinderStore {
  return {
    version: 1,
    targets: {
      [targetId]: createSeedTarget()
    },
    workspaces: {},
    jobs: []
  };
}

export function maskTargetConfig(target: TargetConfig): TargetConfig {
  return {
    ...target,
    lift: {
      ...target.lift,
      credentials: {
        ...target.lift.credentials,
        Password: "********"
      }
    }
  };
}

async function writeStore(store: PathfinderStore) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function readStore(): Promise<PathfinderStore> {
  try {
    const content = await readFile(storePath, "utf8");
    const parsed = JSON.parse(content) as PathfinderStore;
    return {
      ...parsed,
      targets: parsed.targets ?? {},
      workspaces: parsed.workspaces ?? {},
      jobs: parsed.jobs ?? []
    };
  } catch {
    const seed = createSeedStore();
    await writeStore(seed);
    return seed;
  }
}

export async function getOrCreateWorkspace(customer: LiftCustomer) {
  const store = await readStore();
  const existing = store.workspaces[customer.lift_customer_id];

  if (existing) {
    existing.customer = customer;
    existing.jobs = store.jobs.filter((job) => job.customer_id === customer.lift_customer_id);
    store.workspaces[customer.lift_customer_id] = existing;
    await writeStore(store);
    return existing;
  }

  const workspace = createWorkspace(customer);
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace;
}

export async function updateImportMethod(customer: LiftCustomer, methodId: string, methodPatch: Partial<ImportMethod>) {
  const store = await readStore();
  const workspace = store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer);
  const timestamp = now();
  const existingMethod = workspace.import_methods.find((method) => method.import_method_id === methodId) ?? createSeedMethod(timestamp);
  const nextMethod: ImportMethod = {
    ...existingMethod,
    ...methodPatch,
    import_method_id: methodId,
    updated_at: timestamp
  };

  workspace.import_methods = [
    nextMethod,
    ...workspace.import_methods.filter((method) => method.import_method_id !== methodId)
  ];
  workspace.templates = [
    {
      template_id: nextMethod.template_id,
      name: `${nextMethod.name} Field Mapping`,
      version: "1.0.0",
      status: nextMethod.status === "Active" ? "Published" : "Draft",
      mappings: nextMethod.mappings,
      updated_at: timestamp
    },
    ...workspace.templates.filter((template) => template.template_id !== nextMethod.template_id)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return workspace;
}

export async function listJobs() {
  const store = await readStore();
  return store.jobs;
}

export async function listTargets(maskCredentials = true) {
  const store = await readStore();
  const targets = Object.values(store.targets);
  return maskCredentials ? targets.map(maskTargetConfig) : targets;
}

export async function getTarget(id = targetId, maskCredentials = true) {
  const store = await readStore();
  const target = store.targets[id] ?? createSeedTarget();
  store.targets[id] = target;
  await writeStore(store);
  return maskCredentials ? maskTargetConfig(target) : target;
}

export async function updateTarget(id: string, patch: Partial<TargetConfig>) {
  const store = await readStore();
  const existing = store.targets[id] ?? createSeedTarget();
  const submittedPassword = patch.lift?.credentials?.Password;
  const nextTarget: TargetConfig = {
    ...existing,
    ...patch,
    target_id: id,
    lift: {
      ...existing.lift,
      ...patch.lift,
      environments: {
        ...existing.lift.environments,
        ...patch.lift?.environments
      },
      headers: {
        ...existing.lift.headers,
        ...patch.lift?.headers,
        Ext_ID: {
          ...existing.lift.headers.Ext_ID,
          ...patch.lift?.headers?.Ext_ID
        }
      },
      credentials: {
        ...existing.lift.credentials,
        ...patch.lift?.credentials,
        Password:
          submittedPassword && submittedPassword !== "********"
            ? submittedPassword
            : existing.lift.credentials.Password
      }
    },
    updated_at: now()
  };

  store.targets[id] = nextTarget;
  await writeStore(store);
  return maskTargetConfig(nextTarget);
}

export async function persistPreviewJob(customer: LiftCustomer, job: ProcessingJobPreview, method: ImportMethod) {
  const store = await readStore();
  const workspace = store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer);
  const timestamp = now();
  const nextMethod: ImportMethod = {
    ...method,
    last_run_at: timestamp,
    success_rate: job.state === "Ready" ? "100%" : method.success_rate ?? null,
    updated_at: timestamp
  };

  store.jobs = [job, ...store.jobs.filter((candidate) => candidate.job_id !== job.job_id)];
  workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
  workspace.import_methods = [
    nextMethod,
    ...workspace.import_methods.filter((candidate) => candidate.import_method_id !== method.import_method_id)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return workspace;
}

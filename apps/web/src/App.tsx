import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FileText,
  Gauge,
  History,
  Map,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Upload,
  Users,
  Workflow
} from "lucide-react";
import type { LiftCustomer, LiftCustomerDirectory } from "@pathfinder/customer-directory";
import { validateCanonicalOrder, type CanonicalOrder, type ProcessingState, type ValidationMessage } from "@pathfinder/canonical";
import {
  buildLiftSubmitRequest,
  generateLiftPayload,
  maskLiftSubmitRequest,
  validateLiftPayload,
  type LiftOrderPayload,
  type LiftSubmitRequest,
  type LiftTargetConfig
} from "@pathfinder/lift-adapter";
import {
  buildDefaultMappings,
  canonicalTargetFields,
  mapSourceRowsToCanonicalOrder,
  parseWorkbookArrayBuffer,
  sampleSourceGrid,
  type FieldMapping,
  type SourceGrid
} from "@pathfinder/templates";

type GlobalView = "Dashboard" | "Customers" | "Targets" | "Jobs" | "Audit" | "Settings";
type CustomerView = "Overview" | "Import Methods" | "Manual Import" | "Jobs" | "Settings";

type ImportMethodStatus = "Active" | "Draft" | "Paused";

interface SavedFieldMappingTemplate {
  template_id: string;
  name: string;
  version: string;
  status: "Draft" | "Published" | "Archived";
  mappings: FieldMapping[];
  updated_at: string;
}

interface ImportMethod {
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

interface TargetConfig {
  target_id: string;
  name: string;
  adapter: LiftTargetConfig["destination_adapter"];
  format: "JSON";
  template: string;
  status: "Ready" | "Configured" | "Draft";
  lift: LiftTargetConfig;
  updated_at: string;
}

interface ProcessingJobPreview {
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

interface PathfinderCustomerWorkspace {
  customer: LiftCustomer;
  import_methods: ImportMethod[];
  templates: SavedFieldMappingTemplate[];
  jobs: ProcessingJobPreview[];
  primary_target_id: string;
  primary_target: TargetConfig;
  updated_at: string;
}

const globalNavItems: Array<{ label: GlobalView; icon: typeof Gauge }> = [
  { label: "Dashboard", icon: Gauge },
  { label: "Customers", icon: Users },
  { label: "Targets", icon: Database },
  { label: "Jobs", icon: Archive },
  { label: "Audit", icon: History },
  { label: "Settings", icon: Settings }
];

const customerNavItems: Array<{ label: CustomerView; icon: typeof Gauge }> = [
  { label: "Overview", icon: Gauge },
  { label: "Import Methods", icon: Workflow },
  { label: "Manual Import", icon: Upload },
  { label: "Jobs", icon: Archive },
  { label: "Settings", icon: SlidersHorizontal }
];

const seedTimestamp = "2026-07-09T13:41:00.000Z";

const fallbackJobs: Array<{
  id: string;
  customer: string;
  source: string;
  state: ProcessingState;
  extId: string;
  updated: string;
  orders: number;
  started: string;
  duration: string;
}> = [
  {
    id: "job_20260709_000001",
    customer: "Empirical - Momentara",
    source: "Manual XLSX",
    state: "Ready",
    extId: "AS360-30904511",
    updated: "2 min ago",
    orders: 24,
    started: "Today 9:41 AM",
    duration: "1m 52s"
  },
  {
    id: "job_20260709_000000",
    customer: "Empirical - Momentara",
    source: "Wrike Intake",
    state: "Validated",
    extId: "AS360-30904492",
    updated: "18 min ago",
    orders: 18,
    started: "Today 7:22 AM",
    duration: "2m 18s"
  },
  {
    id: "job_20260708_000118",
    customer: "Empirical - Momentara",
    source: "Manual XLSX",
    state: "Failed",
    extId: "AS360-30904110",
    updated: "1 hr ago",
    orders: 5,
    started: "Yesterday 4:31 PM",
    duration: "45s"
  }
];

const fallbackImportMethods: ImportMethod[] = [
  {
    import_method_id: "manual-xlsx",
    name: "Manual XLSX",
    type: "Manual upload",
    source: "XLSX",
    status: "Active",
    target_id: "lift-standard-graphics",
    target_template: "Lift Standard Graphics Order",
    template_id: "template_manual_xlsx_v1",
    mappings: buildDefaultMappings(sampleSourceGrid.columns),
    last_run_at: seedTimestamp,
    success_rate: "100%",
    created_at: seedTimestamp,
    updated_at: seedTimestamp
  },
  {
    import_method_id: "wrike-intake",
    name: "Wrike Intake",
    type: "API import",
    source: "REST API",
    status: "Draft",
    target_id: "lift-standard-graphics",
    target_template: "Lift Standard Graphics Order",
    template_id: "template_wrike_intake_v1",
    mappings: [],
    last_run_at: null,
    success_rate: "98.7%",
    created_at: seedTimestamp,
    updated_at: seedTimestamp
  },
  {
    import_method_id: "paste-grid",
    name: "Paste Grid",
    type: "Manual paste",
    source: "Clipboard",
    status: "Draft",
    target_id: "lift-standard-graphics",
    target_template: "Lift Standard Graphics Order",
    template_id: "template_paste_grid_v1",
    mappings: [],
    last_run_at: null,
    success_rate: null,
    created_at: seedTimestamp,
    updated_at: seedTimestamp
  }
];

const fallbackCustomer: LiftCustomer = {
  lift_customer_id: "284619",
  customer_name: "Empirical - Momentara",
  customer_number: "0000000960",
  customer_type: "Standard",
  customer_status: "Regular",
  sales_rep: "Alex Hay",
  default_invoice_email_address: "michael@empirical-inc.com",
  created_date: "2026-06-25"
};

const apiBaseUrl = "http://127.0.0.1:3000";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || `Request failed with HTTP ${response.status}.`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error("Pathfinder API returned a non-JSON response. Confirm the API server is running on port 3000.");
  }

  return JSON.parse(body) as T;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function StatePill({ state }: { state: ProcessingState }) {
  const className =
    state === "Failed"
      ? "pill pill-danger"
      : state === "Ready" || state === "Completed"
        ? "pill pill-success"
        : "pill pill-neutral";
  return <span className={className}>{state}</span>;
}

function PanelHeader({
  icon: Icon,
  title,
  detail
}: {
  icon: typeof FileSpreadsheet;
  title: string;
  detail?: string;
}) {
  return (
    <div className="panel-header">
      <div className="panel-title">
        <Icon size={18} strokeWidth={2.2} />
        <h2>{title}</h2>
      </div>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function ArrowGlyph() {
  return (
    <svg className="arrow-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3.5 10 8l-4.5 4.5" />
    </svg>
  );
}

function updateMapping(mappings: FieldMapping[], sourceColumn: string, targetField: string) {
  const nextMappings = mappings.filter((mapping) => mapping.sourceColumn !== sourceColumn);
  return targetField ? [...nextMappings, { sourceColumn, targetField }] : nextMappings;
}

function DetailItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "Unassigned"}</dd>
    </div>
  );
}

function displayTimestamp(value?: string | null) {
  if (!value) {
    return "Not run";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function displayJobId(jobId: string) {
  const digits = jobId.replace(/\D/g, "").slice(-6);
  return digits ? `JOB-${digits}` : jobId;
}

function isFailureState(state: ProcessingState) {
  return state === "Failed" || state === "Cancelled";
}

function jobExtId(job: ProcessingJobPreview) {
  return job.lift_payload.order.ext_id;
}

function jobOrderCount(job: ProcessingJobPreview) {
  return job.lift_payload.lines.length;
}

function methodLastRun(method: ImportMethod) {
  return displayTimestamp(method.last_run_at);
}

function methodTargetLabel(method: ImportMethod) {
  return `Lift ERP · ${method.target_template}`;
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeGlobalView, setActiveGlobalView] = useState<GlobalView>("Customers");
  const [activeCustomerView, setActiveCustomerView] = useState<CustomerView>("Overview");
  const [sourceGrid, setSourceGrid] = useState<SourceGrid>(sampleSourceGrid);
  const [mappings, setMappings] = useState<FieldMapping[]>(() => buildDefaultMappings(sampleSourceGrid.columns));
  const [sourceName, setSourceName] = useState("Sample workbook");
  const [sheetName, setSheetName] = useState("Sample");
  const [importError, setImportError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<LiftCustomer[]>([fallbackCustomer]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(fallbackCustomer.lift_customer_id);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [customerDirectory, setCustomerDirectory] = useState<Omit<LiftCustomerDirectory, "customers">>({
    source: "local-seed",
    endpoint_url: "",
    loaded_at: "",
    warning: undefined
  });
  const [customerImportState, setCustomerImportState] = useState<"idle" | "loading">("idle");
  const [workspace, setWorkspace] = useState<PathfinderCustomerWorkspace | null>(null);
  const [targets, setTargets] = useState<TargetConfig[]>([]);
  const [globalJobs, setGlobalJobs] = useState<ProcessingJobPreview[]>([]);
  const [activeMethodId, setActiveMethodId] = useState("manual-xlsx");
  const [workspaceState, setWorkspaceState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [lastPreviewJob, setLastPreviewJob] = useState<ProcessingJobPreview | null>(null);

  async function loadCustomers(refresh = false) {
    setCustomerImportState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/lift/customers${refresh ? "?refresh=1" : ""}`);
      const directory = await readJsonResponse<LiftCustomerDirectory>(response);
      setCustomers(directory.customers);
      setCustomerDirectory({
        source: directory.source,
        endpoint_url: directory.endpoint_url,
        loaded_at: directory.loaded_at,
        warning: directory.warning
      });
      setSelectedCustomerId((current) => {
        if (directory.customers.some((customer) => customer.lift_customer_id === current)) {
          return current;
        }
        const momentara = directory.customers.find((customer) =>
          customer.customer_name.toLowerCase().includes("momentara")
        );
        return momentara?.lift_customer_id ?? directory.customers[0]?.lift_customer_id ?? fallbackCustomer.lift_customer_id;
      });
    } catch (error) {
      setCustomerDirectory((current) => ({
        ...current,
        warning: error instanceof Error ? error.message : "Customer import failed."
      }));
    } finally {
      setCustomerImportState("idle");
    }
  }

  async function loadWorkspace(liftCustomerId: string) {
    setWorkspaceState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${liftCustomerId}/workspace`);
      const loadedWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      setWorkspace(loadedWorkspace);
      setActiveMethodId(loadedWorkspace.import_methods[0]?.import_method_id ?? "manual-xlsx");
      setWorkspaceMessage(null);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Workspace load failed.");
      setWorkspaceState("error");
      return;
    }
    setWorkspaceState("idle");
  }

  async function loadTargetsAndJobs() {
    try {
      const [targetsResponse, jobsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/targets`),
        fetch(`${apiBaseUrl}/api/jobs`)
      ]);
      const targetsPayload = await readJsonResponse<{ targets: TargetConfig[] }>(targetsResponse);
      const jobsPayload = await readJsonResponse<{ jobs: ProcessingJobPreview[] }>(jobsResponse);
      setTargets(targetsPayload.targets);
      setGlobalJobs(jobsPayload.jobs);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target/job load failed.");
    }
  }

  async function saveImportMethod(method: ImportMethod, nextMappings = mappings) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/import-methods/${method.import_method_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...method, mappings: nextMappings })
        }
      );
      const nextWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      setWorkspace(nextWorkspace);
      setWorkspaceMessage("Import method saved.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Import method save failed.");
      setWorkspaceState("error");
    }
  }

  async function createPreviewJob() {
    const availableMethods = workspace?.import_methods.length ? workspace.import_methods : fallbackImportMethods;
    const method = availableMethods.find((candidate) => candidate.import_method_id === activeMethodId) ?? availableMethods[0];
    if (!method) {
      setWorkspaceMessage("Choose an import method before generating a preview job.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/jobs/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_method_id: method.import_method_id,
          source_file_name: sourceName,
          sheet_name: sheetName,
          source_grid: sourceGrid,
          mappings
        })
      });
      const payload = await readJsonResponse<{ job: ProcessingJobPreview; workspace: PathfinderCustomerWorkspace }>(response);
      setLastPreviewJob(payload.job);
      setWorkspace(payload.workspace);
      setWorkspaceMessage(
        payload.job.state === "Ready"
          ? "Preview job created and ready for Lift submit review."
          : "Preview job created with blocking validation failures."
      );
      await loadTargetsAndJobs();
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Preview job failed.");
      setWorkspaceState("error");
    }
  }

  async function saveTarget(target: TargetConfig) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/targets/${target.target_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target)
      });
      const savedTarget = await readJsonResponse<TargetConfig>(response);
      setTargets((current) => [savedTarget, ...current.filter((candidate) => candidate.target_id !== savedTarget.target_id)]);
      setWorkspace((current) => (current ? { ...current, primary_target: savedTarget } : current));
      setWorkspaceMessage("Target settings saved.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target save failed.");
      setWorkspaceState("error");
    }
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  useEffect(() => {
    void loadTargetsAndJobs();
  }, []);

  const selectedCustomer =
    customers.find((customer) => customer.lift_customer_id === selectedCustomerId) ?? fallbackCustomer;
  useEffect(() => {
    void loadWorkspace(selectedCustomer.lift_customer_id);
  }, [selectedCustomer.lift_customer_id]);

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) {
      return customers;
    }
    return customers.filter(
      (customer) =>
        customer.customer_name.toLowerCase().includes(query) ||
        customer.lift_customer_id.includes(query) ||
        (customer.customer_number ?? "").includes(query)
    );
  }, [customerSearch, customers]);
  const customerSelectOptions = useMemo(() => {
    if (filteredCustomers.some((customer) => customer.lift_customer_id === selectedCustomer.lift_customer_id)) {
      return filteredCustomers;
    }
    return [selectedCustomer, ...filteredCustomers];
  }, [filteredCustomers, selectedCustomer]);
  const visibleCustomerOptions = customerSelectOptions.slice(0, 8);
  const customerComboboxValue = isCustomerPickerOpen
    ? customerSearch
    : `${selectedCustomer.customer_name} · ${selectedCustomer.lift_customer_id}`;
  const importMethods = workspace?.import_methods.length ? workspace.import_methods : fallbackImportMethods;
  const activeImportMethod =
    importMethods.find((method) => method.import_method_id === activeMethodId) ?? importMethods[0];
  const customerJobs = workspace?.jobs ?? [];
  const overviewJobs = customerJobs.slice(0, 5);
  const allJobs = globalJobs.length ? globalJobs : customerJobs;
  const primaryTarget = workspace?.primary_target ?? targets[0];
  const targetRows = targets.length ? targets : primaryTarget ? [primaryTarget] : [];

  useEffect(() => {
    if (activeImportMethod?.mappings.length) {
      setMappings(activeImportMethod.mappings);
    }
  }, [activeImportMethod?.import_method_id, workspace?.updated_at]);

  const canonicalOrder = useMemo(
    () =>
      mapSourceRowsToCanonicalOrder(sourceGrid.rows, mappings, {
        customerId: `lift:${selectedCustomer.lift_customer_id}`,
        customerName: selectedCustomer.customer_name,
        destinationCustomerId: selectedCustomer.lift_customer_id,
        sourceSystem: sourceName === "Sample workbook" ? "Manual Upload" : "XLSX Upload",
        sourceCustomer: selectedCustomer.customer_name,
        sourceTemplate: sourceName,
        targetSystem: "Lift Standard Graphics"
      }),
    [mappings, selectedCustomer, sourceGrid.rows, sourceName]
  );

  const canonicalMessages = validateCanonicalOrder(canonicalOrder);
  const liftPayload = generateLiftPayload(canonicalOrder, {
    jobId: "job_preview",
    canonicalOrderId: "co_preview"
  });
  const liftMessages = validateLiftPayload(liftPayload);
  const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload, primaryTarget?.lift));
  const allMessages = [...canonicalMessages, ...liftMessages];
  const hasBlockingFailure = allMessages.some((message) => message.severity === "FAIL");
  const mappedColumnCount = sourceGrid.columns.filter((column) =>
    mappings.some((mapping) => mapping.sourceColumn === column)
  ).length;
  const customerOrderCount = customerJobs.reduce((total, job) => total + jobOrderCount(job), 0);
  const readyJobCount = customerJobs.filter((job) => !isFailureState(job.state)).length;
  const failedJobCount = customerJobs.filter((job) => isFailureState(job.state)).length;
  const validationRate = customerJobs.length ? Math.round((readyJobCount / customerJobs.length) * 1000) / 10 : 0;

  async function importWorkbook(file: File) {
    try {
      const parsed = parseWorkbookArrayBuffer(await file.arrayBuffer());
      setSourceGrid({ columns: parsed.columns, rows: parsed.rows });
      setMappings(buildDefaultMappings(parsed.columns));
      setSourceName(file.name);
      setSheetName(parsed.sheetName);
      setImportError(null);
      setActiveGlobalView("Customers");
      setActiveCustomerView("Manual Import");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Workbook import failed.");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) {
      void importWorkbook(file);
    }
    event.target.value = "";
  }

  function resetSample() {
    setSourceGrid(sampleSourceGrid);
    setMappings(buildDefaultMappings(sampleSourceGrid.columns));
    setSourceName("Sample workbook");
    setSheetName("Sample");
    setImportError(null);
  }

  function updateActiveMethodDraft(patch: Partial<ImportMethod>) {
    setWorkspace((current) => {
      if (!current || !activeImportMethod) {
        return current;
      }

      return {
        ...current,
        import_methods: current.import_methods.map((method) =>
          method.import_method_id === activeImportMethod.import_method_id ? { ...method, ...patch } : method
        )
      };
    });
  }

  function createDraftImportMethod() {
    if (!workspace) {
      setWorkspaceMessage("Workspace is still loading. Try again in a moment.");
      return;
    }

    const timestamp = new Date().toISOString();
    const method: ImportMethod = {
      import_method_id: `method-${Date.now()}`,
      name: "New Import Method",
      type: "Manual upload",
      source: "XLSX",
      status: "Draft",
      target_id: workspace.primary_target_id,
      target_template: workspace.primary_target.template,
      template_id: `template-${Date.now()}`,
      mappings: buildDefaultMappings(sourceGrid.columns),
      last_run_at: null,
      success_rate: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    setWorkspace({
      ...workspace,
      import_methods: [method, ...workspace.import_methods]
    });
    setActiveMethodId(method.import_method_id);
    setActiveCustomerView("Import Methods");
  }

  function updateTargetDraft(targetId: string, updater: (target: TargetConfig) => TargetConfig) {
    setTargets((current) => current.map((target) => (target.target_id === targetId ? updater(target) : target)));
    setWorkspace((current) =>
      current?.primary_target?.target_id === targetId
        ? { ...current, primary_target: updater(current.primary_target) }
        : current
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img src="/brand/vornan-wordmark.png" alt="Vornan" />
          <div className="product-lockup">
            <Send size={18} />
            <span>Pathfinder</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {globalNavItems.map((item) => (
            <button
              className={activeGlobalView === item.label ? "nav-item nav-item-active" : "nav-item"}
              key={item.label}
              onClick={() => setActiveGlobalView(item.label)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="sidebar-context" aria-label="Selected customer">
          <div className="sidebar-section-row">
            <div className="sidebar-section-title">Selected Customer</div>
            <button
              className="sidebar-icon-button"
              disabled={customerImportState === "loading"}
              onClick={() => void loadCustomers(true)}
              title="Refresh Lift customers"
            >
              <RefreshCw size={15} />
            </button>
          </div>
          <div className="customer-combobox">
            <label className="sidebar-field">
              <span>Customer</span>
              <div className="combobox-input-wrap">
                <Search size={16} />
                <input
                  value={customerComboboxValue}
                  onBlur={() => window.setTimeout(() => setIsCustomerPickerOpen(false), 120)}
                  onChange={(event) => {
                    setCustomerSearch(event.target.value);
                    setIsCustomerPickerOpen(true);
                  }}
                  onFocus={() => {
                    setCustomerSearch("");
                    setIsCustomerPickerOpen(true);
                  }}
                  placeholder="Search customers"
                />
              </div>
            </label>
            {isCustomerPickerOpen ? (
              <div className="customer-options" role="listbox">
                {visibleCustomerOptions.map((customer) => (
                  <button
                    className={
                      customer.lift_customer_id === selectedCustomer.lift_customer_id
                        ? "customer-option customer-option-active"
                        : "customer-option"
                    }
                    key={customer.lift_customer_id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedCustomerId(customer.lift_customer_id);
                      setCustomerSearch("");
                      setIsCustomerPickerOpen(false);
                      setActiveGlobalView("Customers");
                      setActiveCustomerView("Overview");
                    }}
                    role="option"
                    aria-selected={customer.lift_customer_id === selectedCustomer.lift_customer_id}
                  >
                    <strong>{customer.customer_name}</strong>
                    <span>{customer.lift_customer_id} · {customer.customer_number ?? "No number"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <nav className="customer-nav" aria-label="Customer workspace">
            {customerNavItems.map((item) => (
              <button
                className={activeCustomerView === item.label ? "customer-nav-item customer-nav-item-active" : "customer-nav-item"}
                key={item.label}
                onClick={() => {
                  setActiveGlobalView("Customers");
                  setActiveCustomerView(item.label);
                }}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </section>

        <div className="sidebar-status">
          <img src="/brand/scout.png" alt="" />
          <div>
            <strong>Faster forward.</strong>
            <span>Customer context controls import setup.</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        {activeGlobalView === "Customers" ? (
          <>
            <header className="topbar">
              <div className="title-block">
                <div className="headline-row">
                  <h1>{selectedCustomer.customer_name}</h1>
                  <span className="active-tag">Active</span>
                </div>
                <p className="meta-line">
                  Lift CustomerID: {selectedCustomer.lift_customer_id}
                  <span>•</span>
                  Customer Number: {selectedCustomer.customer_number ?? "Unassigned"}
                </p>
              </div>
              <div className="topbar-actions">
                <button className="environment-select">
                  <span>Environment</span>
                  <strong>{primaryTarget?.lift.active_environment ?? "QA1"}</strong>
                  <ChevronDown size={16} />
                </button>
                <button className="notification-button" aria-label="Notifications">
                  <Bell size={20} />
                  <span>2</span>
                </button>
                <button className="primary-button actions-button">
                  Actions
                  <ChevronDown size={16} />
                </button>
              </div>
            </header>

            {activeCustomerView === "Overview" ? (
              <>
                <section className="customer-overview">
                  <div className="panel customer-panel">
                    <PanelHeader icon={Users} title="Customer Details" detail={customerDirectory.source === "lift-endpoint" ? "Lift endpoint" : "Local seed"} />
                    <dl className="customer-detail-grid">
                      <DetailItem label="Customer Name" value={selectedCustomer.customer_name} />
                      <DetailItem label="Status" value={selectedCustomer.customer_status} />
                      <DetailItem label="CustomerID" value={selectedCustomer.lift_customer_id} />
                      <DetailItem label="Sales Rep" value={selectedCustomer.sales_rep} />
                      <DetailItem label="Customer Number" value={selectedCustomer.customer_number} />
                      <DetailItem label="Default Invoice Email" value={selectedCustomer.default_invoice_email_address} />
                    </dl>
                    {customerDirectory.warning ? <p className="import-warning">{customerDirectory.warning}</p> : null}
                    {workspaceMessage ? <p className={workspaceState === "error" ? "import-error" : "import-warning"}>{workspaceMessage}</p> : null}
                  </div>

                  <div className="panel target-summary-panel">
                    <PanelHeader icon={Database} title="Primary Target" detail="Output template" />
                    <div className="primary-target-body">
                      <div className="target-identity">
                        <div className="target-logo">LIFT</div>
                        <div>
                          <strong>{primaryTarget?.name ?? "Lift ERP"}</strong>
                          <span>{primaryTarget?.template ?? "Lift Standard Graphics Order"}</span>
                        </div>
                        <span className="target-env">{primaryTarget?.lift.active_environment ?? "QA1"}</span>
                      </div>
                      <dl className="target-summary">
                        <DetailItem label="Endpoint" value={submitRequest.endpoint_url} />
                        <DetailItem label="Company ID" value={submitRequest.headers.Company} />
                        <DetailItem label="Auth" value="Header (User / Password)" />
                      </dl>
                    </div>
                  </div>
                </section>

                <section className="metric-strip" aria-label="Customer KPIs">
                  {[
                    { value: String(customerOrderCount), label: "Previewed Orders", trend: customerJobs.length ? "Persisted locally" : "No jobs yet", intent: "good", icon: FileText },
                    { value: `${validationRate}%`, label: "Validation Pass Rate", trend: `Ready previews: ${readyJobCount}`, intent: "good", icon: Check },
                    { value: String(readyJobCount), label: "Ready For Submit", trend: "QA1 submit gated", intent: "good", icon: Send },
                    { value: workspaceState === "loading" ? "Syncing" : "Local", label: "Workspace State", trend: workspace?.updated_at ? displayTimestamp(workspace.updated_at) : "Seeded defaults", intent: "good", icon: Clock3 },
                    { value: String(failedJobCount), label: "Failed Previews", trend: failedJobCount ? "Needs mapping review" : "No blocking failures", intent: failedJobCount ? "bad" : "good", icon: AlertTriangle }
                  ].map(({ value, label, trend, intent, icon: Icon }) => (
                    <div className="metric-card" key={label}>
                      <div className="metric-icon">
                        <Icon size={20} />
                      </div>
                      <div>
                        <strong>{value}</strong>
                        <span>{label}</span>
                        <small className={intent === "bad" ? "trend-bad" : "trend-good"}>{trend}</small>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="overview-grid overview-grid-two">
                  <div className="panel method-panel">
                    <div className="table-panel-header">
                      <PanelHeader icon={Workflow} title="Active Import Methods" detail="" />
                      <button className="primary-button table-header-action" onClick={createDraftImportMethod}>
                        <Plus size={15} />
                        New Import Method
                      </button>
                    </div>
                    <table className="methods-table">
                      <thead>
                        <tr>
                          <th>Method Name</th>
                          <th>Type</th>
                          <th>Source</th>
                          <th>Status</th>
                          <th>Last Run</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importMethods.map((method) => (
                          <tr key={method.import_method_id} onClick={() => setActiveCustomerView("Import Methods")}>
                            <td>{method.name}</td>
                            <td>{method.type}</td>
                            <td>{method.source}</td>
                            <td>
                              <span className={method.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                                {method.status}
                              </span>
                            </td>
                            <td>{methodLastRun(method)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button className="table-footer-link" onClick={() => setActiveCustomerView("Import Methods")}>
                      View all import methods
                      <ArrowGlyph />
                    </button>
                  </div>

                  <div className="panel jobs-panel">
                    <PanelHeader icon={Archive} title="Recent Processing Jobs" detail="View all jobs →" />
                    <table>
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th>Method</th>
                          <th>Status</th>
                          <th>Orders</th>
                          <th>Started</th>
                          <th>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewJobs.map((job) => (
                          <tr key={job.job_id}>
                            <td>{displayJobId(job.job_id)}</td>
                            <td>{job.import_method_name}</td>
                            <td>
                              <StatePill state={job.state} />
                            </td>
                            <td>{jobOrderCount(job)}</td>
                            <td>{displayTimestamp(job.created_at)}</td>
                            <td>Preview</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {overviewJobs.length === 0 ? <p className="empty-state">No persisted preview jobs yet.</p> : null}
                    <div className="jobs-summary-footer">
                      <div>
                        <span>Total Jobs</span>
                        <strong>{customerJobs.length}</strong>
                      </div>
                      <div>
                        <span>Success Rate</span>
                        <strong>{validationRate}%</strong>
                      </div>
                      <svg viewBox="0 0 180 36" role="img" aria-label="Success trend">
                        <polyline
                          points="0,24 12,23 24,24 36,22 48,23 60,21 72,22 84,20 96,18 108,20 120,15 132,12 144,14 156,10 168,12 180,8"
                        />
                      </svg>
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {activeCustomerView === "Import Methods" ? (
              <>
                <section className="panel method-panel">
                  <div className="table-panel-header">
                    <PanelHeader icon={Workflow} title="Import Methods" detail="Source intake definitions" />
                    <button className="primary-button table-header-action" onClick={createDraftImportMethod}>
                      <Plus size={15} />
                      New Import Method
                    </button>
                  </div>
                  <div className="method-table">
                    {importMethods.map((method) => (
                      <button
                        className={activeMethodId === method.import_method_id ? "method-row method-row-active" : "method-row"}
                        key={method.import_method_id}
                        onClick={() => setActiveMethodId(method.import_method_id)}
                      >
                        <div>
                          <strong>{method.name}</strong>
                          <span>{method.type}</span>
                        </div>
                        <span>{methodTargetLabel(method)}</span>
                        <StatePill state={method.status === "Active" ? "Ready" : "Waiting"} />
                        <span>{methodLastRun(method)}</span>
                      </button>
                    ))}
                  </div>
                </section>
                {activeImportMethod ? (
                  <section className="panel setup-panel">
                    <PanelHeader icon={SlidersHorizontal} title="Method Setup" detail={activeImportMethod.import_method_id} />
                    <div className="setup-grid">
                      <label className="setup-control">
                        <span>Name</span>
                        <input
                          value={activeImportMethod.name}
                          onChange={(event) => updateActiveMethodDraft({ name: event.target.value })}
                        />
                      </label>
                      <label className="setup-control">
                        <span>Type</span>
                        <select
                          value={activeImportMethod.type}
                          onChange={(event) => updateActiveMethodDraft({ type: event.target.value as ImportMethod["type"] })}
                        >
                          <option>Manual upload</option>
                          <option>API import</option>
                          <option>Manual paste</option>
                          <option>Scheduled</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Source</span>
                        <select
                          value={activeImportMethod.source}
                          onChange={(event) => updateActiveMethodDraft({ source: event.target.value as ImportMethod["source"] })}
                        >
                          <option>XLSX</option>
                          <option>REST API</option>
                          <option>Clipboard</option>
                          <option>SFTP</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Status</span>
                        <select
                          value={activeImportMethod.status}
                          onChange={(event) => updateActiveMethodDraft({ status: event.target.value as ImportMethodStatus })}
                        >
                          <option>Active</option>
                          <option>Draft</option>
                          <option>Paused</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Output Template</span>
                        <input
                          value={activeImportMethod.target_template}
                          onChange={(event) => updateActiveMethodDraft({ target_template: event.target.value })}
                        />
                      </label>
                      <div className="setup-actions">
                        <button className="secondary-button" onClick={() => setActiveCustomerView("Manual Import")}>
                          Open Manual Import
                        </button>
                        <button className="primary-button" onClick={() => void saveImportMethod(activeImportMethod)}>
                          Save Method
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}
                <section className="panel mapping-panel">
                  <PanelHeader icon={Map} title="Field Mapping" detail="Manual XLSX to canonical order" />
                  <div className="mapping-grid">
                    {sourceGrid.columns.map((column) => {
                      const selected = mappings.find((mapping) => mapping.sourceColumn === column)?.targetField ?? "";
                      return (
                        <label className="mapping-control" key={column}>
                          <span>{column}</span>
                          <select
                            value={selected}
                            onChange={(event) => setMappings((current) => updateMapping(current, column, event.target.value))}
                          >
                            <option value="">Ignore</option>
                            {canonicalTargetFields.map((field) => (
                              <option key={field} value={field}>
                                {field}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <div className="panel-action-footer">
                    <span>{mappedColumnCount} of {sourceGrid.columns.length} source columns mapped</span>
                    {activeImportMethod ? (
                      <button className="primary-button" onClick={() => void saveImportMethod(activeImportMethod)}>
                        Save Field Mapping
                      </button>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}

            {activeCustomerView === "Manual Import" ? (
              <>
                <section className="overview-grid">
                  <div className="panel upload-panel">
                    <PanelHeader icon={FileSpreadsheet} title="Manual XLSX Import" detail={sheetName} />
                    <label
                      className="drop-zone"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const [file] = Array.from(event.dataTransfer.files);
                        if (file) {
                          void importWorkbook(file);
                        }
                      }}
                    >
                      <Upload size={30} />
                      <div>
                        <strong>{sourceName}</strong>
                        <span>Drop an order workbook here or browse for XLSX, XLS, or CSV files.</span>
                      </div>
                      <input
                        ref={fileInputRef}
                        className="file-input"
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileChange}
                      />
                    </label>
                    {importError ? <p className="import-error">{importError}</p> : null}
                    <div className="action-row">
                      <button className="primary-button" onClick={() => fileInputRef.current?.click()}>
                        Upload XLSX
                      </button>
                      <button className="secondary-button" onClick={resetSample}>
                        Use Sample
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => activeImportMethod ? void saveImportMethod(activeImportMethod, mappings) : undefined}
                        disabled={!activeImportMethod}
                      >
                        Save Mapping
                      </button>
                      <button className="primary-button" onClick={() => void createPreviewJob()} disabled={workspaceState === "saving"}>
                        {workspaceState === "saving" ? "Saving Preview" : "Generate Preview Job"}
                      </button>
                    </div>
                  </div>

                  <div className="panel validation-panel">
                    <PanelHeader icon={Activity} title="Validation" detail="Canonical + Lift checks" />
                    <div className="validation-list">
                      {allMessages.map((message) => (
                        <div className="validation-row" key={`${message.code}-${message.field}`}>
                          <span className={message.severity === "PASS" ? "dot dot-success" : "dot dot-danger"} />
                          <div>
                            <strong>{message.code}</strong>
                            <span>{message.message}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="panel request-panel">
                    <PanelHeader icon={Database} title="Lift Target" detail="QA1 submit request" />
                    <dl>
                      <DetailItem label="Ext_ID" value={submitRequest.headers.Ext_ID} />
                      <DetailItem label="Company" value={submitRequest.headers.Company} />
                      <DetailItem label="Lift CustomerID" value={liftPayload.customer.lift_customer_id} />
                      <DetailItem label="Endpoint" value={submitRequest.endpoint_url} />
                    </dl>
                    <div className="request-actions">
                      <button className="secondary-button" disabled>
                        Submit to Lift gated
                      </button>
                      <span>{lastPreviewJob ? `${displayJobId(lastPreviewJob.job_id)} saved as ${lastPreviewJob.state}` : "Generate a preview job before QA1 submission."}</span>
                    </div>
                  </div>
                </section>

                <section className="panel mapping-panel">
                  <PanelHeader icon={Map} title="Field Mapping" detail={`${mappedColumnCount} columns mapped`} />
                  <div className="mapping-grid">
                    {sourceGrid.columns.map((column) => {
                      const selected = mappings.find((mapping) => mapping.sourceColumn === column)?.targetField ?? "";
                      return (
                        <label className="mapping-control" key={column}>
                          <span>{column}</span>
                          <select
                            value={selected}
                            onChange={(event) => setMappings((current) => updateMapping(current, column, event.target.value))}
                          >
                            <option value="">Ignore</option>
                            {canonicalTargetFields.map((field) => (
                              <option key={field} value={field}>
                                {field}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <div className="panel-action-footer">
                    <span>{hasBlockingFailure ? "Blocking validation failures present" : "Current mapping passes preview validation"}</span>
                    <button className="primary-button" onClick={() => void createPreviewJob()} disabled={workspaceState === "saving"}>
                      Persist Preview Job
                    </button>
                  </div>
                </section>

                <section className="workbench">
                  <div className="panel code-panel source-panel">
                    <PanelHeader icon={FileSpreadsheet} title="Source Grid" detail="Imported rows" />
                    <div className="source-grid">
                      {sourceGrid.columns.length ? (
                        <table>
                          <thead>
                            <tr>
                              {sourceGrid.columns.map((column) => (
                                <th key={column}>{column}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sourceGrid.rows.map((row, index) => (
                              <tr key={index}>
                                {sourceGrid.columns.map((column) => (
                                  <td key={column}>{row[column]}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="empty-state">No rows imported.</p>
                      )}
                    </div>
                  </div>

                  <div className="panel code-panel">
                    <PanelHeader icon={Braces} title="Canonical Order" detail="Platform contract" />
                    <pre>{formatJson(canonicalOrder)}</pre>
                  </div>

                  <div className="panel code-panel">
                    <PanelHeader icon={Braces} title="Lift Payload" detail="Body + headers" />
                    <pre>{formatJson({ headers: submitRequest.headers, body: liftPayload })}</pre>
                  </div>
                </section>
              </>
            ) : null}

            {activeCustomerView === "Jobs" ? (
              <section className="panel jobs-panel">
                <PanelHeader icon={Archive} title="Customer Jobs" detail={selectedCustomer.customer_name} />
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Source</th>
                      <th>Ext ID</th>
                      <th>State</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerJobs.map((job) => (
                      <tr key={job.job_id}>
                        <td>{displayJobId(job.job_id)}</td>
                        <td>{job.import_method_name}</td>
                        <td>{jobExtId(job)}</td>
                        <td>
                          <StatePill state={job.state} />
                        </td>
                        <td>{displayTimestamp(job.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {customerJobs.length === 0 ? <p className="empty-state">No persisted jobs for this customer yet.</p> : null}
              </section>
            ) : null}

            {activeCustomerView === "Settings" ? (
              <section className="customer-overview">
                <div className="panel customer-panel">
                  <PanelHeader icon={Settings} title="Customer Settings" detail="Defaults" />
                  <dl className="customer-details">
                    <DetailItem label="Lift CustomerID" value={selectedCustomer.lift_customer_id} />
                    <DetailItem label="Default target" value="Lift ERP" />
                    <DetailItem label="Default template" value="Standard Graphics Order" />
                    <DetailItem label="Manual import" value="Enabled" />
                    <DetailItem label="Automation" value="Draft" />
                  </dl>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {activeGlobalView === "Dashboard" ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Pathfinder Dashboard</p>
                <h1>Order translation health across all customers.</h1>
              </div>
            </header>
            <section className="status-strip">
              {[
                ["Customers", `${customers.length} imported`],
                ["Targets", "1 active"],
                ["Jobs Today", `${allJobs.length} previewed`],
                ["Failures", `${allJobs.filter((job) => isFailureState(job.state)).length} needs review`]
              ].map(([label, detail]) => (
                <div className="status-step" key={label}>
                  <CheckCircle2 size={18} />
                  <div>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </div>
                </div>
              ))}
            </section>
            <section className="panel jobs-panel">
              <PanelHeader icon={ClipboardList} title="Recent Processing Jobs" detail="All customers" />
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Customer</th>
                    <th>Source</th>
                    <th>Ext ID</th>
                    <th>State</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {allJobs.map((job) => (
                    <tr key={job.job_id}>
                      <td>{displayJobId(job.job_id)}</td>
                      <td>{job.customer_name}</td>
                      <td>{job.import_method_name}</td>
                      <td>{jobExtId(job)}</td>
                      <td>
                        <StatePill state={job.state} />
                      </td>
                      <td>{displayTimestamp(job.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allJobs.length === 0 ? <p className="empty-state">No persisted jobs yet. Generate a preview job from Manual Import.</p> : null}
            </section>
          </>
        ) : null}

        {activeGlobalView === "Targets" ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Targets</p>
                <h1>Destination platforms and reusable output templates.</h1>
              </div>
              {primaryTarget ? (
                <button className="primary-button" onClick={() => void saveTarget(primaryTarget)} disabled={workspaceState === "saving"}>
                  {workspaceState === "saving" ? "Saving" : "Save Target"}
                </button>
              ) : null}
            </header>
            <section className="panel jobs-panel">
              <PanelHeader icon={Database} title="Target Templates" detail="Global output definitions" />
              <table>
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Template</th>
                    <th>Environment</th>
                    <th>Format</th>
                    <th>Headers</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {targetRows.map((target) => (
                    <tr key={target.target_id}>
                      <td>{target.name}</td>
                      <td>{target.template}</td>
                      <td>{target.lift.active_environment}</td>
                      <td>{target.format}</td>
                      <td>Content-Type, Ext_ID, User, Password, Company</td>
                      <td>
                        <StatePill state={target.status === "Ready" ? "Ready" : "Validated"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {primaryTarget ? (
              <section className="panel setup-panel">
                <PanelHeader icon={SlidersHorizontal} title="Lift Target Settings" detail="Preview configuration" />
                <div className="setup-grid target-settings-grid">
                  <label className="setup-control">
                    <span>Active Environment</span>
                    <select
                      value={primaryTarget.lift.active_environment}
                      onChange={(event) =>
                        updateTargetDraft(primaryTarget.target_id, (target) => ({
                          ...target,
                          lift: { ...target.lift, active_environment: event.target.value as "QA1" | "PROD" }
                        }))
                      }
                    >
                      <option>QA1</option>
                      <option>PROD</option>
                    </select>
                  </label>
                  <label className="setup-control">
                    <span>Company ID</span>
                    <input
                      value={primaryTarget.lift.headers.Company}
                      onChange={(event) =>
                        updateTargetDraft(primaryTarget.target_id, (target) => ({
                          ...target,
                          lift: {
                            ...target.lift,
                            headers: { ...target.lift.headers, Company: event.target.value }
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="setup-control">
                    <span>Import User</span>
                    <input
                      value={primaryTarget.lift.credentials.User}
                      onChange={(event) =>
                        updateTargetDraft(primaryTarget.target_id, (target) => ({
                          ...target,
                          lift: {
                            ...target.lift,
                            credentials: { ...target.lift.credentials, User: event.target.value }
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="setup-control">
                    <span>Password Secret</span>
                    <input
                      value={primaryTarget.lift.credentials.Password}
                      onChange={(event) =>
                        updateTargetDraft(primaryTarget.target_id, (target) => ({
                          ...target,
                          lift: {
                            ...target.lift,
                            credentials: { ...target.lift.credentials, Password: event.target.value }
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="setup-control setup-control-wide">
                    <span>QA1 Endpoint</span>
                    <input
                      value={primaryTarget.lift.environments.QA1.endpoint_url}
                      onChange={(event) =>
                        updateTargetDraft(primaryTarget.target_id, (target) => ({
                          ...target,
                          lift: {
                            ...target.lift,
                            environments: {
                              ...target.lift.environments,
                              QA1: { endpoint_url: event.target.value }
                            }
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="setup-control setup-control-wide">
                    <span>PROD Endpoint</span>
                    <input
                      value={primaryTarget.lift.environments.PROD.endpoint_url}
                      onChange={(event) =>
                        updateTargetDraft(primaryTarget.target_id, (target) => ({
                          ...target,
                          lift: {
                            ...target.lift,
                            environments: {
                              ...target.lift.environments,
                              PROD: { endpoint_url: event.target.value }
                            }
                          }
                        }))
                      }
                    />
                  </label>
                  <label className="setup-control setup-control-wide">
                    <span>Ext_ID Strategy</span>
                    <input value="Header Ext_ID must match body order.ext_id" readOnly />
                  </label>
                  <div className="setup-actions">
                    <button className="primary-button" onClick={() => void saveTarget(primaryTarget)} disabled={workspaceState === "saving"}>
                      Save Target Settings
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {activeGlobalView === "Jobs" ? (
          <section className="panel jobs-panel">
            <PanelHeader icon={Archive} title="Processing Jobs" detail="Global history" />
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Source</th>
                  <th>Ext ID</th>
                  <th>State</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {allJobs.map((job) => (
                  <tr key={job.job_id}>
                    <td>{displayJobId(job.job_id)}</td>
                    <td>{job.customer_name}</td>
                    <td>{job.import_method_name}</td>
                    <td>{jobExtId(job)}</td>
                    <td>
                      <StatePill state={job.state} />
                    </td>
                    <td>{displayTimestamp(job.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allJobs.length === 0 ? <p className="empty-state">No persisted jobs yet.</p> : null}
          </section>
        ) : null}

        {activeGlobalView === "Audit" || activeGlobalView === "Settings" ? (
          <section className="panel customer-panel">
            <PanelHeader
              icon={activeGlobalView === "Audit" ? History : Settings}
              title={activeGlobalView}
              detail="Platform administration"
            />
            <dl className="customer-details">
              <DetailItem label="Scope" value="Global" />
              <DetailItem label="Status" value="Ready for next build pass" />
              <DetailItem label="Customer context" value={selectedCustomer.customer_name} />
            </dl>
          </section>
        ) : null}
      </section>
    </main>
  );
}

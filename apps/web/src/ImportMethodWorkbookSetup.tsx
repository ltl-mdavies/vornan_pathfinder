import React from "react";

type WorkbookRole = "order_lines" | "shipping_attachment" | "reference_catalog" | "ignore";
type WorkbookLineKind = "print" | "hardware" | "custom";

export interface WorkbookSetupSection {
  section_id: string;
  label: string;
  line_kind: WorkbookLineKind;
  columns: string[];
  header_row: number;
  header_row_count: 1 | 2;
  quantity_column: string | null;
  missing_quantity_behavior: "reference" | "block";
  order_row_count: number;
  reference_row_count: number;
  incomplete_row_count: number;
}

export interface WorkbookSetupSheet {
  sheet_name: string;
  role?: WorkbookRole;
  columns: string[];
  order_row_count: number;
  reference_row_count: number;
  incomplete_row_count?: number;
  sections?: WorkbookSetupSection[];
}

export interface WorkbookSetupSectionConfig {
  section_id: string;
  label: string;
  line_kind: WorkbookLineKind;
  header_row: number | null;
  header_row_count: 1 | 2;
  header_signature: string[];
  quantity_column: string | null;
  missing_quantity_behavior: "reference" | "block";
  required: boolean;
}

export interface WorkbookSetupSheetConfig {
  role: WorkbookRole;
  enabled: boolean;
  sections: WorkbookSetupSectionConfig[];
}

interface ImportMethodWorkbookSetupProps {
  sheets: WorkbookSetupSheet[];
  structure: Record<string, WorkbookSetupSheetConfig>;
  selectedSheetName: string;
  onSelectSheet: (sheetName: string) => void;
  onChangeSheet: (sheetName: string, config: WorkbookSetupSheetConfig) => void;
}

const roleLabels: Record<WorkbookRole, string> = {
  order_lines: "Order lines",
  shipping_attachment: "Shipping attachment",
  reference_catalog: "Reference / catalog",
  ignore: "Ignore"
};

function configForSheet(
  sheet: WorkbookSetupSheet,
  configured: WorkbookSetupSheetConfig | undefined
): WorkbookSetupSheetConfig {
  if (configured) {
    return configured;
  }
  return {
    role: sheet.role ?? "order_lines",
    enabled: (sheet.role ?? "order_lines") !== "ignore",
    sections: (sheet.sections ?? []).map((section, index) => ({
      section_id: section.section_id,
      label: section.label,
      line_kind: section.line_kind,
      header_row: section.header_row,
      header_row_count: section.header_row_count,
      header_signature: section.columns,
      quantity_column: section.quantity_column,
      missing_quantity_behavior: section.missing_quantity_behavior,
      required: index === 0
    }))
  };
}

export function ImportMethodWorkbookSetup({
  sheets,
  structure,
  selectedSheetName,
  onSelectSheet,
  onChangeSheet
}: ImportMethodWorkbookSetupProps) {
  const selectedSheet = sheets.find((sheet) => sheet.sheet_name === selectedSheetName) ?? sheets[0];
  if (!selectedSheet) {
    return null;
  }
  const selectedConfig = configForSheet(selectedSheet, structure[selectedSheet.sheet_name]);
  const detectedSections = selectedSheet.sections ?? [];

  function updateSection(sectionId: string, patch: Partial<WorkbookSetupSectionConfig>) {
    onChangeSheet(selectedSheet.sheet_name, {
      ...selectedConfig,
      sections: selectedConfig.sections.map((section) =>
        section.section_id === sectionId ? { ...section, ...patch } : section
      )
    });
  }

  function addSection() {
    let ordinal = selectedConfig.sections.length + 1;
    let sectionId = `section-${ordinal}`;
    while (selectedConfig.sections.some((section) => section.section_id === sectionId)) {
      ordinal += 1;
      sectionId = `section-${ordinal}`;
    }
    onChangeSheet(selectedSheet.sheet_name, {
      ...selectedConfig,
      sections: [
        ...selectedConfig.sections,
        {
          section_id: sectionId,
          label: `Section ${ordinal}`,
          line_kind: "custom",
          header_row: null,
          header_row_count: 1,
          header_signature: selectedSheet.columns,
          quantity_column: null,
          missing_quantity_behavior: "block",
          required: false
        }
      ]
    });
  }

  function removeSection(sectionId: string) {
    onChangeSheet(selectedSheet.sheet_name, {
      ...selectedConfig,
      sections: selectedConfig.sections.filter((section) => section.section_id !== sectionId)
    });
  }

  return (
    <section className="source-sheet-override-panel workbook-structure-panel" aria-label="Workbook structure">
      <div className="source-sheet-override-heading">
        <div>
          <strong>Workbook Structure</strong>
          <span>
            Assign every sheet a role, then configure each detected order section. These settings are saved with this
            Input Method.
          </span>
        </div>
        <span>{sheets.length} sheets</span>
      </div>

      <div className="workbook-structure-layout">
        <div className="workbook-sheet-nav" role="list" aria-label="Workbook sheets">
          {sheets.map((sheet) => {
            const config = configForSheet(sheet, structure[sheet.sheet_name]);
            const isSelected = sheet.sheet_name === selectedSheet.sheet_name;
            const issueCount = sheet.incomplete_row_count ?? 0;
            return (
              <button
                key={sheet.sheet_name}
                type="button"
                className={isSelected ? "workbook-sheet-button workbook-sheet-button-active" : "workbook-sheet-button"}
                onClick={() => onSelectSheet(sheet.sheet_name)}
              >
                <span>
                  <strong>{sheet.sheet_name}</strong>
                  <small>{roleLabels[config.role]}</small>
                </span>
                <span className={issueCount ? "mini-pill mini-pill-danger" : "mini-pill mini-pill-neutral"}>
                  {issueCount ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : `${sheet.order_row_count} lines`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="workbook-sheet-editor">
          <div className="setup-grid workbook-role-grid">
            <label className="setup-control">
              <span>Sheet Role</span>
              <select
                value={selectedConfig.role}
                onChange={(event) => {
                  const role = event.target.value as WorkbookRole;
                  onChangeSheet(selectedSheet.sheet_name, {
                    ...selectedConfig,
                    role,
                    enabled: role !== "ignore"
                  });
                }}
              >
                <option value="order_lines">Order lines</option>
                <option value="reference_catalog">Reference / catalog</option>
                <option value="shipping_attachment">Shipping attachment (separate intake)</option>
                <option value="ignore">Ignore sheet</option>
              </select>
            </label>
            <div className="workbook-sheet-metrics" aria-label={`${selectedSheet.sheet_name} detection summary`}>
              <span>{selectedSheet.order_row_count} order rows</span>
              <span>{selectedSheet.reference_row_count} reference rows</span>
              <span>{detectedSections.length} section{detectedSections.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          {selectedConfig.role === "shipping_attachment" ? (
            <div className="source-setup-callout">
              <strong>Shipping stays a separate, default-inactive Wrike intake.</strong>
              <p>
                Pathfinder will not parse this sheet into order lines. Capture, Lift attachment transport, and activation
                remain disabled until the shipping contract is defined.
              </p>
            </div>
          ) : selectedConfig.role === "order_lines" ? (
            <div className="workbook-section-list">
              <div className="workbook-section-toolbar">
                <span>
                  Pathfinder finds each section by its saved column headers. The detected row is a setup hint and may
                  move in future workbooks.
                </span>
                <button className="secondary-button table-inline-button" type="button" onClick={addSection}>
                  Add another section
                </button>
              </div>
              {selectedConfig.sections.map((section, index) => {
                const detected = detectedSections.find((candidate) => candidate.section_id === section.section_id);
                const columns = detected?.columns ?? section.header_signature;
                return (
                  <article className="workbook-section-card" key={section.section_id}>
                    <div className="workbook-section-heading">
                      <div>
                        <span>Section {index + 1}</span>
                        <strong>{section.label}</strong>
                      </div>
                      <span
                        className={
                          (detected?.incomplete_row_count ?? 0) > 0
                            ? "mini-pill mini-pill-danger"
                            : "mini-pill mini-pill-success"
                        }
                      >
                        {(detected?.incomplete_row_count ?? 0) > 0
                          ? `${detected?.incomplete_row_count} quantity issue${detected?.incomplete_row_count === 1 ? "" : "s"}`
                          : "Ready to map"}
                      </span>
                      {selectedConfig.sections.length > 1 ? (
                        <button
                          className="secondary-button table-inline-button"
                          type="button"
                          onClick={() => removeSection(section.section_id)}
                        >
                          Remove section
                        </button>
                      ) : null}
                    </div>
                    <div className="setup-grid workbook-section-grid">
                      <label className="setup-control setup-control-wide">
                        <span>Section Label</span>
                        <input
                          value={section.label}
                          onChange={(event) => updateSection(section.section_id, { label: event.target.value })}
                        />
                      </label>
                      <label className="setup-control">
                        <span>Line Type</span>
                        <select
                          value={section.line_kind}
                          onChange={(event) =>
                            updateSection(section.section_id, {
                              line_kind: event.target.value as WorkbookLineKind
                            })
                          }
                        >
                          <option value="print">Print product</option>
                          <option value="hardware">Hardware product</option>
                          <option value="custom">Custom product</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Detected Row (starting hint)</span>
                        <input
                          type="number"
                          min={1}
                          value={section.header_row ?? ""}
                          onChange={(event) =>
                            updateSection(section.section_id, {
                              header_row: event.target.value ? Number.parseInt(event.target.value, 10) || 1 : null
                            })
                          }
                        />
                      </label>
                      <label className="setup-control">
                        <span>Header Span</span>
                        <select
                          value={section.header_row_count}
                          onChange={(event) =>
                            updateSection(section.section_id, {
                              header_row_count: event.target.value === "2" ? 2 : 1
                            })
                          }
                        >
                          <option value="1">One row</option>
                          <option value="2">Two grouped rows</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Quantity Column</span>
                        <select
                          value={section.quantity_column ?? ""}
                          onChange={(event) =>
                            updateSection(section.section_id, {
                              quantity_column: event.target.value || null
                            })
                          }
                        >
                          <option value="">Select quantity column</option>
                          {columns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Missing Quantity</span>
                        <select
                          value={section.missing_quantity_behavior}
                          onChange={(event) =>
                            updateSection(section.section_id, {
                              missing_quantity_behavior: event.target.value === "block" ? "block" : "reference"
                            })
                          }
                        >
                          <option value="reference">Keep as reference row</option>
                          <option value="block">Block preview until fixed</option>
                        </select>
                      </label>
                    </div>
                    <div className="workbook-column-signature">
                      <span>Detected columns</span>
                      <div>
                        {columns.map((column) => (
                          <span className="mini-pill mini-pill-neutral" key={column}>
                            {column}
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="source-setup-callout">
              <strong>
                {selectedConfig.role === "ignore"
                  ? "This sheet is intentionally excluded."
                  : "This sheet is available as reference/catalog data only."}
              </strong>
              <p>It will not create Lift order lines unless its role is changed to Order lines.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

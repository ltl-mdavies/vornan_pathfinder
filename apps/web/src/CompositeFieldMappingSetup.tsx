import React from "react";
import type { CanonicalFieldDefinition } from "@pathfinder/canonical";
import {
  resolveFieldMappingValue,
  type CompositeFieldMappingExpression,
  type FieldMapping
} from "@pathfinder/templates";

const sectionLabels: Record<string, string> = {
  customer: "Customer",
  contacts: "Contacts",
  source: "Source",
  target: "Target",
  order: "Order",
  shipping: "Order Shipping",
  lines: "Lines"
};

interface CompositeFieldMappingSetupProps {
  columns: string[];
  fields: CanonicalFieldDefinition[];
  mappings: FieldMapping[];
  sampleRow: Record<string, string | number | boolean | null>;
  scopeId?: string | null;
  scopeLabel: string;
  onChange: (mappings: FieldMapping[]) => void;
}

function defaultExpression(columns: string[]): CompositeFieldMappingExpression {
  return {
    kind: "composite",
    sourceColumns: columns.slice(0, Math.min(2, columns.length)),
    separator: " — ",
    prefix: "",
    suffix: "",
    skipEmpty: true,
    fallback: null,
    maxLength: 250
  };
}

function canonicalOptions(fields: CanonicalFieldDefinition[]) {
  const grouped = fields.reduce<Record<string, CanonicalFieldDefinition[]>>((result, field) => {
    result[field.section] = [...(result[field.section] ?? []), field];
    return result;
  }, {});
  return Object.entries(grouped).map(([section, sectionFields]) => (
    <optgroup key={section} label={sectionLabels[section] ?? section}>
      {sectionFields.map((field) => (
        <option key={field.field_id} value={field.path}>
          {field.label} · {field.path}
        </option>
      ))}
    </optgroup>
  ));
}

function mappingLabel(mapping: FieldMapping, index: number) {
  return mapping.targetField || `Derived field ${index + 1}`;
}

export function CompositeFieldMappingSetup({
  columns,
  fields,
  mappings,
  sampleRow,
  scopeId,
  scopeLabel,
  onChange
}: CompositeFieldMappingSetupProps) {
  const normalizedScopeId = scopeId || null;
  const compositeMappings = mappings
    .map((mapping, index) => ({ mapping, index }))
    .filter(
      ({ mapping }) =>
        (mapping.scopeId ?? null) === normalizedScopeId && mapping.valueExpression?.kind === "composite"
    );

  function addMapping() {
    const preferredTarget =
      fields.find((field) => field.path === "lines[].description")?.path ??
      fields.find((field) => !mappings.some((mapping) => mapping.targetField === field.path))?.path ??
      fields[0]?.path ??
      "";
    const next = mappings.filter(
      (mapping) =>
        !(
          (mapping.scopeId ?? null) === normalizedScopeId &&
          mapping.targetField === preferredTarget &&
          !mapping.ignored
        )
    );
    onChange([
      ...next,
      {
        sourceColumn: "",
        targetField: preferredTarget,
        ...(normalizedScopeId ? { scopeId: normalizedScopeId } : {}),
        valueExpression: defaultExpression(columns)
      }
    ]);
  }

  function replaceMapping(index: number, mapping: FieldMapping) {
    onChange(
      mappings.flatMap((candidate, candidateIndex) => {
        if (candidateIndex === index) {
          return [mapping];
        }
        return (candidate.scopeId ?? null) === normalizedScopeId &&
          candidate.targetField === mapping.targetField &&
          !candidate.ignored
          ? []
          : [candidate];
      })
    );
  }

  function removeMapping(index: number) {
    onChange(mappings.filter((_, candidateIndex) => candidateIndex !== index));
  }

  function updateExpression(
    index: number,
    mapping: FieldMapping,
    patch: Partial<CompositeFieldMappingExpression>
  ) {
    const expression = mapping.valueExpression;
    if (!expression || expression.kind !== "composite") {
      return;
    }
    replaceMapping(index, {
      ...mapping,
      valueExpression: {
        ...expression,
        ...patch
      }
    });
  }

  return (
    <div className="composite-mapping-setup">
      <div className="resolver-subsection-heading">
        <div>
          <h3>Derived Field Composites</h3>
          <span>
            Build one canonical value from ordered fields in {scopeLabel}. Empty components can be skipped safely.
          </span>
        </div>
        <button className="secondary-button" type="button" onClick={addMapping} disabled={!columns.length || !fields.length}>
          Add composite
        </button>
      </div>

      {compositeMappings.length ? (
        <div className="composite-mapping-list">
          {compositeMappings.map(({ mapping, index }, compositeIndex) => {
            const expression = mapping.valueExpression!;
            const resolution = resolveFieldMappingValue(sampleRow, mapping);
            return (
              <article className="composite-mapping-card" key={`${mapping.targetField}-${index}`}>
                <div className="composite-mapping-card-header">
                  <div>
                    <span>Derived canonical value</span>
                    <strong>{mappingLabel(mapping, compositeIndex)}</strong>
                  </div>
                  <button className="text-button danger-text" type="button" onClick={() => removeMapping(index)}>
                    Remove
                  </button>
                </div>

                <div className="setup-grid composite-mapping-grid">
                  <label className="setup-control">
                    <span>Canonical Target</span>
                    <select
                      value={mapping.targetField}
                      onChange={(event) => replaceMapping(index, { ...mapping, targetField: event.target.value })}
                    >
                      {canonicalOptions(fields)}
                    </select>
                  </label>
                  <label className="setup-control">
                    <span>Separator</span>
                    <input
                      value={expression.separator}
                      maxLength={24}
                      onChange={(event) => updateExpression(index, mapping, { separator: event.target.value })}
                    />
                  </label>
                  <label className="setup-control">
                    <span>Prefix</span>
                    <input
                      value={expression.prefix}
                      maxLength={120}
                      onChange={(event) => updateExpression(index, mapping, { prefix: event.target.value })}
                    />
                  </label>
                  <label className="setup-control">
                    <span>Suffix</span>
                    <input
                      value={expression.suffix}
                      maxLength={120}
                      onChange={(event) => updateExpression(index, mapping, { suffix: event.target.value })}
                    />
                  </label>
                  <label className="setup-control">
                    <span>Fallback when empty</span>
                    <input
                      value={expression.fallback ?? ""}
                      maxLength={500}
                      placeholder="Optional"
                      onChange={(event) =>
                        updateExpression(index, mapping, { fallback: event.target.value.trim() ? event.target.value : null })
                      }
                    />
                  </label>
                  <label className="setup-control">
                    <span>Maximum length</span>
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={expression.maxLength ?? ""}
                      placeholder="No limit"
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10);
                        updateExpression(index, mapping, {
                          maxLength: Number.isInteger(value) ? Math.max(1, Math.min(2000, value)) : null
                        });
                      }}
                    />
                  </label>
                </div>

                <div className="composite-component-list">
                  <div className="composite-component-heading">
                    <strong>Source fields in output order</strong>
                    <label>
                      <input
                        type="checkbox"
                        checked={expression.skipEmpty}
                        onChange={(event) => updateExpression(index, mapping, { skipEmpty: event.target.checked })}
                      />
                      Skip empty values
                    </label>
                  </div>
                  {expression.sourceColumns.map((column, componentIndex) => (
                    <div className="composite-component-row" key={`${componentIndex}-${column}`}>
                      <span>{componentIndex + 1}</span>
                      <select
                        aria-label={`Composite source field ${componentIndex + 1}`}
                        value={column}
                        onChange={(event) =>
                          updateExpression(index, mapping, {
                            sourceColumns: expression.sourceColumns.map((candidate, candidateIndex) =>
                              candidateIndex === componentIndex ? event.target.value : candidate
                            )
                          })
                        }
                      >
                        {columns.map((candidate) => (
                          <option
                            key={candidate}
                            value={candidate}
                            disabled={
                              candidate !== column &&
                              expression.sourceColumns.some(
                                (selected, selectedIndex) =>
                                  selectedIndex !== componentIndex && selected === candidate
                              )
                            }
                          >
                            {candidate}
                          </option>
                        ))}
                      </select>
                      <button
                        className="text-button"
                        type="button"
                        disabled={componentIndex === 0}
                        onClick={() => {
                          const sourceColumns = [...expression.sourceColumns];
                          [sourceColumns[componentIndex - 1], sourceColumns[componentIndex]] = [
                            sourceColumns[componentIndex],
                            sourceColumns[componentIndex - 1]
                          ];
                          updateExpression(index, mapping, { sourceColumns });
                        }}
                      >
                        Up
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        disabled={componentIndex === expression.sourceColumns.length - 1}
                        onClick={() => {
                          const sourceColumns = [...expression.sourceColumns];
                          [sourceColumns[componentIndex + 1], sourceColumns[componentIndex]] = [
                            sourceColumns[componentIndex],
                            sourceColumns[componentIndex + 1]
                          ];
                          updateExpression(index, mapping, { sourceColumns });
                        }}
                      >
                        Down
                      </button>
                      <button
                        className="text-button danger-text"
                        type="button"
                        disabled={expression.sourceColumns.length === 1}
                        onClick={() =>
                          updateExpression(index, mapping, {
                            sourceColumns: expression.sourceColumns.filter((_, candidateIndex) => candidateIndex !== componentIndex)
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    disabled={expression.sourceColumns.length >= Math.min(12, columns.length)}
                    onClick={() => {
                      const nextColumn = columns.find((column) => !expression.sourceColumns.includes(column));
                      if (nextColumn) {
                        updateExpression(index, mapping, {
                          sourceColumns: [...expression.sourceColumns, nextColumn]
                        });
                      }
                    }}
                  >
                    Add source field
                  </button>
                </div>

                <div
                  className={`composite-preview ${
                    resolution.status === "max_length_exceeded" ? "composite-preview-blocked" : ""
                  }`}
                >
                  <span>Live sample</span>
                  <strong>
                    {resolution.status === "max_length_exceeded"
                      ? "Exceeds the configured maximum"
                      : String(resolution.value ?? "No populated sample value")}
                  </strong>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-state compact-empty-state">
          No composite is configured for this section. Direct source-to-canonical mappings continue to work unchanged.
        </p>
      )}
    </div>
  );
}

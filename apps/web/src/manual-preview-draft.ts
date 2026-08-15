import type { FieldMapping } from "@pathfinder/templates";

export type ManualPreviewProductResolutionConfig = {
  strategy: "derived_key" | "composite_key" | "direct_lift_unit_number";
  mode: "map_to_lift_unit" | "send_derived_unit";
  source_column: string;
  prefix: string;
  suffix: string;
  composite_columns: string[];
  fallback_strategy: "none" | "composite_key";
  direct_unit_number_column?: string | null;
};

const identityTargets = new Set(["order.external_order_id", "order.contract_number"]);

export function manualPreviewProductConfig(
  savedConfig: ManualPreviewProductResolutionConfig,
  productKeyColumn: string
): ManualPreviewProductResolutionConfig {
  if (!productKeyColumn) return savedConfig;

  return {
    ...savedConfig,
    strategy: "derived_key",
    source_column: productKeyColumn,
    prefix: "",
    suffix: "",
    composite_columns: [],
    fallback_strategy: "none",
    direct_unit_number_column: null
  };
}

export function manualPreviewDerivedProductKey(
  value: unknown,
  config: Pick<ManualPreviewProductResolutionConfig, "prefix" | "suffix">
) {
  const sourceKey = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return sourceKey ? `${config.prefix}${sourceKey}${config.suffix}` : "";
}

export function manualPreviewMappings(
  savedMappings: FieldMapping[],
  identityColumn: string
): FieldMapping[] {
  if (!identityColumn) return savedMappings;

  const retainedMappings = savedMappings.filter(
    (mapping) => mapping.valueExpression || !identityTargets.has(mapping.targetField)
  );

  return [
    ...retainedMappings,
    {
      sourceColumn: identityColumn,
      targetField: "order.external_order_id",
      required: true
    },
    {
      sourceColumn: identityColumn,
      targetField: "order.contract_number"
    }
  ];
}

export function manualPreviewIdentityIsMapped(mappings: FieldMapping[]) {
  return [...identityTargets].every((targetField) =>
    mappings.some(
      (mapping) =>
        !mapping.ignored &&
        !mapping.valueExpression &&
        mapping.targetField === targetField &&
        Boolean(mapping.sourceColumn)
    )
  );
}

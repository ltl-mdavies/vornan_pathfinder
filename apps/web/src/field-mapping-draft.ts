import type { FieldMapping } from "@pathfinder/templates";

function normalizedScopeId(scopeId?: string | null) {
  return scopeId || null;
}

function directMappingForScope(
  mappings: FieldMapping[],
  sourceColumn: string,
  scopeId?: string | null
) {
  const scope = normalizedScopeId(scopeId);
  return mappings.find(
    (mapping) =>
      !mapping.valueExpression &&
      mapping.sourceColumn === sourceColumn &&
      (mapping.scopeId ?? null) === scope
  );
}

export function selectedDirectMappingTarget(
  mappings: FieldMapping[],
  sourceColumn: string,
  scopeId?: string | null
) {
  const scoped = directMappingForScope(mappings, sourceColumn, scopeId);
  if (scoped) {
    return scoped.ignored ? "" : scoped.targetField;
  }
  if (normalizedScopeId(scopeId)) {
    const global = directMappingForScope(mappings, sourceColumn, null);
    return global?.ignored ? "" : global?.targetField ?? "";
  }
  return "";
}

export function updateDirectMapping(
  mappings: FieldMapping[],
  sourceColumn: string,
  targetField: string,
  scopeId?: string | null
) {
  const scope = normalizedScopeId(scopeId);
  const currentTarget = selectedDirectMappingTarget(mappings, sourceColumn, scope);
  const nextMappings = mappings.filter(
    (mapping) =>
      !(
        (mapping.scopeId ?? null) === scope &&
        (
          (!mapping.valueExpression && mapping.sourceColumn === sourceColumn) ||
          (Boolean(targetField) && mapping.valueExpression?.kind === "composite" && mapping.targetField === targetField)
        )
      )
  );

  if (targetField) {
    return [
      ...nextMappings,
      {
        sourceColumn,
        targetField,
        ...(scope ? { scopeId: scope } : {})
      }
    ];
  }

  if (!currentTarget) {
    return nextMappings;
  }

  return [
    ...nextMappings,
    {
      sourceColumn,
      targetField: currentTarget,
      ...(scope ? { scopeId: scope } : {}),
      ignored: true
    }
  ];
}

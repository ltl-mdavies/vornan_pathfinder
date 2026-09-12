import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { checkCandidateEnvironment } from "./intake-environment-preflight.mjs";

class PreflightError extends Error {
  constructor(code) { super(`Intake offline preflight failed: ${code}`); }
}
const fail = code => { throw new PreflightError(code); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));
const parameterName = /^[A-Za-z][A-Za-z0-9]*$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const evidenceDigest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const unresolved = value => /\{\{resolve:|\$\{|\$\{Token\[|\bTOKEN\[/.test(value);

function definitions(template) {
  if (!record(template) || !record(template.Parameters) || !Object.keys(template.Parameters).length) fail("TEMPLATE_PARAMETERS_REQUIRED");
  if (own(template, "Transform")) fail("TEMPLATE_TRANSFORM_UNSUPPORTED");
  for (const [key, value] of Object.entries(template.Parameters)) {
    if (!parameterName.test(key) || !record(value) || !["String", "Number", "CommaDelimitedList", "List<Number>"].includes(value.Type) ||
      (own(value, "NoEcho") && typeof value.NoEcho !== "boolean")) fail("INVALID_PARAMETER_DEFINITION");
  }
  return template.Parameters;
}
function inventory(rows, definitions, current = false) {
  if (!Array.isArray(rows)) fail("PARAMETER_ARRAY_REQUIRED");
  const mapped = new Map();
  for (const row of rows) {
    if (!record(row) || typeof row.ParameterKey !== "string" || !own(definitions, row.ParameterKey)) fail("UNKNOWN_PARAMETER");
    if (mapped.has(row.ParameterKey)) fail("DUPLICATE_PARAMETER");
    if (current) {
      if (typeof row.ParameterValue !== "string" || Object.keys(row).some(key => !["ParameterKey", "ParameterValue", "ResolvedValue"].includes(key)) ||
        (own(row, "ResolvedValue") && typeof row.ResolvedValue !== "string")) fail("INVALID_CURRENT_PARAMETER");
    } else if (!(exactKeys(row, ["ParameterKey", "UsePreviousValue"]) && row.UsePreviousValue === true) &&
      !(exactKeys(row, ["ParameterKey", "ParameterValue"]) && typeof row.ParameterValue === "string")) fail("INVALID_PARAMETER_MANIFEST_ENTRY");
    mapped.set(row.ParameterKey, row);
  }
  if (mapped.size !== Object.keys(definitions).length) fail("INCOMPLETE_PARAMETER_INVENTORY");
  return mapped;
}
function environment(value) {
  if (!record(value) || Object.entries(value).some(([key, item]) => !/^[A-Za-z][A-Za-z0-9_]+$/.test(key) || typeof item !== "string")) fail("INVALID_ENVIRONMENT_MAP");
  if (Object.values(value).some(unresolved)) fail("UNRESOLVED_ENVIRONMENT_VALUE");
  try { return checkCandidateEnvironment(value); } catch { fail("ENVIRONMENT_LIMIT_EXCEEDED"); }
}

/** Validates supplied evidence only. Does not establish provenance, approve or perform deployment. */
export function validateIntakeDeploymentEvidence(bundle) {
  const fields = ["schema_version", "evidence_sha256", "deployed_template", "candidate_template", "current_parameters", "candidate_parameters", "rollback_parameters", "intended_parameter_changes", "current_environment", "candidate_environment", "rollback_environment", "intended_environment_changes"];
  if (!exactKeys(bundle, fields) || bundle.schema_version !== 1) fail("INVALID_EVIDENCE_SCHEMA");
  const documents = fields.filter(key => !["schema_version", "evidence_sha256"].includes(key));
  if (!exactKeys(bundle.evidence_sha256, documents)) fail("INCOMPLETE_EVIDENCE_DIGESTS");
  for (const key of documents) {
    const digest = bundle.evidence_sha256[key];
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || digest !== evidenceDigest(bundle[key])) fail("EVIDENCE_DIGEST_MISMATCH");
  }
  const oldDefs = definitions(bundle.deployed_template);
  const newDefs = definitions(bundle.candidate_template);
  for (const key of Object.keys(oldDefs)) {
    if (!own(newDefs, key)) fail("PARAMETER_REMOVAL_UNSUPPORTED");
    // Values can change only through explicit intent; parameter meaning cannot silently change.
    if (newDefs[key].Type !== oldDefs[key].Type || Boolean(newDefs[key].NoEcho) !== Boolean(oldDefs[key].NoEcho)) fail("PARAMETER_SEMANTICS_CHANGED");
  }
  const current = inventory(bundle.current_parameters, oldDefs, true);
  const candidate = inventory(bundle.candidate_parameters, newDefs);
  const rollback = inventory(bundle.rollback_parameters, oldDefs);
  for (const [key, row] of current) if (!oldDefs[key].NoEcho && unresolved(row.ParameterValue)) fail("UNRESOLVED_PARAMETER_VALUE");
  const intended = bundle.intended_parameter_changes;
  if (!record(intended)) fail("INVALID_PARAMETER_INTENT");
  for (const [key, value] of Object.entries(intended)) {
    if (!own(newDefs, key) || typeof value !== "string" || unresolved(value)) fail("INVALID_PARAMETER_INTENT");
    if (newDefs[key].NoEcho) fail("NOECHO_CHANGE_UNSUPPORTED");
    if (own(oldDefs, key) && current.get(key).ParameterValue === value) fail("REDUNDANT_PARAMETER_INTENT");
  }
  let preserved = 0;
  for (const [key, row] of candidate) {
    const existing = own(oldDefs, key);
    if (own(intended, key)) {
      if (row.ParameterValue !== intended[key] || own(row, "UsePreviousValue")) fail("PARAMETER_INTENT_MISMATCH");
    } else {
      if (!existing) fail("NEW_PARAMETER_REQUIRES_EXPLICIT_INTENT");
      if (row.UsePreviousValue !== true) fail("EXISTING_PARAMETER_MUST_USE_PREVIOUS");
      preserved++;
    }
    if (newDefs[key].NoEcho && row.UsePreviousValue !== true) fail("NOECHO_MUST_USE_PREVIOUS");
  }
  for (const [key, row] of rollback) {
    if (own(intended, key)) {
      const previous = current.get(key).ParameterValue;
      if (/^\*+$/.test(previous)) fail("ROLLBACK_VALUE_UNAVAILABLE");
      if (row.ParameterValue !== previous || own(row, "UsePreviousValue")) fail("ROLLBACK_MUST_RESTORE_ORIGINAL");
    } else if (row.UsePreviousValue !== true) fail("ROLLBACK_UNCHANGED_MUST_USE_PREVIOUS");
  }
  const currentEnv = environment(bundle.current_environment);
  const candidateEnv = environment(bundle.candidate_environment);
  const rollbackEnv = environment(bundle.rollback_environment);
  if (!record(bundle.intended_environment_changes)) fail("INVALID_ENVIRONMENT_INTENT");
  const expected = new Map(Object.entries(bundle.current_environment));
  for (const [key, value] of Object.entries(bundle.intended_environment_changes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]+$/.test(key) || (typeof value !== "string" && value !== null)) fail("INVALID_ENVIRONMENT_INTENT");
    if (value === null) {
      if (!expected.has(key)) fail("REDUNDANT_ENVIRONMENT_INTENT");
      expected.delete(key);
    } else {
      if (expected.get(key) === value) fail("REDUNDANT_ENVIRONMENT_INTENT");
      expected.set(key, value);
    }
  }
  const matches = (value, entries) => Object.keys(value).length === entries.size && [...entries].every(([key, item]) => own(value, key) && value[key] === item);
  if (!matches(bundle.candidate_environment, expected)) fail("ENVIRONMENT_INTENT_MISMATCH");
  if (!matches(bundle.rollback_environment, new Map(Object.entries(bundle.current_environment)))) fail("ROLLBACK_ENVIRONMENT_MUST_RESTORE_ORIGINAL");
  return {
    status: "supplied_evidence_checks_passed", deployment_authorized: false,
    parameters: { current_count: current.size, candidate_count: candidate.size, preserved_count: preserved, intended_change_count: Object.keys(intended).length, noecho_preserved_count: Object.values(oldDefs).filter(def => def.NoEcho).length },
    environment: { current: currentEnv, candidate: candidateEnv, rollback: rollbackEnv },
    remaining_checks: ["evidence_provenance_and_freshness", "cloudformation_validation_and_exact_change_set", "runtime_template_and_admin_build_compatibility", "resource_retention_and_rollback_review", "separate_deployment_and_activation_approval"]
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) fail("ONE_EVIDENCE_FILE_REQUIRED");
    let bundle;
    try {
      const source = readFileSync(process.argv[2], "utf8");
      bundle = JSON.parse(source);
      // JSON.parse silently accepts duplicate object keys; reject that ambiguity separately.
      const document = parseDocument(source);
      if (document.errors.length || document.warnings.length) fail("INVALID_EVIDENCE_FILE");
    } catch { fail("INVALID_EVIDENCE_FILE"); }
    console.log(JSON.stringify(validateIntakeDeploymentEvidence(bundle), null, 2));
  } catch (error) {
    console.error(error instanceof PreflightError ? error.message : "Intake offline preflight failed: INVALID_EVIDENCE");
    process.exitCode = 1;
  }
}

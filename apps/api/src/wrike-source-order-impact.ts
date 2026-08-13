import { createHash } from "node:crypto";
import type { LiftOrderPayload } from "@pathfinder/lift-adapter";

export type WrikeSourceOrderImpactReasonCode =
  | "lift_header_changed"
  | "lift_lines_changed"
  | "reference_proof_set_changed"
  | "workbook_content_changed"
  | "processing_only_changed"
  | "impact_unavailable";

export interface WrikeSourceOrderImpact {
  version: 1;
  fingerprint: string;
  header_sha256: string;
  lines_sha256: string;
  workbook_sha256: string;
  reference_proof_set_sha256: string;
  document_set_sha256: string;
}

export interface WrikeSourceOrderImpactAssessment {
  version: 1;
  classification: "material" | "processing_only" | "impact_unavailable";
  reason_codes: WrikeSourceOrderImpactReasonCode[];
  header_changed: boolean | null;
  lines_changed: boolean | null;
  document_set_changed: boolean | null;
  baseline_fingerprint: string | null;
  detected_fingerprint: string | null;
}

type WrikeSourceOrderReviewVersion = {
  action: string;
  source_evidence_id: string;
  import_method_fingerprint: string;
  reference_proof_evidence_ids?: string[];
};

const SOURCE_REVIEW_ACTIONS = new Set([
  "source_change_observed_after_transport",
  "source_change_assessed_no_impact"
]);

export function hasRecordedWrikeSourceOrderReviewVersion(
  history: WrikeSourceOrderReviewVersion[] | undefined,
  sourceVersion: Omit<WrikeSourceOrderReviewVersion, "action">
) {
  const proofIds = [...(sourceVersion.reference_proof_evidence_ids ?? [])].sort();
  return (history ?? []).some((entry) =>
    SOURCE_REVIEW_ACTIONS.has(entry.action) &&
    entry.source_evidence_id === sourceVersion.source_evidence_id &&
    entry.import_method_fingerprint === sourceVersion.import_method_fingerprint &&
    JSON.stringify([...(entry.reference_proof_evidence_ids ?? [])].sort()) === JSON.stringify(proofIds)
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function buildWrikeSourceOrderImpact(args: {
  payload: LiftOrderPayload;
  workbook_sha256: string;
  reference_proof_evidence_ids?: string[];
}) {
  const {
    ext_id: _extId,
    order_attachment: _orderAttachment,
    artwork_folder_url: _artworkFolderUrl,
    reference_proof_url: _referenceProofUrl,
    ...stableOrder
  } = args.payload.order;
  const header = {
    customer: args.payload.customer,
    contacts: args.payload.contacts ?? [],
    source: {
      source_system: args.payload.source.source_system,
      source_customer: args.payload.source.source_customer,
      source_record_id: args.payload.source.source_record_id,
      source_template: args.payload.source.source_template ?? null
    },
    order: stableOrder
  };
  const lines = args.payload.lines.map((line) => ({
    ...line,
    artwork: line.artwork
      ? {
          file_name: line.artwork.file_name ?? null,
          checksum: line.artwork.checksum ?? null
        }
      : undefined
  }));
  const documentSet = {
    workbook_sha256: args.workbook_sha256,
    reference_proof_evidence_ids: [...(args.reference_proof_evidence_ids ?? [])].sort()
  };
  const referenceProofSetSha256 = digest(documentSet.reference_proof_evidence_ids);
  const impact: WrikeSourceOrderImpact = {
    version: 1,
    header_sha256: digest(header),
    lines_sha256: digest(lines),
    workbook_sha256: args.workbook_sha256,
    reference_proof_set_sha256: referenceProofSetSha256,
    document_set_sha256: digest(documentSet),
    fingerprint: ""
  };
  impact.fingerprint = digest({
    version: impact.version,
    header_sha256: impact.header_sha256,
    lines_sha256: impact.lines_sha256,
    workbook_sha256: impact.workbook_sha256,
    reference_proof_set_sha256: impact.reference_proof_set_sha256,
    document_set_sha256: impact.document_set_sha256
  });
  return impact;
}

export function assessWrikeSourceOrderImpact(
  baseline: WrikeSourceOrderImpact | null,
  detected: WrikeSourceOrderImpact | null
): WrikeSourceOrderImpactAssessment {
  if (!baseline || !detected) {
    return {
      version: 1,
      classification: "impact_unavailable",
      reason_codes: ["impact_unavailable"],
      header_changed: null,
      lines_changed: null,
      document_set_changed: null,
      baseline_fingerprint: baseline?.fingerprint ?? null,
      detected_fingerprint: detected?.fingerprint ?? null
    };
  }
  const headerChanged = baseline.header_sha256 !== detected.header_sha256;
  const linesChanged = baseline.lines_sha256 !== detected.lines_sha256;
  const documentSetChanged = baseline.document_set_sha256 !== detected.document_set_sha256;
  const workbookChanged = baseline.workbook_sha256 !== detected.workbook_sha256;
  const referenceProofSetChanged =
    baseline.reference_proof_set_sha256 !== detected.reference_proof_set_sha256;
  const reasonCodes: WrikeSourceOrderImpactReasonCode[] = [];
  if (headerChanged) reasonCodes.push("lift_header_changed");
  if (linesChanged) reasonCodes.push("lift_lines_changed");
  if (workbookChanged) reasonCodes.push("workbook_content_changed");
  if (referenceProofSetChanged) reasonCodes.push("reference_proof_set_changed");
  if (!reasonCodes.length) reasonCodes.push("processing_only_changed");
  return {
    version: 1,
    classification: reasonCodes[0] === "processing_only_changed" ? "processing_only" : "material",
    reason_codes: reasonCodes,
    header_changed: headerChanged,
    lines_changed: linesChanged,
    document_set_changed: documentSetChanged,
    baseline_fingerprint: baseline.fingerprint,
    detected_fingerprint: detected.fingerprint
  };
}

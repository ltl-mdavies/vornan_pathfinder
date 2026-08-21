import type {
  ArtworkInspectionResultViewModel,
  InspectionFinding,
  InspectionMetric,
  InspectionPage,
  InspectionVerdict
} from "./ArtworkInspectionResultsWorkspace";

export const LOCAL_ARTWORK_ANALYSIS_MAX_BYTES = 250 * 1024 * 1024;

export type ArtworkUploadItemStatus =
  | "selected"
  | "hashing"
  | "inspecting"
  | "completed"
  | "failed";

export type ArtworkUploadBatchStatus = "processing" | "completed" | "partially-completed" | "failed";

export type ArtworkUploadProgress = Readonly<{
  itemId: string;
  status: ArtworkUploadItemStatus;
  label: string;
}>;

export type ArtworkProductInspectionSpec = Readonly<{
  customerId: string;
  productId: string;
  productName: string;
  proposedVersion: number;
  finishedWidthInches: number;
  finishedHeightInches: number;
  targetDpi: number;
  expectedColorSpace: string;
}>;

export type ArtworkInputFile = File;

export type ArtworkUploadItem = Readonly<{
  itemId: string;
  batchId: string;
  customerId: string;
  productId: string;
  filename: string;
  mediaType: "pdf" | "png" | "jpeg" | "unsupported";
  byteSize: number;
  sha256: string;
  status: ArtworkUploadItemStatus;
  duplicateOfItemId: string | null;
  result: ArtworkInspectionResultViewModel | null;
  error: string | null;
}>;

export type ArtworkUploadBatch = Readonly<{
  batchId: string;
  customerId: string;
  createdAt: string;
  status: ArtworkUploadBatchStatus;
  items: ReadonlyArray<ArtworkUploadItem>;
}>;

export type AnalyzeArtworkOptions = Readonly<{
  now?: () => Date;
  createId?: () => string;
  createObjectUrl?: (blob: Blob) => string;
  onProgress?: (progress: ArtworkUploadProgress) => void;
}>;

type ParsedArtwork = {
  mediaType: ArtworkUploadItem["mediaType"];
  integrityValid: boolean;
  integrityDetail: string;
  pageCount: number | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  pageWidthInches: number | null;
  pageHeightInches: number | null;
  colorSpace: string | null;
  trimLabel: string;
  bleedLabel: string;
  bleedCompatible: boolean | null;
};

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${formatter.format(bytes / 1024)} KB`;
  return `${formatter.format(bytes / 1024 ** 2)} MB`;
}

function readAscii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  return new TextDecoder("latin1").decode(bytes.subarray(start, end));
}

function hasPrefix(bytes: Uint8Array, prefix: ReadonlyArray<number>): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function parsePng(bytes: Uint8Array): ParsedArtwork {
  const signatureValid = bytes.length >= 33 && hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  const headerValid = signatureValid && readAscii(bytes, 12, 16) === "IHDR";
  const iendValid = bytes.length >= 12 && readAscii(bytes, bytes.length - 8, bytes.length - 4) === "IEND";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelWidth = headerValid ? view.getUint32(16) : null;
  const pixelHeight = headerValid ? view.getUint32(20) : null;
  const colorType = headerValid ? bytes[25] : -1;
  const colorSpace = colorType === 0 || colorType === 4 ? "Grayscale" : colorType >= 0 ? "RGB" : null;
  return {
    mediaType: "png",
    integrityValid: Boolean(headerValid && iendValid && pixelWidth && pixelHeight),
    integrityDetail: headerValid && iendValid ? "PNG structure and terminal chunk detected" : "PNG structure is incomplete or invalid",
    pageCount: 1,
    pixelWidth,
    pixelHeight,
    pageWidthInches: null,
    pageHeightInches: null,
    colorSpace,
    trimLabel: "Not embedded",
    bleedLabel: "Indeterminate for raster image",
    bleedCompatible: null
  };
}

function parseJpeg(bytes: Uint8Array): ParsedArtwork {
  const signatureValid = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const terminalValid = bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  let offset = 2;
  let pixelWidth: number | null = null;
  let pixelHeight: number | null = null;
  let components: number | null = null;
  let adobeTransform: number | null = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (signatureValid && offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrame.has(marker) && segmentLength >= 8) {
      pixelHeight = view.getUint16(offset + 3);
      pixelWidth = view.getUint16(offset + 5);
      components = bytes[offset + 7] ?? null;
    }
    if (marker === 0xee && segmentLength >= 14 && readAscii(bytes, offset + 2, offset + 7) === "Adobe") {
      adobeTransform = bytes[offset + 13] ?? null;
    }
    offset += segmentLength;
  }

  const colorSpace = components === 4
    ? adobeTransform === 2 ? "YCCK / CMYK" : "CMYK"
    : components === 3 ? "RGB / YCbCr" : components === 1 ? "Grayscale" : null;
  return {
    mediaType: "jpeg",
    integrityValid: Boolean(signatureValid && terminalValid && pixelWidth && pixelHeight),
    integrityDetail: signatureValid && terminalValid ? "JPEG structure and terminal marker detected" : "JPEG structure is incomplete or invalid",
    pageCount: 1,
    pixelWidth,
    pixelHeight,
    pageWidthInches: null,
    pageHeightInches: null,
    colorSpace,
    trimLabel: "Not embedded",
    bleedLabel: "Indeterminate for raster image",
    bleedCompatible: null
  };
}

type PdfBox = Readonly<{ left: number; bottom: number; right: number; top: number }>;

function parsePdfBox(text: string, name: "MediaBox" | "TrimBox" | "BleedBox"): PdfBox | null {
  const match = text.match(new RegExp(`\\/${name}\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\]`));
  if (!match) return null;
  const [, left, bottom, right, top] = match.map(Number);
  if (![left, bottom, right, top].every(Number.isFinite) || right <= left || top <= bottom) return null;
  return { left, bottom, right, top };
}

function boxDimensionsInches(box: PdfBox | null): { width: number; height: number } | null {
  return box ? { width: (box.right - box.left) / 72, height: (box.top - box.bottom) / 72 } : null;
}

function parsePdf(bytes: Uint8Array): ParsedArtwork {
  const signatureValid = bytes.length >= 8 && readAscii(bytes, 0, 5) === "%PDF-";
  const tail = readAscii(bytes, Math.max(0, bytes.length - 4096));
  const terminalValid = tail.includes("%%EOF");
  const text = readAscii(bytes);
  const pageMatches = text.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches?.length || null;
  const mediaBox = parsePdfBox(text, "MediaBox");
  const trimBox = parsePdfBox(text, "TrimBox") ?? mediaBox;
  const bleedBox = parsePdfBox(text, "BleedBox");
  const dimensions = boxDimensionsInches(trimBox);
  const bleedCompatible = trimBox && bleedBox
    ? bleedBox.left <= trimBox.left - 9 && bleedBox.bottom <= trimBox.bottom - 9 && bleedBox.right >= trimBox.right + 9 && bleedBox.top >= trimBox.top + 9
    : null;
  const colorSpace = text.includes("/DeviceCMYK") && text.includes("/DeviceRGB")
    ? "Mixed RGB / CMYK"
    : text.includes("/DeviceCMYK") ? "CMYK detected" : text.includes("/DeviceRGB") ? "RGB detected" : null;
  return {
    mediaType: "pdf",
    integrityValid: signatureValid && terminalValid,
    integrityDetail: signatureValid && terminalValid ? "PDF header and terminal marker detected" : "PDF header or terminal marker is missing",
    pageCount,
    pixelWidth: null,
    pixelHeight: null,
    pageWidthInches: dimensions?.width ?? null,
    pageHeightInches: dimensions?.height ?? null,
    colorSpace,
    trimLabel: dimensions ? `${formatter.format(dimensions.width)} × ${formatter.format(dimensions.height)} in` : "Indeterminate",
    bleedLabel: bleedCompatible === null ? "Indeterminate" : bleedCompatible ? "At least 0.125 in" : "Below 0.125 in",
    bleedCompatible
  };
}

function detectAndParse(bytes: Uint8Array): ParsedArtwork {
  if (hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return parsePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  if (readAscii(bytes, 0, Math.min(5, bytes.length)) === "%PDF-") return parsePdf(bytes);
  return {
    mediaType: "unsupported",
    integrityValid: false,
    integrityDetail: "File signature is not a supported PDF, PNG, or JPEG",
    pageCount: null,
    pixelWidth: null,
    pixelHeight: null,
    pageWidthInches: null,
    pageHeightInches: null,
    colorSpace: null,
    trimLabel: "Indeterminate",
    bleedLabel: "Indeterminate",
    bleedCompatible: null
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBytes = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function makeFinding(input: Omit<InspectionFinding, "id" | "number" | "pageNumber" | "marker"> & { id: string; number: number }): InspectionFinding {
  return { ...input, pageNumber: 1 };
}

function buildFindings(parsed: ParsedArtwork, spec: ArtworkProductInspectionSpec): ReadonlyArray<InspectionFinding> {
  const findings: InspectionFinding[] = [];
  const push = (finding: Omit<InspectionFinding, "id" | "number" | "pageNumber" | "marker"> & { id: string }) => {
    findings.push(makeFinding({ ...finding, number: findings.length + 1 }));
  };

  if (!parsed.integrityValid) {
    push({ id: "integrity", severity: "needs-work", category: "File integrity", title: "File integrity check failed", description: parsed.integrityDetail, regionLabel: "Whole file", affectedArea: "Entire file", recommendation: "Export a complete PDF, PNG, or JPEG and run the check again." });
    return findings;
  }

  const width = parsed.pageWidthInches ?? parsed.pixelWidth;
  const height = parsed.pageHeightInches ?? parsed.pixelHeight;
  if (width && height) {
    const sourceRatio = width / height;
    const targetRatio = spec.finishedWidthInches / spec.finishedHeightInches;
    const variance = Math.abs(sourceRatio / targetRatio - 1);
    if (variance > 0.01) {
      push({ id: "aspect", severity: "needs-work", category: "Specification", title: "Artwork aspect ratio does not match", description: `The detected ratio differs from the ${formatter.format(spec.finishedWidthInches)} × ${formatter.format(spec.finishedHeightInches)} in product specification by ${formatter.format(variance * 100)}%.`, regionLabel: "Whole artwork", affectedArea: "Entire artwork", recommendation: "Confirm the intended product size or supply artwork with the matching aspect ratio." });
    }
  } else {
    push({ id: "dimensions-indeterminate", severity: "review", category: "Dimensions", title: "Artwork dimensions are indeterminate", description: "This browser-local check could not reliably extract artwork dimensions from the file structure.", regionLabel: "File metadata", affectedArea: "Not applicable", recommendation: "Confirm dimensions in a prepress application or run the future server inspection provider." });
  }

  const effectiveDpi = parsed.pixelWidth && parsed.pixelHeight
    ? Math.min(parsed.pixelWidth / spec.finishedWidthInches, parsed.pixelHeight / spec.finishedHeightInches)
    : null;
  if (effectiveDpi !== null && effectiveDpi < spec.targetDpi) {
    push({ id: "effective-dpi", severity: "needs-work", category: "Resolution", title: `Effective resolution ${formatter.format(effectiveDpi)} DPI`, listLabel: "Effective resolution below target", description: `The raster artwork is below the ${formatter.format(spec.targetDpi)} DPI target at finished size.`, regionLabel: "Whole artwork", affectedArea: "Entire artwork", recommendation: "Supply higher-resolution artwork or confirm a lower product-scale resolution is acceptable." });
  }
  if (effectiveDpi === null) {
    push({ id: "dpi-indeterminate", severity: "review", category: "Resolution", title: "Effective resolution is indeterminate", description: parsed.mediaType === "pdf" ? "PDF content may contain vector and raster elements. Browser-local inspection cannot reliably calculate placed-image effective DPI." : "Pixel dimensions could not be read.", regionLabel: "File content", affectedArea: "Not determined", recommendation: "Use the future server inspection provider for placed-element resolution analysis." });
  }

  if (!parsed.colorSpace) {
    push({ id: "color-indeterminate", severity: "review", category: "Color", title: "Color space is indeterminate", description: "No reliable RGB, CMYK, or grayscale declaration was found in the inspected file structure.", regionLabel: "File content", affectedArea: "Not determined", recommendation: `Confirm the file uses the expected ${spec.expectedColorSpace} production color space.` });
  }

  if (parsed.mediaType === "pdf" && parsed.bleedCompatible === false) {
    push({ id: "bleed", severity: "needs-work", category: "Trim / bleed", title: "Bleed appears below 0.125 in", description: "The detected BleedBox does not extend at least 0.125 in beyond the detected TrimBox on every edge.", regionLabel: "Page boundary", affectedArea: "Artwork perimeter", recommendation: "Extend artwork bleed or confirm the product does not require bleed." });
  } else if (parsed.bleedCompatible === null) {
    push({ id: "bleed-indeterminate", severity: "review", category: "Trim / bleed", title: "Bleed compatibility is indeterminate", description: parsed.mediaType === "pdf" ? "A reliable TrimBox/BleedBox pair was not available." : "Raster image formats do not carry PDF trim and bleed boxes.", regionLabel: "Page boundary", affectedArea: "Not determined", recommendation: "Confirm trim and bleed requirements before production." });
  }
  return findings;
}

function verdictFor(findings: ReadonlyArray<InspectionFinding>): InspectionVerdict {
  if (findings.some((finding) => finding.severity === "needs-work")) return "needs-work";
  return findings.length > 0 ? "review" : "passed";
}

function metric(label: string, value: string, warning = false): InspectionMetric {
  return { label, value, ...(warning ? { emphasis: "warning" as const } : {}) };
}

function buildMetrics(parsed: ParsedArtwork, spec: ArtworkProductInspectionSpec, sha256: string, byteSize: number): ReadonlyArray<InspectionMetric> {
  const effectiveDpi = parsed.pixelWidth && parsed.pixelHeight
    ? Math.min(parsed.pixelWidth / spec.finishedWidthInches, parsed.pixelHeight / spec.finishedHeightInches)
    : null;
  const dimensions = parsed.pixelWidth && parsed.pixelHeight
    ? `${parsed.pixelWidth} × ${parsed.pixelHeight} px`
    : parsed.pageWidthInches && parsed.pageHeightInches
      ? `${formatter.format(parsed.pageWidthInches)} × ${formatter.format(parsed.pageHeightInches)} in`
      : "Indeterminate";
  return [
    metric("File size", formatBytes(byteSize)),
    metric("SHA-256", sha256),
    metric("Pages", parsed.pageCount === null ? "Indeterminate" : String(parsed.pageCount)),
    metric("Dimensions", dimensions),
    metric("Effective DPI", effectiveDpi === null ? "Indeterminate" : formatter.format(effectiveDpi), effectiveDpi !== null && effectiveDpi < spec.targetDpi),
    metric("Color", parsed.colorSpace ?? "Indeterminate"),
    metric("Trim", parsed.trimLabel),
    metric("Bleed", parsed.bleedLabel, parsed.bleedCompatible === false)
  ];
}

function mediaLabel(mediaType: ArtworkUploadItem["mediaType"]): string {
  return mediaType === "jpeg" ? "JPEG" : mediaType.toUpperCase();
}

export async function analyzeArtworkUpload(
  file: ArtworkInputFile,
  spec: ArtworkProductInspectionSpec,
  options: AnalyzeArtworkOptions = {}
): Promise<ArtworkUploadBatch> {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
  const batchId = `upload_batch_${createId()}`;
  const itemId = `upload_item_${createId()}`;
  const createdAt = now().toISOString();
  const progress = (status: ArtworkUploadItemStatus, label: string) => options.onProgress?.({ itemId, status, label });

  progress("selected", "File selected");
  if (file.size > LOCAL_ARTWORK_ANALYSIS_MAX_BYTES) {
    throw new Error(`Local analysis supports files up to ${formatBytes(LOCAL_ARTWORK_ANALYSIS_MAX_BYTES)}.`);
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  progress("hashing", "Calculating SHA-256");
  const sha256 = await sha256Hex(bytes);
  progress("inspecting", "Inspecting file structure and product fit");
  const parsed = detectAndParse(bytes);
  const findings = buildFindings(parsed, spec);
  const verdict = verdictFor(findings);
  const objectUrl = options.createObjectUrl?.(file) ?? (typeof URL !== "undefined" && "createObjectURL" in URL ? URL.createObjectURL(file) : "");
  const previewWidth = parsed.pixelWidth ?? Math.max(1, Math.round((parsed.pageWidthInches ?? spec.finishedWidthInches) * 72));
  const previewHeight = parsed.pixelHeight ?? Math.max(1, Math.round((parsed.pageHeightInches ?? spec.finishedHeightInches) * 72));
  const page: InspectionPage = {
    pageNumber: 1,
    label: "Page 1",
    dimensions: parsed.pageWidthInches && parsed.pageHeightInches
      ? `${formatter.format(parsed.pageWidthInches)} × ${formatter.format(parsed.pageHeightInches)} in`
      : parsed.pixelWidth && parsed.pixelHeight ? `${parsed.pixelWidth} × ${parsed.pixelHeight} px` : "Indeterminate",
    pixelWidth: previewWidth,
    pixelHeight: previewHeight,
    originalPreviewUrl: objectUrl,
    originalPreviewAlt: `Local preview of ${file.name}`,
    heatmapPreviewUrl: objectUrl,
    heatmapPreviewAlt: `No heatmap is available for the local analysis of ${file.name}`,
    mediaType: parsed.mediaType === "pdf" ? "pdf" : "image"
  };
  const inspectionId = `local_inspection_${createId()}`;
  const result: ArtworkInspectionResultViewModel = {
    inspectionId,
    productName: spec.productName,
    versionLabel: `Proposed Version ${spec.proposedVersion}`,
    specification: `${formatter.format(spec.finishedWidthInches)} × ${formatter.format(spec.finishedHeightInches)} in`,
    targetDpi: String(spec.targetDpi),
    completedAt: now().toISOString(),
    verdict,
    verdictLabel: verdict === "passed" ? "Passed" : verdict === "needs-work" ? "Needs work" : "Review",
    verdictDetail: parsed.integrityValid ? "Local technical check" : "File integrity issue",
    verdictSummary: verdict === "passed"
      ? "The available browser-local checks passed. This does not activate artwork or change Proof approval."
      : "Review the available technical evidence before production. This does not activate artwork or change Proof approval.",
    policyRevision: "local-v0.1",
    providerDisplayName: "Pathfinder local analyzer",
    reportLabel: itemId,
    metrics: buildMetrics(parsed, spec, sha256, file.size),
    pages: [page],
    findings,
    availableModes: ["original", "findings"],
    localAnalysis: {
      filename: file.name,
      format: mediaLabel(parsed.mediaType),
      sha256,
      byteSize: file.size,
      persistence: "Browser-local only — not uploaded or retained"
    }
  };
  progress("completed", "Technical inspection ready");
  const item: ArtworkUploadItem = {
    itemId,
    batchId,
    customerId: spec.customerId,
    productId: spec.productId,
    filename: file.name,
    mediaType: parsed.mediaType,
    byteSize: file.size,
    sha256,
    status: "completed",
    duplicateOfItemId: null,
    result,
    error: null
  };
  return { batchId, customerId: spec.customerId, createdAt, status: "completed", items: [item] };
}

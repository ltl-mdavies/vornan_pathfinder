import type {
  ArtworkInspectionResultsActions,
  ArtworkInspectionResultViewModel,
  InspectionFinding,
  InspectionPage
} from "./ArtworkInspectionResultsWorkspace";

const originalPreviewUrl = new URL("./assets/pump-topper-chevron-current.png", import.meta.url).href;
const heatmapPreviewUrl = new URL("./assets/pump-topper-chevron-heatmap.png", import.meta.url).href;

const singlePage: InspectionPage = {
  pageNumber: 1,
  label: "Page 1",
  dimensions: "72 × 15 in",
  pixelWidth: 1200,
  pixelHeight: 675,
  originalPreviewUrl,
  originalPreviewAlt: "Forest green and lime chevron transit artwork reading Move with purpose",
  heatmapPreviewUrl,
  heatmapPreviewAlt: "Heatmap analysis of chevron transit artwork with four highlighted technical finding regions"
};

const findings: ReadonlyArray<InspectionFinding> = [
  {
    id: "finding_resolution_left",
    number: 1,
    pageNumber: 1,
    severity: "needs-work",
    category: "Resolution",
    title: "Effective resolution 118 DPI",
    listLabel: "Effective resolution below target",
    description: "Several tiles in this area are below the 150 DPI target and may appear soft or pixelated when printed.",
    regionLabel: "Upper-left circuit area",
    affectedArea: "18.7% of artwork",
    recommendation: "Replace with higher-resolution artwork or rebuild critical lines and diagonals.",
    learnMoreLabel: "Learn about effective resolution",
    marker: { xPercent: 25, yPercent: 16 }
  },
  {
    id: "finding_blocky_detail",
    number: 2,
    pageNumber: 1,
    severity: "needs-work",
    category: "Detail / Aliasing",
    title: "Blocky detail detected",
    description: "Obvious pixelation appears along fine lines and small-detail transitions in this region.",
    regionLabel: "Lower-left circuit area",
    affectedArea: "12.4% of artwork",
    recommendation: "Review the placed image at output scale and replace the source if the stepped detail is visible.",
    marker: { xPercent: 22, yPercent: 78 }
  },
  {
    id: "finding_low_resolution",
    number: 3,
    pageNumber: 1,
    severity: "needs-work",
    category: "Resolution",
    title: "Low effective resolution",
    description: "Reduced effective resolution was detected in pattern detail and along high-contrast edges.",
    regionLabel: "Upper-right circuit area",
    affectedArea: "14.1% of artwork",
    recommendation: "Confirm the original linked element is present and meets the configured output-scale target.",
    marker: { xPercent: 83, yPercent: 20 }
  },
  {
    id: "finding_moire",
    number: 4,
    pageNumber: 1,
    severity: "review",
    category: "Pattern / Moiré",
    title: "Moiré pattern detected",
    description: "A repeating interference pattern may be present. Confirm acceptability at expected print scale.",
    regionLabel: "Lower-right circuit area",
    affectedArea: "10.0% of artwork",
    recommendation: "Inspect the analyzed region at 100% and confirm whether the source pattern is intentional.",
    marker: { xPercent: 83, yPercent: 78 }
  }
];

export const artworkInspectionResultFixture: ArtworkInspectionResultViewModel = {
  inspectionId: "inspection_1249_chevron_v7_001",
  productName: "Pump Topper Chevron",
  versionLabel: "Version 7",
  specification: "144 × 30 in",
  targetDpi: "150",
  completedAt: "2026-08-19T14:24:00.000Z",
  verdict: "needs-work",
  verdictLabel: "Needs work",
  verdictDetail: "Technical issues",
  verdictSummary: "Technical issues detected that may impact output quality. This does not affect Proof approval status.",
  policyRevision: "v3.2",
  providerDisplayName: "PixelGuard",
  reportLabel: "INS-2026-0819-1147",
  metrics: [
    { label: "Effective PPI", value: "121.9" },
    { label: "Target DPI", value: "150" },
    { label: "Problem area", value: "55.2%", emphasis: "warning" },
    { label: "Worst tile", value: "63.9%", emphasis: "warning" },
    { label: "Sharpness", value: "7605.8" },
    { label: "Trim", value: "72 × 15 in" }
  ],
  pages: [singlePage],
  findings
};

export const artworkInspectionMultiPageFixture: ArtworkInspectionResultViewModel = {
  ...artworkInspectionResultFixture,
  inspectionId: "inspection_1249_chevron_multipage_001",
  reportLabel: "INS-2026-0819-1148",
  pages: [
    singlePage,
    { ...singlePage, pageNumber: 2, label: "Page 2" },
    { ...singlePage, pageNumber: 3, label: "Page 3" }
  ]
};

export const artworkInspectionFixtureActions: ArtworkInspectionResultsActions = {
  onBack: () => undefined,
  onDownloadReport: () => undefined,
  onOpenAnalyzedArtwork: () => undefined,
  onLearnMore: () => undefined
};

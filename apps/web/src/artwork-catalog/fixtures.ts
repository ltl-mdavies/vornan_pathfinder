export type CatalogLifecycle = "Active" | "Draft" | "Archived";
export type InspectionState = "Passed" | "Needs work" | "Not run";
export type ApprovalState = "Approved" | "Pending" | "Needs review";

export type ArtworkInspection = {
  state: InspectionState;
  checkedAt?: string;
  summary: string;
  metrics: ReadonlyArray<{ label: string; value: string }>;
};

export type ArtworkApproval = {
  state: ApprovalState;
  reviewedAt?: string;
  reviewedBy?: string;
  summary: string;
};

export type ArtworkVersion = {
  id: string;
  version: number;
  filename: string;
  uploadedAt: string;
  uploadedBy: string;
  fileSize: string;
  previewUrl: string;
  previewAlt: string;
  isCurrent: boolean;
  inspection: ArtworkInspection;
  approval: ArtworkApproval;
};

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  lifecycle: CatalogLifecycle;
  updatedAt: string;
  specification: ReadonlyArray<{ label: string; value: string }>;
  versions: ReadonlyArray<ArtworkVersion>;
  orderHistory: {
    totalOrders: number;
    lastOrderedAt?: string;
    openOrderCount: number;
    recentReferences: ReadonlyArray<{ reference: string; status: string; orderedAt: string }>;
  };
};

export type UploadCandidate = {
  name: string;
  fileSize: string;
  fileType: string;
  expectedVersion: number;
};

export type ArtworkCatalogActions = {
  onCreateProduct: () => void;
  onOpenArtwork: (input: { productId: string; versionId: string }) => void;
  onDownloadArtwork: (input: { productId: string; versionId: string }) => void;
  onOpenFullOrderHistory: (productId: string) => void;
  onSelectUploadCandidate: (productId: string) => Promise<UploadCandidate | null>;
  onConfirmUpload: (input: { productId: string; candidate: UploadCandidate }) => Promise<void>;
};

const currentArtworkUrl = new URL("./assets/pump-topper-chevron-current.png", import.meta.url).href;

const historicalPreviewUrl = currentArtworkUrl;

export const artworkCatalogFixture: ReadonlyArray<CatalogProduct> = [
  {
    id: "product_1249_pump_topper_chevron",
    sku: "LTL-PT-144",
    name: "Pump Topper Chevron",
    category: "Pump topper",
    lifecycle: "Active",
    updatedAt: "2026-08-16T14:38:00.000Z",
    specification: [
      { label: "Finished size", value: "144 × 30 in" },
      { label: "Print product", value: "Standard transit" },
      { label: "Target resolution", value: "150 DPI" },
      { label: "Color", value: "CMYK" }
    ],
    versions: [
      {
        id: "artwork_version_7",
        version: 7,
        filename: "pump-topper-chevron-v7.pdf",
        uploadedAt: "2026-08-16T14:38:00.000Z",
        uploadedBy: "Avery Bennett",
        fileSize: "18.4 MB",
        previewUrl: currentArtworkUrl,
        previewAlt: "Forest green and lime chevron transit artwork reading Move with purpose",
        isCurrent: true,
        inspection: {
          state: "Passed",
          checkedAt: "2026-08-16T14:41:00.000Z",
          summary: "Technical checks passed for the current product specification.",
          metrics: [
            { label: "Effective PPI", value: "188" },
            { label: "Target DPI", value: "150" },
            { label: "Trim", value: "144 × 30 in" }
          ]
        },
        approval: {
          state: "Approved",
          reviewedAt: "2026-08-16T15:08:00.000Z",
          reviewedBy: "Morgan Lee",
          summary: "Approved for repeat ordering by the internal catalog team."
        }
      },
      {
        id: "artwork_version_6",
        version: 6,
        filename: "pump-topper-chevron-v6.pdf",
        uploadedAt: "2026-07-29T19:12:00.000Z",
        uploadedBy: "Avery Bennett",
        fileSize: "17.9 MB",
        previewUrl: historicalPreviewUrl,
        previewAlt: "Previous forest green chevron transit artwork",
        isCurrent: false,
        inspection: {
          state: "Needs work",
          checkedAt: "2026-07-29T19:16:00.000Z",
          summary: "One placed image fell below the configured target resolution.",
          metrics: [
            { label: "Effective PPI", value: "118" },
            { label: "Target DPI", value: "150" },
            { label: "Trim", value: "144 × 30 in" }
          ]
        },
        approval: {
          state: "Needs review",
          summary: "Historical version; no current approval applies."
        }
      },
      {
        id: "artwork_version_5",
        version: 5,
        filename: "pump-topper-chevron-v5.pdf",
        uploadedAt: "2026-06-18T13:02:00.000Z",
        uploadedBy: "Jamie Ortiz",
        fileSize: "16.7 MB",
        previewUrl: historicalPreviewUrl,
        previewAlt: "Earlier forest green chevron transit artwork",
        isCurrent: false,
        inspection: {
          state: "Not run",
          summary: "No technical inspection evidence is attached to this historical version.",
          metrics: []
        },
        approval: {
          state: "Approved",
          reviewedAt: "2026-06-18T15:24:00.000Z",
          reviewedBy: "Morgan Lee",
          summary: "Approval is retained as historical evidence only."
        }
      }
    ],
    orderHistory: {
      totalOrders: 14,
      lastOrderedAt: "2026-08-14T10:26:00.000Z",
      openOrderCount: 2,
      recentReferences: [
        { reference: "A0227419", status: "In production", orderedAt: "2026-08-14T10:26:00.000Z" },
        { reference: "A0227042", status: "Prepress", orderedAt: "2026-08-09T15:10:00.000Z" },
        { reference: "A0225887", status: "Complete", orderedAt: "2026-07-22T18:45:00.000Z" }
      ]
    }
  },
  {
    id: "product_1249_platform_banner",
    sku: "LTL-PB-096",
    name: "Platform Banner — East",
    category: "Platform banner",
    lifecycle: "Active",
    updatedAt: "2026-08-12T16:20:00.000Z",
    specification: [
      { label: "Finished size", value: "96 × 36 in" },
      { label: "Print product", value: "Platform banner" },
      { label: "Target resolution", value: "150 DPI" },
      { label: "Color", value: "CMYK" }
    ],
    versions: [{
      id: "artwork_platform_3",
      version: 3,
      filename: "platform-banner-east-v3.pdf",
      uploadedAt: "2026-08-12T16:20:00.000Z",
      uploadedBy: "Avery Bennett",
      fileSize: "11.2 MB",
      previewUrl: currentArtworkUrl,
      previewAlt: "Green transit campaign artwork for an east platform banner",
      isCurrent: true,
      inspection: { state: "Passed", summary: "Technical checks passed.", metrics: [] },
      approval: { state: "Pending", summary: "Awaiting internal human review." }
    }],
    orderHistory: { totalOrders: 6, lastOrderedAt: "2026-08-10T13:20:00.000Z", openOrderCount: 1, recentReferences: [] }
  },
  {
    id: "product_1249_interior_card",
    sku: "LTL-IC-028",
    name: "Interior Card — Route Map",
    category: "Interior card",
    lifecycle: "Active",
    updatedAt: "2026-08-08T13:04:00.000Z",
    specification: [
      { label: "Finished size", value: "28 × 11 in" },
      { label: "Print product", value: "Interior card" },
      { label: "Target resolution", value: "300 DPI" },
      { label: "Color", value: "CMYK" }
    ],
    versions: [{
      id: "artwork_interior_2",
      version: 2,
      filename: "route-map-interior-v2.pdf",
      uploadedAt: "2026-08-08T13:04:00.000Z",
      uploadedBy: "Jamie Ortiz",
      fileSize: "7.6 MB",
      previewUrl: currentArtworkUrl,
      previewAlt: "Route map artwork for an interior transit card",
      isCurrent: true,
      inspection: { state: "Needs work", summary: "Fine line detail requires review.", metrics: [] },
      approval: { state: "Needs review", summary: "Human approval remains separate from technical inspection." }
    }],
    orderHistory: { totalOrders: 9, lastOrderedAt: "2026-07-30T11:15:00.000Z", openOrderCount: 0, recentReferences: [] }
  },
  {
    id: "product_1249_large_format",
    sku: "LTL-LF-560",
    name: "Large Format — Station Wall",
    category: "Large format",
    lifecycle: "Draft",
    updatedAt: "2026-08-04T18:22:00.000Z",
    specification: [
      { label: "Finished size", value: "560 × 101.5 in" },
      { label: "Print product", value: "Large format" },
      { label: "Target resolution", value: "40 DPI" },
      { label: "Color", value: "CMYK" }
    ],
    versions: [{
      id: "artwork_large_1",
      version: 1,
      filename: "station-wall-concept-v1.pdf",
      uploadedAt: "2026-08-04T18:22:00.000Z",
      uploadedBy: "Avery Bennett",
      fileSize: "36.5 MB",
      previewUrl: currentArtworkUrl,
      previewAlt: "Concept artwork for a large-format station wall",
      isCurrent: true,
      inspection: { state: "Not run", summary: "Inspection is disabled for this draft product.", metrics: [] },
      approval: { state: "Pending", summary: "Draft products are not ready for ordering." }
    }],
    orderHistory: { totalOrders: 0, openOrderCount: 0, recentReferences: [] }
  },
  {
    id: "product_1249_kiosk_panel",
    sku: "LTL-KP-042",
    name: "Kiosk Panel — Service Update",
    category: "Kiosk panel",
    lifecycle: "Active",
    updatedAt: "2026-07-28T14:50:00.000Z",
    specification: [
      { label: "Finished size", value: "42 × 72 in" },
      { label: "Print product", value: "Kiosk panel" },
      { label: "Target resolution", value: "150 DPI" },
      { label: "Color", value: "CMYK" }
    ],
    versions: [{
      id: "artwork_kiosk_4",
      version: 4,
      filename: "kiosk-service-update-v4.pdf",
      uploadedAt: "2026-07-28T14:50:00.000Z",
      uploadedBy: "Jamie Ortiz",
      fileSize: "9.8 MB",
      previewUrl: currentArtworkUrl,
      previewAlt: "Service update artwork for a transit kiosk panel",
      isCurrent: true,
      inspection: { state: "Passed", summary: "Technical checks passed.", metrics: [] },
      approval: { state: "Approved", summary: "Approved for repeat ordering." }
    }],
    orderHistory: { totalOrders: 4, lastOrderedAt: "2026-07-26T12:30:00.000Z", openOrderCount: 0, recentReferences: [] }
  }
];

export const artworkCatalogFixtureActions: ArtworkCatalogActions = {
  onCreateProduct: () => undefined,
  onOpenArtwork: () => undefined,
  onDownloadArtwork: () => undefined,
  onOpenFullOrderHistory: () => undefined,
  onSelectUploadCandidate: async () => ({
    name: "pump-topper-chevron-v8.pdf",
    fileSize: "19.1 MB",
    fileType: "PDF artwork",
    expectedVersion: 8
  }),
  onConfirmUpload: async () => undefined
};

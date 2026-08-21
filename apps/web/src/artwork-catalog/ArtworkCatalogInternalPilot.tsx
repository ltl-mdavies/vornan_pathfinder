import React, { useEffect, useState } from "react";
import { ArtworkCatalogWorkspace } from "./ArtworkCatalogWorkspace";
import {
  ArtworkInspectionResultsWorkspace,
  type ArtworkInspectionResultViewModel
} from "./ArtworkInspectionResultsWorkspace";
import { artworkCatalogFixture, artworkCatalogFixtureActions } from "./fixtures";
import { artworkInspectionResultFixture } from "./inspection-results-fixtures";
import {
  analyzeArtworkUpload,
  type ArtworkProductInspectionSpec,
  type ArtworkUploadBatch
} from "./artwork-upload-analysis";
import type { CatalogProduct } from "./fixtures";

const INTERNAL_PILOT_CUSTOMER_ID = "1249";
const INTERNAL_PILOT_PRODUCT_ID = "product_1249_pump_topper_chevron";
const INTERNAL_PILOT_VERSION_ID = "artwork_version_7";
const INTERNAL_PILOT_INSPECTION_ID = "inspection_1249_chevron_v7_001";

export function isArtworkCatalogInternalPilotAvailable(enabled: boolean, customerId: string): boolean {
  return enabled && customerId === INTERNAL_PILOT_CUSTOMER_ID;
}

export function shouldUseArtworkCatalogFocusedShell(input: {
  activeGlobalView: string;
  activeCustomerView: string;
  pilotAvailable: boolean;
}): boolean {
  return (
    input.activeGlobalView === "Customers" &&
    input.activeCustomerView === "Artwork Catalog" &&
    input.pilotAvailable
  );
}

export function resolveArtworkInspectionResult(input: {
  customerId: string;
  productId: string;
  versionId: string;
}): ArtworkInspectionResultViewModel | null {
  if (
    input.customerId !== INTERNAL_PILOT_CUSTOMER_ID ||
    input.productId !== INTERNAL_PILOT_PRODUCT_ID ||
    input.versionId !== INTERNAL_PILOT_VERSION_ID
  ) {
    return null;
  }

  const product = artworkCatalogFixture.find((candidate) => candidate.id === input.productId);
  const version = product?.versions.find((candidate) => candidate.id === input.versionId && candidate.isCurrent);
  if (
    !product ||
    !version ||
    artworkInspectionResultFixture.inspectionId !== INTERNAL_PILOT_INSPECTION_ID ||
    artworkInspectionResultFixture.productName !== product.name ||
    artworkInspectionResultFixture.versionLabel !== `Version ${version.version}`
  ) {
    return null;
  }

  return artworkInspectionResultFixture;
}

export type ArtworkCatalogInternalPilotProps = Readonly<{
  customerId: string;
  customerLabel: string;
}>;

type PilotView =
  | Readonly<{ kind: "catalog"; selectedProductId: string }>
  | Readonly<{ kind: "inspection"; productId: string; result: ArtworkInspectionResultViewModel }>;

export function localInspectionSpecForProduct(customerId: string, product: CatalogProduct): ArtworkProductInspectionSpec {
  const finishedSize = product.specification.find((item) => item.label === "Finished size")?.value ?? "";
  const size = finishedSize.match(/^([\d.]+)\s*[×x]\s*([\d.]+)\s*(in|ft|mm|cm)$/i);
  const targetDpi = Number((product.specification.find((item) => item.label === "Target resolution")?.value ?? "").replace(/\s*DPI$/i, ""));
  if (!size || !Number.isFinite(targetDpi) || targetDpi <= 0) {
    throw new Error("The product specification must include finished dimensions and target DPI before local inspection.");
  }
  const unit = size[3].toLowerCase();
  const toInches = unit === "ft" ? 12 : unit === "mm" ? 1 / 25.4 : unit === "cm" ? 1 / 2.54 : 1;
  return {
    customerId,
    productId: product.id,
    productName: product.name,
    proposedVersion: Math.max(...product.versions.map((version) => version.version)) + 1,
    finishedWidthInches: Number(size[1]) * toInches,
    finishedHeightInches: Number(size[2]) * toInches,
    targetDpi,
    expectedColorSpace: product.specification.find((item) => item.label === "Color")?.value ?? "CMYK"
  };
}

function localResultFromBatch(batch: ArtworkUploadBatch): { productId: string; result: ArtworkInspectionResultViewModel } | null {
  if (batch.customerId !== INTERNAL_PILOT_CUSTOMER_ID || batch.items.length !== 1) return null;
  const item = batch.items[0];
  const product = artworkCatalogFixture.find((candidate) => candidate.id === item.productId);
  if (
    item.customerId !== INTERNAL_PILOT_CUSTOMER_ID ||
    !product ||
    item.status !== "completed" ||
    !item.result ||
    item.result.productName !== product.name
  ) return null;
  return { productId: item.productId, result: item.result };
}

export function ArtworkCatalogInternalPilot({ customerId, customerLabel }: ArtworkCatalogInternalPilotProps) {
  const [view, setView] = useState<PilotView>({
    kind: "catalog",
    selectedProductId: INTERNAL_PILOT_PRODUCT_ID
  });

  useEffect(() => () => {
    if (view.kind === "inspection" && view.result.localAnalysis) {
      view.result.pages.forEach((page) => URL.revokeObjectURL(page.originalPreviewUrl));
    }
  }, [view]);

  if (customerId !== INTERNAL_PILOT_CUSTOMER_ID) return null;

  if (view.kind === "inspection") {
    const isLocal = Boolean(view.result.localAnalysis);
    return (
      <ArtworkInspectionResultsWorkspace
        result={view.result}
        actions={{
          onBack: () => {
            setView({ kind: "catalog", selectedProductId: view.productId });
          },
          onDownloadReport: () => {
            if (!isLocal) return;
            const report = new Blob([JSON.stringify(view.result, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(report);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${view.result.reportLabel}.json`;
            link.click();
            URL.revokeObjectURL(url);
          },
          onOpenAnalyzedArtwork: () => {
            if (isLocal) window.open(view.result.pages[0].originalPreviewUrl, "_blank", "noopener,noreferrer");
          }
        }}
      />
    );
  }

  return (
    <ArtworkCatalogWorkspace
      customerLabel={customerLabel}
      products={artworkCatalogFixture}
      actions={artworkCatalogFixtureActions}
      initialProductId={view.selectedProductId}
      onOpenTechnicalInspection={(identity) => {
        const result = resolveArtworkInspectionResult({ customerId, ...identity });
        if (!result) return;
        setView({ kind: "inspection", productId: identity.productId, result });
      }}
      onAnalyzeLocalArtwork={({ product, file, onProgress }) => analyzeArtworkUpload(
        file,
        localInspectionSpecForProduct(customerId, product),
        { onProgress }
      )}
      onOpenLocalInspection={(batch) => {
        const resolved = localResultFromBatch(batch);
        if (!resolved) return;
        setView({ kind: "inspection", ...resolved });
      }}
    />
  );
}

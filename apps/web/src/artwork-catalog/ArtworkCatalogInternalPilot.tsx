import React, { useState } from "react";
import { ArtworkCatalogWorkspace } from "./ArtworkCatalogWorkspace";
import {
  ArtworkInspectionResultsWorkspace,
  type ArtworkInspectionResultViewModel
} from "./ArtworkInspectionResultsWorkspace";
import { artworkCatalogFixture, artworkCatalogFixtureActions } from "./fixtures";
import { artworkInspectionResultFixture } from "./inspection-results-fixtures";

const INTERNAL_PILOT_CUSTOMER_ID = "1249";
const INTERNAL_PILOT_PRODUCT_ID = "product_1249_pump_topper_chevron";
const INTERNAL_PILOT_VERSION_ID = "artwork_version_7";
const INTERNAL_PILOT_INSPECTION_ID = "inspection_1249_chevron_v7_001";

export function isArtworkCatalogInternalPilotAvailable(enabled: boolean, customerId: string): boolean {
  return enabled && customerId === INTERNAL_PILOT_CUSTOMER_ID;
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

export function ArtworkCatalogInternalPilot({ customerId, customerLabel }: ArtworkCatalogInternalPilotProps) {
  const [view, setView] = useState<PilotView>({
    kind: "catalog",
    selectedProductId: INTERNAL_PILOT_PRODUCT_ID
  });

  if (customerId !== INTERNAL_PILOT_CUSTOMER_ID) return null;

  if (view.kind === "inspection") {
    return (
      <ArtworkInspectionResultsWorkspace
        result={view.result}
        actions={{
          onBack: () => setView({ kind: "catalog", selectedProductId: view.productId }),
          onDownloadReport: () => undefined,
          onOpenAnalyzedArtwork: () => undefined
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
    />
  );
}

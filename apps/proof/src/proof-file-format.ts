import type { proofAsset } from "./asset-state";

export function highResolutionFormatDiffers(
  filename: string | null | undefined,
  displayKind: ReturnType<typeof proofAsset>["display_kind"]
) {
  if (!filename) return false;
  const sourceIsPdf = /\.pdf$/i.test(filename);
  const sourceIsImage = /\.(avif|gif|jpe?g|png|webp)$/i.test(filename);
  return (sourceIsPdf && displayKind === "image") || (sourceIsImage && displayKind === "pdf");
}

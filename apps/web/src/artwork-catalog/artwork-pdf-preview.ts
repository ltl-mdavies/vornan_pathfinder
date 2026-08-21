import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type RenderedPdfPreview = Readonly<{
  url: string;
  pixelWidth: number;
  pixelHeight: number;
  pageCount: number;
}>;

export async function renderPdfFirstPagePreview(
  sourceBytes: Uint8Array,
  createObjectUrl: (blob: Blob) => string
): Promise<RenderedPdfPreview> {
  const loadingTask = getDocument({ data: Uint8Array.from(sourceBytes) });
  const documentProxy = await loadingTask.promise;
  try {
    const page = await documentProxy.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2400 / Math.max(unscaled.width, unscaled.height));
    const viewport = page.getViewport({ scale: Math.max(0.25, scale) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvas, viewport, background: "rgb(255,255,255)" }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PDF preview rendering returned no image.")), "image/png");
    });
    return {
      url: createObjectUrl(blob),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      pageCount: documentProxy.numPages
    };
  } finally {
    await documentProxy.destroy();
  }
}

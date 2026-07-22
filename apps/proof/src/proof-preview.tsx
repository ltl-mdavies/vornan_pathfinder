import { ExternalLink, FileText } from "lucide-react";
import { proofAsset } from "./asset-state";
import type { ProofVersion } from "./types";

export function ProofPreview({ version }: { version: ProofVersion | null }) {
  const asset = proofAsset(version);
  const preview = asset.preview;
  const helpId = `pdf-preview-help-${version?.version_id.replace(/[^a-z0-9_-]/gi, "-") ?? "unknown"}`;
  if (asset.kind === "download" && asset.open) {
    return (
      <div className="preview-empty">
        <FileText aria-hidden="true" />
        <strong>Full-resolution file</strong>
        <span>{version?.content_type ?? "This file type"} can’t be previewed safely in the browser. Open or download the original file to review it.</span>
        <a className="button secondary" href={asset.open} target="_blank" rel="noreferrer" aria-label={`Open ${version?.filename ?? "proof file"}`}>Open file <ExternalLink aria-hidden="true" /></a>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="preview-empty">
        <FileText aria-hidden="true" />
        <strong>Preview unavailable</strong>
        <span>The source file can’t be previewed here.</span>
      </div>
    );
  }
  if (asset.kind === "image") {
    const image = <img className="proof-image" src={preview} referrerPolicy="no-referrer" alt={`Proof preview for ${version?.filename ?? "selected artwork"}`} />;
    return asset.open ? (
      <a
        className="proof-image-link"
        href={asset.open}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${version?.filename ?? "proof artwork"} full size in a new tab`}
        title="Open full size in a new tab"
      >
        {image}
      </a>
    ) : image;
  }
  if (asset.kind === "pdf") {
    return (
      <div className="preview-document">
        <iframe
          className="proof-frame"
          src={preview}
          referrerPolicy="no-referrer"
          sandbox="allow-same-origin"
          loading="lazy"
          title={`PDF proof preview for ${version?.filename ?? "selected artwork"}`}
          aria-describedby={helpId}
        />
        <p id={helpId}>Use the browser PDF controls to page or zoom. If the preview does not load, use Open or Download for the full-resolution file.</p>
      </div>
    );
  }
  return (
    <div className="preview-empty">
      <FileText aria-hidden="true" />
      <strong>Preview unavailable</strong>
      <span>The source file can’t be previewed here.</span>
    </div>
  );
}

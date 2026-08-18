import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileImage, FileUp, LoaderCircle, LockKeyhole, X } from "lucide-react";
import {
  finalizeRevisionUpload,
  loadRevisionUploadStatus,
  prepareRevisionUpload,
  ProofApiError,
  uploadRevisionFile,
  type ProofRevisionAsset
} from "./api";
import {
  revisionAssetProgress,
  revisionContentType,
  sha256File,
  validateRevisionFile
} from "./revision-upload-state";
import type { ProofTask } from "./types";

type LocalStage = "select" | "hashing" | "uploading" | "finalizing" | "processing" | "error";

interface RevisionUploadDialogProps {
  open: boolean;
  task: ProofTask | null;
  enabled: boolean;
  participantIdentified: boolean;
  onClose: () => void;
  onSessionExpired: () => void;
}

function stageCopy(stage: LocalStage) {
  if (stage === "hashing") return "Checking the selected file…";
  if (stage === "uploading") return "Uploading revised artwork…";
  if (stage === "finalizing") return "Finishing the upload…";
  return null;
}

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size / 1024 / 1024)} MB`;
}

function fileTypeLabel(file: File) {
  const extension = file.name.trim().split(".").at(-1);
  return extension ? extension.toUpperCase() : "File";
}

export function RevisionUploadDialog({
  open,
  task,
  enabled,
  participantIdentified,
  onClose,
  onSessionExpired
}: RevisionUploadDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLLabelElement>(null);
  const dragDepth = useRef(0);
  const idempotencyKeys = useRef(new Map<string, string>());
  const sessionExpired = useRef(onSessionExpired);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<LocalStage>("select");
  const [asset, setAsset] = useState<ProofRevisionAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const busy = stage === "hashing" || stage === "uploading" || stage === "finalizing";
  const blockedMessage = !enabled
    ? "Revised artwork upload is not available in this review window."
    : !participantIdentified
      ? "Identify the reviewer before uploading revised artwork."
      : !task?.attachment_id || !task.current_version
        ? "The current proof is not available for a revision upload."
        : null;

  useEffect(() => {
    sessionExpired.current = onSessionExpired;
  }, [onSessionExpired]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      window.requestAnimationFrame(() => filePicker.current?.focus());
    }
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    setFile(null);
    setStage("select");
    setAsset(null);
    setMessage(null);
    setPollCount(0);
    setDragActive(false);
    dragDepth.current = 0;
    if (fileInput.current) fileInput.current.value = "";
  }, [task?.task_id, task?.current_version?.version_id]);

  useEffect(() => {
    if (!open || !asset || asset.state === "ready_for_lift" || asset.verification_status === "quarantined" || (asset.verification_status === "cleared" && asset.publication_status === "not_started") || pollCount >= 24) return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await loadRevisionUploadStatus(asset.asset_id);
        setAsset(result.asset);
        setStage("processing");
        setPollCount((count) => count + 1);
      } catch (error) {
        if (error instanceof ProofApiError && error.status === 401) sessionExpired.current();
        setPollCount((count) => count + 1);
      }
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [asset, open, pollCount]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const chooseFile = (next: File | null) => {
    setFile(next);
    setStage("select");
    setMessage(next ? validateRevisionFile(next) : null);
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (blockedMessage || busy) return;
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length !== 1) {
      chooseFile(null);
      setMessage("Choose one revised artwork file at a time.");
      return;
    }
    chooseFile(dropped[0] ?? null);
  };

  const submit = async () => {
    if (!task?.attachment_id || !task.current_version || !file || busy) return;
    const validation = validateRevisionFile(file);
    if (validation) {
      setStage("error");
      setMessage(validation);
      return;
    }
    const contentType = revisionContentType(file);
    if (!contentType) return;
    setMessage(null);
    try {
      setStage("hashing");
      const digest = await sha256File(file);
      const identity = `${task.task_id}:${task.current_version.version_id}:${file.name}:${file.size}:${digest}`;
      const idempotencyKey = idempotencyKeys.current.get(identity)
        ?? `prevision_${crypto.randomUUID().replaceAll("-", "")}`;
      idempotencyKeys.current.set(identity, idempotencyKey);
      const prepared = await prepareRevisionUpload({
        task_id: task.task_id,
        attachment_id: task.attachment_id,
        idempotency_key: idempotencyKey,
        original_filename: file.name,
        content_type: contentType,
        content_length: file.size,
        sha256: digest
      });
      setAsset(prepared.asset);
      setStage("uploading");
      await uploadRevisionFile(prepared.upload, file);
      setStage("finalizing");
      const finalized = await finalizeRevisionUpload(prepared.asset.asset_id);
      setAsset(finalized.asset);
      setStage("processing");
      setPollCount(0);
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setStage("error");
      setMessage(error instanceof Error ? error.message : "The revised artwork could not be uploaded.");
    }
  };

  const retryFinalization = async () => {
    if (!asset || busy) return;
    setMessage(null);
    try {
      setStage("finalizing");
      const finalized = await finalizeRevisionUpload(asset.asset_id);
      setAsset(finalized.asset);
      setStage("processing");
      setPollCount(0);
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setStage("error");
      setMessage(error instanceof Error ? error.message : "The revised artwork could not be verified.");
    }
  };

  const progress = asset ? revisionAssetProgress(asset) : null;
  const currentFilename = task?.current_version?.filename ?? "Current proof";
  const currentPreview = task?.current_version?.preview_kind === "image"
    ? task.current_version.preview_url
    : null;

  return (
    <dialog
      className="proof-dialog revision-upload-dialog"
      ref={dialog}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={() => { if (open) onClose(); }}
      aria-labelledby="revision-upload-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">Revised artwork</span>
          <h2 id="revision-upload-title">Upload revised artwork</h2>
        </div>
        <button className="icon-button subtle" type="button" aria-label="Close revised artwork upload" disabled={busy} onClick={close}><X aria-hidden="true" /></button>
      </div>
      <div className="dialog-content revision-upload-content">
        <div className="revision-upload-scope">
          <div className="revision-current-thumbnail">
            {currentPreview ? <img src={currentPreview} alt="" /> : <FileImage aria-hidden="true" />}
          </div>
          <span className="revision-current-copy">
            <small>Line {task?.line_number ?? "—"} · {task?.product_name ?? "Artwork proof"}</small>
            <strong title={currentFilename}>{currentFilename}</strong>
            <em>Your upload will be used to prepare a new proof for this line.</em>
          </span>
        </div>
        {asset && progress ? (
          <div className={`revision-upload-progress ${progress.tone}`} role="status">
            {progress.tone === "ready" || progress.tone === "stored" ? <CheckCircle2 aria-hidden="true" /> : progress.tone === "error" ? <LockKeyhole aria-hidden="true" /> : <LoaderCircle className="spinning" aria-hidden="true" />}
            <span><strong>{progress.title}</strong><small>{progress.detail}</small><em>{asset.original_filename}</em></span>
          </div>
        ) : (
          <label
            ref={filePicker}
            className={`revision-file-picker ${file ? "selected" : ""} ${dragActive ? "drag-active" : ""}`}
            tabIndex={blockedMessage || busy ? -1 : 0}
            aria-disabled={Boolean(blockedMessage) || busy}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !blockedMessage && !busy) {
                event.preventDefault();
                fileInput.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              if (blockedMessage || busy) return;
              dragDepth.current += 1;
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = blockedMessage || busy ? "none" : "copy";
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.psd,.ai,.eps,.ps,application/pdf,image/jpeg,image/png,image/tiff,image/vnd.adobe.photoshop,application/postscript"
              disabled={Boolean(blockedMessage) || busy}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <FileUp aria-hidden="true" />
            <span>
              <strong>{file?.name ?? "Drop revised artwork here"}</strong>
              <small>{file ? `${fileTypeLabel(file)} · ${fileSizeLabel(file.size)}` : "or choose a file"}</small>
              <em>{file ? "Choose a different file" : "PDF, image, Photoshop, or PostScript · up to 1 GB"}</em>
            </span>
          </label>
        )}
        {blockedMessage ? <p className="revision-upload-message blocked"><LockKeyhole aria-hidden="true" /> {blockedMessage}</p> : null}
        {stageCopy(stage) ? <p className="revision-upload-message" role="status"><LoaderCircle className="spinning" aria-hidden="true" /> {stageCopy(stage)}</p> : null}
        {message ? <p className="revision-upload-message error" role="alert">{message}</p> : null}
      </div>
      <div className="revision-upload-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={close}>{asset ? "Done" : "Cancel"}</button>
        {!asset ? <button className="button primary" type="button" disabled={!file || Boolean(blockedMessage) || Boolean(message) || busy} onClick={() => void submit()}>{busy ? stage === "hashing" ? "Checking file…" : "Uploading…" : "Upload and check file"}</button> : null}
        {asset && stage === "error" ? <button className="button primary" type="button" disabled={busy} onClick={() => void retryFinalization()}>Retry file check</button> : null}
      </div>
    </dialog>
  );
}

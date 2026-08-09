import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, LoaderCircle, LockKeyhole, ShieldCheck, X } from "lucide-react";
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
  if (stage === "uploading") return "Uploading securely…";
  if (stage === "finalizing") return "Confirming the complete upload…";
  return null;
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
  const idempotencyKeys = useRef(new Map<string, string>());
  const sessionExpired = useRef(onSessionExpired);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<LocalStage>("select");
  const [asset, setAsset] = useState<ProofRevisionAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const busy = stage === "hashing" || stage === "uploading" || stage === "finalizing";

  useEffect(() => {
    sessionExpired.current = onSessionExpired;
  }, [onSessionExpired]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    setFile(null);
    setStage("select");
    setAsset(null);
    setMessage(null);
    setPollCount(0);
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

  const progress = asset ? revisionAssetProgress(asset) : null;
  const blockedMessage = !enabled
    ? "Revised artwork upload is not available in this review window."
    : !participantIdentified
      ? "Identify the reviewer before uploading revised artwork."
      : !task?.attachment_id || !task.current_version
        ? "The current proof is not available for a revision upload."
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
          <h2 id="revision-upload-title">Provide a replacement file</h2>
        </div>
        <button className="icon-button subtle" type="button" aria-label="Close revised artwork upload" disabled={busy} onClick={close}><X aria-hidden="true" /></button>
      </div>
      <div className="dialog-content revision-upload-content">
        <div className="revision-upload-scope">
          <FileUp aria-hidden="true" />
          <span><strong>Line {task?.line_number ?? "—"}</strong><small>{task?.product_name ?? "Artwork proof"}</small></span>
        </div>
        <p className="revision-upload-intro">Upload the complete replacement artwork. Vornan will store and verify it privately before any separate production request can be sent.</p>
        {asset && progress ? (
          <div className={`revision-upload-progress ${progress.tone}`} role="status">
            {progress.tone === "ready" || progress.tone === "stored" ? <CheckCircle2 aria-hidden="true" /> : progress.tone === "error" ? <LockKeyhole aria-hidden="true" /> : <LoaderCircle className="spinning" aria-hidden="true" />}
            <span><strong>{progress.title}</strong><small>{progress.detail}</small><em>{asset.original_filename}</em></span>
          </div>
        ) : (
          <label className={`revision-file-picker ${file ? "selected" : ""}`}>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.psd,.ai,.eps,.ps,application/pdf,image/jpeg,image/png,image/tiff,image/vnd.adobe.photoshop,application/postscript"
              disabled={Boolean(blockedMessage) || busy}
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
                setStage("select");
                setMessage(next ? validateRevisionFile(next) : null);
              }}
            />
            <FileUp aria-hidden="true" />
            <span><strong>{file?.name ?? "Choose revised artwork"}</strong><small>{file ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(file.size / 1024 / 1024)} MB` : "PDF, image, Photoshop, or PostScript · up to 1 GB"}</small></span>
          </label>
        )}
        {blockedMessage ? <p className="revision-upload-message blocked"><LockKeyhole aria-hidden="true" /> {blockedMessage}</p> : null}
        {stageCopy(stage) ? <p className="revision-upload-message" role="status"><LoaderCircle className="spinning" aria-hidden="true" /> {stageCopy(stage)}</p> : null}
        {message ? <p className="revision-upload-message error" role="alert">{message}</p> : null}
        <div className="revision-upload-privacy"><ShieldCheck aria-hidden="true" /><span><strong>Private by default</strong><small>This upload does not call Lift or change the current proof.</small></span></div>
      </div>
      <div className="revision-upload-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={close}>{asset ? "Done" : "Cancel"}</button>
        {!asset ? <button className="button primary" type="button" disabled={!file || Boolean(blockedMessage) || Boolean(message) || busy} onClick={() => void submit()}>{busy ? "Uploading…" : "Upload revised artwork"}</button> : null}
      </div>
    </dialog>
  );
}

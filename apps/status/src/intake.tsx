import { useEffect, useRef, useState } from "react";

type IntakeConfig = {
  customer_name: string;
  method_name: string;
  headline: string;
  instructions: string;
  require_email: boolean;
  max_order_rows: number;
  accepted_file_types: string[];
  expected_columns: string[];
};

type IntakePreviewRow = {
  sheet_name: string;
  row_number: number;
  product: string;
  quantity: number | null;
  final_width: string | number | boolean | null;
  final_height: string | number | boolean | null;
  status: "Ready" | "Needs review";
  message: string;
};

type IntakePreview = {
  source_file_name: string;
  sheet_name: string;
  order_row_count: number;
  reference_row_count: number;
  ready_row_count: number;
  review_row_count: number;
  rows: IntakePreviewRow[];
};

type IntakeSubmission = {
  status: "received";
  message: string;
  reference: string;
  order_row_count: number;
  review_required: boolean;
};

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

async function responseJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "The request could not be completed.";
    throw new Error(errorMessage);
  }
  return payload as T;
}

function dimensionLabel(row: IntakePreviewRow) {
  if (row.final_width == null && row.final_height == null) {
    return "Dimensions not supplied";
  }
  return `${row.final_width ?? "—"} × ${row.final_height ?? "—"}`;
}

export function CustomerIntake({ apiBaseUrl, publicKey }: { apiBaseUrl: string; publicKey: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<IntakeConfig | null>(null);
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [submission, setSubmission] = useState<IntakeSubmission | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "previewing" | "submitting" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    void fetch(`${apiBaseUrl}/public/intake/${encodeURIComponent(publicKey)}`)
      .then((response) => responseJson<IntakeConfig>(response))
      .then((nextConfig) => {
        if (!ignore) {
          setConfig(nextConfig);
          setState("idle");
        }
      })
      .catch((error) => {
        if (!ignore) {
          setMessage(error instanceof Error ? error.message : "This order page is unavailable.");
          setState("error");
        }
      });
    return () => {
      ignore = true;
    };
  }, [apiBaseUrl, publicKey]);

  function resetSource() {
    setFile(null);
    setPasteText("");
    setPreview(null);
    setMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function requestBody() {
    return {
      email: email.trim(),
      source_file_name: file?.name ?? "Pasted order grid.csv",
      file_base64: file ? await fileAsBase64(file) : "",
      paste_text: file ? "" : pasteText
    };
  }

  async function generatePreview() {
    setState("previewing");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/public/intake/${encodeURIComponent(publicKey)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await requestBody())
      });
      setPreview(await responseJson<IntakePreview>(response));
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The order source could not be previewed.");
      setState("error");
    }
  }

  async function submitOrder() {
    setState("submitting");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/public/intake/${encodeURIComponent(publicKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await requestBody())
      });
      setSubmission(await responseJson<IntakeSubmission>(response));
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The order source could not be submitted.");
      setState("error");
    }
  }

  if (state === "loading") {
    return (
      <section className="intake-loading">
        <span />
        <strong>Opening your order page</strong>
      </section>
    );
  }

  if (!config) {
    return (
      <section className="intake-unavailable">
        <p className="eyebrow">Order intake</p>
        <h1>This order page is unavailable.</h1>
        <p>{message || "Contact your Vornan representative for a current order link."}</p>
      </section>
    );
  }

  if (submission) {
    return (
      <section className="intake-success">
        <div className="success-mark">✓</div>
        <p className="eyebrow">Order received</p>
        <h1>Thank you, {config.customer_name}.</h1>
        <p>{submission.message}</p>
        <div className="intake-reference">
          <span>Reference</span>
          <strong>{submission.reference}</strong>
          <small>{submission.order_row_count} order rows received{submission.review_required ? " · Vornan review required" : ""}</small>
        </div>
        <button type="button" onClick={() => {
          setSubmission(null);
          resetSource();
        }}>
          Submit another order
        </button>
      </section>
    );
  }

  return (
    <div className="intake-layout">
      <section className="intake-intro">
        <p className="eyebrow">{config.customer_name}</p>
        <h1>{config.headline}</h1>
        <p>{config.instructions}</p>
        <div className="intake-expectation">
          <strong>What happens next</strong>
          <span>Pathfinder checks your rows, then sends the order to Vornan for review before production submission.</span>
        </div>
      </section>

      <section className="intake-card">
        <div className="intake-card-heading">
          <span>Order source</span>
          <strong>{config.method_name}</strong>
        </div>
        <label className="intake-email">
          <span>Work email</span>
          <input
            type="email"
            value={email}
            required={config.require_email}
            placeholder="you@company.com"
            autoComplete="email"
            onChange={(event) => {
              setEmail(event.target.value);
              setPreview(null);
              setMessage("");
            }}
          />
          <small>Used to identify who submitted this order.</small>
        </label>

        <button
          type="button"
          className="intake-drop-zone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const nextFile = event.dataTransfer.files[0] ?? null;
            if (nextFile) {
              setFile(nextFile);
              setPasteText("");
              setPreview(null);
              setMessage("");
            }
          }}
        >
          <span className="drop-arrow">↑</span>
          <strong>{file?.name ?? "Drop your spreadsheet here"}</strong>
          <small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB selected` : "or choose an XLSX, XLS, or CSV file"}</small>
        </button>
        <input
          ref={fileInputRef}
          className="intake-file-input"
          type="file"
          accept={config.accepted_file_types.join(",")}
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            setPasteText("");
            setPreview(null);
            setMessage("");
          }}
        />

        <div className="intake-divider"><span>or paste a grid</span></div>
        <label className="intake-paste">
          <span>Paste spreadsheet rows</span>
          <textarea
            value={pasteText}
            placeholder={"Order Number\tDescription\tQuantity\n12345\tOne Sheet Poster\t10"}
            onChange={(event) => {
              setPasteText(event.target.value);
              setFile(null);
              setPreview(null);
              setMessage("");
            }}
          />
        </label>

        {config.expected_columns.length ? (
          <details className="intake-columns">
            <summary>Expected spreadsheet columns</summary>
            <p>{config.expected_columns.join(" · ")}</p>
          </details>
        ) : null}

        {message ? <p className="intake-error">{message}</p> : null}

        {!preview ? (
          <button
            type="button"
            className="intake-primary"
            disabled={state === "previewing" || (!file && !pasteText.trim()) || (config.require_email && !email.trim())}
            onClick={() => void generatePreview()}
          >
            {state === "previewing" ? "Checking rows…" : "Review order rows"}
          </button>
        ) : null}
      </section>

      {preview ? (
        <section className="intake-preview">
          <div className="intake-preview-heading">
            <div>
              <p className="eyebrow">Visual confirmation</p>
              <h2>{preview.order_row_count} order rows</h2>
              <span>{preview.source_file_name} · {preview.sheet_name}</span>
            </div>
            <div className={preview.review_row_count ? "preview-count review" : "preview-count ready"}>
              <strong>{preview.review_row_count ? `${preview.review_row_count} need review` : "Ready"}</strong>
              <span>{preview.ready_row_count} rows matched</span>
            </div>
          </div>
          <div className="intake-row-list">
            {preview.rows.map((row) => (
              <article key={`${row.sheet_name}-${row.row_number}`}>
                <span className={row.status === "Ready" ? "row-status ready" : "row-status review"}>{row.status}</span>
                <div>
                  <strong>{row.product}</strong>
                  <span>Row {row.row_number} · Qty {row.quantity ?? "—"} · {dimensionLabel(row)}</span>
                  <small>{row.message}</small>
                </div>
              </article>
            ))}
          </div>
          <div className="intake-preview-actions">
            <button type="button" className="intake-secondary" disabled={state === "submitting"} onClick={resetSource}>Cancel</button>
            <button type="button" className="intake-primary" disabled={state === "submitting"} onClick={() => void submitOrder()}>
              {state === "submitting" ? "Submitting…" : "Submit order to Vornan"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, X } from "lucide-react";
import { loadDetailedReport, startDetailedReport } from "./api";
import type { ProofDetailedReport, ProofTask, ProofVersion } from "./types";

export function detailedReportOptionStatus(ready: boolean, generating: boolean, failed = false) {
  if (generating) return { description: "Generating report…", action: "Generating…" };
  if (failed) return { description: "Couldn’t generate report", action: "Try again" };
  return ready
    ? { description: "Ready to view", action: "View" }
    : { description: "Generate report", action: "Generate" };
}

export function DetailedReportButton({ task, version }: { task: ProofTask; version: ProofVersion | null }) {
  const definitions = version?.current ? version.report_definitions ?? [] : [];
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const definition = definitions.find((candidate) => candidate.definition_id === selectedDefinitionId) ?? definitions[0] ?? null;
  const [report, setReport] = useState<ProofDetailedReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [startingDefinitionId, setStartingDefinitionId] = useState<string | null>(null);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const selectionDialog = useRef<HTMLDialogElement | null>(null);
  const viewerDialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    setReport(null);
    setMessage(null);
    setStartingDefinitionId(null);
    setSelectedDefinitionId(null);
    setSelectionOpen(false);
    setViewerOpen(false);
  }, [task.task_id, version?.version_id]);
  useEffect(() => {
    const dialog = selectionDialog.current;
    if (!dialog) return;
    if (selectionOpen && !dialog.open) dialog.showModal();
    if (!selectionOpen && dialog.open) dialog.close();
  }, [selectionOpen]);
  useEffect(() => {
    const dialog = viewerDialog.current;
    if (!dialog) return;
    if (viewerOpen && !dialog.open) dialog.showModal();
    if (!viewerOpen && dialog.open) dialog.close();
  }, [viewerOpen]);
  useEffect(() => {
    if (!definition || !report || !["generation_started", "running"].includes(report.state)) return;
    const timer = window.setInterval(() => {
      void loadDetailedReport(task.task_id, definition.definition_id)
        .then(({ report: next }) => {
          setReport(next);
          if (next.state === "ready" && next.view_url) {
            setSelectionOpen(false);
            setViewerOpen(true);
          }
        })
        .catch(() => {
          setMessage("We’re still preparing your report. Try again shortly.");
          setReport((current) => current ? { ...current, state: "failed" } : current);
        });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [definition?.definition_id, report?.state, task.task_id]);
  if (!definition) return null;

  const state = report?.state ?? (definition.ready ? "ready" : "unavailable");
  const generatingDefinitionId = startingDefinitionId ?? (
    ["generation_started", "running"].includes(state) ? report?.definition_id ?? null : null
  );
  const generating = Boolean(generatingDefinitionId);
  const label = generating ? "Generating detailed report…" : state === "ready" ? "View detailed report" : "Generate detailed report";

  function openReport(next: ProofDetailedReport) {
    setReport(next);
    if (["failed", "timed_out"].includes(next.state)) {
      setMessage("This report couldn’t be generated. Try again.");
    }
    if (next.state === "ready" && next.view_url) {
      setSelectionOpen(false);
      setViewerOpen(true);
    }
  }

  function chooseDefinition(candidate: NonNullable<typeof definition>) {
    if (startingDefinitionId) return;
    setSelectedDefinitionId(candidate.definition_id);
    setMessage(null);
    setStartingDefinitionId(candidate.definition_id);
    void startDetailedReport(task.task_id, candidate.definition_id)
      .then(({ report: next }) => openReport(next))
      .catch(() => {
        setReport({ record_id: "", definition_id: candidate.definition_id, label: candidate.label, state: "failed", view_url: null });
        setMessage("This report couldn’t be generated. Try again.");
      })
      .finally(() => setStartingDefinitionId(null));
  }

  return (
    <>
      <button className="button secondary compact detailed-report-trigger" type="button" disabled={generating} onClick={() => {
        setMessage(null);
        if (report?.state === "ready" && report.view_url) setViewerOpen(true);
        else setSelectionOpen(true);
      }}><FileText aria-hidden="true" /> {label}</button>

      <dialog
        ref={selectionDialog}
        className="proof-dialog detailed-report-selection-dialog"
        aria-labelledby="detailed-report-selection-title"
        onCancel={(event) => { event.preventDefault(); setSelectionOpen(false); }}
        onClose={() => setSelectionOpen(false)}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">{task.product_name ?? "Artwork proof"}</span>
            <h2 id="detailed-report-selection-title">Detailed report</h2>
            <p>Choose a report type to generate or view.</p>
          </div>
          <button className="icon-button subtle" type="button" aria-label="Close detailed report selection" onClick={() => setSelectionOpen(false)}><X aria-hidden="true" /></button>
        </div>
        <div className="detailed-report-options" aria-busy={generating}>
          {definitions.map((candidate) => {
            const failed = report?.definition_id === candidate.definition_id && ["failed", "timed_out"].includes(report.state);
            const optionStatus = detailedReportOptionStatus(candidate.ready, generatingDefinitionId === candidate.definition_id, failed);
            return (
              <button key={candidate.definition_id} className="detailed-report-option" type="button" disabled={generating} onClick={() => chooseDefinition(candidate)}>
                <FileText aria-hidden="true" />
                <span><strong>{candidate.label ?? "Detailed report"}</strong><small>{optionStatus.description}</small></span>
                <span className="detailed-report-option-action">{optionStatus.action}</span>
              </button>
            );
          })}
          {message ? <p className="detailed-report-message" role="status">{message}</p> : null}
        </div>
      </dialog>

      {report?.view_url ? (
        <dialog
          ref={viewerDialog}
          className="proof-dialog detailed-report-viewer-dialog"
          aria-labelledby="detailed-report-viewer-title"
          onCancel={(event) => { event.preventDefault(); setViewerOpen(false); }}
          onClose={() => setViewerOpen(false)}
        >
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">{task.product_name ?? "Artwork proof"}</span>
              <h2 id="detailed-report-viewer-title">{report.label ?? "Detailed report"}</h2>
            </div>
            <div className="detailed-report-viewer-actions">
              <button className="button secondary compact" type="button" onClick={() => { setViewerOpen(false); setSelectionOpen(true); }}><ArrowLeft aria-hidden="true" /> Back</button>
              <button className="icon-button subtle" type="button" aria-label="Close detailed report" onClick={() => setViewerOpen(false)}><X aria-hidden="true" /></button>
            </div>
          </div>
          <div className="detailed-report-frame-wrap"><iframe className="detailed-report-frame" src={report.view_url} title={`${report.label ?? "Detailed"} report`} /></div>
        </dialog>
      ) : null}
    </>
  );
}

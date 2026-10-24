import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { operationsDate, type OperationsJob } from "./operations-model";

/** Read-only list-record summary. Actions and full evidence stay in the existing detail. */
export function OperationsJobInspector({ job, onClose, onOpen }: {
  job: OperationsJob; onClose: () => void; onOpen: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    const wide = window.matchMedia("(min-width: 1550px)");
    const position = () => { element?.close(); if (wide.matches) element?.show(); else element?.showModal(); };
    position();
    wide.addEventListener("change", position);
    return () => { wide.removeEventListener("change", position); element?.close(); if (origin?.isConnected) origin.focus(); };
  }, [job.id]);
  return <dialog ref={dialog} className="pf-job-inspector" aria-labelledby="job-inspector-title" onCancel={onClose} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab" || !event.currentTarget.matches(":modal")) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header><div><span>{job.customer}</span><h2 id="job-inspector-title">{job.label}</h2><p>{job.sourceOrder || "Source order not recorded"}</p></div><button autoFocus type="button" aria-label="Close job inspector" onClick={onClose}><X size={18}/></button></header>
    <dl>
      <div><dt>Intake method</dt><dd>{job.intake}</dd></div>
      <div><dt>Lift order</dt><dd>{job.liftOrder || "Not confirmed"}</dd></div>
      <div><dt>Processing</dt><dd>{job.liftOrder ? "Confirmed" : job.processing === "Submitted" ? "Confirming" : job.processing}</dd></div>
      <div><dt>Production</dt><dd>{job.production === "—" ? "Not available" : job.production}</dd></div>
      <div><dt>Received</dt><dd>{operationsDate(job.createdAt)}</dd></div>
      <div><dt>Confirmed</dt><dd>{job.confirmedAt ? operationsDate(job.confirmedAt) : "Not recorded"}</dd></div>
      <div><dt>Last activity</dt><dd>{operationsDate(job.activityAt)}</dd></div>
      <div><dt>Visibility</dt><dd>{job.archived ? "Archived" : "Active"}</dd></div>
    </dl>
    <p className="pf-job-reference">Full job ID: {job.id}</p>
    <footer><span>Full details include lines, attempts, history and available actions.</span><button className="primary-button" type="button" onClick={onOpen}>Open full job details</button></footer>
  </dialog>;
}

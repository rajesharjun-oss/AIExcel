import { useEffect, useRef, type ReactNode } from "react";
import type { InvoiceStatus } from "../lib/api.js";

export function Field(props: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.error ? (
        <p className="error" id={`${props.id}-error`} role="alert">
          {props.error}
        </p>
      ) : props.hint ? (
        <p className="hint" id={`${props.id}-hint`}>
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

export function StatusPill({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (overdue) return <span className="pill pill-overdue">Overdue</span>;
  const labels: Record<InvoiceStatus, string> = {
    draft: "Draft",
    sent: "Sent",
    part_paid: "Part paid",
    paid: "Paid",
    void: "Void",
  };
  return <span className={`pill pill-${status}`}>{labels[status]}</span>;
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  );
}

/** Announces async completions to screen readers without visual noise. */
export function LiveStatus({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.textContent = message;
  }, [message]);
  return <p className="visually-hidden" aria-live="polite" ref={ref} />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8 }} />
      ))}
    </div>
  );
}

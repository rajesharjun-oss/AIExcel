import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { api, ApiError, type Invoice, type InvoiceItem } from "../lib/api.js";
import { formatDate, formatNaira, isOverdue, parseNairaToKobo } from "../lib/money.js";
import { ErrorAlert, Field, ListSkeleton, LiveStatus, StatusPill } from "../components/ui.js";

type FullInvoice = Invoice & { items: InvoiceItem[] };

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<FullInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "transfer">("transfer");
  const [payError, setPayError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setInvoice(await api.get<FullInvoice>(`/api/invoices/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(name: string, fn: () => Promise<unknown>, doneMessage: string) {
    setBusyAction(name);
    setError(null);
    try {
      await fn();
      setAnnounce(doneMessage);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusyAction(null);
    }
  }

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    const kobo = parseNairaToKobo(payAmount);
    if (kobo === null || kobo === 0) {
      setPayError("Enter the amount received, e.g. 5,000");
      return;
    }
    setPayError(undefined);
    await act(
      "pay",
      () => api.post(`/api/invoices/${id}/payments`, { amountKobo: kobo, method: payMethod }),
      "Payment recorded",
    );
    setPayAmount("");
  }

  async function copyShareLink(shareToken: string) {
    const url = `${window.location.origin}/i/${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setAnnounce("Link copied to clipboard");
    } catch {
      // Clipboard can be blocked; fall back to showing the link for manual copy.
      window.prompt("Copy this link:", url);
    }
  }

  if (error && !invoice) return <ErrorAlert message={error} />;
  if (!invoice) return <ListSkeleton rows={6} />;

  const outstanding = invoice.totalKobo - invoice.paidKobo;
  const shareUrl = `${window.location.origin}/i/${invoice.shareToken}`;
  const canRecordPayment = invoice.status === "sent" || invoice.status === "part_paid";

  return (
    <>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {invoice.number} <StatusPill status={invoice.status} overdue={isOverdue(invoice)} />
      </h1>
      <ErrorAlert message={error} />
      <LiveStatus message={announce} />

      <div className="card">
        <table className="items-table">
          <caption className="visually-hidden">Invoice items</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td>{item.description}</td>
                <td className="num">{item.quantity}</td>
                <td className="num">{formatNaira(item.lineTotalKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <div className="line">
            <span>Subtotal</span>
            <span>{formatNaira(invoice.subtotalKobo)}</span>
          </div>
          <div className="line">
            <span>VAT</span>
            <span>{formatNaira(invoice.vatKobo)}</span>
          </div>
          <div className="line grand">
            <span>Total</span>
            <span>{formatNaira(invoice.totalKobo)}</span>
          </div>
          <div className="line">
            <span>Paid</span>
            <span>{formatNaira(invoice.paidKobo)}</span>
          </div>
          <div className="line grand">
            <span>Outstanding</span>
            <span>{formatNaira(outstanding)}</span>
          </div>
        </div>
        <p className="row-sub" style={{ marginTop: 8 }}>
          Issued {formatDate(invoice.issueDate)} · Due {formatDate(invoice.dueDate)}
        </p>
      </div>

      {invoice.status === "draft" && (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            This invoice is a draft. Send it to start reminders and let the customer view it online.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyAction !== null}
            onClick={() => void act("send", () => api.post(`/api/invoices/${invoice.id}/send`), "Invoice sent")}
          >
            {busyAction === "send" ? "Sending…" : "Mark as sent"}
          </button>
        </div>
      )}

      {invoice.status !== "draft" && invoice.status !== "void" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Share with your customer</h2>
          <p className="row-sub" style={{ wordBreak: "break-all" }}>
            {shareUrl}
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void copyShareLink(invoice.shareToken)}
            >
              Copy link
            </button>
            <a
              className="btn btn-wa"
              href={`https://wa.me/?text=${encodeURIComponent(
                `Invoice ${invoice.number} — ${formatNaira(invoice.totalKobo)}. View and pay here: ${shareUrl}`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on WhatsApp
            </a>
            <a className="btn btn-secondary" href={`/api/invoices/${invoice.id}/pdf`} download>
              Download PDF
            </a>
          </div>
        </div>
      )}

      {canRecordPayment && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Record a payment</h2>
          <form onSubmit={(e) => void recordPayment(e)} noValidate>
            <Field id="amount" label="Amount received (₦)" error={payError}>
              <input
                id="amount"
                inputMode="decimal"
                value={payAmount}
                placeholder={`up to ${formatNaira(outstanding)}`}
                aria-invalid={Boolean(payError)}
                aria-describedby={payError ? "amount-error" : undefined}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </Field>
            <Field id="method" label="How were you paid?">
              <select
                id="method"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as "cash" | "transfer")}
              >
                <option value="transfer">Bank transfer</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busyAction !== null}>
              {busyAction === "pay" ? "Recording…" : "Record payment"}
            </button>
          </form>
        </div>
      )}

      {(invoice.status === "draft" || canRecordPayment) && (
        <div className="card">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busyAction !== null}
            onClick={() => {
              if (window.confirm(`Void ${invoice.number}? This cannot be undone.`)) {
                void act("void", () => api.post(`/api/invoices/${invoice.id}/void`), "Invoice voided");
              }
            }}
          >
            {busyAction === "void" ? "Voiding…" : "Void invoice"}
          </button>
        </div>
      )}
    </>
  );
}

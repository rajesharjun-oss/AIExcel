import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type Customer } from "../lib/api.js";
import { formatNaira, parseNairaToKobo } from "../lib/money.js";
import { ErrorAlert, Field, ListSkeleton } from "../components/ui.js";

interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
}

const emptyLine = (): DraftLine => ({ description: "", quantity: "1", unitPrice: "" });

export function NewInvoicePage({ chargesVat }: { chargesVat: boolean }) {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ customers: Customer[] }>("/api/customers?limit=100");
        setCustomers(res.customers);
        const first = res.customers[0];
        if (first) setCustomerId(first.id);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Something went wrong");
      }
    })();
  }, []);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function parsedLines(): Array<{ description: string; quantity: number; unitPriceKobo: number }> | string {
    const out: Array<{ description: string; quantity: number; unitPriceKobo: number }> = [];
    for (const [i, l] of lines.entries()) {
      if (l.description.trim() === "" && l.unitPrice.trim() === "") continue; // ignore fully empty rows
      if (l.description.trim() === "") return `Item ${i + 1}: add a description`;
      const qty = Number(l.quantity);
      if (!Number.isInteger(qty) || qty < 1) return `Item ${i + 1}: quantity must be a whole number of at least 1`;
      const kobo = parseNairaToKobo(l.unitPrice);
      if (kobo === null) return `Item ${i + 1}: enter a valid price, e.g. 12,500`;
      out.push({ description: l.description.trim(), quantity: qty, unitPriceKobo: kobo });
    }
    if (out.length === 0) return "Add at least one item";
    return out;
  }

  const preview = (() => {
    const parsed = parsedLines();
    if (typeof parsed === "string") return null;
    const subtotal = parsed.reduce((s, l) => s + l.quantity * l.unitPriceKobo, 0);
    const vat = chargesVat ? Math.floor((subtotal * 750 + 5000) / 10_000) : 0;
    return { subtotal, vat, total: subtotal + vat };
  })();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!customerId) {
      setFormError("Choose a customer first");
      return;
    }
    const parsed = parsedLines();
    if (typeof parsed === "string") {
      setFormError(parsed);
      return;
    }
    const due = new Date(`${dueDate}T23:59:59`);
    if (Number.isNaN(due.getTime())) {
      setFormError("Pick a valid due date");
      return;
    }
    setBusy(true);
    try {
      const inv = await api.post<{ id: string }>("/api/invoices", {
        customerId,
        dueDate: due.getTime(),
        items: parsed,
      });
      navigate(`/invoices/${inv.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save. Check your connection.");
      setBusy(false);
    }
  }

  if (loadError) return <ErrorAlert message={loadError} />;
  if (!customers) return <ListSkeleton rows={5} />;

  if (customers.length === 0) {
    return (
      <div className="card empty">
        <p>You need a customer before you can invoice. Add one first.</p>
        <a href="/customers" className="btn btn-primary">
          Add a customer
        </a>
      </div>
    );
  }

  return (
    <>
      <h1>New invoice</h1>
      <ErrorAlert message={formError} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="card">
          <Field id="customer" label="Customer">
            <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="due" label="Due date">
            <input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Items</h2>
          {lines.map((l, i) => (
            <fieldset key={i} style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
              <legend className="visually-hidden">Item {i + 1}</legend>
              <Field id={`desc-${i}`} label={`Description${lines.length > 1 ? ` (item ${i + 1})` : ""}`}>
                <input
                  id={`desc-${i}`}
                  value={l.description}
                  placeholder="e.g. Bag of rice 50kg"
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                <Field id={`qty-${i}`} label="Qty">
                  <input
                    id={`qty-${i}`}
                    inputMode="numeric"
                    value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  />
                </Field>
                <Field id={`price-${i}`} label="Unit price (₦)">
                  <input
                    id={`price-${i}`}
                    inputMode="decimal"
                    value={l.unitPrice}
                    placeholder="12,500"
                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                  />
                </Field>
              </div>
            </fieldset>
          ))}
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setLines((p) => [...p, emptyLine()])}>
              + Add item
            </button>
            {lines.length > 1 && (
              <button type="button" className="btn btn-danger" onClick={() => setLines((p) => p.slice(0, -1))}>
                Remove last item
              </button>
            )}
          </div>

          {preview && (
            <div className="totals" aria-live="polite">
              <div className="line">
                <span>Subtotal</span>
                <span>{formatNaira(preview.subtotal)}</span>
              </div>
              <div className="line">
                <span>VAT (7.5%)</span>
                <span>{chargesVat ? formatNaira(preview.vat) : "Not charged"}</span>
              </div>
              <div className="line grand">
                <span>Total</span>
                <span>{formatNaira(preview.total)}</span>
              </div>
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating…" : "Create invoice"}
        </button>
      </form>
    </>
  );
}

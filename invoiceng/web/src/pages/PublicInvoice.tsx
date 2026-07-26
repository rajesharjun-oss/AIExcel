import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { api, ApiError, type PublicInvoice } from "../lib/api.js";
import { formatDate, formatNaira } from "../lib/money.js";
import { ErrorAlert, Field, ListSkeleton } from "../components/ui.js";

export function PublicInvoicePage() {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        setInvoice(await api.get<PublicInvoice>(`/api/pub/invoices/${token}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : "Something went wrong");
      }
    })();
  }, [token]);

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Enter the email address for your payment receipt");
      return;
    }
    setEmailError(undefined);
    setPaying(true);
    setError(null);
    try {
      const res = await api.post<{ authorizationUrl: string }>(`/api/pub/invoices/${token}/pay`, { email });
      window.location.assign(res.authorizationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the payment. Try again.");
      setPaying(false);
    }
  }

  if (notFound) {
    return (
      <div className="auth-wrap">
        <div className="card empty">
          <p>This invoice link is not valid or has been removed. Please contact the business that sent it.</p>
        </div>
      </div>
    );
  }
  if (error && !invoice) {
    return (
      <div className="auth-wrap">
        <ErrorAlert message={error} />
      </div>
    );
  }
  if (!invoice) {
    return (
      <div className="auth-wrap">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  const outstanding = invoice.totalKobo - invoice.paidKobo;

  return (
    <div className="auth-wrap" style={{ maxWidth: 560 }}>
      <header style={{ margin: "16px 0" }}>
        <p className="row-sub" style={{ margin: 0 }}>
          Invoice from
        </p>
        <h1 style={{ margin: "2px 0" }}>{invoice.businessName}</h1>
        <p className="row-sub">
          {invoice.number} · for {invoice.customerName} · due {formatDate(invoice.dueDate)}
        </p>
      </header>

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
          {invoice.paidKobo > 0 && (
            <>
              <div className="line">
                <span>Already paid</span>
                <span>{formatNaira(invoice.paidKobo)}</span>
              </div>
              <div className="line grand">
                <span>Balance</span>
                <span>{formatNaira(outstanding)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {invoice.status === "paid" ? (
        <div className="alert alert-ok" role="status">
          This invoice is fully paid. Thank you!
        </div>
      ) : invoice.paymentsEnabled ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pay {formatNaira(outstanding)} now</h2>
          <ErrorAlert message={error} />
          <form onSubmit={(e) => void pay(e)} noValidate>
            <Field id="email" label="Your email (for the receipt)" error={emailError}>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? "email-error" : undefined}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() =>
                  setEmailError(
                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === ""
                      ? undefined
                      : "Enter a valid email address",
                  )
                }
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-block" disabled={paying}>
              {paying ? "Starting secure payment…" : "Pay securely with Paystack"}
            </button>
          </form>
        </div>
      ) : (
        <div className="card">
          <p style={{ margin: 0 }}>
            To pay, contact {invoice.businessName} directly — bank transfer details are usually in the
            invoice notes{invoice.notes ? `: ${invoice.notes}` : "."}
          </p>
        </div>
      )}
    </div>
  );
}

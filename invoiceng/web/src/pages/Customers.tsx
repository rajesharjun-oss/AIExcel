import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Customer } from "../lib/api.js";
import { ErrorAlert, Field, ListSkeleton, LiveStatus } from "../components/ui.js";

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);

  async function load() {
    try {
      const res = await api.get<{ customers: Customer[] }>("/api/customers?limit=100");
      setCustomers(res.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function validatePhone(value: string): string | undefined {
    if (value.trim() === "") return undefined; // phone is optional
    if (!/^(\+?234|0)?[789][01]\d{8}$/.test(value.replace(/[\s-]/g, ""))) {
      return "Enter a valid Nigerian mobile number or leave blank";
    }
    return undefined;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (name.trim().length === 0) {
      setFormError("Customer name is required");
      return;
    }
    const pErr = validatePhone(phone);
    setPhoneError(pErr);
    if (pErr) return;

    setBusy(true);
    try {
      await api.post("/api/customers", {
        name: name.trim(),
        ...(phone.trim() !== "" ? { phone: phone.trim() } : {}),
      });
      setName("");
      setPhone("");
      setShowForm(false);
      setAnnounce("Customer added");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Customers</h1>
      <ErrorAlert message={error} />
      <LiveStatus message={announce} />

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ Add customer"}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <ErrorAlert message={formError} />
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <Field id="cname" label="Name">
              <input id="cname" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field
              id="cphone"
              label="WhatsApp / phone number (optional)"
              error={phoneError}
              hint="Needed for WhatsApp and SMS payment reminders"
            >
              <input
                id="cphone"
                type="tel"
                inputMode="tel"
                value={phone}
                aria-invalid={Boolean(phoneError)}
                aria-describedby={phoneError ? "cphone-error" : "cphone-hint"}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={(e) => setPhoneError(validatePhone(e.target.value))}
              />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save customer"}
            </button>
          </form>
        </div>
      )}

      {!customers && !error ? (
        <ListSkeleton rows={5} />
      ) : customers && customers.length === 0 ? (
        <div className="card empty">
          <p>No customers yet. Add the people who buy from you, then invoice them in seconds.</p>
        </div>
      ) : customers ? (
        <div className="card">
          <ul className="list">
            {customers.map((c) => (
              <li key={c.id}>
                <div className="row-link" style={{ cursor: "default" }}>
                  <div className="row-main">
                    <div className="row-title">{c.name}</div>
                    <div className="row-sub">{c.phone ?? "no phone — reminders off"}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

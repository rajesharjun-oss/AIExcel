import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type ReminderSettings } from "../lib/api.js";
import { ErrorAlert, Field, ListSkeleton, LiveStatus } from "../components/ui.js";

export function SettingsPage() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await api.get<ReminderSettings>("/api/reminders/settings"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch("/api/reminders/settings", settings);
      setAnnounce("Reminder settings saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <ErrorAlert message={error} />;
  if (!settings) return <ListSkeleton rows={4} />;

  return (
    <>
      <h1>Reminder settings</h1>
      <ErrorAlert message={error} />
      <LiveStatus message={announce} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="card">
          <div className="field">
            <label htmlFor="enabled" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="enabled"
                type="checkbox"
                checked={settings.enabled}
                style={{ width: 20, height: 20 }}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              Automatically remind customers who owe you
            </label>
          </div>
          <Field
            id="before"
            label="Nudge before the due date (days)"
            hint="0 turns the early nudge off"
          >
            <input
              id="before"
              inputMode="numeric"
              value={String(settings.daysBeforeDue)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0 && n <= 30) {
                  setSettings({ ...settings, daysBeforeDue: n });
                }
              }}
            />
          </Field>
          <Field id="every" label="After the due date, remind every (days)">
            <input
              id="every"
              inputMode="numeric"
              value={String(settings.everyNDaysAfterDue)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 30) {
                  setSettings({ ...settings, everyNDaysAfterDue: n });
                }
              }}
            />
          </Field>
          <Field id="max" label="Stop after this many reminders">
            <input
              id="max"
              inputMode="numeric"
              value={String(settings.maxAfterDueCount)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0 && n <= 20) {
                  setSettings({ ...settings, maxAfterDueCount: n });
                }
              }}
            />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <h2>Your data</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Everything you record here is yours. Download it any time — it opens in Excel or Google
          Sheets.
        </p>
        <div className="actions">
          <a className="btn btn-secondary" href="/api/export/invoices.csv" download>
            Invoices (CSV)
          </a>
          <a className="btn btn-secondary" href="/api/export/customers.csv" download>
            Customers (CSV)
          </a>
          <a className="btn btn-secondary" href="/api/export/payments.csv" download>
            Payments (CSV)
          </a>
        </div>
      </div>
    </>
  );
}

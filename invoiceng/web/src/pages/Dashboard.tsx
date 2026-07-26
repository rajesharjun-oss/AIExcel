import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Invoice, type Me, type OutboxReminder } from "../lib/api.js";
import { formatNaira, isOverdue } from "../lib/money.js";
import { ErrorAlert, ListSkeleton, LiveStatus, StatusPill } from "../components/ui.js";

type Data = { invoices: Invoice[]; outbox: OutboxReminder[] };

export function Dashboard({ me }: { me: Me }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inv, out] = await Promise.all([
        api.get<{ invoices: Invoice[] }>("/api/invoices?limit=100"),
        api.get<{ outbox: OutboxReminder[] }>("/api/reminders/outbox"),
      ]);
      setData({ invoices: inv.invoices, outbox: out.outbox });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markSent(id: string) {
    try {
      await api.post(`/api/reminders/${id}/mark-sent`);
      setAnnounce("Reminder marked as sent");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const open = data?.invoices.filter((i) => i.status === "sent" || i.status === "part_paid") ?? [];
  const outstandingKobo = open.reduce((sum, i) => sum + (i.totalKobo - i.paidKobo), 0);
  const overdueCount = open.filter((i) => isOverdue(i)).length;

  return (
    <>
      <h1>
        {greeting()}, {me.name.split(" ")[0]}
      </h1>
      <ErrorAlert message={error} />
      <LiveStatus message={announce} />

      {!data && !error ? (
        <ListSkeleton rows={5} />
      ) : data ? (
        <>
          <div className="stat-row">
            <div className="card stat">
              <div className="label">Customers owing you</div>
              <div className="value">{formatNaira(outstandingKobo)}</div>
            </div>
            <div className={`card stat${overdueCount > 0 ? " warn" : ""}`}>
              <div className="label">Overdue invoices</div>
              <div className="value">{overdueCount}</div>
            </div>
          </div>

          <div className="actions">
            <Link to="/invoices/new" className="btn btn-primary">
              + New invoice
            </Link>
          </div>

          {data.outbox.length > 0 && (
            <section aria-labelledby="outbox-h">
              <h2 id="outbox-h">WhatsApp reminders to send ({data.outbox.length})</h2>
              <div className="card">
                <ul className="list">
                  {data.outbox.map((r) => (
                    <li key={r.id}>
                      <div className="row-link" style={{ cursor: "default" }}>
                        <div className="row-main">
                          <div className="row-title">{r.customerName}</div>
                          <div className="row-sub">
                            {r.invoiceNumber} · {r.seq === 0 ? "due soon" : `reminder ${r.seq}`}
                          </div>
                        </div>
                        <div className="row-side" style={{ display: "flex", gap: 8 }}>
                          {r.waLink && (
                            <a
                              className="btn btn-wa"
                              href={r.waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => void markSent(r.id)}
                            >
                              Send on WhatsApp
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section aria-labelledby="recent-h">
            <h2 id="recent-h">Recent invoices</h2>
            <div className="card">
              {data.invoices.length === 0 ? (
                <div className="empty">
                  <p>No invoices yet. Create your first one — it takes under a minute.</p>
                  <Link to="/invoices/new" className="btn btn-primary">
                    Create an invoice
                  </Link>
                </div>
              ) : (
                <ul className="list">
                  {data.invoices.slice(0, 8).map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/invoices/${inv.id}`} className="row-link">
                        <div className="row-main">
                          <div className="row-title">{inv.number}</div>
                          <div className="row-sub">{formatNaira(inv.totalKobo - inv.paidKobo)} outstanding</div>
                        </div>
                        <div className="row-side">
                          <StatusPill status={inv.status} overdue={isOverdue(inv)} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

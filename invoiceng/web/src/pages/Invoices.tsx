import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Invoice } from "../lib/api.js";
import { formatNaira, formatDate, isOverdue } from "../lib/money.js";
import { ErrorAlert, ListSkeleton, StatusPill } from "../components/ui.js";

const PAGE_SIZE = 50;

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ invoices: Invoice[] }>(`/api/invoices?limit=${PAGE_SIZE}&offset=0`);
        setInvoices(res.invoices);
        setHasMore(res.invoices.length === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    })();
  }, []);

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const res = await api.get<{ invoices: Invoice[] }>(
        `/api/invoices?limit=${PAGE_SIZE}&offset=${nextOffset}`,
      );
      setInvoices((prev) => [...(prev ?? []), ...res.invoices]);
      setOffset(nextOffset);
      setHasMore(res.invoices.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <h1>Invoices</h1>
      <div className="actions">
        <Link to="/invoices/new" className="btn btn-primary">
          + New invoice
        </Link>
      </div>
      <ErrorAlert message={error} />
      {!invoices && !error ? (
        <ListSkeleton rows={6} />
      ) : invoices && invoices.length === 0 ? (
        <div className="card empty">
          <p>Nothing here yet. Your invoices will show up in this list.</p>
          <Link to="/invoices/new" className="btn btn-primary">
            Create your first invoice
          </Link>
        </div>
      ) : invoices ? (
        <div className="card">
          <ul className="list">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link to={`/invoices/${inv.id}`} className="row-link">
                  <div className="row-main">
                    <div className="row-title">{inv.number}</div>
                    <div className="row-sub">
                      due {formatDate(inv.dueDate)} · {formatNaira(inv.totalKobo)}
                    </div>
                  </div>
                  <div className="row-side">
                    <StatusPill status={inv.status} overdue={isOverdue(inv)} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router";
import { api, ApiError, NetworkError, type Me } from "./lib/api.js";
import { AuthPage } from "./pages/Auth.js";
import { Dashboard } from "./pages/Dashboard.js";
import { CustomersPage } from "./pages/Customers.js";
import { NewInvoicePage } from "./pages/NewInvoice.js";
import { InvoiceDetailPage } from "./pages/InvoiceDetail.js";
import { InvoicesPage } from "./pages/Invoices.js";
import { SettingsPage } from "./pages/Settings.js";
import { PublicInvoicePage } from "./pages/PublicInvoice.js";
import { ErrorAlert } from "./components/ui.js";

type AuthState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; me: Me }
  | { kind: "offline" };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const navigate = useNavigate();

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.get<Me>("/api/auth/me");
      setAuth({ kind: "authed", me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuth({ kind: "anonymous" });
      } else if (err instanceof NetworkError) {
        setAuth({ kind: "offline" });
      } else {
        setAuth({ kind: "anonymous" });
      }
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Even if the server is unreachable the local session view resets;
      // the cookie is HttpOnly so the server remains the source of truth.
    }
    setAuth({ kind: "anonymous" });
    navigate("/");
  }, [navigate]);

  return (
    <Routes>
      {/* Customer-facing page: no auth, no app chrome. */}
      <Route path="/i/:token" element={<PublicInvoicePage />} />
      <Route
        path="/*"
        element={
          auth.kind === "loading" ? (
            <div className="auth-wrap">
              <div className="auth-logo">
                Invoice<span>NG</span>
              </div>
              <div className="skeleton" style={{ height: 120 }} aria-hidden="true" />
              <p className="visually-hidden" role="status">
                Loading your account
              </p>
            </div>
          ) : auth.kind === "offline" ? (
            <div className="auth-wrap">
              <div className="auth-logo">
                Invoice<span>NG</span>
              </div>
              <ErrorAlert message="Could not reach the server. Check your connection." />
              <button type="button" className="btn btn-primary btn-block" onClick={() => void refreshMe()}>
                Try again
              </button>
            </div>
          ) : auth.kind === "anonymous" ? (
            <AuthPage onAuthed={() => void refreshMe()} />
          ) : (
            <AppShell me={auth.me} onLogout={() => void logout()} />
          )
        }
      />
    </Routes>
  );
}

function AppShell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          Invoice<span>NG</span>
        </NavLink>
        <button type="button" className="btn btn-secondary" style={{ minHeight: 36, padding: "4px 12px" }} onClick={onLogout}>
          Sign out
        </button>
      </header>
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<Dashboard me={me} />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/new" element={<NewInvoicePage chargesVat={me.chargesVat} />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/invoices">Invoices</NavLink>
        <NavLink to="/customers">Customers</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api.js";
import { ErrorAlert, Field } from "../components/ui.js";

type Mode = "login" | "signup";

export function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");

  function validateField(field: string, value: string): string | undefined {
    if (field === "phone" && !/^(\+?234|0)?[789][01]\d{8}$/.test(value.replace(/[\s-]/g, ""))) {
      return "Enter a valid Nigerian mobile number, e.g. 0803 123 4567";
    }
    if (field === "password" && mode === "signup" && value.length < 8) {
      return "Use at least 8 characters";
    }
    if ((field === "businessName" || field === "name") && value.trim().length < 2) {
      return "This field is required";
    }
    return undefined;
  }

  function onBlur(field: string, value: string) {
    const err = validateField(field, value);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const checks: Array<[string, string]> =
      mode === "signup"
        ? [
            ["businessName", businessName],
            ["name", name],
            ["phone", phone],
            ["password", password],
          ]
        : [["phone", phone]];
    const errs: Record<string, string> = {};
    for (const [f, v] of checks) {
      const err = validateField(f, v);
      if (err) errs[f] = err;
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      if (mode === "signup") {
        await api.post("/api/auth/signup", { businessName, name, phone, password });
      } else {
        await api.post("/api/auth/login", { phone, password });
      }
      onAuthed();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        Invoice<span>NG</span>
      </div>
      <div className="card">
        <h1 style={{ fontSize: 20, marginTop: 0 }}>
          {mode === "login" ? "Welcome back" : "Create your business account"}
        </h1>
        <ErrorAlert message={formError} />
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          {mode === "signup" && (
            <>
              <Field id="businessName" label="Business name" error={fieldErrors["businessName"]}>
                <input
                  id="businessName"
                  value={businessName}
                  autoComplete="organization"
                  aria-invalid={Boolean(fieldErrors["businessName"])}
                  aria-describedby={fieldErrors["businessName"] ? "businessName-error" : undefined}
                  onChange={(e) => setBusinessName(e.target.value)}
                  onBlur={(e) => onBlur("businessName", e.target.value)}
                />
              </Field>
              <Field id="name" label="Your name" error={fieldErrors["name"]}>
                <input
                  id="name"
                  value={name}
                  autoComplete="name"
                  aria-invalid={Boolean(fieldErrors["name"])}
                  aria-describedby={fieldErrors["name"] ? "name-error" : undefined}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={(e) => onBlur("name", e.target.value)}
                />
              </Field>
            </>
          )}
          <Field id="phone" label="Phone number" error={fieldErrors["phone"]} hint="e.g. 0803 123 4567">
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              autoComplete="tel"
              aria-invalid={Boolean(fieldErrors["phone"])}
              aria-describedby={fieldErrors["phone"] ? "phone-error" : "phone-hint"}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={(e) => onBlur("phone", e.target.value)}
            />
          </Field>
          <Field id="password" label="Password" error={fieldErrors["password"]}>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              aria-invalid={Boolean(fieldErrors["password"])}
              aria-describedby={fieldErrors["password"] ? "password-error" : undefined}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={(e) => onBlur("password", e.target.value)}
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
      <p className="auth-switch">
        {mode === "login" ? (
          <>
            New here?{" "}
            <button type="button" className="btn btn-secondary" onClick={() => setMode("signup")}>
              Create an account
            </button>
          </>
        ) : (
          <>
            Already registered?{" "}
            <button type="button" className="btn btn-secondary" onClick={() => setMode("login")}>
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}

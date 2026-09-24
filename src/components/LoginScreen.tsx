import React, { useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  status: "ACTIVE" | "LOCKED" | "CLOSED";
}

interface LoginScreenProps {
  onAuthenticated: (user: AuthenticatedUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.authenticated || !payload?.user) {
        throw new Error(payload?.error || "Authentication failed.");
      }
      onAuthenticated(payload.user as AuthenticatedUser);
    } catch (err: any) {
      setError(err?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/90 shadow-2xl shadow-black/30 overflow-hidden">
          <div className="px-6 py-5 border-b border-neutral-800">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-center">
                <LockKeyhole className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-neutral-500">
                  Jarvis Finance
                </div>
                <h1 className="text-xl font-semibold text-neutral-100">Authenticated workspace</h1>
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="p-6 space-y-4">
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2.5 flex gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-200/80">
                Account and exchange data stay behind a server-side authenticated session.
                Market data can remain publicly readable.
              </p>
            </div>

            <label className="block">
              <span className="text-[10px] font-mono uppercase text-neutral-500">Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-amber-700"
                placeholder="operator@example.com"
                required
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-mono uppercase text-neutral-500">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-amber-700"
                required
              />
            </label>

            {error && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2.5 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-amber-500 text-neutral-950 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "AUTHENTICATING…" : "SIGN IN"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

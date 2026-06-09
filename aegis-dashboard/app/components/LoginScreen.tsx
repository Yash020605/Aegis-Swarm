"use client";

import { useState, FormEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface Props {
  onAuthenticated: (token: string) => void;
}

export default function LoginScreen({ onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // FastAPI /token expects application/x-www-form-urlencoded
      const body = new URLSearchParams();
      body.append("username", username);
      body.append("password", password);

      const res = await fetch(`${API_BASE}/token`, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    body.toString(),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.detail ?? "Authentication failed. Check credentials.");
        return;
      }

      const data = await res.json() as { access_token: string; token_type: string };
      // Persist token in sessionStorage so a page refresh asks for login again
      sessionStorage.setItem("aegis_jwt", data.access_token);
      onAuthenticated(data.access_token);
    } catch {
      setError("Cannot reach Aegis server. Ensure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    /* Full-screen overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden select-none"
      style={{
        background: "radial-gradient(ellipse at center, #0d1a2a 0%, #040810 100%)",
      }}
    >
      {/* Scanline pseudo-effect via repeating-linear-gradient */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, #00f5ff, #00f5ff 1px, transparent 1px, transparent 4px)",
        }}
      />

      {/* Centered card */}
      <div
        className="relative z-10 w-full max-w-sm mx-4 rounded-lg border p-8 flex flex-col gap-6"
        style={{
          background:   "linear-gradient(160deg, #0d1520 0%, #09101a 100%)",
          borderColor:  "rgba(0,245,255,0.18)",
          boxShadow:    "0 0 60px rgba(0,245,255,0.06), 0 0 120px rgba(0,0,0,0.8)",
        }}
      >
        {/* Top accent bar */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px] rounded-t-lg"
          style={{ background: "linear-gradient(90deg, transparent, #00f5ff, transparent)" }}
        />

        {/* Logo & Title */}
        <div className="flex flex-col items-center gap-3">
          <svg width="52" height="52" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <polygon
              points="18,2 34,32 18,26 2,32"
              fill="none"
              stroke="#00f5ff"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <polygon
              points="18,10 28,28 18,24 8,28"
              fill="#00f5ff"
              fillOpacity="0.15"
              stroke="#00f5ff"
              strokeWidth="0.8"
              strokeLinejoin="round"
            />
            <line x1="18" y1="2" x2="18" y2="26" stroke="#00f5ff" strokeWidth="0.8" strokeOpacity="0.5" />
          </svg>

          <div className="text-center">
            <h1
              className="text-lg font-bold uppercase tracking-[0.3em]"
              style={{
                color:      "#00f5ff",
                textShadow: "0 0 14px #00f5ff, 0 0 30px rgba(0,245,255,0.3)",
              }}
            >
              AEGIS SWARM
            </h1>
            <p className="text-[9px] uppercase tracking-[0.35em] mt-1" style={{ color: "rgba(0,245,255,0.4)" }}>
              COMMAND CENTER — SECURE ACCESS
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px" style={{ background: "rgba(0,245,255,0.10)" }} />

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Username */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="username"
              className="text-[9px] uppercase tracking-widest"
              style={{ color: "rgba(0,245,255,0.45)" }}
            >
              Operator ID
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="admin"
              className="w-full rounded border px-3 py-2 text-sm outline-none transition-all"
              style={{
                background:   "rgba(0,245,255,0.04)",
                borderColor:  "rgba(0,245,255,0.18)",
                color:        "#e0f7ff",
                caretColor:   "#00f5ff",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,245,255,0.55)")}
              onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,245,255,0.18)")}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[9px] uppercase tracking-widest"
              style={{ color: "rgba(0,245,255,0.45)" }}
            >
              Access Code
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full rounded border px-3 py-2 text-sm outline-none transition-all"
              style={{
                background:   "rgba(0,245,255,0.04)",
                borderColor:  "rgba(0,245,255,0.18)",
                color:        "#e0f7ff",
                caretColor:   "#00f5ff",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,245,255,0.55)")}
              onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,245,255,0.18)")}
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded border px-3 py-2 text-xs"
              style={{
                borderColor: "rgba(255,32,32,0.35)",
                background:  "rgba(255,32,32,0.06)",
                color:       "#ff6060",
              }}
              role="alert"
            >
              ⚠ {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded py-2.5 text-xs font-bold uppercase tracking-[0.25em] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background:  loading
                ? "rgba(0,245,255,0.08)"
                : "linear-gradient(135deg, rgba(0,245,255,0.12), rgba(0,245,255,0.06))",
              border:      "1px solid rgba(0,245,255,0.30)",
              color:       "#00f5ff",
              boxShadow:   loading ? "none" : "0 0 20px rgba(0,245,255,0.08)",
            }}
          >
            {loading ? "AUTHENTICATING…" : "INITIATE SECURE SESSION"}
          </button>
        </form>

        {/* Footer hint */}
        <p
          className="text-center text-[9px] uppercase tracking-widest"
          style={{ color: "rgba(0,245,255,0.20)" }}
        >
          Unauthorized access is prohibited · AEGIS v2.0
        </p>

        {/* Bottom accent bar */}
        <div
          className="absolute bottom-0 left-0 right-0 h-[1px] rounded-b-lg"
          style={{ background: "linear-gradient(90deg, transparent, rgba(0,245,255,0.25), transparent)" }}
        />
      </div>
    </div>
  );
}

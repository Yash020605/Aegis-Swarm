"use client";

import { useState, FormEvent } from "react";
import type { LaunchStation } from "../types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface Props {
  token: string;
  current: LaunchStation | null;
  onUpdated: (ls: LaunchStation) => void;
}

/**
 * REFINE LOGIC 2 — Bounded Human-In-The-Loop Launch Setup
 *
 * Lets the field rescue worker set the calamity boundary focus point /
 * launch station coordinates before deploying the swarm.
 * Sends a POST /launch-station request to the backend.
 */
export default function LaunchStationPanel({ token, current, onUpdated }: Props) {
  const [x,       setX]       = useState<string>(current ? String(current.x) : "500");
  const [y,       setY]       = useState<string>(current ? String(current.y) : "500");
  const [status,  setStatus]  = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errMsg,  setErrMsg]  = useState<string>("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setErrMsg("");

    const nx = parseFloat(x);
    const ny = parseFloat(y);
    if (isNaN(nx) || isNaN(ny) || nx < 0 || nx > 999 || ny < 0 || ny > 999) {
      setErrMsg("Coordinates must be numbers in the range [0, 999].");
      setStatus("error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/launch-station`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ x: nx, y: ny }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrMsg(data?.detail ?? "Failed to update launch station.");
        setStatus("error");
        return;
      }

      const data = await res.json() as { x: number; y: number };
      onUpdated({ x: data.x, y: data.y });
      setX(String(data.x));
      setY(String(data.y));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setErrMsg("Cannot reach Aegis server.");
      setStatus("error");
    }
  };

  const isBusy = status === "saving";

  return (
    <div
      className="rounded border p-3 flex flex-col gap-2"
      style={{
        borderColor: "rgba(245,158,11,0.25)",
        background:  "linear-gradient(135deg, rgba(245,158,11,0.04), rgba(0,0,0,0))",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span style={{ color: "#f59e0b", fontSize: "11px" }}>◈</span>
        <span
          className="text-[10px] uppercase tracking-[0.2em] font-semibold"
          style={{ color: "rgba(245,158,11,0.75)" }}
        >
          CALAMITY BOUNDARY FOCUS POINT
        </span>
        <div className="flex-1 h-px" style={{ background: "rgba(245,158,11,0.12)" }} />
      </div>

      {/* Current live coords */}
      {current && (
        <p className="text-[9px] uppercase tracking-wider" style={{ color: "rgba(245,158,11,0.45)" }}>
          Live station →&nbsp;
          <span style={{ color: "rgba(245,158,11,0.75)" }}>
            ({current.x.toFixed(0)}, {current.y.toFixed(0)})
          </span>
        </p>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <CoordInput
          id="ls-x"
          label="X (0–999)"
          value={x}
          onChange={setX}
          disabled={isBusy}
        />
        <CoordInput
          id="ls-y"
          label="Y (0–999)"
          value={y}
          onChange={setY}
          disabled={isBusy}
        />
        <button
          type="submit"
          disabled={isBusy}
          className="shrink-0 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
          style={{
            border:     "1px solid rgba(245,158,11,0.40)",
            background: isBusy ? "rgba(245,158,11,0.04)" : "rgba(245,158,11,0.10)",
            color:      "#f59e0b",
          }}
          onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = "rgba(245,158,11,0.20)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = isBusy ? "rgba(245,158,11,0.04)" : "rgba(245,158,11,0.10)"; }}
          aria-label="Set launch station coordinates"
        >
          {isBusy ? "SETTING…" : "SET LAUNCH"}
        </button>
      </form>

      {/* Feedback */}
      {status === "saved" && (
        <p className="text-[9px] text-green-400 uppercase tracking-wider">
          ✓ Launch station updated — drones will RTH to new coordinates.
        </p>
      )}
      {status === "error" && (
        <p className="text-[9px] text-red-400 uppercase tracking-wider">
          ⚠ {errMsg}
        </p>
      )}
    </div>
  );
}

function CoordInput({
  id, label, value, onChange, disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 w-24">
      <label
        htmlFor={id}
        className="text-[8px] uppercase tracking-widest"
        style={{ color: "rgba(245,158,11,0.50)" }}
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={999}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded border px-2 py-1.5 text-xs outline-none transition-all"
        style={{
          background:  "rgba(245,158,11,0.04)",
          borderColor: "rgba(245,158,11,0.25)",
          color:       "#fbbf24",
          caretColor:  "#f59e0b",
        }}
        onFocus={(e)  => (e.currentTarget.style.borderColor = "rgba(245,158,11,0.65)")}
        onBlur={(e)   => (e.currentTarget.style.borderColor = "rgba(245,158,11,0.25)")}
      />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { TelemetryFrame, LaunchStation } from "./types";
import DroneCard          from "./components/DroneCard";
import MissionLog         from "./components/MissionLog";
import MetricsPanel       from "./components/MetricsPanel";
import LoginScreen        from "./components/LoginScreen";
import LaunchStationPanel from "./components/LaunchStationPanel";

// RadarGrid uses Canvas — load it client-only to avoid SSR mismatch
const RadarGrid = dynamic(() => import("./components/RadarGrid"), { ssr: false });

const WS_BASE         = process.env.NEXT_PUBLIC_WS_BASE_URL  ?? "ws://localhost:8000";
const RECONNECT_DELAY = 3000;

type ConnStatus = "connected" | "disconnected" | "connecting";

export default function AegisCommandPage() {
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("aegis_jwt");
    if (stored) setToken(stored);
  }, []);

  const handleAuthenticated = (jwt: string) => setToken(jwt);

  const handleLogout = () => {
    sessionStorage.removeItem("aegis_jwt");
    setToken(null);
    setFrame(null);
    setConnStatus("disconnected");
  };

  // ── Telemetry state ────────────────────────────────────────────────────────
  const [frame,      setFrame]      = useState<TelemetryFrame | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>("connecting");
  const [lastUpdate, setLastUpdate] = useState<string>("—");

  // REFINE LOGIC 2 — local launch station state (seeded from first WS frame)
  const [launchStation, setLaunchStation] = useState<LaunchStation | null>(null);

  const wsRef       = useRef<WebSocket | null>(null);
  const reconnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef  = useRef(true);

  // ── WebSocket connect / reconnect ──────────────────────────────────────────
  const connect = useCallback((jwt: string) => {
    if (!mountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.onclose   = null;
      wsRef.current.onerror   = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnStatus("connecting");

    const url = `${WS_BASE}/ws/telemetry?token=${encodeURIComponent(jwt)}`;
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnStatus("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const data: TelemetryFrame = JSON.parse(event.data as string);
        setFrame(data);
        // Sync launch station from backend frame
        if (data.launch_station) {
          setLaunchStation(data.launch_station);
        }
        const now = new Date();
        setLastUpdate(
          `${String(now.getHours()).padStart(2, "0")}:` +
          `${String(now.getMinutes()).padStart(2, "0")}:` +
          `${String(now.getSeconds()).padStart(2, "0")}.` +
          `${String(now.getMilliseconds()).padStart(3, "0")}`
        );
      } catch {
        /* Malformed frame — skip */
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setConnStatus("disconnected");
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      setConnStatus("disconnected");
      wsRef.current = null;

      if (event.code === 1008) {
        sessionStorage.removeItem("aegis_jwt");
        setToken(null);
        return;
      }

      if (reconnTimer.current) clearTimeout(reconnTimer.current);
      reconnTimer.current = setTimeout(() => {
        if (mountedRef.current && jwt) connect(jwt);
      }, RECONNECT_DELAY);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (token) connect(token);
    return () => {
      mountedRef.current = false;
      if (reconnTimer.current) clearTimeout(reconnTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose   = null;
        wsRef.current.onerror   = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, connect]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const alpha = frame?.drones.find((d) => d.drone_id === "Aegis-Alpha");
  const beta  = frame?.drones.find((d) => d.drone_id === "Aegis-Beta");

  const statusMeta = {
    connected:    { dot: "bg-green-400", label: "CONNECTED",   glow: "shadow-[0_0_8px_#39ff14]" },
    disconnected: { dot: "bg-red-500",   label: "OFFLINE",     glow: "shadow-[0_0_8px_#ff2020]" },
    connecting:   { dot: "bg-amber-400", label: "CONNECTING…", glow: "shadow-[0_0_8px_#ffaa00]" },
  }[connStatus];

  if (!token) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden select-none"
      style={{ background: "#0a0a0a", color: "#ededed" }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center justify-between px-6 py-3 border-b relative"
        style={{
          borderColor: "rgba(0,245,255,0.15)",
          background:  "linear-gradient(180deg, #0d1520 0%, #0a0e18 100%)",
          boxShadow:   "0 1px 0 rgba(0,245,255,0.08), 0 4px 20px rgba(0,0,0,0.5)",
        }}
      >
        {/* Left — branding */}
        <div className="flex items-center gap-4">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
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
            <line x1="18" y1="2" x2="18" y2="26" stroke="#00f5ff" strokeWidth="0.8" strokeOpacity="0.4" />
          </svg>
          <div>
            <h1
              className="text-xl font-bold uppercase tracking-[0.25em] leading-none"
              style={{
                color:      "#00f5ff",
                textShadow: "0 0 12px #00f5ff, 0 0 30px rgba(0,245,255,0.3)",
              }}
            >
              AEGIS SWARM COMMAND
            </h1>
            {/* REFINE LOGIC 1 — middleware layer subtitle */}
            <p className="text-[9px] uppercase tracking-[0.2em] mt-0.5" style={{ color: "rgba(0,245,255,0.45)" }}>
              AGNOSTIC MIDDLEWARE LAYER · ESP-NOW MESH · CALAMITY ZONE 1000×1000m
            </p>
          </div>
        </div>

        {/* Center — metrics bar */}
        <div className="hidden lg:flex items-center gap-6">
          <HeaderStat label="DRONES ACTIVE" value="02"     color="#00f5ff" />
          <div className="w-px h-6" style={{ background: "rgba(0,245,255,0.12)" }} />
          <HeaderStat label="GRID SIZE"     value="1000m²" color="#00f5ff" />
          <div className="w-px h-6" style={{ background: "rgba(0,245,255,0.12)" }} />
          <HeaderStat
            label="SURVIVORS"
            value={String(frame?.found_survivors.length ?? 0)}
            color="#39ff14"
          />
          <div className="w-px h-6" style={{ background: "rgba(0,245,255,0.12)" }} />
          {/* REFINE LOGIC 2 — live launch station coords in header */}
          <HeaderStat
            label="LAUNCH STATION"
            value={launchStation
              ? `(${launchStation.x.toFixed(0)}, ${launchStation.y.toFixed(0)})`
              : "—"}
            color="#f59e0b"
          />
        </div>

        {/* Right — status cluster */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[8px] uppercase tracking-widest" style={{ color: "rgba(0,245,255,0.35)" }}>
              LAST FRAME
            </span>
            <span
              className="text-xs font-semibold"
              style={{ color: "rgba(0,245,255,0.6)", fontVariantNumeric: "tabular-nums" }}
            >
              {lastUpdate}
            </span>
          </div>

          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-semibold uppercase tracking-wider"
            style={{
              borderColor: connStatus === "connected"
                ? "#39ff1444" : connStatus === "connecting" ? "#ffaa0044" : "#ff202044",
              background: connStatus === "connected"
                ? "rgba(57,255,20,0.06)" : connStatus === "connecting"
                ? "rgba(255,170,0,0.06)" : "rgba(255,32,32,0.06)",
            }}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dot} ${statusMeta.glow} ${connStatus === "connecting" ? "animate-pulse" : ""}`}
            />
            <span
              style={{
                color: connStatus === "connected" ? "#39ff14"
                  : connStatus === "connecting" ? "#ffaa00" : "#ff2020",
              }}
            >
              {statusMeta.label}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded border text-[10px] font-semibold uppercase tracking-wider transition-all"
            style={{
              borderColor: "rgba(255,32,32,0.25)",
              background:  "rgba(255,32,32,0.04)",
              color:       "rgba(255,80,80,0.70)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,32,32,0.55)";
              e.currentTarget.style.color = "#ff5050";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,32,32,0.25)";
              e.currentTarget.style.color = "rgba(255,80,80,0.70)";
            }}
            aria-label="Logout from command center"
          >
            LOGOUT
          </button>
        </div>

        <div
          className="absolute bottom-0 left-0 right-0 h-[1px]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, #00f5ff44 30%, #00f5ff88 50%, #00f5ff44 70%, transparent 100%)",
          }}
        />
      </header>

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex gap-0 overflow-hidden min-h-0">

        {/* LEFT COLUMN: Radar + Launch Station Panel + Metrics */}
        <section
          className="flex flex-col gap-3 p-4 border-r shrink-0"
          style={{
            borderColor: "rgba(0,245,255,0.10)",
            background:  "linear-gradient(180deg, #0a0e14 0%, #08090f 100%)",
          }}
        >
          <div className="flex items-center justify-between">
            <SectionLabel icon="◈" text="RADAR GRID — CALAMITY ZONE" />
            <div className="flex items-center gap-3 text-[9px]" style={{ color: "rgba(0,245,255,0.40)" }}>
              <LegendDot color="#00f5ff" label="DRONE" />
              <LegendDot color="#ff2020" label="THERMAL" />
              <LegendDot color="#39ff14" label="SURVIVOR" />
              {/* REFINE LOGIC 2 — launch station legend entry */}
              <LegendDot color="#f59e0b" label="LAUNCH STN" />
            </div>
          </div>

          <div className="relative scanlines">
            <RadarGrid frame={frame} />
          </div>

          {/* REFINE LOGIC 2 — operator launch station control */}
          {token && (
            <LaunchStationPanel
              token={token}
              current={launchStation}
              onUpdated={setLaunchStation}
            />
          )}

          <MetricsPanel frame={frame} />
        </section>

        {/* RIGHT COLUMN: Drone cards + Mission log */}
        <section className="flex-1 flex flex-col gap-0 overflow-hidden min-w-0">

          <div
            className="shrink-0 p-4 border-b"
            style={{ borderColor: "rgba(0,245,255,0.10)" }}
          >
            {/* REFINE LOGIC 1 — updated section header reflects middleware stack */}
            <SectionLabel icon="◉" text="UNIT TELEMETRY — AEGIS AGNOSTIC CORE OS · ESP-NOW MESH" />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <DroneCard drone={alpha} name="Aegis-Alpha" />
              <DroneCard drone={beta}  name="Aegis-Beta"  />
            </div>
          </div>

          <div className="flex-1 flex flex-col p-4 gap-2 overflow-hidden min-h-0">
            <SectionLabel icon="▶" text="MISSION LOG — SYSTEM EVENTS" />
            <div className="flex-1 min-h-0">
              <MissionLog logs={frame?.system_logs ?? []} />
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer
        className="shrink-0 flex items-center justify-between px-6 py-1.5 border-t"
        style={{
          borderColor: "rgba(0,245,255,0.10)",
          background:  "#080c10",
        }}
      >
        {/* REFINE LOGIC 1 — middleware layer identity in footer */}
        <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(0,245,255,0.25)" }}>
          AEGIS v2.0 · AGNOSTIC MIDDLEWARE · ESP-NOW MESH
        </span>
        <span className="text-[9px]" style={{ color: "rgba(0,245,255,0.20)", fontVariantNumeric: "tabular-nums" }}>
          WS → {WS_BASE}/ws/telemetry
        </span>
        <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(0,245,255,0.25)" }}>
          JWT SECURED · 10 Hz STREAM · DYNAMIC RTH
        </span>
      </footer>
    </div>
  );
}

// ── Utility sub-components ─────────────────────────────────────────────────────

function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: "rgba(0,245,255,0.6)", fontSize: "10px" }}>{icon}</span>
      <span
        className="text-[10px] uppercase tracking-[0.2em] font-semibold"
        style={{ color: "rgba(0,245,255,0.55)" }}
      >
        {text}
      </span>
      <div className="flex-1 h-px" style={{ background: "rgba(0,245,255,0.08)" }} />
    </div>
  );
}

function HeaderStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0">
      <span className="text-sm font-bold" style={{ color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span className="text-[8px] uppercase tracking-widest" style={{ color: "rgba(0,245,255,0.35)" }}>{label}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="w-2 h-2 rounded-full inline-block"
        style={{ background: color, boxShadow: `0 0 4px ${color}` }}
      />
      <span>{label}</span>
    </div>
  );
}

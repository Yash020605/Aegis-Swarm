"use client";

import type { TelemetryFrame } from "../types";

interface Props {
  frame: TelemetryFrame | null;
}

export default function MetricsPanel({ frame }: Props) {
  const activeThermals  = frame?.active_thermals.filter((t) => !t.found).length ?? 0;
  const foundSurvivors  = frame?.found_survivors.length ?? 0;
  const tick            = frame?.tick ?? 0;
  // Uptime in seconds (approx at 10 Hz)
  const uptimeSec       = Math.floor(tick / 10);
  const mm = String(Math.floor(uptimeSec / 60)).padStart(2, "0");
  const ss = String(uptimeSec % 60).padStart(2, "0");

  const metrics = [
    { label: "ACTIVE THERMALS", value: String(activeThermals), color: activeThermals > 0 ? "#ff2020" : "#39ff14" },
    { label: "SURVIVORS FOUND", value: String(foundSurvivors), color: "#39ff14" },
    { label: "MISSION ELAPSED", value: `${mm}:${ss}`,          color: "#00f5ff" },
    { label: "TICK",             value: String(tick).padStart(6, "0"), color: "rgba(0,245,255,0.5)" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="rounded border bg-[#0d1117] px-3 py-2 flex flex-col items-center gap-0.5"
          style={{ borderColor: `${m.color}22` }}
        >
          <span
            className="text-lg font-bold leading-none"
            style={{ color: m.color, textShadow: `0 0 10px ${m.color}88`, fontVariantNumeric: "tabular-nums" }}
          >
            {m.value}
          </span>
          <span className="text-[8px] uppercase tracking-widest text-[#3a5a6a]">
            {m.label}
          </span>
        </div>
      ))}
    </div>
  );
}

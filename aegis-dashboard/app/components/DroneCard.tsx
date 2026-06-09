"use client";

import type { DroneData } from "../types";

interface Props {
  drone: DroneData | undefined;
  name: string;
}

const STATUS_META: Record<string, { color: string; label: string; dot: string }> = {
  Searching: {
    color: "text-cyan-300",
    label: "SEARCHING",
    dot:   "bg-cyan-400",
  },
  Assisting: {
    color: "text-green-400",
    label: "ASSISTING",
    dot:   "bg-green-400",
  },
  Returning: {
    color: "text-amber-400",
    label: "RTH",
    dot:   "bg-amber-400",
  },
};

export default function DroneCard({ drone, name }: Props) {
  const isAlpha   = name === "Aegis-Alpha";
  const accentHex = isAlpha ? "#00f5ff" : "#00cfff";

  if (!drone) {
    return (
      <div
        className="rounded border border-[#1a2a3a] bg-[#0d1117] p-4 flex items-center justify-center h-full min-h-[200px]"
        style={{ boxShadow: `0 0 20px rgba(0,0,0,0.6)` }}
      >
        <span className="text-xs text-[#1e3a4a] uppercase tracking-widest">
          awaiting unit signal…
        </span>
      </div>
    );
  }

  const battPct   = Math.max(0, Math.min(100, drone.battery));
  const rthPct    = drone.required_return_battery ?? 5;
  // Battery is "low" when it's within 10 % above the dynamic RTH floor
  const battLow   = battPct <= rthPct + 10;
  const battMed   = battPct < 50;
  const battColor = battLow  ? "#ff2020"
                  : battMed  ? "#ffaa00"
                  :             "#39ff14";
  const statusMeta = STATUS_META[drone.status] ?? STATUS_META.Searching;

  return (
    <div
      className="rounded border bg-[#0d1117] p-4 flex flex-col gap-3 relative overflow-hidden"
      style={{
        borderColor:  `${accentHex}33`,
        boxShadow:    `0 0 24px ${accentHex}0a, inset 0 0 40px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Top accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${accentHex}, transparent)` }}
      />

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Unit icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <polygon
              points="12,3 21,20 12,16 3,20"
              fill={accentHex}
              fillOpacity="0.15"
              stroke={accentHex}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="text-sm font-bold uppercase tracking-widest"
            style={{ color: accentHex, textShadow: `0 0 8px ${accentHex}88` }}
          >
            {drone.drone_id}
          </span>
        </div>

        {/* Status badge */}
        <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${statusMeta.color}`}>
          <span
            className={`w-2 h-2 rounded-full inline-block ${statusMeta.dot} ${drone.status === "Assisting" ? "animate-pulse" : ""}`}
          />
          {statusMeta.label}
        </div>
      </div>

      {/* REFINE LOGIC 1 — middleware OS tag */}
      <div
        className="px-2 py-1 rounded text-[8px] uppercase tracking-wider truncate"
        style={{
          background:  `${accentHex}0d`,
          border:      `1px solid ${accentHex}22`,
          color:       `${accentHex}99`,
        }}
        title={drone.os_layer}
      >
        ⬡ {drone.os_layer ?? "Aegis Agnostic Core OS Override via ESP-NOW Mesh"}
      </div>

      {/* Divider */}
      <div className="h-px" style={{ background: `${accentHex}22` }} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat label="SECTOR"   value={drone.sector === "A" ? "ALPHA-ZONE" : "BETA-ZONE"} />
        <Stat label="PAYLOAD"  value={drone.payload_ready ? "READY" : "DEPLOYED"}
              valueClass={drone.payload_ready ? "text-green-400" : "text-amber-400"} />
        <Stat label="X COORD"  value={`${drone.x_coord.toFixed(1)} m`} />
        <Stat label="Y COORD"  value={`${drone.y_coord.toFixed(1)} m`} />
      </div>

      {/* REFINE LOGIC 3 — dynamic RTH threshold indicator */}
      <div
        className="flex items-center justify-between px-2 py-1.5 rounded"
        style={{
          background:  "rgba(255,170,0,0.05)",
          border:      "1px solid rgba(255,170,0,0.18)",
        }}
      >
        <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(255,170,0,0.55)" }}>
          Dynamic RTH floor
        </span>
        <span
          className="text-xs font-bold"
          style={{ color: "#ffaa00", textShadow: "0 0 6px #ffaa0066" }}
        >
          {rthPct.toFixed(1)}%
        </span>
      </div>

      {/* Divider */}
      <div className="h-px" style={{ background: `${accentHex}22` }} />

      {/* Battery section */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-[#4a6a7a] uppercase tracking-widest">
            Power Cell
          </span>
          <span
            className={`text-sm font-bold ${battLow ? "animate-blink" : ""}`}
            style={{ color: battColor, textShadow: `0 0 6px ${battColor}88` }}
          >
            {battPct.toFixed(1)}%
          </span>
        </div>

        {/* Progress bar track */}
        <div
          className="w-full h-3 rounded-full overflow-hidden relative"
          style={{ background: "#0a0e14", border: `1px solid ${accentHex}22` }}
          role="progressbar"
          aria-valuenow={battPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${drone.drone_id} battery ${battPct.toFixed(1)}%`}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${battLow ? "animate-blink" : ""}`}
            style={{
              width:      `${battPct}%`,
              background: `linear-gradient(90deg, ${battColor}aa, ${battColor})`,
              boxShadow:  `0 0 8px ${battColor}66`,
            }}
          />
          {/* RTH threshold marker line on the bar */}
          <div
            className="absolute top-0 bottom-0 w-[2px]"
            style={{
              left:       `${Math.min(rthPct, 99)}%`,
              background: "#ffaa00",
              boxShadow:  "0 0 4px #ffaa00",
              opacity:    0.8,
            }}
            title={`RTH at ${rthPct.toFixed(1)}%`}
          />
        </div>

        {/* Battery notches */}
        <div className="flex justify-between px-0.5">
          {[0, 25, 50, 75, 100].map((n) => (
            <span key={n} className="text-[8px]" style={{ color: `${accentHex}44` }}>
              {n}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom corner decoration */}
      <div
        className="absolute bottom-2 right-3 text-[8px] tracking-widest opacity-20"
        style={{ color: accentHex }}
      >
        UNIT-{isAlpha ? "01" : "02"}
      </div>
    </div>
  );
}

// ── Sub-component ──────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  valueClass = "text-gray-100",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-widest text-[#3a5a6a]">{label}</span>
      <span className={`text-xs font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

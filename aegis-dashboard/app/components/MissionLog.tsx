"use client";

import { useEffect, useRef } from "react";

interface Props {
  logs: string[];
}

// Classify log lines for coloring
function classifyLog(line: string): string {
  // LLM tactical decisions — brightest highlight
  if (line.includes("🤖") || line.includes("AEGIS-COMMANDER")) return "text-violet-300";
  if (line.includes("🔋") || line.includes("RTB") || line.includes("critical")) return "text-amber-400";
  if (line.includes("🚨") || line.includes("survivor") || line.includes("located")) return "text-red-400";
  if (line.includes("✅") || line.includes("recharged") || line.includes("payload deployed")) return "text-green-400";
  if (line.includes("🌡") || line.includes("Thermal") || line.includes("thermal")) return "text-red-300";
  if (line.includes("⚠") || line.includes("Collision") || line.includes("avoidance")) return "text-amber-300";
  if (line.includes("🛸") || line.includes("Sector") || line.includes("assigned")) return "text-cyan-300";
  if (line.includes("🔌") || line.includes("resuming")) return "text-cyan-400";
  return "text-gray-300";
}

export default function MissionLog({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div
      className="flex flex-col h-full rounded border bg-[#080c10] overflow-hidden"
      style={{ borderColor: "rgba(0,245,255,0.12)" }}
    >
      {/* Log header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b shrink-0"
        style={{
          borderColor: "rgba(0,245,255,0.12)",
          background:  "linear-gradient(90deg, #0d1117, #0a1520)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Three terminal dots */}
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 opacity-70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400 opacity-70" />
          <span
            className="ml-3 text-xs uppercase tracking-widest"
            style={{ color: "rgba(0,245,255,0.55)" }}
          >
            MISSION LOG — SYSTEM OUTPUT
          </span>
        </div>
        <span
          className="text-[10px]"
          style={{ color: "rgba(0,245,255,0.30)" }}
        >
          {logs.length} entries
        </span>
      </div>

      {/* Scrollable log body */}
      <div className="flex-1 overflow-y-auto p-3 font-mono">
        {logs.length === 0 ? (
          <p className="text-[11px] text-[#1e3a4a] italic">
            Awaiting system events…
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {logs.map((line, i) => {
              const isLatest = i === logs.length - 1;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-[11px] leading-5 ${classifyLog(line)}`}
                >
                  {/* Line number */}
                  <span className="shrink-0 select-none" style={{ color: "rgba(0,245,255,0.20)", minWidth: "2.5rem" }}>
                    {String(i + 1).padStart(4, "0")}
                  </span>
                  {/* Log text */}
                  <span className={isLatest ? "terminal-cursor" : ""}>{line}</span>
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

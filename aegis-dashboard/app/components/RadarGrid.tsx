"use client";

import { useEffect, useRef } from "react";
import type { TelemetryFrame } from "../types";

// ── Canvas constants ──────────────────────────────────────────────────────────
const CANVAS_SIZE = 500;   // px — visual canvas dimensions
const GRID_WORLD  = 1000;  // metres — simulation world size
const SCALE       = CANVAS_SIZE / GRID_WORLD; // 0.5 px per metre

// Convert world coords → canvas coords
// NOTE: Y is flipped — world Y=0 is "bottom" in real space, but canvas Y=0 is top.
const toCanvas = (wx: number, wy: number) => ({
  cx: wx * SCALE,
  cy: CANVAS_SIZE - wy * SCALE,
});

// ── Colour palette ────────────────────────────────────────────────────────────
const CLR = {
  bg:           "#0a0e14",
  gridLine:     "rgba(0, 180, 210, 0.08)",
  gridLineMid:  "rgba(0, 220, 255, 0.22)",
  sectorDiv:    "rgba(0, 245, 255, 0.35)",
  sectorLabel:  "rgba(0, 245, 255, 0.30)",
  alpha:        "#00f5ff",
  alphaGlow:    "rgba(0, 245, 255, 0.25)",
  beta:         "#00cfff",
  betaGlow:     "rgba(0, 207, 255, 0.25)",
  thermal:      "#ff2020",
  thermalGlow:  "rgba(255, 32,  32,  0.35)",
  survivor:     "#39ff14",
  survivorGlow: "rgba(57,  255, 20,  0.4)",
  trail:        "rgba(0, 245, 255, 0.18)",
  // REFINE LOGIC 2: launch station marker colour
  launchStn:    "#f59e0b",
  launchStnGlow:"rgba(245,158,11,0.35)",
};

// Drone trail history (kept outside component to persist across renders)
const trailHistory: Record<string, Array<{ cx: number; cy: number }>> = {};
const MAX_TRAIL = 40;

interface Props {
  frame: TelemetryFrame | null;
}

export default function RadarGrid({ frame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef  = useRef<number>(0);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      pulseRef.current += 0.05;
      const pulse = pulseRef.current;

      // ── Background ──────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = CLR.bg;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // ── Grid lines ──────────────────────────────────────────────────────────
      for (let i = 0; i <= 10; i++) {
        const pos   = (i / 10) * CANVAS_SIZE;
        const isMid = i === 5;
        ctx.strokeStyle = isMid ? CLR.gridLineMid : CLR.gridLine;
        ctx.lineWidth   = isMid ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, CANVAS_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(CANVAS_SIZE, pos); ctx.stroke();
      }

      // ── Sector divider ───────────────────────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = CLR.sectorDiv;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.shadowColor = "#00f5ff";
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.moveTo(CANVAS_SIZE / 2, 0);
      ctx.lineTo(CANVAS_SIZE / 2, CANVAS_SIZE);
      ctx.stroke();
      ctx.restore();

      ctx.font      = "bold 11px monospace";
      ctx.fillStyle = CLR.sectorLabel;
      ctx.textAlign = "center";
      ctx.fillText("SECTOR A", CANVAS_SIZE / 4,        18);
      ctx.fillText("SECTOR B", (CANVAS_SIZE * 3) / 4,  18);

      // ── Corner coordinates ───────────────────────────────────────────────────
      ctx.font      = "9px monospace";
      ctx.fillStyle = "rgba(0,245,255,0.20)";
      ctx.textAlign = "left";
      ctx.fillText("(0,999)",      4, 12);
      ctx.textAlign = "right";
      ctx.fillText("(999,999)", CANVAS_SIZE - 4, 12);
      ctx.textAlign = "left";
      ctx.fillText("(0,0)",        4, CANVAS_SIZE - 4);
      ctx.textAlign = "right";
      ctx.fillText("(999,0)",  CANVAS_SIZE - 4, CANVAS_SIZE - 4);

      if (!frame) {
        ctx.save();
        ctx.font      = "14px monospace";
        ctx.fillStyle = `rgba(0,245,255,${0.4 + 0.3 * Math.sin(pulse)})`;
        ctx.textAlign = "center";
        ctx.fillText("AWAITING TELEMETRY SIGNAL…", CANVAS_SIZE / 2, CANVAS_SIZE / 2);
        ctx.restore();
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // ── REFINE LOGIC 2: Draw launch station marker ───────────────────────────
      const ls   = frame.launch_station;
      const lsPt = toCanvas(ls.x, ls.y);
      ctx.save();
      // Outer pulse ring
      const lsPulse = 0.5 + 0.5 * Math.abs(Math.sin(pulse * 0.8));
      ctx.globalAlpha = (1 - lsPulse) * 0.6;
      ctx.strokeStyle = CLR.launchStn;
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = CLR.launchStn;
      ctx.shadowBlur  = 14;
      ctx.beginPath();
      ctx.arc(lsPt.cx, lsPt.cy, 6 + lsPulse * 14, 0, Math.PI * 2);
      ctx.stroke();
      // Inner filled circle
      ctx.globalAlpha = 0.9;
      ctx.fillStyle   = CLR.launchStnGlow;
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.arc(lsPt.cx, lsPt.cy, 7, 0, Math.PI * 2);
      ctx.fill();
      // Centre diamond
      ctx.globalAlpha = 1;
      ctx.fillStyle   = CLR.launchStn;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.moveTo(lsPt.cx,      lsPt.cy - 5);
      ctx.lineTo(lsPt.cx + 5,  lsPt.cy);
      ctx.lineTo(lsPt.cx,      lsPt.cy + 5);
      ctx.lineTo(lsPt.cx - 5,  lsPt.cy);
      ctx.closePath();
      ctx.fill();
      // Label
      ctx.font         = "bold 8px monospace";
      ctx.fillStyle    = CLR.launchStn;
      ctx.textAlign    = "left";
      ctx.shadowBlur   = 6;
      ctx.fillText("LAUNCH STN", lsPt.cx + 9, lsPt.cy - 4);
      ctx.font         = "7px monospace";
      ctx.globalAlpha  = 0.65;
      ctx.fillText(`(${ls.x.toFixed(0)},${ls.y.toFixed(0)})`, lsPt.cx + 9, lsPt.cy + 6);
      ctx.restore();

      // ── Update trail history ─────────────────────────────────────────────────
      for (const drone of frame.drones) {
        const { cx, cy } = toCanvas(drone.x_coord, drone.y_coord);
        if (!trailHistory[drone.drone_id]) trailHistory[drone.drone_id] = [];
        const trail = trailHistory[drone.drone_id];
        trail.push({ cx, cy });
        if (trail.length > MAX_TRAIL) trail.shift();
      }

      // ── Draw trails ──────────────────────────────────────────────────────────
      for (const drone of frame.drones) {
        const trail     = trailHistory[drone.drone_id] || [];
        const baseColor = drone.drone_id === "Aegis-Alpha" ? CLR.alpha : CLR.beta;
        for (let i = 1; i < trail.length; i++) {
          ctx.save();
          ctx.globalAlpha = (i / trail.length) * 0.35;
          ctx.strokeStyle = baseColor;
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].cx, trail[i - 1].cy);
          ctx.lineTo(trail[i].cx,     trail[i].cy);
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── Found survivors ───────────────────────────────────────────────────────
      for (const s of frame.found_survivors) {
        const { cx, cy } = toCanvas(s.x, s.y);
        ctx.save();
        ctx.shadowColor = CLR.survivor;
        ctx.shadowBlur  = 10;
        ctx.fillStyle   = CLR.survivorGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = CLR.survivor;
        ctx.lineWidth   = 1.5;
        ctx.shadowBlur  = 6;
        ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
        ctx.fillStyle = CLR.survivor;
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // ── Active thermals ───────────────────────────────────────────────────────
      for (const t of frame.active_thermals) {
        if (t.found) continue;
        const { cx, cy } = toCanvas(t.x, t.y);
        const pulseFactor = 0.5 + 0.5 * Math.abs(Math.sin(pulse + t.sig_id));

        ctx.save();
        ctx.globalAlpha  = (1 - pulseFactor) * 0.7;
        ctx.strokeStyle  = CLR.thermal;
        ctx.lineWidth    = 1;
        ctx.shadowColor  = CLR.thermal;
        ctx.shadowBlur   = 12;
        ctx.beginPath(); ctx.arc(cx, cy, 4 + pulseFactor * 10, 0, Math.PI * 2); ctx.stroke();

        ctx.globalAlpha  = 0.9;
        ctx.fillStyle    = CLR.thermalGlow;
        ctx.shadowBlur   = 14;
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle  = CLR.thermal;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

        ctx.globalAlpha  = 0.75;
        ctx.font         = "8px monospace";
        ctx.fillStyle    = CLR.thermal;
        ctx.textAlign    = "left";
        ctx.shadowBlur   = 4;
        ctx.fillText(`#${t.sig_id}`, cx + 7, cy - 4);
        ctx.restore();
      }

      // ── Drones ────────────────────────────────────────────────────────────────
      for (const drone of frame.drones) {
        const { cx, cy } = toCanvas(drone.x_coord, drone.y_coord);
        const isAlpha    = drone.drone_id === "Aegis-Alpha";
        const baseColor  = isAlpha ? CLR.alpha : CLR.beta;
        const glowColor  = isAlpha ? CLR.alphaGlow : CLR.betaGlow;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(isAlpha ? 0 : Math.PI);

        ctx.shadowColor = baseColor;
        ctx.shadowBlur  = 18;
        ctx.fillStyle   = glowColor;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();

        const size = 7;
        ctx.fillStyle  = baseColor;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo( size,        0);
        ctx.lineTo(-size * 0.7,  size * 0.7);
        ctx.lineTo(-size * 0.7, -size * 0.7);
        ctx.closePath();
        ctx.fill();

        const ringBlink = drone.status === "Returning" || drone.battery < 20;
        if (ringBlink) {
          ctx.globalAlpha  = 0.5 + 0.5 * Math.abs(Math.sin(pulse * 2));
          ctx.strokeStyle  = "#ffaa00";
          ctx.lineWidth    = 1.5;
          ctx.shadowColor  = "#ffaa00";
          ctx.shadowBlur   = 10;
        } else if (drone.status === "Assisting") {
          ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(pulse));
          ctx.strokeStyle = "#39ff14";
          ctx.lineWidth   = 1.5;
          ctx.shadowColor = "#39ff14";
          ctx.shadowBlur  = 10;
        } else {
          ctx.strokeStyle = baseColor;
          ctx.lineWidth   = 1;
          ctx.shadowBlur  = 6;
        }
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.font        = "8px monospace";
        ctx.fillStyle   = baseColor;
        ctx.shadowColor = baseColor;
        ctx.shadowBlur  = 6;
        ctx.textAlign   = "center";
        ctx.fillText(isAlpha ? "α" : "β", cx, cy - 15);
        ctx.restore();
      }

      // ── Tick counter watermark ────────────────────────────────────────────────
      ctx.save();
      ctx.font      = "9px monospace";
      ctx.fillStyle = "rgba(0,245,255,0.18)";
      ctx.textAlign = "right";
      ctx.fillText(`TICK ${frame.tick.toString().padStart(6, "0")}`, CANVAS_SIZE - 6, CANVAS_SIZE - 6);
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [frame]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      className="block rounded-sm"
      style={{
        border:    "1px solid rgba(0,245,255,0.18)",
        boxShadow: "0 0 30px rgba(0,245,255,0.08), inset 0 0 30px rgba(0,0,0,0.5)",
      }}
      aria-label="Drone radar grid"
    />
  );
}

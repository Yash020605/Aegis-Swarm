// ──────────────────────────────────────────────────────────────────────────────
// Aegis Swarm — WebSocket Telemetry Frame Types
// Matches the exact payload schema from main.py  `to_broadcast_payload()`
// ──────────────────────────────────────────────────────────────────────────────

export type DroneStatus = "Searching" | "Assisting" | "Returning";

export interface DroneData {
  drone_id: string;         // "Aegis-Alpha" | "Aegis-Beta"
  x_coord: number;          // metres 0–999
  y_coord: number;          // metres 0–999
  battery: number;          // 0–100 %
  status: DroneStatus;
  payload_ready: boolean;
  sector: "A" | "B";
  // REFINE LOGIC 1: middleware identity string
  os_layer: string;         // "Aegis Agnostic Core OS Override via ESP-NOW Mesh"
  // REFINE LOGIC 3: live dynamic RTH threshold for this drone
  required_return_battery: number;
}

export interface ThermalSignature {
  sig_id: number;
  x: number;
  y: number;
  found: boolean;
  found_by: string | null;
}

export interface FoundSurvivor {
  survivor_id: number;
  x: number;
  y: number;
  assisted_by: string;
  tick: number;
}

// REFINE LOGIC 2: launch station broadcast in every frame
export interface LaunchStation {
  x: number;
  y: number;
}

export interface TelemetryFrame {
  tick: number;
  timestamp: number;
  drones: DroneData[];
  active_thermals: ThermalSignature[];
  found_survivors: FoundSurvivor[];
  system_logs: string[];
  launch_station: LaunchStation;
}

"""
╔═══════════════════════════════════════════════════════════════════════╗
║               AEGIS - Disaster Response Drone Swarm Engine            ║
║                         Backend Server (main.py)                      ║
╠═══════════════════════════════════════════════════════════════════════╣
║  Stack       : FastAPI + Uvicorn + WebSockets + Asyncio               ║
║  AI          : Groq SDK — llama-3.3-70b-versatile (Tactical Cmd)     ║
║  Auth        : JWT Bearer Token (python-jose + passlib)               ║
║  Grid        : 1000 x 1000 metre Calamity Zone                        ║
║  Drones      : Aegis-Alpha (Sector A, left half  X: 0–499)            ║
║                Aegis-Beta  (Sector B, right half X: 500–999)          ║
║  Loop        : 10 Hz background simulation tick                       ║
║  Middleware  : Aegis Agnostic Core OS Override via ESP-NOW Mesh       ║
║  Deployment  : Field-deployed from human-carried launch station       ║
║  RTH Logic   : Dynamic battery-distance vector calculator             ║
╚═══════════════════════════════════════════════════════════════════════╝
"""

import asyncio
import json
import logging
import math
import os
import random
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from typing import Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

# Load .env file early so all os.getenv() calls see the values
load_dotenv()

# ──────────────────────────────────────────────────────────────────────
# LLM Integration — Groq SDK (direct)
# Using groq SDK directly — Python 3.14 compatible.
# langchain-core has a pydantic.v1 shim that hangs on Python 3.14.
# ──────────────────────────────────────────────────────────────────────
try:
    from groq import Groq as GroqClient
    LLM_AVAILABLE = True
except ImportError:
    LLM_AVAILABLE = False

# ──────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("aegis")

# ──────────────────────────────────────────────────────────────────────
# JWT / Auth Configuration
# ──────────────────────────────────────────────────────────────────────
# ⚠  In production: load these from environment variables, never hardcode.
SECRET_KEY = os.getenv("AEGIS_SECRET_KEY", "aegis-super-secret-key-change-in-prod-2024")
ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# Mock admin user store — replace with a real DB in production
MOCK_USERS_DB = {
    "admin": {
        "username": "admin",
        # bcrypt hash of "aegis2024" — generated at startup
        "hashed_password": None,  # filled in on startup
        "role": "commander",
    }
}
MOCK_ADMIN_PASSWORD = "aegis2024"

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")


def _hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def _verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    """Raises HTTPException 401 if token is invalid or expired."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise ValueError("No subject in token")
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload = _decode_token(token)
    username = payload.get("sub")
    user = MOCK_USERS_DB.get(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# Pydantic models for auth
class Token(BaseModel):
    access_token: str
    token_type:   str


class TokenData(BaseModel):
    username: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────
GRID_WIDTH: int = 1000
GRID_HEIGHT: int = 1000
SIM_TICK_HZ: float = 10.0
TICK_INTERVAL: float = 1.0 / SIM_TICK_HZ

BATTERY_DECAY_PER_TICK: float = 0.03
# Extra battery drain while drone is carrying its first-aid payload.
# Models the increased motor load from the payload weight.
BATTERY_PAYLOAD_COEFFICIENT: float = 0.01   # extra % per tick when payload is onboard
# ── REFINE LOGIC 3: Static BATTERY_CRITICAL threshold removed. ──────────
# RTH is now computed dynamically per-drone each tick via the formula:
#   required_return_battery = (distance_to_base * 0.05) + 5.0
BATTERY_DECAY_PER_METRE: float = 0.05   # % per metre traversed (linear model)
BATTERY_SAFETY_MARGIN:   float = 5.0    # flat % safety buffer
DRONE_SPEED: float = 5.0
COLLISION_RADIUS: float = 50.0
THERMAL_DETECT_RADIUS: float = 10.0
THERMAL_SPAWN_INTERVAL_S: float = 15.0
MAX_ACTIVE_THERMALS: int = 5
ASSIST_DURATION_TICKS: int = 30

SECTOR_A_X_MIN, SECTOR_A_X_MAX = 0,   499
SECTOR_B_X_MIN, SECTOR_B_X_MAX = 500, 999
SECTOR_Y_MIN,   SECTOR_Y_MAX   = 0,   999

# ── REFINE LOGIC 2: Dynamic launch station coordinates ──────────────────
# Defaults to the centre of the calamity zone.  The operator can override
# this at runtime via POST /launch-station.
@dataclass
class LaunchStationCoords:
    x: float = float(GRID_WIDTH  // 2)   # 500.0
    y: float = float(GRID_HEIGHT // 2)   # 500.0


# ──────────────────────────────────────────────────────────────────────
# Data Models
# ──────────────────────────────────────────────────────────────────────

@dataclass
class ThermalSignature:
    sig_id: int
    x: float
    y: float
    found: bool = False
    found_by: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class Drone:
    drone_id: str
    x_coord: float
    y_coord: float
    battery: float
    status: str
    payload_ready: bool
    sector_x_min: float
    sector_x_max: float
    sweep_direction: float      = field(default=1.0,  repr=False)
    sweep_row: float            = field(default=0.0,  repr=False)
    assisting_target_id: Optional[int] = field(default=None, repr=False)
    assisting_ticks: int        = field(default=0,    repr=False)
    # REFINE LOGIC 3: live-computed RTH threshold, broadcast to frontend
    required_return_battery: float = field(default=5.0, repr=False)

    def to_dict(self) -> dict:
        return {
            "drone_id":      self.drone_id,
            "x_coord":       round(self.x_coord, 2),
            "y_coord":       round(self.y_coord, 2),
            "battery":       round(self.battery, 2),
            "status":        self.status,
            "payload_ready": self.payload_ready,
            "sector":        "A" if self.sector_x_min == SECTOR_A_X_MIN else "B",
            # REFINE LOGIC 1: reflect middleware identity
            "os_layer":      "Aegis Agnostic Core OS Override via ESP-NOW Mesh",
            # REFINE LOGIC 3: expose live RTH threshold so UI can display it
            "required_return_battery": round(self.required_return_battery, 2),
        }


# ──────────────────────────────────────────────────────────────────────
# Shared System State
# ──────────────────────────────────────────────────────────────────────

class SystemState:
    def __init__(self) -> None:
        # REFINE LOGIC 2: mutable launch-station anchor set by field operator
        self.launch_station = LaunchStationCoords()

        self.drones: list[Drone] = [
            Drone(
                drone_id="Aegis-Alpha",
                x_coord=self.launch_station.x,
                y_coord=self.launch_station.y,
                battery=100.0,
                status="Searching",
                payload_ready=True,
                sector_x_min=float(SECTOR_A_X_MIN),
                sector_x_max=float(SECTOR_A_X_MAX),
            ),
            Drone(
                drone_id="Aegis-Beta",
                x_coord=self.launch_station.x,
                y_coord=self.launch_station.y,
                battery=100.0,
                status="Searching",
                payload_ready=True,
                sector_x_min=float(SECTOR_B_X_MIN),
                sector_x_max=float(SECTOR_B_X_MAX),
            ),
        ]

        self.active_thermals: list[ThermalSignature] = []
        self.found_survivors: list[dict] = []
        self.system_logs: list[str] = []
        self.tick_count: int = 0
        self.last_thermal_spawn: float = time.time()
        self._thermal_id_counter: int = 0

    def log(self, message: str) -> None:
        entry = f"[T={self.tick_count:06d}] {message}"
        self.system_logs.append(entry)
        if len(self.system_logs) > 50:
            self.system_logs.pop(0)
        logger.info(message)

    def to_broadcast_payload(self) -> dict:
        return {
            "tick":       self.tick_count,
            "timestamp":  round(time.time(), 3),
            "drones":     [d.to_dict() for d in self.drones],
            "active_thermals": [
                {
                    "sig_id":   t.sig_id,
                    "x":        round(t.x, 2),
                    "y":        round(t.y, 2),
                    "found":    t.found,
                    "found_by": t.found_by,
                }
                for t in self.active_thermals
            ],
            "found_survivors": self.found_survivors,
            "system_logs": list(self.system_logs),
            # REFINE LOGIC 2: broadcast launch station so frontend can render it
            "launch_station": {
                "x": round(self.launch_station.x, 2),
                "y": round(self.launch_station.y, 2),
            },
        }


# ──────────────────────────────────────────────────────────────────────
# ★  TASK 1 — Agentic LLM Tactical Commander
# ──────────────────────────────────────────────────────────────────────

TACTICAL_SYSTEM_PROMPT = """You are AEGIS-COMMANDER, an elite AI Tactical Rescue Commander 
embedded in an autonomous drone swarm operating in a live disaster zone. 
You receive real-time survivor detection data and must issue immediate, 
actionable tactical directives.

Rules:
- ALWAYS respond in EXACTLY 2 sentences.
- Sentence 1: Start with "Priority: HIGH." or "Priority: CRITICAL." and specify 
  what the detecting drone must do (deploy payload, hover, coordinate).
- Sentence 2: Start with "Ground Command:" and instruct human medical teams 
  with exact coordinates and the drone callsign for rendezvous.
- Be precise, military-terse, and include the coordinates in your response.
- Do NOT use markdown, bullet points, or any formatting.
"""


async def get_llm_tactical_decision(
    drone_id: str,
    x: float,
    y: float,
    battery: float,
    survivor_id: int,
    situational_context: str,
) -> str:
    """
    Calls Groq llama-3.3-70b-versatile via the native groq SDK.
    Runs in a thread pool so it never blocks the asyncio event loop.
    Falls back to a hardcoded template if the key is missing or call fails.
    """
    fallback = (
        f"Priority: HIGH. {drone_id} deploying first-aid payload at sector "
        f"({x:.0f}, {y:.0f}) — battery at {battery:.0f}%, sustain coverage. "
        f"Ground Command: Medical Team Alpha converge on ({x:.0f}, {y:.0f}) "
        f"for survivor #{survivor_id} extraction — {drone_id} on station."
    )

    if not LLM_AVAILABLE:
        logger.warning("groq SDK not installed — using fallback tactical message.")
        return fallback

    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        logger.warning("GROQ_API_KEY not set — using fallback tactical message.")
        return fallback

    user_content = (
        f"SURVIVOR DETECTION EVENT\n"
        f"Drone Callsign  : {drone_id}\n"
        f"Grid Coordinates: ({x:.1f}, {y:.1f})\n"
        f"Battery Level   : {battery:.1f}%\n"
        f"Survivor ID     : #{survivor_id}\n"
        f"Situation       : {situational_context}\n\n"
        f"Issue your tactical directive now."
    )

    def _call_groq() -> str:
        client = GroqClient(api_key=groq_api_key)
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": TACTICAL_SYSTEM_PROMPT},
                {"role": "user",   "content": user_content},
            ],
            temperature=0.4,
            max_tokens=120,
        )
        return completion.choices[0].message.content.strip()

    try:
        decision = await asyncio.to_thread(_call_groq)
        logger.info(f"[LLM] Groq tactical decision: {decision[:80]}…")
        return decision
    except Exception as exc:
        logger.error(f"[LLM] Error calling Groq: {exc} — using fallback.")
        return fallback


# ──────────────────────────────────────────────────────────────────────
# Simulation Helpers (unchanged)
# ──────────────────────────────────────────────────────────────────────

def _distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _move_toward(drone: Drone, target_x: float, target_y: float) -> None:
    dx = target_x - drone.x_coord
    dy = target_y - drone.y_coord
    dist = math.hypot(dx, dy)
    if dist < 1.0:
        drone.x_coord, drone.y_coord = target_x, target_y
        return
    ratio = DRONE_SPEED / dist
    drone.x_coord += dx * ratio
    drone.y_coord += dy * ratio


def _sweep_move(drone: Drone) -> None:
    row_step = 10.0
    drone.x_coord += DRONE_SPEED * drone.sweep_direction
    if drone.x_coord >= drone.sector_x_max:
        drone.x_coord = drone.sector_x_max
        drone.sweep_direction = -1.0
        drone.sweep_row += row_step
        if drone.sweep_row > float(SECTOR_Y_MAX):
            drone.sweep_row = 0.0
        drone.y_coord = drone.sweep_row
    elif drone.x_coord <= drone.sector_x_min:
        drone.x_coord = drone.sector_x_min
        drone.sweep_direction = 1.0
        drone.sweep_row += row_step
        if drone.sweep_row > float(SECTOR_Y_MAX):
            drone.sweep_row = 0.0
        drone.y_coord = drone.sweep_row


def _apply_collision_avoidance(state: SystemState) -> None:
    alpha, beta = state.drones[0], state.drones[1]
    dist = _distance(alpha.x_coord, alpha.y_coord, beta.x_coord, beta.y_coord)
    if 0.01 < dist < COLLISION_RADIUS:
        overlap = COLLISION_RADIUS - dist
        repulse = (overlap / COLLISION_RADIUS) * DRONE_SPEED * 0.5
        ux = (beta.x_coord - alpha.x_coord) / dist
        uy = (beta.y_coord - alpha.y_coord) / dist
        alpha.x_coord -= ux * repulse
        alpha.y_coord -= uy * repulse
        beta.x_coord  += ux * repulse
        beta.y_coord  += uy * repulse
        for drone in (alpha, beta):
            drone.x_coord = max(drone.sector_x_min, min(drone.sector_x_max, drone.x_coord))
            drone.y_coord = max(0.0, min(float(SECTOR_Y_MAX), drone.y_coord))
        state.log(
            f"⚠  Collision avoidance! Alpha–Beta separation: {dist:.1f} m "
            f"(below {COLLISION_RADIUS} m threshold)"
        )


def _maybe_spawn_thermal(state: SystemState) -> None:
    now = time.time()
    active_unfound = sum(1 for t in state.active_thermals if not t.found)
    if (now - state.last_thermal_spawn >= THERMAL_SPAWN_INTERVAL_S
            and active_unfound < MAX_ACTIVE_THERMALS):
        state._thermal_id_counter += 1
        t = ThermalSignature(
            sig_id=state._thermal_id_counter,
            x=random.uniform(0, GRID_WIDTH - 1),
            y=random.uniform(0, GRID_HEIGHT - 1),
        )
        state.active_thermals.append(t)
        state.last_thermal_spawn = now
        state.log(
            f"🌡  Thermal signature #{t.sig_id} detected at "
            f"({t.x:.1f}, {t.y:.1f})"
        )


# ──────────────────────────────────────────────────────────────────────
# ★  TASK 1 — Thermal Detection now triggers LLM via asyncio queue
# ──────────────────────────────────────────────────────────────────────

# We use a queue so the sync simulation_tick can enqueue events and
# the async simulation loop processes them without blocking.
llm_event_queue: asyncio.Queue = None   # initialised in on_startup


def _check_thermal_detection(drone: Drone, state: SystemState) -> None:
    """
    Scan all unfound thermals. On detection, enqueue an LLM event.
    The simulation loop will await the LLM response and broadcast it.
    """
    best_dist = float("inf")
    best_thermal: Optional[ThermalSignature] = None

    for thermal in state.active_thermals:
        if thermal.found:
            continue
        d = _distance(drone.x_coord, drone.y_coord, thermal.x, thermal.y)
        if d <= THERMAL_DETECT_RADIUS and d < best_dist:
            best_dist = d
            best_thermal = thermal

    if best_thermal is not None:
        best_thermal.found = True
        best_thermal.found_by = drone.drone_id
        drone.status = "Assisting"
        drone.payload_ready = False
        drone.assisting_target_id = best_thermal.sig_id
        drone.assisting_ticks = 0

        state.found_survivors.append({
            "survivor_id": best_thermal.sig_id,
            "x":           round(best_thermal.x, 2),
            "y":           round(best_thermal.y, 2),
            "assisted_by": drone.drone_id,
            "tick":        state.tick_count,
        })
        state.log(
            f"🚨  {drone.drone_id} located survivor #{best_thermal.sig_id} "
            f"at ({best_thermal.x:.1f}, {best_thermal.y:.1f}) – "
            f"deploying first-aid payload!"
        )

        # Enqueue LLM event — processed async in simulation_loop
        event = {
            "drone_id":    drone.drone_id,
            "x":           best_thermal.x,
            "y":           best_thermal.y,
            "battery":     drone.battery,
            "survivor_id": best_thermal.sig_id,
            "situation":   (
                f"Heat signature detected near collapsed structure at grid "
                f"({best_thermal.x:.0f}, {best_thermal.y:.0f}). "
                f"Structural debris likely. Survivor may be immobile."
            ),
        }
        if llm_event_queue is not None:
            try:
                llm_event_queue.put_nowait(event)
            except asyncio.QueueFull:
                pass  # Don't block the sim loop if queue is full


def _tick_drone(drone: Drone, state: SystemState) -> None:
    # Base decay every tick + extra coefficient when carrying payload weight
    payload_drain = BATTERY_PAYLOAD_COEFFICIENT if drone.payload_ready else 0.0
    drone.battery = max(0.0, drone.battery - BATTERY_DECAY_PER_TICK - payload_drain)

    # ── REFINE LOGIC 3: Dynamic RTH calculation ───────────────────────────────
    # Compute Euclidean distance to launch station and derive the minimum
    # battery level needed to safely return.
    dist_to_base = _distance(
        drone.x_coord, drone.y_coord,
        state.launch_station.x, state.launch_station.y,
    )
    drone.required_return_battery = (
        dist_to_base * BATTERY_DECAY_PER_METRE + BATTERY_SAFETY_MARGIN
    )

    # Trigger RTH the instant battery ≤ required threshold (replaces static 20%)
    if (drone.battery <= drone.required_return_battery
            and drone.status != "Returning"):
        drone.status = "Returning"
        state.log(
            f"🔋  {drone.drone_id} dynamic RTH triggered — "
            f"battery {drone.battery:.1f}% ≤ required {drone.required_return_battery:.1f}% "
            f"(dist to base: {dist_to_base:.0f} m)"
        )

    if drone.status == "Returning":
        _move_toward(drone, state.launch_station.x, state.launch_station.y)
        if _distance(drone.x_coord, drone.y_coord,
                     state.launch_station.x, state.launch_station.y) < 2.0:
            drone.battery = 100.0
            drone.status = "Searching"
            drone.payload_ready = True
            drone.sweep_row = 0.0
            drone.sweep_direction = 1.0
            drone.x_coord = drone.sector_x_min
            drone.y_coord = state.launch_station.y
            state.log(
                f"🔌  {drone.drone_id} recharged at launch station "
                f"({state.launch_station.x:.0f}, {state.launch_station.y:.0f}) – "
                f"resuming sector sweep."
            )

    elif drone.status == "Assisting":
        drone.assisting_ticks += 1
        if drone.assisting_ticks >= ASSIST_DURATION_TICKS:
            drone.status = "Searching"
            drone.assisting_target_id = None
            state.log(
                f"✅  {drone.drone_id} payload deployed – "
                f"resuming sector sweep."
            )

    else:  # Searching
        _sweep_move(drone)
        _check_thermal_detection(drone, state)


# ──────────────────────────────────────────────────────────────────────
# Master Simulation Tick
# ──────────────────────────────────────────────────────────────────────

def simulation_tick(state: SystemState) -> None:
    state.tick_count += 1
    _maybe_spawn_thermal(state)
    for drone in state.drones:
        _tick_drone(drone, state)
    _apply_collision_avoidance(state)


# ──────────────────────────────────────────────────────────────────────
# WebSocket Connection Manager
# ──────────────────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)
        logger.info(f"WS client connected  | total={len(self.active)}")

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)
        logger.info(f"WS client disconnected | total={len(self.active)}")

    async def broadcast(self, payload: dict) -> None:
        if not self.active:
            return
        message = json.dumps(payload)
        dead: list[WebSocket] = []
        for ws in self.active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


# ──────────────────────────────────────────────────────────────────────
# FastAPI Application & Singletons
# ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Aegis Swarm Engine",
    description=(
        "Real-time disaster-response drone swarm simulation backend. "
        "Connect to /ws/telemetry with a valid JWT for live telemetry."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # Tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

state: SystemState = SystemState()
manager: ConnectionManager = ConnectionManager()


# ──────────────────────────────────────────────────────────────────────
# ★  TASK 1 — LLM background processor
# ──────────────────────────────────────────────────────────────────────

async def llm_event_processor() -> None:
    """
    Background task that drains the LLM event queue.
    For each survivor detection event, it calls the LLM (async),
    then injects the tactical decision into system_logs and broadcasts.
    """
    global llm_event_queue
    logger.info("🤖  AEGIS-COMMANDER LLM processor online.")
    while True:
        event = await llm_event_queue.get()
        try:
            decision = await get_llm_tactical_decision(
                drone_id=event["drone_id"],
                x=event["x"],
                y=event["y"],
                battery=event["battery"],
                survivor_id=event["survivor_id"],
                situational_context=event["situation"],
            )
            # Inject into mission log with a distinctive prefix
            tactical_log = f"🤖 [AEGIS-COMMANDER] {decision}"
            state.log(tactical_log)
            # Broadcast updated state immediately so dashboard shows it
            await manager.broadcast(state.to_broadcast_payload())
        except Exception as exc:
            logger.error(f"[LLM Processor] Unhandled error: {exc}")
        finally:
            llm_event_queue.task_done()


# ──────────────────────────────────────────────────────────────────────
# Async Simulation Loop
# ──────────────────────────────────────────────────────────────────────

async def simulation_loop() -> None:
    logger.info(
        f"🚀  Aegis simulation loop starting at {SIM_TICK_HZ} Hz "
        f"({TICK_INTERVAL*1000:.0f} ms/tick)"
    )
    loop = asyncio.get_event_loop()
    while True:
        tick_start = loop.time()
        simulation_tick(state)
        if manager.active:
            await manager.broadcast(state.to_broadcast_payload())
        elapsed = loop.time() - tick_start
        await asyncio.sleep(max(0.0, TICK_INTERVAL - elapsed))


# ──────────────────────────────────────────────────────────────────────
# ★  ESP32 Base Station Mock Bridge
# ──────────────────────────────────────────────────────────────────────

async def esp32_mock_bridge() -> None:
    """
    Simulates an ESP32 base station transmitting ESP-NOW mesh packets
    to the Aegis backend over a serial/UDP bridge.

    In a real field deployment this coroutine would open a pyserial port
    (e.g. 'COM3' / '/dev/ttyUSB0') and parse incoming ESP-NOW frames.
    For the evaluation environment we generate synthetic packets at 1 Hz
    so the data pipeline is demonstrably active without physical hardware.

    Packet schema mirrors a real ESP-NOW telemetry frame:
      { node_id, rssi_dbm, packet_seq, x, y, battery, status }
    """
    logger.info("📡  ESP32 mock bridge online — simulating ESP-NOW mesh packets at 1 Hz.")
    packet_seq: int = 0

    while True:
        packet_seq += 1
        for drone in state.drones:
            rssi = random.randint(-80, -45)          # realistic RSSI range
            packet = {
                "node_id":    drone.drone_id,
                "rssi_dbm":   rssi,
                "packet_seq": packet_seq,
                "x":          round(drone.x_coord, 1),
                "y":          round(drone.y_coord, 1),
                "battery":    round(drone.battery, 1),
                "status":     drone.status,
            }
            state.log(
                f"📡 [ESP32-RX] SEQ#{packet_seq:05d} | "
                f"{packet['node_id']} | "
                f"RSSI={rssi} dBm | "
                f"pos=({packet['x']:.0f},{packet['y']:.0f}) | "
                f"batt={packet['battery']:.1f}%"
            )
            logger.debug(f"[ESP32] {packet}")

        await asyncio.sleep(1.0)   # 1 Hz — one packet burst per second per node


# ──────────────────────────────────────────────────────────────────────
# Startup / Shutdown
# ──────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup() -> None:
    global llm_event_queue
    # Hash the mock admin password at startup
    MOCK_USERS_DB["admin"]["hashed_password"] = _hash_password(MOCK_ADMIN_PASSWORD)
    logger.info("🔐  JWT auth initialised. Mock admin: admin / aegis2024")

    # Initialise the LLM event queue
    llm_event_queue = asyncio.Queue(maxsize=20)

    state.log(f"🗺  Calamity Zone initialised: {GRID_WIDTH}×{GRID_HEIGHT} m grid.")
    state.log(
        f"📐  Sector A  →  X[{SECTOR_A_X_MIN}–{SECTOR_A_X_MAX}]  |  "
        f"Sector B  →  X[{SECTOR_B_X_MIN}–{SECTOR_B_X_MAX}]"
    )
    state.log(
        f"📍  Launch Station at ({state.launch_station.x:.0f}, {state.launch_station.y:.0f}) "
        f"— field-deployed by rescue operator."
    )
    state.log("🛸  Aegis-Alpha assigned to Sector A  [Aegis Agnostic Core OS Override via ESP-NOW Mesh]")
    state.log("🛸  Aegis-Beta  assigned to Sector B  [Aegis Agnostic Core OS Override via ESP-NOW Mesh]")
    state.log("🤖  AEGIS-COMMANDER AI online — awaiting thermal events.")
    state.log("⚙️  Dynamic RTH enabled — distance-vector battery calculator active.")

    asyncio.create_task(simulation_loop())
    asyncio.create_task(llm_event_processor())
    asyncio.create_task(esp32_mock_bridge())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    logger.info("Aegis engine shutting down.")


# ──────────────────────────────────────────────────────────────────────
# ★  TASK 3 — JWT Auth Endpoint
# ──────────────────────────────────────────────────────────────────────

@app.post("/token", response_model=Token, tags=["Auth"])
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """
    Authenticate with username/password (admin / aegis2024).
    Returns a JWT Bearer token valid for 60 minutes.
    """
    user = MOCK_USERS_DB.get(form_data.username)
    if not user or not _verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = _create_access_token(
        data={"sub": user["username"], "role": user["role"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ──────────────────────────────────────────────────────────────────────
# REST Endpoints
# ──────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {
        "system":            "Aegis Swarm Engine",
        "status":            "operational",
        "version":           "2.0.0",
        "tick":              state.tick_count,
        "connected_clients": len(manager.active),
        "ws_endpoint":       "ws://<host>:8000/ws/telemetry?token=<JWT>",
        "auth_endpoint":     "POST /token  (username: admin, password: aegis2024)",
    }


@app.get("/status", tags=["Telemetry"])
async def get_status(current_user: dict = Depends(get_current_user)):
    return state.to_broadcast_payload()


@app.get("/zone", tags=["Calamity Zone"])
async def get_zone_info():
    return {
        "grid_width_m":  GRID_WIDTH,
        "grid_height_m": GRID_HEIGHT,
        "sectors": {
            "A": {
                "drone":   "Aegis-Alpha",
                "x_range": [SECTOR_A_X_MIN, SECTOR_A_X_MAX],
                "y_range": [SECTOR_Y_MIN, SECTOR_Y_MAX],
            },
            "B": {
                "drone":   "Aegis-Beta",
                "x_range": [SECTOR_B_X_MIN, SECTOR_B_X_MAX],
                "y_range": [SECTOR_Y_MIN, SECTOR_Y_MAX],
            },
        },
        "parameters": {
            "collision_avoidance_radius_m": COLLISION_RADIUS,
            "thermal_detection_radius_m":   THERMAL_DETECT_RADIUS,
            "battery_payload_coefficient":  BATTERY_PAYLOAD_COEFFICIENT,
            "battery_decay_per_metre":      BATTERY_DECAY_PER_METRE,
            "battery_safety_margin_pct":    BATTERY_SAFETY_MARGIN,
            "drone_speed_m_per_tick":       DRONE_SPEED,
            "sim_frequency_hz":             SIM_TICK_HZ,
        },
    }


@app.get("/survivors", tags=["Survivors"])
async def get_survivors(current_user: dict = Depends(get_current_user)):
    return {
        "total_found": len(state.found_survivors),
        "survivors":   state.found_survivors,
    }


# ── REFINE LOGIC 2: Launch Station Pydantic model ──────────────────────────

class LaunchStationRequest(BaseModel):
    x: float
    y: float


@app.get("/launch-station", tags=["Launch Station"])
async def get_launch_station():
    """
    Returns the current field launch station coordinates set by the operator.
    Drones return-to-home to this point and spawn from it on reset.
    """
    return {
        "x": round(state.launch_station.x, 2),
        "y": round(state.launch_station.y, 2),
    }


@app.post("/launch-station", tags=["Launch Station"])
async def set_launch_station(
    body: LaunchStationRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Update the calamity boundary focus / launch station coordinates.
    The field rescue worker sets this before deploying the swarm.
    All drones will use this as their RTH target immediately.
    Coordinates are clamped to the valid grid range [0, 999].
    """
    new_x = max(0.0, min(float(GRID_WIDTH  - 1), body.x))
    new_y = max(0.0, min(float(GRID_HEIGHT - 1), body.y))
    state.launch_station.x = new_x
    state.launch_station.y = new_y
    state.log(
        f"📍  [OPERATOR] Launch station updated → "
        f"({new_x:.1f}, {new_y:.1f}) by {current_user['username']}"
    )
    return {
        "status":  "updated",
        "x": new_x,
        "y": new_y,
    }


@app.post("/thermal/spawn", tags=["Debug / Demo"])
async def force_spawn_thermal(
    x: float = None,
    y: float = None,
    current_user: dict = Depends(get_current_user),
):
    state._thermal_id_counter += 1
    tx = float(x) if x is not None else random.uniform(0, GRID_WIDTH - 1)
    ty = float(y) if y is not None else random.uniform(0, GRID_HEIGHT - 1)
    tx = max(0.0, min(float(GRID_WIDTH - 1),  tx))
    ty = max(0.0, min(float(GRID_HEIGHT - 1), ty))
    t = ThermalSignature(sig_id=state._thermal_id_counter, x=tx, y=ty)
    state.active_thermals.append(t)
    state.log(f"🌡  [MANUAL] Thermal #{t.sig_id} injected at ({tx:.1f}, {ty:.1f})")
    return {"status": "injected", "thermal": asdict(t)}


@app.post("/reset", tags=["Debug / Demo"])
async def reset_simulation(current_user: dict = Depends(get_current_user)):
    global state
    # Preserve the operator-set launch station across resets
    saved_launch = LaunchStationCoords(
        x=state.launch_station.x,
        y=state.launch_station.y,
    )
    state = SystemState()
    state.launch_station = saved_launch
    # Reposition drones to launch station
    for drone in state.drones:
        drone.x_coord = saved_launch.x
        drone.y_coord = saved_launch.y
    state.log(
        f"🔄  Simulation reset by operator. "
        f"Launch station preserved at ({saved_launch.x:.0f}, {saved_launch.y:.0f})."
    )
    return {"status": "ok", "message": "Simulation reset successfully."}


# ──────────────────────────────────────────────────────────────────────
# ★  TASK 3 — JWT-protected WebSocket Endpoint
# ──────────────────────────────────────────────────────────────────────

@app.websocket("/ws/telemetry")
async def websocket_telemetry(ws: WebSocket, token: str = ""):
    """
    Real-time telemetry stream via WebSocket.

    Authentication:
      Connect with ?token=<JWT>  e.g.:
      ws://localhost:8000/ws/telemetry?token=eyJhbGci...

    The server validates the JWT before accepting the connection.
    Invalid or missing tokens receive a 1008 Policy Violation close code.

    Frame schema is identical to v1.0 — no frontend data changes needed
    beyond passing the token in the connection URL.
    """
    # Validate JWT before accepting the WebSocket handshake
    if not token:
        await ws.close(code=1008, reason="Missing authentication token")
        logger.warning("WS rejected: no token provided")
        return

    try:
        _decode_token(token)
    except HTTPException:
        await ws.close(code=1008, reason="Invalid or expired token")
        logger.warning("WS rejected: invalid token")
        return

    await manager.connect(ws)

    try:
        await ws.send_text(json.dumps(state.to_broadcast_payload()))
    except Exception:
        manager.disconnect(ws)
        return

    try:
        while True:
            data = await ws.receive_text()
            logger.debug(f"WS inbound: {data}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ──────────────────────────────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )

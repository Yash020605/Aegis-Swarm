"""
╔═══════════════════════════════════════════════════════════════════════╗
║           AEGIS — Edge Vision Pipeline (aegis_vision_edge.py)         ║
╠═══════════════════════════════════════════════════════════════════════╣
║  Stack  : OpenCV + Ultralytics YOLOv8                                 ║
║  Input  : Local webcam (default) OR a local .mp4 video file           ║
║  Filter : class 0 = "person" only                                     ║
║  Output : Cyan HUD bounding boxes + confidence overlay                ║
║           Terminal alert: [SYSTEM ALERT] HUMAN_DETECTED at frame N   ║
╠═══════════════════════════════════════════════════════════════════════╣
║  Usage:                                                               ║
║    python aegis_vision_edge.py                     # webcam mode      ║
║    python aegis_vision_edge.py --source video.mp4  # file mode        ║
║    python aegis_vision_edge.py --source 1          # second camera    ║
╚═══════════════════════════════════════════════════════════════════════╝
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
from ultralytics import YOLO

# ──────────────────────────────────────────────────────────────────────
# Visual constants — "high-tech" HUD palette
# ──────────────────────────────────────────────────────────────────────
CLR_BOX        = (255, 255,   0)   # Cyan in BGR  (OpenCV is BGR, not RGB)
CLR_LABEL_BG   = (  0,   0,   0)   # Black label background
CLR_LABEL_TEXT = (255, 255,   0)   # Cyan label text
CLR_CORNER     = (  0, 255, 255)   # Bright yellow corner accents  (BGR)
CLR_HUD_TEXT   = (  0, 255, 255)   # Yellow HUD overlay text
CLR_ALERT      = (  0,   0, 255)   # Red flash border on detection

BOX_THICKNESS      = 2
CORNER_LENGTH      = 14            # px for the corner tick-mark arms
CORNER_THICKNESS   = 3
FONT               = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE         = 0.52
FONT_THICKNESS     = 1
CONF_THRESHOLD     = 0.45          # minimum confidence to show a box
PERSON_CLASS_ID    = 0             # COCO class 0 = "person"
MODEL_WEIGHTS      = "yolov8n.pt"  # nano — fastest; swap for yolov8s/m for accuracy


# ──────────────────────────────────────────────────────────────────────
# Drawing helpers
# ──────────────────────────────────────────────────────────────────────

def draw_hud_box(frame, x1: int, y1: int, x2: int, y2: int, confidence: float) -> None:
    """
    Draw a high-tech bounding box:
      - Thin cyan rectangle
      - Corner tick-mark accents
      - Confidence score label with a dark pill background
    """
    # Main rectangle
    cv2.rectangle(frame, (x1, y1), (x2, y2), CLR_BOX, BOX_THICKNESS)

    # Corner accents — top-left
    cv2.line(frame, (x1, y1), (x1 + CORNER_LENGTH, y1), CLR_CORNER, CORNER_THICKNESS)
    cv2.line(frame, (x1, y1), (x1, y1 + CORNER_LENGTH), CLR_CORNER, CORNER_THICKNESS)

    # Corner accents — top-right
    cv2.line(frame, (x2, y1), (x2 - CORNER_LENGTH, y1), CLR_CORNER, CORNER_THICKNESS)
    cv2.line(frame, (x2, y1), (x2, y1 + CORNER_LENGTH), CLR_CORNER, CORNER_THICKNESS)

    # Corner accents — bottom-left
    cv2.line(frame, (x1, y2), (x1 + CORNER_LENGTH, y2), CLR_CORNER, CORNER_THICKNESS)
    cv2.line(frame, (x1, y2), (x1, y2 - CORNER_LENGTH), CLR_CORNER, CORNER_THICKNESS)

    # Corner accents — bottom-right
    cv2.line(frame, (x2, y2), (x2 - CORNER_LENGTH, y2), CLR_CORNER, CORNER_THICKNESS)
    cv2.line(frame, (x2, y2), (x2, y2 - CORNER_LENGTH), CLR_CORNER, CORNER_THICKNESS)

    # Label: "HUMAN  conf%"
    label = f"HUMAN  {confidence * 100:.1f}%"
    (tw, th), baseline = cv2.getTextSize(label, FONT, FONT_SCALE, FONT_THICKNESS)
    pad = 4
    # Dark pill behind the text
    cv2.rectangle(
        frame,
        (x1, y1 - th - 2 * pad - baseline),
        (x1 + tw + 2 * pad, y1),
        CLR_LABEL_BG,
        cv2.FILLED,
    )
    cv2.putText(
        frame,
        label,
        (x1 + pad, y1 - pad - baseline),
        FONT,
        FONT_SCALE,
        CLR_LABEL_TEXT,
        FONT_THICKNESS,
        cv2.LINE_AA,
    )


def draw_alert_border(frame, alpha: float = 1.0) -> None:
    """Flash a red border on the frame when a human is detected."""
    h, w = frame.shape[:2]
    thickness = max(4, int(8 * alpha))
    cv2.rectangle(frame, (0, 0), (w - 1, h - 1), CLR_ALERT, thickness)


def draw_hud_overlay(frame, frame_num: int, fps: float, count: int, source_label: str) -> None:
    """Top-left HUD with frame number, FPS, and detection count."""
    lines = [
        f"AEGIS EDGE VISION  v2.0",
        f"SOURCE  : {source_label}",
        f"FRAME   : {frame_num:07d}",
        f"FPS     : {fps:5.1f}",
        f"HUMANS  : {count}",
    ]
    x, y = 12, 22
    for i, line in enumerate(lines):
        yy = y + i * 20
        # Drop-shadow
        cv2.putText(frame, line, (x + 1, yy + 1), FONT, 0.48,
                    (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(frame, line, (x, yy), FONT, 0.48,
                    CLR_HUD_TEXT, 1, cv2.LINE_AA)


# ──────────────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────────────

def run_vision_pipeline(source) -> None:
    """
    Open `source` (int for webcam index, str for video/image path),
    run YOLOv8 inference, and render the HUD.

    Press 'q' or ESC to exit.
    """
    print("=" * 60)
    print("  AEGIS EDGE VISION PIPELINE — STARTING")
    print(f"  Model   : {MODEL_WEIGHTS}")
    print(f"  Source  : {source}")
    print(f"  Filter  : PERSON (class {PERSON_CLASS_ID}), conf ≥ {CONF_THRESHOLD}")
    print("=" * 60)

    # Load YOLOv8 — downloads yolov8n.pt on first run automatically
    print("[INFO] Loading YOLOv8 model …")
    model = YOLO(MODEL_WEIGHTS)
    print("[INFO] Model loaded. Press 'q' or ESC to quit.\n")

    # Open video source
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open source: {source}")
        sys.exit(1)

    source_label = (
        f"CAM:{source}" if isinstance(source, int) else Path(str(source)).name
    )

    frame_num      = 0
    fps_buffer     = []
    alert_frames   = 0          # frame countdown for red-border flash
    ALERT_DURATION = 6          # frames to show red border after detection

    while True:
        t_start = time.perf_counter()
        ret, frame = cap.read()
        if not ret:
            print("[INFO] End of stream or cannot read frame. Exiting.")
            break

        frame_num += 1
        human_count = 0

        # ── YOLOv8 Inference ──────────────────────────────────────────
        results = model(frame, verbose=False)[0]

        for box in results.boxes:
            cls_id  = int(box.cls[0].item())
            conf    = float(box.conf[0].item())

            # Filter: only persons above confidence threshold
            if cls_id != PERSON_CLASS_ID or conf < CONF_THRESHOLD:
                continue

            human_count += 1

            # Bounding box pixel coordinates
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            draw_hud_box(frame, x1, y1, x2, y2, conf)

        # ── Terminal alert ────────────────────────────────────────────
        if human_count > 0:
            alert_frames = ALERT_DURATION
            for _ in range(human_count):
                print(
                    f"[SYSTEM ALERT] HUMAN_DETECTED at frame [{frame_num:07d}]  "
                    f"| count={human_count}  "
                    f"| source={source_label}"
                )

        # ── Alert border flash ────────────────────────────────────────
        if alert_frames > 0:
            draw_alert_border(frame, alpha=alert_frames / ALERT_DURATION)
            alert_frames -= 1

        # ── FPS calculation (rolling 30-frame window) ─────────────────
        t_elapsed = time.perf_counter() - t_start
        fps_buffer.append(t_elapsed)
        if len(fps_buffer) > 30:
            fps_buffer.pop(0)
        avg_fps = 1.0 / (sum(fps_buffer) / len(fps_buffer))

        # ── HUD overlay ───────────────────────────────────────────────
        draw_hud_overlay(frame, frame_num, avg_fps, human_count, source_label)

        # ── Display ───────────────────────────────────────────────────
        cv2.imshow("AEGIS Edge Vision — Person Detector", frame)

        # Key handling
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):  # 'q' or ESC
            print("[INFO] User quit.")
            break

    cap.release()
    cv2.destroyAllWindows()
    print(f"\n[INFO] Pipeline stopped after {frame_num} frames.")


# ──────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="AEGIS Edge Vision — Real-time Person Detection (YOLOv8 + OpenCV)"
    )
    parser.add_argument(
        "--source",
        default="0",
        help=(
            "Video source. "
            "Use '0' (default) for webcam, '1' for second camera, "
            "or a path like 'disaster_footage.mp4' for a video file."
        ),
    )
    args = parser.parse_args()

    # Resolve source: integer for camera index, string for file path
    source_str = args.source
    try:
        source = int(source_str)
    except ValueError:
        source = source_str
        if not Path(source).exists():
            print(f"[ERROR] File not found: {source}")
            sys.exit(1)

    run_vision_pipeline(source)


if __name__ == "__main__":
    main()

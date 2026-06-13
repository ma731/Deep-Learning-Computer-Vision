"""FreshGuard two-stage inference pipeline.

Stage 1 — YOLO (pretrained, COCO) localizes fruit in the frame and, in
conveyor mode, tracks each fruit with a persistent ID (ByteTrack).
Stage 2 — Our fine-tuned MobileNetV2 grades each crop fresh/rotten.

Predictions per track are smoothed with a majority vote over recent frames
so the live demo doesn't flicker when the fruit rotates.
"""

import base64
import json
from collections import defaultdict, deque
from pathlib import Path

import cv2
import numpy as np

from gradcam import gradcam_heatmap, overlay_heatmap

REPO_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = REPO_DIR / "models"
CLASSIFIER_PATH = MODELS_DIR / "freshguard_mobilenetv2.keras"
CLASS_NAMES_PATH = MODELS_DIR / "class_names.json"
REVIEW_DIR = REPO_DIR / "data" / "review_queue"      # saved crops awaiting review
REVIEW_LOG = MODELS_DIR / "review_queue.jsonl"        # one json line per flagged item

# COCO class ids for the produce our pilot supports (all detected zero-shot)
COCO_FRUIT = {46: "banana", 47: "apple", 49: "orange", 51: "carrot"}
IMG_SIZE = 224
SMOOTH_WINDOW = 15          # frames of softmax history per track
SELL_SOON_BAND = (0.40, 0.65)  # rotten-prob band → "sell soon" tier
CONFIDENCE_TAU = 0.70       # below this top-class confidence → abstain ("review")

# Overridden at load time by models/class_names.json (training export).
# 10 produce types x {fresh, rotten}; only apple/banana/orange/carrot are
# COCO-detectable — the rest are graded via the center-crop fallback.
DEFAULT_CLASSES = [
    "fresh_apple", "fresh_banana", "fresh_bellpepper", "fresh_carrot",
    "fresh_cucumber", "fresh_mango", "fresh_orange", "fresh_potato",
    "fresh_strawberry", "fresh_tomato",
    "rotten_apple", "rotten_banana", "rotten_bellpepper", "rotten_carrot",
    "rotten_cucumber", "rotten_mango", "rotten_orange", "rotten_potato",
    "rotten_strawberry", "rotten_tomato",
]


def _b64_png(img_bgr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img_bgr)
    return base64.b64encode(buf).decode() if ok else ""


def rot_area_fraction(crop_bgr: np.ndarray) -> float:
    """Estimate the fraction of fruit surface showing decay discoloration.

    Classic CV (course session 2) in production: dark/brown regions are
    low-value, low-to-mid-saturation pixels in HSV space. Used to convert
    the classifier's verdict into a markdown *amount*.
    """
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    # decay: dark patches OR desaturated brownish patches
    dark = v < 70
    brown = (h < 30) & (s > 60) & (v < 140)
    mask = (dark | brown).astype(np.uint8)
    # clean speckle noise so shadows don't read as rot
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return float(mask.mean())


def markdown_recommendation(tier: str, severity: float) -> str:
    """Business decision: price action from grade + decay severity."""
    if tier == "fresh":
        return "full price"
    if tier == "sell_soon":
        return "markdown −40% (last day)" if severity > 0.25 else "markdown −20%"
    if tier == "reject":
        return "remove — donate if edible (Law 1/2025)"
    return "—"


# Typical EU unit retail price per item (€) — for the live "money recovered" demo.
UNIT_PRICE = {
    "apple": 0.40, "banana": 0.25, "orange": 0.50, "carrot": 0.15,
    "tomato": 0.30, "potato": 0.20, "cucumber": 0.45, "bellpepper": 0.60,
    "mango": 0.90, "strawberry": 1.80,
}
RECOVERY_RATE = 0.60  # a marked-down "sell soon" item recovers ~60% of its price


def produce_from_label(label: str) -> str:
    """'rotten_bellpepper' -> 'bellpepper' (the produce type, for the
    classifier-only fallback path where YOLO gave us no class)."""
    return label.split("_", 1)[1] if label and "_" in label else "item"


def recovered_value(tier: str, fruit: str) -> float:
    """€ recovered vs. the counterfactual where decay is caught too late and
    the item is binned. 'sell soon' items are the recoverable margin; fresh
    items would have sold anyway (0), rejects are already lost (0)."""
    if tier == "sell_soon":
        return round(UNIT_PRICE.get(fruit, 0.30) * RECOVERY_RATE, 2)
    return 0.0


class FreshGuardPipeline:
    def __init__(self):
        from ultralytics import YOLO  # deferred: first call downloads weights
        self.detector = YOLO("yolov8n.pt")
        self.classifier = None
        self.class_names = DEFAULT_CLASSES
        if CLASSIFIER_PATH.exists():
            import tensorflow as tf
            self.classifier = tf.keras.models.load_model(CLASSIFIER_PATH)
            if CLASS_NAMES_PATH.exists():
                self.class_names = json.loads(CLASS_NAMES_PATH.read_text())
        # softmax history per track id (conveyor mode smoothing)
        self.track_history: dict[int, deque] = defaultdict(
            lambda: deque(maxlen=SMOOTH_WINDOW))
        self.session_counts: dict[int, str] = {}
        self.session_value: dict[int, float] = {}  # € recovered per track id
        self.queued_ids: set[int] = set()          # track ids already sent to review
        self.single_history: deque = deque(maxlen=SMOOTH_WINDOW)  # single-mode smoothing

    @property
    def model_loaded(self) -> bool:
        return self.classifier is not None

    def live_flagged(self) -> int:
        """Items flagged this conveyor session (sell_soon + reject) — feeds the
        live forecast loop (CNN scans → RNN re-forecast)."""
        return sum(1 for t in self.session_counts.values()
                   if t in ("sell_soon", "reject"))

    def reset_session(self):
        self.track_history.clear()
        self.session_counts.clear()
        self.session_value.clear()
        self.queued_ids.clear()
        self.single_history.clear()

    def _enqueue_review(self, crop_bgr: np.ndarray, det: dict, track_id: int):
        """Save the crop + log one row so the item can be re-labeled and folded
        into the next training run (active learning). Deduped per track id."""
        REVIEW_DIR.mkdir(parents=True, exist_ok=True)
        fname = f"{det['fruit']}_{track_id}.jpg"
        cv2.imwrite(str(REVIEW_DIR / fname), crop_bgr)
        row = {
            "image": fname,
            "fruit": det["fruit"],
            "tier_raw": det.get("tier_raw"),
            "confidence": det.get("confidence"),
            "rotten_prob": det.get("rotten_prob"),
        }
        with open(REVIEW_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")

    # ---------------- stage 2 helpers ----------------

    def _preprocess(self, crop_bgr: np.ndarray) -> np.ndarray:
        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)
        return preprocess_input(rgb.astype(np.float32))[np.newaxis]

    def _grade(self, softmax: np.ndarray, yolo_fruit: str) -> dict:
        """Turn a (possibly smoothed) softmax into a business decision.

        We grade on the classifier's own (smoothed) prediction — fresh/rotten
        depends on decay, which the classifier reads well; identity confusion
        (e.g. a warm-lit red apple) shows up as low confidence and is caught by
        the abstain gate below rather than being papered over."""
        idx = int(np.argmax(softmax))
        label = self.class_names[idx]
        confidence = float(softmax[idx])
        rotten_prob = float(sum(p for name, p in zip(self.class_names, softmax)
                                if name.startswith("rotten")))
        if rotten_prob >= SELL_SOON_BAND[1]:
            tier = "reject"
        elif rotten_prob >= SELL_SOON_BAND[0]:
            tier = "sell_soon"
        else:
            tier = "fresh"
        # confidence gate: if the model isn't sure enough, abstain rather than
        # guess — the item is flagged for human review (active-learning loop).
        tier_raw = tier  # what it *would* have called it (for the deck/debug)
        if confidence < CONFIDENCE_TAU:
            tier = "review"
        agree = yolo_fruit in label
        return {
            "label": label,
            "tier": tier,
            "tier_raw": tier_raw,
            "rotten_prob": round(rotten_prob, 3),
            "confidence": round(confidence, 3),
            "fruit_agreement": agree,
        }

    # ---------------- main entry ----------------

    def process_frame(self, frame_bgr: np.ndarray, mode: str = "single",
                      explain: bool = False) -> dict:
        """Run the two-stage pipeline on one frame.

        mode='single'   → plain detection, optional Grad-CAM on largest fruit
        mode='conveyor' → tracking + per-track majority vote + session counts
        """
        if mode == "conveyor":
            results = self.detector.track(
                frame_bgr, persist=True, classes=list(COCO_FRUIT),
                conf=0.35, verbose=False)
        else:
            results = self.detector(
                frame_bgr, classes=list(COCO_FRUIT), conf=0.35, verbose=False)

        detections = []
        boxes = results[0].boxes
        if boxes is not None:
            for box in boxes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                fruit = COCO_FRUIT.get(int(box.cls[0]), "fruit")
                track_id = int(box.id[0]) if box.id is not None else None
                det = {"box": [x1, y1, x2, y2], "fruit": fruit,
                       "track_id": track_id,
                       "det_conf": round(float(box.conf[0]), 3)}

                crop = frame_bgr[max(0, y1):y2, max(0, x1):x2]
                if self.classifier is not None and crop.size > 0:
                    batch = self._preprocess(crop)
                    softmax = self.classifier.predict(batch, verbose=0)[0]
                    if track_id is not None:
                        self.track_history[track_id].append(softmax)
                        softmax = np.mean(self.track_history[track_id], axis=0)
                    elif len(boxes) == 1:
                        # single mode, one item held up → smooth over recent frames
                        self.single_history.append(softmax)
                        softmax = np.mean(self.single_history, axis=0)
                    det.update(self._grade(softmax, fruit))
                    severity = rot_area_fraction(crop)
                    det["severity"] = round(severity, 3)
                    det["action"] = markdown_recommendation(det["tier"], severity)
                    det["unit_price"] = UNIT_PRICE.get(fruit, 0.30)
                    det["recovered"] = recovered_value(det["tier"], fruit)
                    if track_id is not None:
                        self.session_counts[track_id] = det["tier"]
                        self.session_value[track_id] = det["recovered"]
                        # active learning: queue low-confidence items once each
                        if det["tier"] == "review" and track_id not in self.queued_ids:
                            self.queued_ids.add(track_id)
                            if crop.size > 0:
                                self._enqueue_review(crop, det, track_id)
                else:
                    det.update({"label": None, "tier": "untrained",
                                "note": "classifier not trained yet — run notebook 02"})
                detections.append(det)

        # Fallback: YOLO detects only apple/banana/orange/carrot (COCO). For the
        # other produce types (tomato, mango, …) it finds no box — so in single
        # mode we classify the center crop directly, no detection needed.
        if not detections and mode == "single" and self.classifier is not None:
            h, w = frame_bgr.shape[:2]
            s = min(h, w)
            y0, x0 = (h - s) // 2, (w - s) // 2
            crop = frame_bgr[y0:y0 + s, x0:x0 + s]
            if crop.size > 0:
                softmax = self.classifier.predict(self._preprocess(crop), verbose=0)[0]
                fruit = produce_from_label(self.class_names[int(np.argmax(softmax))])
                det = {"box": [x0, y0, x0 + s, y0 + s], "fruit": fruit,
                       "track_id": None, "det_conf": None, "source": "fallback"}
                det.update(self._grade(softmax, fruit))
                det["fruit_agreement"] = None  # no detector opinion in fallback
                sev = rot_area_fraction(crop)
                det["severity"] = round(sev, 3)
                det["action"] = markdown_recommendation(det["tier"], sev)
                det["unit_price"] = UNIT_PRICE.get(fruit, 0.30)
                det["recovered"] = recovered_value(det["tier"], fruit)
                detections.append(det)

        # Grad-CAM on the largest fruit only (single mode, opt-in: it's slow)
        if explain and self.classifier is not None and detections:
            largest = max(detections, key=lambda d: (d["box"][2] - d["box"][0])
                          * (d["box"][3] - d["box"][1]))
            x1, y1, x2, y2 = largest["box"]
            crop = frame_bgr[max(0, y1):y2, max(0, x1):x2]
            if crop.size > 0:
                heat = gradcam_heatmap(self.classifier, self._preprocess(crop))
                largest["heatmap_png"] = _b64_png(overlay_heatmap(crop, heat))

        out = {"detections": detections, "model_loaded": self.model_loaded}
        if mode == "conveyor":
            tiers = list(self.session_counts.values())
            out["session"] = {
                "scanned": len(tiers),
                "fresh": tiers.count("fresh"),
                "sell_soon": tiers.count("sell_soon"),
                "reject": tiers.count("reject"),
                "review": tiers.count("review"),
                "recovered_eur": round(sum(self.session_value.values()), 2),
            }
        return out

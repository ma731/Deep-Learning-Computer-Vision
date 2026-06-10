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

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
CLASSIFIER_PATH = MODELS_DIR / "freshguard_mobilenetv2.keras"
CLASS_NAMES_PATH = MODELS_DIR / "class_names.json"

# COCO class ids for the produce our pilot supports (all detected zero-shot)
COCO_FRUIT = {46: "banana", 47: "apple", 49: "orange", 51: "carrot"}
IMG_SIZE = 224
SMOOTH_WINDOW = 15          # frames of softmax history per track
SELL_SOON_BAND = (0.40, 0.65)  # rotten-prob band → "sell soon" tier

# Overridden at load time by models/class_names.json (training export).
DEFAULT_CLASSES = ["fresh_apple", "fresh_banana", "fresh_orange", "fresh_carrot",
                   "rotten_apple", "rotten_banana", "rotten_orange", "rotten_carrot"]


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

    @property
    def model_loaded(self) -> bool:
        return self.classifier is not None

    def reset_session(self):
        self.track_history.clear()
        self.session_counts.clear()

    # ---------------- stage 2 helpers ----------------

    def _preprocess(self, crop_bgr: np.ndarray) -> np.ndarray:
        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)
        return preprocess_input(rgb.astype(np.float32))[np.newaxis]

    def _grade(self, softmax: np.ndarray, yolo_fruit: str) -> dict:
        """Turn a (possibly smoothed) softmax into a business decision."""
        idx = int(np.argmax(softmax))
        label = self.class_names[idx]
        rotten_prob = float(sum(p for name, p in zip(self.class_names, softmax)
                                if name.startswith("rotten")))
        if rotten_prob >= SELL_SOON_BAND[1]:
            tier = "reject"
        elif rotten_prob >= SELL_SOON_BAND[0]:
            tier = "sell_soon"
        else:
            tier = "fresh"
        # integrity check: detector and classifier should agree on the fruit
        agree = yolo_fruit in label
        return {
            "label": label,
            "tier": tier,
            "rotten_prob": round(rotten_prob, 3),
            "confidence": round(float(softmax[idx]), 3),
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
                    det.update(self._grade(softmax, fruit))
                    severity = rot_area_fraction(crop)
                    det["severity"] = round(severity, 3)
                    det["action"] = markdown_recommendation(det["tier"], severity)
                    if track_id is not None:
                        self.session_counts[track_id] = det["tier"]
                else:
                    det.update({"label": None, "tier": "untrained",
                                "note": "classifier not trained yet — run notebook 02"})
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
            }
        return out

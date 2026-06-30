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

import store
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
NO_PRODUCT_TAU = 0.42       # below this in the fallback path → "no produce in view"
DETECT_CONF = 0.25          # YOLO detection threshold (lower = easier to detect)
WHITE_BALANCE = True        # neutralize warm-light colour cast before inference

# --- demo easter egg ---------------------------------------------------------
# When a face fills the frame (a person, COCO class 0), short-circuit the
# produce pipeline and return a "funny moment" verdict instead of trying to
# grade a human as fruit. Pure crowd-pleaser for the live presentation.
EASTER_EGG = True
PERSON_CLASS = 0            # COCO 'person'
EASTER_AREA = 0.16          # person box must cover >=16% of the frame to trigger
EASTER_NAME = "BigBossBass"  # the legend himself

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


def _b64_jpg(img_bgr: np.ndarray, size: int = 120) -> str:
    """Small data-URI JPEG thumbnail (for the augmentation playground)."""
    t = cv2.resize(img_bgr, (size, size))
    ok, buf = cv2.imencode(".jpg", t, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return ("data:image/jpeg;base64," + base64.b64encode(buf).decode()) if ok else ""


def white_balance(img_bgr: np.ndarray) -> np.ndarray:
    """Gray-world white balance — neutralizes a warm/cool lighting colour cast
    so a real apple under warm light stops drifting toward 'orange'. Classic CV
    (course session 2). Conservative clip avoids over-correction."""
    f = img_bgr.astype(np.float32)
    avg = f.reshape(-1, 3).mean(axis=0)            # per-channel mean (B, G, R)
    scale = avg.mean() / (avg + 1e-6)
    scale = np.clip(scale, 0.7, 1.5)               # don't over-push any channel
    return np.clip(f * scale, 0, 255).astype(np.uint8)


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


def shelf_life_days(rotten_prob: float, severity: float) -> float:
    """Rough 'days remaining' for the manager: a fresh item (~0 rot) has ~7 days;
    it shrinks with rot probability and visible decay surface. Heuristic, but it
    turns the grade into a number staff can act on."""
    days = (1.0 - float(rotten_prob)) * 7.0 - float(severity) * 4.0
    return round(max(0.0, days), 1)


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
        self._compare = None                        # lazy ANN/CNN compare models

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

    def _classify(self, crop_bgr: np.ndarray) -> np.ndarray:
        """Classify a crop with light test-time augmentation (original + h-flip),
        averaged. Steadier predictions on hard/small produce like strawberries —
        no retraining required."""
        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (IMG_SIZE, IMG_SIZE),
                         interpolation=cv2.INTER_LINEAR).astype(np.float32)
        batch = np.stack([rgb, rgb[:, ::-1, :]])           # + horizontal flip (TTA)
        preds = self.classifier.predict(preprocess_input(batch), verbose=0)
        return preds.mean(axis=0)

    def _saliency_crop(self, frame_bgr: np.ndarray):
        """Padded bbox of the most colour-saturated blob — isolates vivid produce
        (a strawberry) from a dull background so the classifier sees the fruit,
        not the room. None if nothing stands out."""
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        sat = cv2.GaussianBlur(hsv[:, :, 1], (0, 0), 9)
        _, mask = cv2.threshold(sat, max(55, int(sat.mean() * 1.6)), 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return None
        c = max(cnts, key=cv2.contourArea)
        H, W = frame_bgr.shape[:2]
        if cv2.contourArea(c) < 0.01 * H * W:
            return None
        x, y, w, h = cv2.boundingRect(c)
        pad = int(0.15 * max(w, h))
        return (max(0, x - pad), max(0, y - pad),
                min(W, x + w + pad), min(H, y + h + pad))

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
        # top-3 softmax (for the probability bars) + normalised entropy (OOD signal)
        order = np.argsort(softmax)[::-1][:3]
        top = [[self.class_names[int(i)], round(float(softmax[int(i)]), 4)] for i in order]
        p = np.clip(softmax, 1e-9, 1.0)
        entropy = float(-(p * np.log(p)).sum() / np.log(len(softmax)))
        return {
            "label": label,
            "tier": tier,
            "tier_raw": tier_raw,
            "rotten_prob": round(rotten_prob, 3),
            "confidence": round(confidence, 3),
            "fruit_agreement": agree,
            "top": top,
            "entropy": round(entropy, 3),
        }

    # ---------------- Lab: compare + augment ----------------

    def _verdict_from(self, softmax: np.ndarray, classes=None) -> dict:
        """Compact verdict (label/conf/rot/tier) from any model's softmax."""
        classes = classes or self.class_names
        idx = int(np.argmax(softmax))
        conf = float(softmax[idx])
        rot = float(sum(p for n, p in zip(classes, softmax) if n.startswith("rotten")))
        tier = "reject" if rot >= SELL_SOON_BAND[1] else "sell_soon" if rot >= SELL_SOON_BAND[0] else "fresh"
        if conf < CONFIDENCE_TAU:
            tier = "review"
        return {"label": classes[idx], "confidence": round(conf, 3),
                "rotten_prob": round(rot, 3), "tier": tier}

    def _load_compare(self):
        """Lazily load the ANN + CNN baselines (Lab model-compare). Retries each
        call until BOTH exist, so it picks them up the moment training finishes."""
        if self._compare is not None:
            return self._compare
        summ = MODELS_DIR / "compare_summary.json"
        info = json.loads(summ.read_text()) if summ.exists() else {}
        m = {"img": info.get("img_size", 96),
             "classes": info.get("classes") or self.class_names,
             "acc": info.get("models", {}), "ann": None, "cnn": None}
        try:
            import tensorflow as tf
            ap, cp = MODELS_DIR / "ann_baseline.keras", MODELS_DIR / "cnn_scratch.keras"
            if ap.exists():
                m["ann"] = tf.keras.models.load_model(ap)
            if cp.exists():
                m["cnn"] = tf.keras.models.load_model(cp)
        except Exception:
            pass
        if m["ann"] is not None and m["cnn"] is not None:
            self._compare = m         # cache only when both are ready
        return m

    def compare_models(self, frame_bgr: np.ndarray) -> dict:
        """Run the same center-cropped frame through ANN, CNN and MobileNetV2."""
        import time
        h, w = frame_bgr.shape[:2]
        s = min(h, w)
        crop = frame_bgr[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
        out = []
        if self.classifier is not None:
            t = time.perf_counter(); sm = self._classify(crop); ms = (time.perf_counter() - t) * 1000
            v = self._verdict_from(sm); v.update(name="MobileNetV2 · transfer", key="mobilenet",
                                                 ms=round(ms, 1), test_acc=0.956); out.append(v)
        cm = self._load_compare()
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        small = (cv2.resize(rgb, (cm["img"], cm["img"])).astype(np.float32) / 255.0)[np.newaxis]
        for key, name, sk in (("ann", "ANN · flattened pixels", "ann_baseline"),
                              ("cnn", "CNN · from scratch", "cnn_scratch")):
            mdl = cm.get(key)
            if mdl is None:
                out.append({"name": name, "key": key, "pending": True}); continue
            t = time.perf_counter(); pred = mdl.predict(small, verbose=0)[0]; ms = (time.perf_counter() - t) * 1000
            v = self._verdict_from(pred, cm["classes"])
            v.update(name=name, key=key, ms=round(ms, 1),
                     test_acc=cm["acc"].get(sk, {}).get("test_accuracy"))
            out.append(v)
        return {"thumb": _b64_jpg(crop, 160), "models": out}

    def augment_variants(self, frame_bgr: np.ndarray) -> dict:
        """Apply the inference-time robustness transforms and grade each — shows
        how white-balance / TTA / saliency-crop move the prediction."""
        if self.classifier is None:
            return {"variants": []}
        h, w = frame_bgr.shape[:2]
        s = min(h, w)
        base = frame_bgr[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
        bright = lambda im, f: np.clip(im.astype(np.float32) * f, 0, 255).astype(np.uint8)
        variants = [("original", base), ("gray-world WB", white_balance(base)),
                    ("h-flip · TTA", base[:, ::-1]), ("brighter", bright(base, 1.35)),
                    ("darker", bright(base, 0.6))]
        sal = self._saliency_crop(frame_bgr)
        if sal:
            x0, y0, x1, y1 = sal
            c = frame_bgr[y0:y1, x0:x1]
            if c.size > 0:
                variants.append(("saliency crop", c))
        out = []
        for name, img in variants:
            if img.size == 0:
                continue
            v = self._verdict_from(self._classify(img))
            v.update(name=name, thumb=_b64_jpg(img))
            out.append(v)
        return {"variants": out}

    # ---------------- demo easter egg ----------------

    def _easter_egg(self, frame_bgr: np.ndarray, boxes) -> dict | None:
        """If a person's face fills the frame, return a tongue-in-cheek 'legend'
        verdict instead of a produce grade. Returns None when no big-enough
        person box is present, so normal grading proceeds."""
        H, W = frame_bgr.shape[:2]
        frame_area = float(H * W) or 1.0
        best = None
        for box in boxes:
            if int(box.cls[0]) != PERSON_CLASS:
                continue
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
            frac = max(0, x2 - x1) * max(0, y2 - y1) / frame_area
            if frac >= EASTER_AREA and (best is None or frac > best[0]):
                best = (frac, float(box.conf[0]), [x1, y1, x2, y2])
        if best is None:
            return None
        _, conf, box = best
        return {
            "box": box,
            "fruit": EASTER_NAME,
            "track_id": None,
            "det_conf": round(conf, 3),
            "easter": True,
            "tier": "legend",
            "label": "Homo sapiens · heirloom variety",
            "confidence": 0.999,
            "rotten_prob": 0.0,
            "severity": 0.0,
            "shelf_life_days": 9999.0,
            "action": "Certified legend — do NOT mark down",
            "note": f"That's {EASTER_NAME}, not produce",
            "fun": {
                "name": EASTER_NAME,
                "lines": [
                    ["Specimen", EASTER_NAME],
                    ["Variety", "100% organic, free-range legend"],
                    ["Ripeness", "peak — aging like fine wine"],
                    ["Freshness score", "999 / 100"],
                    ["Rot probability", "0% — legends don't spoil"],
                    ["Shelf life", "infinite"],
                    ["Beard", "majestic"],
                    ["Recommendation", "frame it, don't bin it"],
                ],
            },
        }

    # ---------------- main entry ----------------

    def process_frame(self, frame_bgr: np.ndarray, mode: str = "single",
                      explain: bool = False, log: bool = False) -> dict:
        """Run the two-stage pipeline on one frame.

        mode='single'   → plain detection, optional Grad-CAM on largest fruit
        mode='conveyor' → tracking + per-track majority vote + session counts
        log=True         → persist single-mode grades to history (set by the
                           frontend for deliberate grabs: upload, batch, explain;
                           never for the continuous live-preview loop, which would
                           flood the DB). Conveyor logs per new track regardless.
        """
        if WHITE_BALANCE:
            frame_bgr = white_balance(frame_bgr)   # counter lighting colour cast
        if mode == "conveyor":
            results = self.detector.track(
                frame_bgr, persist=True, classes=list(COCO_FRUIT),
                conf=DETECT_CONF, verbose=False)
        else:
            # also look for a person (COCO 0) so the face-fills-frame easter egg
            # can fire; person boxes are filtered out of grading below.
            cls = list(COCO_FRUIT) + ([PERSON_CLASS] if EASTER_EGG else [])
            results = self.detector(
                frame_bgr, classes=cls, conf=DETECT_CONF, verbose=False)

        detections = []
        boxes = results[0].boxes

        # Easter egg: a face filling the frame wins outright (single mode only).
        if EASTER_EGG and mode == "single" and boxes is not None:
            egg = self._easter_egg(frame_bgr, boxes)
            if egg is not None:
                return {"detections": [egg], "model_loaded": self.model_loaded,
                        "easter": True}

        if boxes is not None:
            for box in boxes:
                if int(box.cls[0]) == PERSON_CLASS:
                    continue   # person boxes are only for the easter egg
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                fruit = COCO_FRUIT.get(int(box.cls[0]), "fruit")
                track_id = int(box.id[0]) if box.id is not None else None
                det = {"box": [x1, y1, x2, y2], "fruit": fruit,
                       "track_id": track_id,
                       "det_conf": round(float(box.conf[0]), 3)}

                crop = frame_bgr[max(0, y1):y2, max(0, x1):x2]
                if self.classifier is not None and crop.size > 0:
                    softmax = self._classify(crop)            # TTA-averaged
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
                    det["shelf_life_days"] = shelf_life_days(det.get("rotten_prob", 0), severity)
                    if track_id is not None:
                        is_new = track_id not in self.session_counts
                        self.session_counts[track_id] = det["tier"]
                        self.session_value[track_id] = det["recovered"]
                        if is_new:
                            store.log_scan(fruit, det["tier"], det.get("confidence"),
                                           det.get("rotten_prob"), det.get("recovered"))
                        # active learning: queue low-confidence items once each
                        if det["tier"] == "review" and track_id not in self.queued_ids:
                            self.queued_ids.add(track_id)
                            if crop.size > 0:
                                self._enqueue_review(crop, det, track_id)
                    elif log:
                        # single mode (no track id): persist deliberate grabs
                        store.log_scan(fruit, det["tier"], det.get("confidence"),
                                       det.get("rotten_prob"), det.get("recovered"))
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
            # candidate crops: the center square AND a colour-saliency crop (which
            # isolates a strawberry). Keep whichever the classifier is most sure of.
            candidates = [(x0, y0, x0 + s, y0 + s)]
            sal = self._saliency_crop(frame_bgr)
            if sal:
                candidates.append(sal)
            best = None
            for (bx0, by0, bx1, by1) in candidates:
                crop = frame_bgr[by0:by1, bx0:bx1]
                if crop.size == 0:
                    continue
                sm = self._classify(crop)
                conf = float(np.max(sm))
                if best is None or conf > best[0]:
                    best = (conf, sm, [bx0, by0, bx1, by1], crop)
            if best:
                conf0, softmax, box, crop = best
                if conf0 < NO_PRODUCT_TAU:
                    # foreign-object / empty-scene guard: don't guess a fruit
                    detections.append({"box": box, "fruit": "—", "track_id": None,
                                       "det_conf": None, "source": "fallback",
                                       "label": None, "tier": "none",
                                       "confidence": round(conf0, 3),
                                       "note": "no produce in view"})
                else:
                    self.single_history.append(softmax)          # temporal smoothing
                    softmax = np.mean(self.single_history, axis=0)
                    fruit = produce_from_label(self.class_names[int(np.argmax(softmax))])
                    det = {"box": box, "fruit": fruit,
                           "track_id": None, "det_conf": None, "source": "fallback"}
                    det.update(self._grade(softmax, fruit))
                    det["fruit_agreement"] = None  # no detector opinion in fallback
                    sev = rot_area_fraction(crop)
                    det["severity"] = round(sev, 3)
                    det["shelf_life_days"] = shelf_life_days(det.get("rotten_prob", 0), sev)
                    det["action"] = markdown_recommendation(det["tier"], sev)
                    det["unit_price"] = UNIT_PRICE.get(fruit, 0.30)
                    det["recovered"] = recovered_value(det["tier"], fruit)
                    if log:
                        store.log_scan(fruit, det["tier"], det.get("confidence"),
                                       det.get("rotten_prob"), det.get("recovered"))
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

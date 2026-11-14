"""Build the browser demo in demo/: the classifier as ONNX, sample photos, Grad-CAM, reference scores.

Needs Python 3.12 with TensorFlow, Keras 3.13 (the model was saved with it), tf2onnx and
onnxruntime, plus the local held-out test split in data/dataset/test.

    python scripts/build_web_demo.py

The page itself (demo/index.html) needs no server: GitHub Pages serves it as static files.
Thresholds and prices are read from backend/pipeline.py so the two can't drift apart.
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
TEST = ROOT / "data" / "dataset" / "test"
MODEL = ROOT / "models" / "freshguard_mobilenetv2.keras"
ONNX = DEMO / "model" / "freshguard_mobilenetv2.onnx"
PRODUCE = ["apple", "banana", "orange", "strawberry", "tomato"]
DISPLAY_MAX = 480
IMG = 224


# --- constants shared with the backend ----------------------------------------- #
def backend_constants() -> dict:
    """Read the grading constants straight out of backend/pipeline.py (no cv2 import)."""
    tree = ast.parse((ROOT / "backend" / "pipeline.py").read_text(encoding="utf-8"))
    want = {"SELL_SOON_BAND", "CONFIDENCE_TAU", "UNIT_PRICE", "RECOVERY_RATE"}
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in want:
                out[name] = ast.literal_eval(node.value)
    out["SELL_SOON_BAND"] = list(out["SELL_SOON_BAND"])
    return out


# --- the same maths the browser runs ---------------------------------------------- #
def resize224(img: Image.Image) -> np.ndarray:
    """Squash to 224x224 with plain bilinear sampling (cv2.INTER_LINEAR, as the backend does).
    The page runs the same loop, so browser and Python see the same pixels."""
    src = np.asarray(img.convert("RGB"), dtype=np.float64)
    H, W = src.shape[:2]

    def axis(n_src):
        f = np.maximum(0, (np.arange(IMG) + 0.5) * n_src / IMG - 0.5)
        i0 = np.minimum(n_src - 1, np.floor(f).astype(int))
        return i0, np.minimum(n_src - 1, i0 + 1), f - i0

    y0, y1, wy = axis(H)
    x0, x1, wx = axis(W)
    wx, wy = wx[None, :, None], wy[:, None, None]
    top = src[y0][:, x0] * (1 - wx) + src[y0][:, x1] * wx
    bot = src[y1][:, x0] * (1 - wx) + src[y1][:, x1] * wx
    return np.clip(np.trunc(top * (1 - wy) + bot * wy + 0.5), 0, 255).astype(np.uint8)


def to_input(img: Image.Image) -> np.ndarray:
    """224x224 pixels, then MobileNetV2 scaling."""
    rgb = resize224(img).astype(np.float32)
    batch = np.stack([rgb, rgb[:, ::-1, :]])             # original + horizontal flip (TTA)
    return batch / 127.5 - 1.0


def hsv_opencv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """RGB uint8 -> OpenCV-style HSV (H 0..180, S and V 0..255)."""
    x = rgb.astype(np.float32)
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    v = x.max(-1)
    mn = x.min(-1)
    d = v - mn
    s = np.where(v > 0, d / np.maximum(v, 1e-6) * 255, 0)
    h = np.zeros_like(v)
    nz = d > 0
    rm, gm = nz & (v == r), nz & (v == g) & (v != r)
    bm = nz & ~rm & ~gm
    h[rm] = 60 * (g[rm] - b[rm]) / d[rm]
    h[gm] = 120 + 60 * (b[gm] - r[gm]) / d[gm]
    h[bm] = 240 + 60 * (r[bm] - g[bm]) / d[bm]
    h = np.where(h < 0, h + 360, h) / 2
    return np.round(h), np.round(s), v


def _morph(mask: np.ndarray, k: int, fn) -> np.ndarray:
    p = k // 2
    pad = np.pad(mask, p, mode="edge")
    stack = [pad[i:i + mask.shape[0], j:j + mask.shape[1]] for i in range(k) for j in range(k)]
    return fn(np.stack(stack), axis=0)


def severity(img: Image.Image) -> float:
    """numpy port of backend rot_area_fraction, on the 224 px copy the browser also uses."""
    rgb = resize224(img)
    h, s, v = hsv_opencv(rgb)
    mask = ((v < 70) | ((h < 30) & (s > 60) & (v < 140))).astype(np.uint8)
    opened = _morph(_morph(mask, 5, np.min), 5, np.max)
    return float(opened.mean())


# --- Grad-CAM ------------------------------------------------------------------- #
def jet(x: np.ndarray) -> np.ndarray:
    r = np.clip(1.5 - np.abs(4 * x - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * x - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * x - 1), 0, 1)
    return (np.stack([r, g, b], -1) * 255).astype(np.uint8)


def gradcam(model, batch: np.ndarray, class_index: int) -> np.ndarray:
    import tensorflow as tf
    grad_model = tf.keras.Model(model.input, [model.get_layer("out_relu").output, model.output])
    with tf.GradientTape() as tape:
        conv, preds = grad_model(batch[:1])
        score = preds[:, class_index]
    grads = tape.gradient(score, conv)
    weights = tf.reduce_mean(grads, axis=(0, 1, 2))
    cam = tf.maximum(tf.squeeze(conv[0] @ weights[..., tf.newaxis]), 0)
    return (cam / (tf.reduce_max(cam) + 1e-8)).numpy()


def overlay(img: Image.Image, cam: np.ndarray, alpha: float = 0.45) -> Image.Image:
    heat = Image.fromarray((cam * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR)
    colour = jet(np.asarray(heat, dtype=np.float32) / 255)
    base = np.asarray(img.convert("RGB"), dtype=np.float32)
    return Image.fromarray((alpha * colour + (1 - alpha) * base).astype(np.uint8))


# --- build ---------------------------------------------------------------------- #
def convert(model) -> tuple[str, str]:
    import tensorflow as tf
    import tf2onnx

    spec = (tf.TensorSpec((None, IMG, IMG, 3), tf.float32, name="image"),)

    @tf.function(input_signature=spec)
    def forward(x):
        return {"probs": model(x, training=False)}

    ONNX.parent.mkdir(parents=True, exist_ok=True)
    proto, _ = tf2onnx.convert.from_function(forward, input_signature=spec, opset=17,
                                             output_path=str(ONNX))
    return proto.graph.input[0].name, proto.graph.output[0].name


def main() -> int:
    import keras
    import onnxruntime as ort

    model = keras.models.load_model(MODEL, compile=False)
    classes = json.loads((ROOT / "models" / "class_names.json").read_text(encoding="utf-8"))
    in_name, out_name = convert(model)
    sess = ort.InferenceSession(str(ONNX), providers=["CPUExecutionProvider"])

    (DEMO / "samples").mkdir(parents=True, exist_ok=True)
    samples, worst = [], 0.0
    sell_soon = backend_constants()["SELL_SOON_BAND"]

    def score(path: Path, name: str):
        img = Image.open(path).convert("RGB")
        img.thumbnail((DISPLAY_MAX, DISPLAY_MAX))
        out = DEMO / "samples" / f"{name}.jpg"
        img.save(out, quality=88)
        img = Image.open(out).convert("RGB")          # score exactly what the page loads
        batch = to_input(img)
        return img, batch, model.predict(batch, verbose=0).mean(0)

    def add(name, truth, path, skipped, img, batch, keras_p):
        nonlocal worst
        onnx_p = sess.run([out_name], {in_name: batch})[0].mean(0)
        worst = max(worst, float(np.abs(onnx_p - keras_p).max()))
        top = int(np.argmax(keras_p))
        overlay(img, gradcam(model, batch, top)).save(DEMO / "samples" / f"{name}_cam.jpg", quality=85)
        samples.append({"id": name, "photo": f"samples/{name}.jpg", "cam": f"samples/{name}_cam.jpg",
                        "truth": truth, "source": path.name, "skipped": skipped,
                        "keras_probs": [round(float(p), 6) for p in keras_p],
                        "severity": round(severity(img), 4)})
        print(f"{name:22s} truth={truth:18s} keras={classes[top]:18s} p={keras_p[top]:.3f} skipped={skipped}")

    def photos(cls):
        return sorted(p for p in (TEST / cls).iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})

    for produce in PRODUCE:
        for state in ("fresh", "rotten"):
            cls = f"{state}_{produce}"
            # first test photo the model grades correctly; `skipped` records how many came before it
            for skipped, path in enumerate(photos(cls)):
                img, batch, keras_p = score(path, cls)
                if classes[int(np.argmax(keras_p))] == cls:
                    break
            add(cls, cls, path, skipped, img, batch, keras_p)

    # One borderline photo, so the page can show a markdown: the first test photo (same
    # fixed order) the model puts in the "sell soon" band, shown with its true label.
    seen = 0
    for produce in PRODUCE:
        for state in ("rotten", "fresh"):
            cls = f"{state}_{produce}"
            for path in photos(cls)[:60]:
                img, batch, keras_p = score(path, "borderline")
                rot = sum(p for c, p in zip(classes, keras_p) if c.startswith("rotten"))
                if sell_soon[0] <= rot < sell_soon[1]:
                    add("borderline", cls, path, seen, img, batch, keras_p)
                    break
                seen += 1
            else:
                continue
            break
        else:
            continue
        break

    raw = ONNX.read_bytes()
    manifest = {
        "model": {"file": "model/" + ONNX.name, "input": in_name, "output": out_name,
                  "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "size": IMG},
        "classes": classes,
        "backend": backend_constants(),
        "parity_onnx_vs_keras_max_abs": worst,
        "samples": samples,
    }
    (DEMO / "demo.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(f"ONNX {len(raw) / 1e6:.1f} MB, max |onnx - keras| over samples = {worst:.2e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

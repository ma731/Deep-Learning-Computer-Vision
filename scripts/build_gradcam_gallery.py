"""Offline: precompute a Grad-CAM overlay for one test image per class →
docs/figures/gradcam/<class>.jpg + models/gradcam_gallery.json (Lab gallery).
Run:  .venv\\Scripts\\python.exe scripts/build_gradcam_gallery.py
"""
import json, pathlib, random, sys
import cv2, numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from gradcam import gradcam_heatmap, overlay_heatmap   # noqa: E402

MODELS, TEST = ROOT / "models", ROOT / "data" / "dataset" / "test"
OUT = ROOT / "docs" / "figures" / "gradcam"
OUT.mkdir(parents=True, exist_ok=True)
clf = tf.keras.models.load_model(MODELS / "freshguard_mobilenetv2.keras")
classes = json.loads((MODELS / "class_names.json").read_text())

IMG = 224
items = []
for cname in classes:
    d = TEST / cname
    if not d.exists():
        continue
    files = sorted(p for p in d.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not files:
        continue
    p = random.Random(7).choice(files)
    img = cv2.imread(str(p))
    if img is None:
        continue
    crop = cv2.resize(img, (IMG, IMG))
    batch = preprocess_input(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32))[None]
    over = overlay_heatmap(crop, gradcam_heatmap(clf, batch))
    cv2.imwrite(str(OUT / f"{cname}.jpg"), over, [cv2.IMWRITE_JPEG_QUALITY, 85])
    items.append({"label": cname, "rotten": cname.startswith("rotten"),
                  "produce": cname.split("_", 1)[1], "img": f"/figures/gradcam/{cname}.jpg"})
    print("gradcam:", cname, flush=True)

(MODELS / "gradcam_gallery.json").write_text(json.dumps({"items": items}))
print("DONE gradcam", len(items), flush=True)

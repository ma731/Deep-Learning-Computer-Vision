"""Offline: confusion-matrix COUNTS as JSON (for the interactive Model-tab matrix).
Runs MobileNetV2 over a balanced sample of the test set.
Run:  .venv\\Scripts\\python.exe scripts/build_confusion.py
"""
import json, pathlib, random
import cv2, numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS, TEST = ROOT / "models", ROOT / "data" / "dataset" / "test"
clf = tf.keras.models.load_model(MODELS / "freshguard_mobilenetv2.keras")
classes = json.loads((MODELS / "class_names.json").read_text())
ci = {c: i for i, c in enumerate(classes)}
IMG, PER = 224, 70
mat = np.zeros((len(classes), len(classes)), int)
for cname in classes:
    d = TEST / cname
    if not d.exists():
        continue
    files = sorted(p for p in d.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    random.Random(42).shuffle(files)
    batch = []
    for p in files[:PER]:
        im = cv2.imread(str(p))
        if im is None:
            continue
        rgb = cv2.cvtColor(cv2.resize(im, (IMG, IMG)), cv2.COLOR_BGR2RGB).astype(np.float32)
        batch.append(preprocess_input(rgb))
    if not batch:
        continue
    for pr in clf.predict(np.array(batch), batch_size=64, verbose=0):
        mat[ci[cname], int(np.argmax(pr))] += 1
    print("confusion:", cname, flush=True)

acc = float(np.trace(mat) / max(1, mat.sum()))
(MODELS / "confusion_matrix.json").write_text(json.dumps({"classes": classes, "matrix": mat.tolist(), "accuracy": round(acc, 4)}))
print("DONE confusion acc=%.3f" % acc, flush=True)

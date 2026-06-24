"""Offline: project MobileNetV2's penultimate features for a sample of the test
set down to 2D with t-SNE → models/embeddings.json (for the Lab embedding map).
Run:  .venv\\Scripts\\python.exe scripts/build_embeddings.py
"""
import json, pathlib, random
import cv2, numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from sklearn.manifold import TSNE

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS, TEST = ROOT / "models", ROOT / "data" / "dataset" / "test"
clf = tf.keras.models.load_model(MODELS / "freshguard_mobilenetv2.keras")
classes = json.loads((MODELS / "class_names.json").read_text())
feat = tf.keras.Model(clf.input, clf.layers[-2].output)   # penultimate features

IMG, PER = 224, 25
X, meta = [], []
for cname in classes:
    d = TEST / cname
    if not d.exists():
        continue
    files = sorted(p for p in d.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    random.Random(42).shuffle(files)
    for p in files[:PER]:
        img = cv2.imread(str(p))
        if img is None:
            continue
        rgb = cv2.cvtColor(cv2.resize(img, (IMG, IMG)), cv2.COLOR_BGR2RGB).astype(np.float32)
        X.append(preprocess_input(rgb)); meta.append(cname)

print(f"extracting features for {len(X)} images…", flush=True)
F = feat.predict(np.array(X), batch_size=64, verbose=0).reshape(len(X), -1)
print("running t-SNE…", flush=True)
emb = TSNE(n_components=2, perplexity=30, init="pca", random_state=42).fit_transform(F)
mn = emb.min(0); rng = emb.max(0) - mn; rng[rng == 0] = 1
emb = (emb - mn) / rng
pts = [{"x": round(float(emb[i, 0]), 4), "y": round(float(emb[i, 1]), 4),
        "label": meta[i], "rotten": meta[i].startswith("rotten"),
        "produce": meta[i].split("_", 1)[1]} for i in range(len(meta))]
(MODELS / "embeddings.json").write_text(json.dumps({"points": pts, "n": len(pts)}))
print("DONE embeddings", len(pts), flush=True)

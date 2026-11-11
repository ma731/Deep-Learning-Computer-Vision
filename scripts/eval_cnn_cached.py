"""Score the shipped MobileNetV2 on the cached test arrays (same pixels the ViT sees)
and time it on CPU, batch 1. Writes models/cnn_eval_cached.json.

Run:  .venv\\Scripts\\python.exe scripts/eval_cnn_cached.py
"""
import json
import pathlib
import sys
import time

import numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from metrics import balanced_subset, score  # noqa: E402

cache = pathlib.Path.home() / "fg_cache"
path = ROOT / "models" / "freshguard_mobilenetv2.keras"
model = tf.keras.models.load_model(path)
classes = json.loads((cache / "classes.json").read_text())
x = np.load(cache / "test_x.npy", mmap_mode="r")
y = np.load(cache / "test_y.npy").astype(np.int64)
keep = np.flatnonzero(y >= 0)
probs = np.concatenate([model.predict(preprocess_input(x[keep[k:k + 128]].astype(np.float32)), verbose=0)
                        for k in range(0, len(keep), 128)])
np.save(cache / "probs_mobilenetv2.npy", probs)
yt = y[keep]

one = preprocess_input(x[:1].astype(np.float32))
for _ in range(5):
    model(one, training=False)
t = []
for _ in range(50):
    t0 = time.perf_counter()
    model(one, training=False)
    t.append((time.perf_counter() - t0) * 1000)

sub = balanced_subset(yt)
result = {
    "model": "MobileNetV2 (ImageNet) + head, fine-tuned top 30 layers",
    "framework": f"tensorflow {tf.__version__}",
    "params": int(model.count_params()),
    "size_mb_file": round(path.stat().st_size / 1e6, 1),
    "cpu_latency_ms_batch1": round(float(np.median(t)), 1),
    "test_full": score(yt, probs, classes),
    "test_balanced_70": score(yt[sub], probs[sub], classes),
}
(ROOT / "models" / "cnn_eval_cached.json").write_text(json.dumps(result, indent=2))
print({k: result["test_full"][k] for k in ("accuracy", "macro_f1", "auc_fresh_vs_rotten", "weakest")},
      result["cpu_latency_ms_batch1"], "ms")

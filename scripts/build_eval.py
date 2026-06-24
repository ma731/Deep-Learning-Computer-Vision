"""Offline: ROC curve + AUC (fresh-vs-rotten), reliability/calibration bins, and
the weakest per-class recall → models/eval.json (for the Model-tab charts).
Run:  .venv\\Scripts\\python.exe scripts/build_eval.py
"""
import json, pathlib, random
import cv2, numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from sklearn.metrics import roc_curve, auc

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS, TEST = ROOT / "models", ROOT / "data" / "dataset" / "test"
clf = tf.keras.models.load_model(MODELS / "freshguard_mobilenetv2.keras")
classes = json.loads((MODELS / "class_names.json").read_text())
rotten_idx = np.array([i for i, c in enumerate(classes) if c.startswith("rotten")])
IMG, PER = 224, 70

y_true, y_score, conf, correct, true_cls = [], [], [], [], []
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
        batch.append(preprocess_input(cv2.cvtColor(cv2.resize(im, (IMG, IMG)), cv2.COLOR_BGR2RGB).astype(np.float32)))
    if not batch:
        continue
    for pr in clf.predict(np.array(batch), batch_size=64, verbose=0):
        y_score.append(float(pr[rotten_idx].sum()))
        y_true.append(1 if cname.startswith("rotten") else 0)
        top = int(np.argmax(pr)); conf.append(float(pr[top]))
        correct.append(1 if classes[top] == cname else 0); true_cls.append(cname)
    print("eval:", cname, flush=True)

fpr, tpr, _ = roc_curve(y_true, y_score)
roc_auc = float(auc(fpr, tpr))
ix = np.linspace(0, len(fpr) - 1, min(70, len(fpr))).astype(int)
roc = {"fpr": [round(float(fpr[i]), 4) for i in ix], "tpr": [round(float(tpr[i]), 4) for i in ix], "auc": round(roc_auc, 4)}

conf = np.array(conf); correct = np.array(correct)
cal = []
for b in range(10):
    lo, hi = b / 10, (b + 1) / 10
    m = (conf >= lo) & (conf < hi) if b < 9 else (conf >= lo) & (conf <= hi)
    cal.append({"conf": round(float(conf[m].mean()), 3) if m.sum() else round((lo + hi) / 2, 3),
                "acc": round(float(correct[m].mean()), 3) if m.sum() else None, "count": int(m.sum())})

rec = {}
for c in classes:
    idx = [k for k, t in enumerate(true_cls) if t == c]
    rec[c] = round(float(np.mean([correct[k] for k in idx])), 3) if idx else None
weak = min((c for c in classes if rec[c] is not None), key=lambda c: rec[c])
overall = round(float(correct.mean()), 4)

(MODELS / "eval.json").write_text(json.dumps({
    "roc": roc, "calibration": cal, "overall_acc": overall,
    "weak": {"class": weak, "recall": rec[weak]}, "per_class_recall": rec}))
print("DONE eval auc=%.4f acc=%.4f weak=%s(%.2f)" % (roc_auc, overall, weak, rec[weak]), flush=True)

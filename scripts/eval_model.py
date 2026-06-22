"""Per-class metrics + confusion matrix for the current MobileNetV2.

Run after training to populate:
    models/classification_report.json   (per-class precision/recall/f1)
    docs/figures/confusion_matrix.png
These feed the in-app Model report.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from sklearn.metrics import classification_report, confusion_matrix

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
FIG = ROOT / "docs" / "figures"
TEST = ROOT / "data" / "dataset" / "test"

model = tf.keras.models.load_model(MODELS / "freshguard_mobilenetv2.keras")
gen = ImageDataGenerator(preprocessing_function=preprocess_input).flow_from_directory(
    TEST, target_size=(224, 224), batch_size=64, class_mode="categorical", shuffle=False)
probs = model.predict(gen, verbose=1)
y_pred = probs.argmax(1)
y_true = gen.classes
labels = [n for n, _ in sorted(gen.class_indices.items(), key=lambda kv: kv[1])]

rep = classification_report(y_true, y_pred, target_names=labels,
                            output_dict=True, zero_division=0)
(MODELS / "classification_report.json").write_text(json.dumps(rep))

cm = confusion_matrix(y_true, y_pred)
fig, ax = plt.subplots(figsize=(8.5, 7.5))
im = ax.imshow(cm, cmap="Greens")
ax.set_xticks(range(len(labels)))
ax.set_yticks(range(len(labels)))
ax.set_xticklabels(labels, rotation=90, fontsize=7)
ax.set_yticklabels(labels, fontsize=7)
ax.set_xlabel("predicted")
ax.set_ylabel("true")
ax.set_title("Confusion matrix — MobileNetV2 (20 classes)")
fig.colorbar(im, fraction=0.046, pad=0.04)
fig.tight_layout()
fig.savefig(FIG / "confusion_matrix.png", dpi=140)
print("wrote classification_report.json + confusion_matrix.png")

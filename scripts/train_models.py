"""FreshGuard — Notebook 02a as a script: the three-model ablation.

Model 1: ANN on flattened pixels   (the deliberate failure — no spatial structure)
Model 2: CNN from scratch          (spatial features + augmentation)
Model 3: MobileNetV2 transfer learning + fine-tuning  (the core model)

Exports (the integration contract):
    models/freshguard_mobilenetv2.keras
    models/class_names.json
    models/histories.json            (all training curves, for evaluation 02b)
    models/training_summary.json     (test accuracy per model)
    docs/figures/*.png               (curves + comparison chart)
"""

import json
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, Model, Sequential
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.callbacks import (EarlyStopping, ModelCheckpoint,
                                        ReduceLROnPlateau, TensorBoard)
from tensorflow.keras.preprocessing.image import ImageDataGenerator

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
FIGURES = ROOT / "docs" / "figures"
LOGS = ROOT / "logs"
for d in (MODELS, FIGURES, LOGS):
    d.mkdir(parents=True, exist_ok=True)

SEED = 42
tf.keras.utils.set_random_seed(SEED)

# ----------------------------------------------------------------------
# Dataset — 8 classes (fresh/rotten x apple/banana/orange/carrot)
# ----------------------------------------------------------------------
# Built by scripts/build_dataset.py (apple/banana/orange/carrot
# x fresh/rotten) — single source, all four COCO-detectable for Stage-1 YOLO.
DATA_DIR = ROOT / "data" / "dataset"
train_dir = DATA_DIR / "train"
test_dir = DATA_DIR / "test"
if not train_dir.exists():
    raise SystemExit("Run scripts/build_dataset.py first to create data/dataset/")
print("train:", train_dir)
print("test: ", test_dir)

BATCH = 64
VAL_SPLIT = 0.15


def make_generators(img_size: int, preprocessing=None, rescale=None,
                    augment=True):
    """Train/val generators (split from train dir) + untouched test gen."""
    # known-good augmentation (CNN 73% / MobileNetV2 95.6%). NOTE: a much more
    # aggressive variant (channel_shift 40 + shear + wide brightness) was tried
    # and HURT clean accuracy (CNN collapsed to ~29%); real-world robustness is
    # handled at inference instead (TTA + saliency crop in backend/pipeline.py).
    aug = dict(rotation_range=30, width_shift_range=0.15,
               height_shift_range=0.15, zoom_range=0.2,
               horizontal_flip=True, brightness_range=(0.6, 1.4)) if augment else {}
    train_idg = ImageDataGenerator(rescale=rescale,
                                   preprocessing_function=preprocessing,
                                   validation_split=VAL_SPLIT, **aug)
    plain_idg = ImageDataGenerator(rescale=rescale,
                                   preprocessing_function=preprocessing,
                                   validation_split=VAL_SPLIT)
    test_idg = ImageDataGenerator(rescale=rescale,
                                  preprocessing_function=preprocessing)
    common = dict(target_size=(img_size, img_size), batch_size=BATCH,
                  class_mode="categorical", seed=SEED)
    train_gen = train_idg.flow_from_directory(train_dir, subset="training",
                                              shuffle=True, **common)
    val_gen = plain_idg.flow_from_directory(train_dir, subset="validation",
                                            shuffle=False, **common)
    test_gen = test_idg.flow_from_directory(test_dir, shuffle=False, **common)
    return train_gen, val_gen, test_gen


histories: dict[str, dict] = {}
summary: dict[str, dict] = {}


def evaluate_and_log(name: str, model, test_gen, history, seconds: float):
    loss, acc = model.evaluate(test_gen, verbose=0)
    histories[name] = {k: [float(x) for x in v] for k, v in history.history.items()}
    summary[name] = {"test_accuracy": round(float(acc), 4),
                     "test_loss": round(float(loss), 4),
                     "params": int(model.count_params()),
                     "train_minutes": round(seconds / 60, 1)}
    print(f"[{name}] test accuracy: {acc:.4f}  ({model.count_params():,} params)")


def plot_history(name: str, history):
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for ax, metric in zip(axes, ("accuracy", "loss")):
        ax.plot(history.history[metric], label=f"train {metric}")
        ax.plot(history.history[f"val_{metric}"], label=f"val {metric}")
        ax.set_title(f"{name} - {metric}")
        ax.set_xlabel("epoch")
        ax.legend()
    fig.tight_layout()
    fig.savefig(FIGURES / f"curves_{name}.png", dpi=150)
    plt.close(fig)


# ----------------------------------------------------------------------
# Model 1 — ANN baseline on flattened pixels (96x96)
# Course arc: "limitations of traditional ANN for images"
# ----------------------------------------------------------------------
print("\n=== Model 1: ANN baseline ===")
train_g, val_g, test_g = make_generators(96, rescale=1.0 / 255, augment=False)
NUM_CLASSES = train_g.num_classes

ann = Sequential([
    layers.Input((96, 96, 3)),
    layers.Flatten(),
    layers.Dense(512, activation="relu"),
    layers.Dropout(0.3),
    layers.Dense(256, activation="relu"),
    layers.Dropout(0.3),
    layers.Dense(NUM_CLASSES, activation="softmax"),
], name="ann_baseline")
ann.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
            loss="categorical_crossentropy", metrics=["accuracy"])
t0 = time.time()
h = ann.fit(train_g, validation_data=val_g, epochs=8,
            callbacks=[EarlyStopping(patience=3, restore_best_weights=True)])
evaluate_and_log("ann_baseline", ann, test_g, h, time.time() - t0)
plot_history("ann_baseline", h)

# ----------------------------------------------------------------------
# Model 2 — CNN from scratch (128x128) + augmentation
# ----------------------------------------------------------------------
print("\n=== Model 2: CNN from scratch ===")
train_g, val_g, test_g = make_generators(128, rescale=1.0 / 255, augment=True)

cnn = Sequential([
    layers.Input((128, 128, 3)),
    layers.Conv2D(32, 3, activation="relu", padding="same"),
    layers.BatchNormalization(),
    layers.MaxPooling2D(),
    layers.Conv2D(64, 3, activation="relu", padding="same"),
    layers.BatchNormalization(),
    layers.MaxPooling2D(),
    layers.Conv2D(128, 3, activation="relu", padding="same"),
    layers.BatchNormalization(),
    layers.MaxPooling2D(),
    layers.Flatten(),
    layers.Dense(256, activation="relu"),
    layers.Dropout(0.4),
    layers.Dense(NUM_CLASSES, activation="softmax"),
], name="cnn_scratch")
cnn.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
            loss="categorical_crossentropy", metrics=["accuracy"])
t0 = time.time()
h = cnn.fit(train_g, validation_data=val_g, epochs=12,
            callbacks=[EarlyStopping(patience=3, restore_best_weights=True)])
evaluate_and_log("cnn_scratch", cnn, test_g, h, time.time() - t0)
plot_history("cnn_scratch", h)

# ----------------------------------------------------------------------
# Model 3 — MobileNetV2 transfer learning (224x224), then fine-tune.
# Built UN-nested (Model(base.input, out)) so Grad-CAM reaches 'out_relu'.
# ----------------------------------------------------------------------
print("\n=== Model 3: MobileNetV2 transfer learning ===")
train_g, val_g, test_g = make_generators(224, preprocessing=preprocess_input,
                                         augment=True)

base = MobileNetV2(include_top=False, weights="imagenet",
                   input_shape=(224, 224, 3))
base.trainable = False
x = layers.GlobalAveragePooling2D()(base.output)
x = layers.Dropout(0.3)(x)
x = layers.Dense(256, activation="relu")(x)
x = layers.Dropout(0.3)(x)
out = layers.Dense(NUM_CLASSES, activation="softmax")(x)
mnv2 = Model(base.input, out, name="freshguard_mobilenetv2")

ckpt_path = MODELS / "freshguard_mobilenetv2.keras"
callbacks = [
    EarlyStopping(patience=3, restore_best_weights=True),
    ModelCheckpoint(str(ckpt_path), save_best_only=True,
                    monitor="val_accuracy"),
    ReduceLROnPlateau(factor=0.3, patience=2, min_lr=1e-6),
    TensorBoard(log_dir=str(LOGS / "mnv2")),
]

mnv2.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
             loss="categorical_crossentropy", metrics=["accuracy"])
t0 = time.time()
h1 = mnv2.fit(train_g, validation_data=val_g, epochs=5, callbacks=callbacks)

# Phase 2 — fine-tune the top of the backbone at a low LR
print("\n--- fine-tuning top 30 layers ---")
base.trainable = True
for layer in base.layers[:-30]:
    layer.trainable = False
mnv2.compile(optimizer=tf.keras.optimizers.Adam(1e-5),
             loss="categorical_crossentropy", metrics=["accuracy"])
h2 = mnv2.fit(train_g, validation_data=val_g, epochs=4, callbacks=callbacks)
seconds = time.time() - t0

# merge the two phases into one history for plotting
merged = {k: h1.history[k] + h2.history[k] for k in h1.history}
h1.history = merged
evaluate_and_log("mobilenetv2_tl", mnv2, test_g, h1, seconds)
plot_history("mobilenetv2_tl", h1)

# ----------------------------------------------------------------------
# Exports — the integration contract
# ----------------------------------------------------------------------
mnv2.save(ckpt_path)  # final weights (checkpoint may hold best-val version)

class_names = [name for name, _ in
               sorted(train_g.class_indices.items(), key=lambda kv: kv[1])]
(MODELS / "class_names.json").write_text(json.dumps(class_names))
(MODELS / "histories.json").write_text(json.dumps(histories))
(MODELS / "training_summary.json").write_text(json.dumps(summary, indent=2))

# comparison chart (the ablation slide)
names = list(summary)
accs = [summary[n]["test_accuracy"] * 100 for n in names]
fig, ax = plt.subplots(figsize=(7, 4))
bars = ax.bar(names, accs, color=["#999999", "#5b8db8", "#34c477"])
ax.bar_label(bars, fmt="%.1f%%")
ax.set_ylabel("test accuracy (%)")
ax.set_ylim(0, 100)
ax.set_title("Same data, three architectures - why we chose transfer learning")
fig.tight_layout()
fig.savefig(FIGURES / "model_comparison.png", dpi=150)

print("\nDone. Summary:")
print(json.dumps(summary, indent=2))
print("Exports written to", MODELS)

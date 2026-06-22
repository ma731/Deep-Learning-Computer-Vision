"""Train compact-but-real ANN + CNN baselines and SAVE them for the live
model-compare feature (Lab tab). These are the same architectures as the
full ablation (scripts/train_models.py) but trained on a capped number of
steps so they finish in minutes on CPU — enough to show the *qualitative*
gap (ANN guesses, CNN is decent, MobileNetV2 is sharp) on a live image.

Outputs:
    models/ann_baseline.keras
    models/cnn_scratch.keras
    models/compare_summary.json   (test acc + class order + img size)

Run:  .venv\\Scripts\\python.exe scripts/train_compare_models.py
"""
import json, time, pathlib
import tensorflow as tf
from tensorflow.keras import layers, Sequential
from tensorflow.keras.preprocessing.image import ImageDataGenerator

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DATA = ROOT / "data" / "dataset"
TRAIN, TEST = DATA / "train", DATA / "test"
MODELS.mkdir(parents=True, exist_ok=True)
if not TRAIN.exists():
    raise SystemExit("Run scripts/build_dataset.py first to create data/dataset/")

tf.keras.utils.set_random_seed(42)
IMG = 96                # shared input size → uniform preprocessing in /api/compare
BATCH = 64
STEPS = 60              # ~3.8k imgs/epoch — capped for speed, still real training
VAL_STEPS = 12

idg = ImageDataGenerator(rescale=1.0 / 255, validation_split=0.15,
                         rotation_range=25, width_shift_range=0.12,
                         height_shift_range=0.12, zoom_range=0.18, horizontal_flip=True)
plain = ImageDataGenerator(rescale=1.0 / 255, validation_split=0.15)
test_idg = ImageDataGenerator(rescale=1.0 / 255)
common = dict(target_size=(IMG, IMG), batch_size=BATCH, class_mode="categorical", seed=42)
train_g = idg.flow_from_directory(TRAIN, subset="training", shuffle=True, **common)
val_g = plain.flow_from_directory(TRAIN, subset="validation", shuffle=False, **common)
test_g = test_idg.flow_from_directory(TEST, shuffle=False, **common)
N = train_g.num_classes
# class order (index -> label) so the backend maps argmax correctly
class_order = [c for c, _ in sorted(train_g.class_indices.items(), key=lambda kv: kv[1])]

summary = {"img_size": IMG, "classes": class_order, "models": {}}


def run(name, model, epochs):
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                  loss="categorical_crossentropy", metrics=["accuracy"])
    t0 = time.time()
    model.fit(train_g, validation_data=val_g, epochs=epochs,
              steps_per_epoch=STEPS, validation_steps=VAL_STEPS, verbose=2)
    loss, acc = model.evaluate(test_g, steps=30, verbose=0)
    model.save(MODELS / f"{name}.keras")
    summary["models"][name] = {"test_accuracy": round(float(acc), 4),
                               "params": int(model.count_params()),
                               "train_minutes": round((time.time() - t0) / 60, 1)}
    print(f"[{name}] acc={acc:.3f}  saved -> models/{name}.keras", flush=True)


# Model 1 — ANN on flattened pixels (the deliberate failure)
ann = Sequential([
    layers.Input((IMG, IMG, 3)), layers.Flatten(),
    layers.Dense(512, activation="relu"), layers.Dropout(0.3),
    layers.Dense(256, activation="relu"), layers.Dropout(0.3),
    layers.Dense(N, activation="softmax"),
], name="ann_baseline")
run("ann_baseline", ann, epochs=6)

# Model 2 — small CNN from scratch (spatial features)
cnn = Sequential([
    layers.Input((IMG, IMG, 3)),
    layers.Conv2D(32, 3, activation="relu", padding="same"), layers.MaxPooling2D(),
    layers.Conv2D(64, 3, activation="relu", padding="same"), layers.MaxPooling2D(),
    layers.Conv2D(128, 3, activation="relu", padding="same"), layers.MaxPooling2D(),
    layers.GlobalAveragePooling2D(),
    layers.Dense(256, activation="relu"), layers.Dropout(0.4),
    layers.Dense(N, activation="softmax"),
], name="cnn_scratch")
run("cnn_scratch", cnn, epochs=8)

(MODELS / "compare_summary.json").write_text(json.dumps(summary, indent=2))
print("DONE", json.dumps(summary["models"]), flush=True)

# FreshGuard 🍏 — AI Quality Control for Perishable Retail

> A camera looks at a piece of fruit or veg and instantly says **Fresh**,
> **Sell soon**, or **Reject** — then turns that verdict into a price decision,
> a reorder signal, and a euro figure for "waste we just avoided."
>
> Deep Learning final project, IE University. Built by Team FreshGuard.

FreshGuard is two things at once:

1. **A real deep-learning system.** A two-stage computer-vision pipeline
   (object detector + fine-tuned CNN classifier) plus an LSTM time-series
   forecaster. It exercises all three neural architectures the course covers —
   ANN, CNN, and RNN — and proves *why* the CNN/transfer-learning route wins
   with a head-to-head ablation on our own data.
2. **A believable product.** A deployed-feeling web "ops console" that a store
   manager could actually use: live scanning on a phone or webcam, a manager
   dashboard with money-recovered and reorder advice, a live market board, an
   active-learning review queue, and a model-explainability lab.

This README is long on purpose. It is meant to be the single place where a
teammate, a professor, or a future employer can understand the whole project —
**the business reasoning and the deep-learning internals, with real code.**

---

## Table of contents

1. [The business problem](#1-the-business-problem)
2. [What FreshGuard does](#2-what-freshguard-does)
3. [System architecture (the big picture)](#3-system-architecture-the-big-picture)
4. [**The deep-learning core (in depth, with code)**](#4-the-deep-learning-core-in-depth-with-code)
   - [4.1 The three-architecture ablation](#41-the-three-architecture-ablation-the-heart-of-the-assignment)
   - [4.2 Model 1 — ANN baseline](#42-model-1--ann-baseline-the-deliberate-failure)
   - [4.3 Model 2 — CNN from scratch](#43-model-2--cnn-from-scratch)
   - [4.4 Model 3 — MobileNetV2 transfer learning](#44-model-3--mobilenetv2-transfer-learning-the-core-model)
   - [4.5 Data pipeline and augmentation](#45-data-pipeline-and-augmentation)
   - [4.6 Results, and what they teach us](#46-results-and-what-they-teach-us)
   - [4.7 Stage 1 — YOLOv8 detection + tracking](#47-stage-1--yolov8-detection--tracking)
   - [4.8 From softmax to a business decision](#48-from-softmax-to-a-business-decision)
   - [4.9 Robustness without retraining](#49-robustness-without-retraining)
   - [4.10 Grad-CAM explainability](#410-grad-cam-explainability)
   - [4.11 Knowing when it doesn't know (abstention + active learning)](#411-knowing-when-it-doesnt-know-abstention--active-learning)
   - [4.12 The RNN — LSTM spoilage forecast](#412-the-rnn--lstm-spoilage-forecast)
5. [The web application, tab by tab](#5-the-web-application-tab-by-tab)
6. [The business model and ROI](#6-the-business-model-and-roi)
7. [Tech stack](#7-tech-stack)
8. [Repository map](#8-repository-map)
9. [API reference](#9-api-reference)
10. [Quick start (run it locally)](#10-quick-start-run-it-locally)
11. [Run it on your phone (the demo rig)](#11-run-it-on-your-phone-the-demo-rig)
12. [Train everything from scratch](#12-train-everything-from-scratch)
13. [Seeding demo data](#13-seeding-demo-data)
14. [Configuration](#14-configuration)
15. [Honest limitations and caveats](#15-honest-limitations-and-caveats)
16. [Roadmap](#16-roadmap)
17. [Team and academic mapping](#17-team-and-academic-mapping)

---

## 1. The business problem

Supermarkets throw away a large slice of the fruit and veg they buy. Industry
estimates put produce **shrink at roughly 4–6% of produce revenue** — and a big
chunk of that is avoidable. The reason is timing: decay is usually caught **too
late**, by a busy employee eyeballing the shelf once or twice a day. By the time
a tomato "looks bad enough" to act on, it is already bin material. A day earlier,
it could have been marked down 20% and still sold.

There is now also a **legal** push. Spain's **Law 1/2025** on food-waste
prevention requires retailers to take action on food approaching the end of its
life — discount it, or donate it — rather than simply discarding it. But here is
the catch that makes this an AI problem: **loose produce has no expiry date
printed on it.** A pre-packed yogurt has a date; a single apple in a bin does
not. For loose fruit and veg, **visual condition is the only available signal**
of how close it is to spoiling.

So the business needs an objective, consistent, always-on way to read visual
freshness and turn it into an action. That is exactly what a computer-vision
model is good at.

**The one-sentence pitch:** *FreshGuard turns any phone or webcam into an
objective produce inspector that catches decay a day earlier, so stores mark
down instead of bin — recovering margin and staying compliant with Law 1/2025.*

---

## 2. What FreshGuard does

Point a camera at produce. FreshGuard:

- **Detects and identifies** the item (it's a banana, an apple, a strawberry…).
- **Grades** its condition into one of three tiers:
  - 🟢 **Fresh** — sell at full price.
  - 🟡 **Sell soon** — mark it down (−20% or −40% depending on how far gone).
  - 🔴 **Reject** — pull it; donate if still edible (Law 1/2025).
  - ⚪ **Needs review** — the model isn't confident enough, so it *abstains* and
    flags the item for a human (more on this clever bit later).
- **Explains itself** with a Grad-CAM heatmap (it highlights the brown/bruised
  region it reacted to — so staff can trust it, not just obey it).
- **Quantifies the money** recovered by acting early instead of binning.
- **Forecasts** next week's spoilage volume with an LSTM, and converts that into
  a concrete reorder recommendation ("order ~12% less, lighter week ahead").

All wrapped in a web app that runs on a laptop and is reachable from a phone.

---

## 3. System architecture (the big picture)

```
                 ┌──────────────────────────────────────────────────────────┐
  camera frame   │  STAGE 1 — YOLOv8n (pretrained on COCO)   backend/pipeline │
  ───────────▶   │  detect + track produce in the frame                       │
                 │  • banana / apple / orange / carrot  → real bounding boxes │
                 │  • other 6 produce types             → center-crop fallback│
                 └───────────────────────────┬──────────────────────────────┘
                                              │  cropped fruit
                                              ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  STAGE 2 — MobileNetV2 (OUR fine-tuned CNN)   models/       │
                 │  20-class softmax → aggregate to rotten-probability        │
                 │  → tier: fresh / sell-soon / reject / review               │
                 │  ├─ Grad-CAM heatmap            backend/gradcam.py          │
                 │  ├─ abstain when unsure → review queue (active learning)   │
                 │  └─ majority vote over tracked frames (stable live demo)   │
                 └───────────────────────────┬──────────────────────────────┘
                                              │  graded items logged
                                              ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  FORECAST — LSTM 7-day spoilage outlook    backend/forecast │
                 │  scan history → reorder + markdown action plan             │
                 └──────────────────────────────────────────────────────────┘

  FastAPI serves /api/* and the static frontend   backend/main.py
  Web app: live scan, manager dashboard, market, review, model, lab   frontend/
```

A key framing for the assignment: **the core predictive model we built is the
CNN classifier.** YOLO is an off-the-shelf preprocessing component (we did not
train it). The project deliberately exercises **all three architectures** the
course requires:

- **ANN** — a dense baseline (and the classifier head on top of the CNN).
- **CNN** — the core model (from-scratch CNN + the MobileNetV2 transfer model).
- **RNN / LSTM** — the spoilage forecaster.

---

## 4. The deep-learning core (in depth, with code)

This is the heart of the project. Everything below is the real code from the
repo (lightly trimmed for readability).

### 4.1 The three-architecture ablation (the heart of the assignment)

We don't just *assert* that a CNN is the right tool for images. We **prove it**
by training three different architectures on the **exact same 20-class dataset**
and comparing them. The whole story is the staircase of results:

| Model | What it is | Test accuracy | Parameters | Train time |
|---|---|---:|---:|---:|
| **ANN** (flattened pixels) | Dense net on raw pixels | **31.9%** | 14.3M | 17.0 min |
| **CNN from scratch** | Conv blocks, learns features | **75.0%** | 8.5M | 46.2 min |
| **MobileNetV2 transfer** | Pretrained backbone, fine-tuned | **95.8%** | **2.6M** | 61.2 min |

Read that table top to bottom and the architecture lesson jumps out: the
transfer-learning model is **~3.0× more accurate than the ANN while using ~5.5×
fewer parameters.** More parameters did not help the ANN — *the right inductive
bias* (convolution + pretrained features) did.

The full ablation lives in `scripts/train_models.py` (a script version of
notebook `02_model_training.ipynb`). Shared data generators feed all three:

```python
SEED = 42
tf.keras.utils.set_random_seed(SEED)   # reproducibility

def make_generators(img_size, preprocessing=None, rescale=None, augment=True):
    """Train/val generators (split from the train dir) + an untouched test gen."""
    aug = dict(rotation_range=30, width_shift_range=0.15, height_shift_range=0.15,
               zoom_range=0.2, horizontal_flip=True,
               brightness_range=(0.6, 1.4)) if augment else {}
    train_idg = ImageDataGenerator(rescale=rescale, preprocessing_function=preprocessing,
                                   validation_split=0.15, **aug)
    plain_idg = ImageDataGenerator(rescale=rescale, preprocessing_function=preprocessing,
                                   validation_split=0.15)               # val: no aug
    test_idg  = ImageDataGenerator(rescale=rescale, preprocessing_function=preprocessing)
    common = dict(target_size=(img_size, img_size), batch_size=64,
                  class_mode="categorical", seed=SEED)
    train_gen = train_idg.flow_from_directory(train_dir, subset="training",  shuffle=True,  **common)
    val_gen   = plain_idg.flow_from_directory(train_dir, subset="validation", shuffle=False, **common)
    test_gen  = test_idg.flow_from_directory(test_dir, shuffle=False, **common)
    return train_gen, val_gen, test_gen
```

Two deliberate choices here:

- **Validation set gets no augmentation.** You augment what you learn from, not
  what you measure on — otherwise your validation score is measuring a distorted
  distribution.
- **A note we learned the hard way (it's in the code comment):** a *more
  aggressive* augmentation recipe (big channel shifts + shear + extreme
  brightness) actually **hurt** clean accuracy (the CNN collapsed to ~29%). So
  we keep training augmentation moderate and push real-world robustness to
  **inference time** instead (test-time augmentation, white balance, saliency
  crop — see §4.9). This is a genuine empirical finding, not a guess.

### 4.2 Model 1 — ANN baseline (the deliberate failure)

A plain fully-connected network. It **flattens** the image into one long vector
and feeds it through dense layers. Flattening destroys all spatial structure:
the network has no idea that two pixels are next to each other, so it cannot
learn "edges," "texture," or "a brown patch." It is the wrong tool, on purpose,
to set the floor of the comparison.

```python
ann = Sequential([
    layers.Input((96, 96, 3)),
    layers.Flatten(),                                  # throws away all 2D structure
    layers.Dense(512, activation="relu"),
    layers.Dropout(0.3),
    layers.Dense(256, activation="relu"),
    layers.Dropout(0.3),
    layers.Dense(NUM_CLASSES, activation="softmax"),
], name="ann_baseline")
ann.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
            loss="categorical_crossentropy", metrics=["accuracy"])
ann.fit(train_g, validation_data=val_g, epochs=8,
        callbacks=[EarlyStopping(patience=3, restore_best_weights=True)])
```

**Result: 31.9% accuracy with 14.3M parameters.** It is the *biggest* model and
the *worst* performer — exactly the point. (Random guessing on 20 classes is 5%,
so it learned *something*, just not much.)

### 4.3 Model 2 — CNN from scratch

Now we give the network the right inductive bias: **convolution**. Conv layers
slide small learnable filters across the image, so they detect *local patterns*
(edges, then textures, then "rotten patch") regardless of where they appear.
`MaxPooling` shrinks the spatial size while keeping the strongest signals;
`BatchNormalization` stabilises training; `Dropout` fights overfitting.

```python
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
    layers.Dropout(0.4),                               # heavier dropout: small dataset
    layers.Dense(NUM_CLASSES, activation="softmax"),
], name="cnn_scratch")
cnn.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
            loss="categorical_crossentropy", metrics=["accuracy"])
cnn.fit(train_g, validation_data=val_g, epochs=12,
        callbacks=[EarlyStopping(patience=3, restore_best_weights=True)])
```

**Result: 75.0% accuracy with 8.5M parameters.** A massive jump over the ANN
(32% → 75%) with *fewer* parameters. That leap is the whole argument for using
convolutions on images. It's limited only by how much it can learn from our
(relatively small) dataset alone.

### 4.4 Model 3 — MobileNetV2 transfer learning (the core model)

Instead of learning visual features from scratch, we **borrow** them.
MobileNetV2 was pretrained on ImageNet (1.4M images, 1000 categories), so its
convolutional backbone already knows edges, textures, shapes, and colours. We
freeze that backbone, attach our own small classification head, train the head,
and then **fine-tune** the top of the backbone at a tiny learning rate.

```python
# --- Phase 1: frozen backbone, train only the new head ---
base = MobileNetV2(include_top=False, weights="imagenet", input_shape=(224, 224, 3))
base.trainable = False
x   = layers.GlobalAveragePooling2D()(base.output)
x   = layers.Dropout(0.3)(x)
x   = layers.Dense(256, activation="relu")(x)
x   = layers.Dropout(0.3)(x)
out = layers.Dense(NUM_CLASSES, activation="softmax")(x)
mnv2 = Model(base.input, out, name="freshguard_mobilenetv2")   # NB: un-nested (see §4.10)

callbacks = [
    EarlyStopping(patience=3, restore_best_weights=True),
    ModelCheckpoint(ckpt_path, save_best_only=True, monitor="val_accuracy"),
    ReduceLROnPlateau(factor=0.3, patience=2, min_lr=1e-6),
    TensorBoard(log_dir="logs/mnv2"),
]
mnv2.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
             loss="categorical_crossentropy", metrics=["accuracy"])
mnv2.fit(train_g, validation_data=val_g, epochs=5, callbacks=callbacks)

# --- Phase 2: unfreeze the TOP 30 layers, fine-tune at a very low LR ---
base.trainable = True
for layer in base.layers[:-30]:
    layer.trainable = False                       # keep the early, generic layers frozen
mnv2.compile(optimizer=tf.keras.optimizers.Adam(1e-5),   # 100x smaller LR: nudge, don't wreck
             loss="categorical_crossentropy", metrics=["accuracy"])
mnv2.fit(train_g, validation_data=val_g, epochs=4, callbacks=callbacks)
```

Why this works, in plain terms:

- **Phase 1** teaches only the new head to map ImageNet features → our 20
  classes. Fast, and it can't damage the valuable pretrained weights.
- **Phase 2** gently *fine-tunes* the last 30 backbone layers (the most
  task-specific ones) at a learning rate **100× smaller** (1e-5 vs 1e-3), so we
  specialise to fruit-rot without erasing what ImageNet taught it. The early
  layers (generic edges/colours) stay frozen.
- The callbacks are textbook good practice: `EarlyStopping` (stop when val stops
  improving, restore the best weights), `ModelCheckpoint` (save the best model),
  `ReduceLROnPlateau` (drop LR when stuck), `TensorBoard` (logged in `logs/mnv2`).

**Result: 95.8% accuracy with only 2.6M trainable parameters** — the best
accuracy *and* the smallest model. That is the transfer-learning payoff.

### 4.5 Data pipeline and augmentation

- **Dataset:** [Kaggle — Fruit and Vegetable Disease (Healthy vs Rotten)](https://www.kaggle.com/datasets/muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten).
- **Classes:** 10 produce × {fresh, rotten} = **20 classes**: apple, banana,
  orange, carrot, tomato, potato, cucumber, bell pepper, mango, strawberry.
- **Size:** ~27.7k images, split **85/15 → 23,537 train / 4,140 test.**
- **Why these 10:** apple/banana/orange/carrot are **COCO-detectable**, so
  Stage-1 YOLO can box and track them in real time. The other six are graded via
  a center-crop fallback (YOLO can't detect them, but our classifier still
  grades them). Broccoli was dropped — no clean rotten dataset.

Each model preprocesses to match how it was trained. Crucially, the **backend
preprocesses live crops the same way the model was trained** — for MobileNetV2
that means `mobilenet_v2.preprocess_input` (scales pixels to [-1, 1]):

```python
def _preprocess(self, crop_bgr):
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)        # OpenCV is BGR, Keras expects RGB
    rgb = cv2.resize(rgb, (224, 224), interpolation=cv2.INTER_LINEAR)
    return preprocess_input(rgb.astype(np.float32))[np.newaxis]
```

Train/serve preprocessing mismatch is one of the most common silent bugs in
deployed ML; keeping these identical is why the live accuracy matches the
notebook.

### 4.6 Results, and what they teach us

- **The ablation (the headline):** 31.9% → 75.0% → 95.8%. Stored in
  `models/training_summary.json`, charted in `docs/figures/model_comparison.png`.
- **Binary fresh-vs-rotten ROC-AUC = 0.9938** (`models/eval.json`,
  `docs/figures/roc_curve.png`). For the business, fresh-vs-rotten is the
  decision that matters most, and the model is near-perfect at it.
- **20×20 confusion matrix** (`docs/figures/confusion_matrix.png`, and an
  interactive version in the app's Model tab) shows where it slips. The weakest
  class is **rotten bell pepper (recall ~0.60)** — a useful honest finding: bell
  peppers wrinkle rather than discolour, so "rotten" is visually subtler.
- **Overfitting evidence:** training/validation curves per model
  (`docs/figures/curves_*.png`) — the from-scratch CNN shows the train/val gap
  that motivated dropout + augmentation; the transfer model generalises tightly.

> **Important honesty note on the in-app "model compare" (Lab tab).** The two
> baselines you can run *live* in the browser (`models/ann_baseline.keras`,
> `models/cnn_scratch.keras`) are **quick-trained at 96px for ~4 minutes each**
> (`scripts/train_compare_models.py`) and score ~13% / ~28% — intentionally low,
> only to show the *qualitative* gap live without a long training wait. The real
> ablation numbers (31.9 / 75.0 / 95.8) come from the full `train_models.py`.
> Don't confuse the two.

### 4.7 Stage 1 — YOLOv8 detection + tracking

Before we can grade a fruit, we have to find it in the frame. We use a
**pretrained YOLOv8n** (nano) from Ultralytics. In **conveyor mode** we use
ByteTrack so each fruit keeps a stable ID across frames (so we can vote over
time and count items once):

```python
COCO_FRUIT = {46: "banana", 47: "apple", 49: "orange", 51: "carrot"}

# conveyor mode: detect + track, only the COCO produce classes
results = self.detector.track(frame_bgr, persist=True,
                              classes=list(COCO_FRUIT), conf=0.25,
                              tracker="bytetrack.yaml", verbose=False)
```

For the six produce types COCO can't detect (tomato, mango, strawberry, etc.),
**single mode** falls back to classifying the **center crop** (plus a
saliency crop, §4.9) — no bounding box, but a full grade and Grad-CAM.

### 4.8 From softmax to a business decision

The classifier outputs a 20-way softmax (a probability per class). We don't show
that to a store manager — we turn it into one of four tiers. The trick: we sum
the probability mass over **all the `rotten_*` classes** to get a single
`rotten_prob`, then threshold it. We also **abstain** when the model isn't
confident:

```python
SELL_SOON_BAND = (0.40, 0.65)   # rotten-prob band -> "sell soon"
CONFIDENCE_TAU = 0.70           # below this top-class confidence -> abstain ("review")

def _grade(self, softmax, yolo_fruit):
    idx        = int(np.argmax(softmax))
    label      = self.class_names[idx]
    confidence = float(softmax[idx])
    # total probability the item is rotten = sum over every rotten_* class
    rotten_prob = float(sum(p for name, p in zip(self.class_names, softmax)
                            if name.startswith("rotten")))

    if   rotten_prob >= SELL_SOON_BAND[1]: tier = "reject"     # >= 0.65
    elif rotten_prob >= SELL_SOON_BAND[0]: tier = "sell_soon"  # 0.40-0.65
    else:                                  tier = "fresh"

    tier_raw = tier                         # what it WOULD have said (for debugging)
    if confidence < CONFIDENCE_TAU:         # not sure enough? don't guess.
        tier = "review"                     # hand it to a human (active learning)

    # extras the UI shows: top-3 classes + normalised entropy (an OOD signal)
    order   = np.argsort(softmax)[::-1][:3]
    top     = [[self.class_names[i], round(float(softmax[i]), 4)] for i in order]
    p       = np.clip(softmax, 1e-9, 1.0)
    entropy = float(-(p * np.log(p)).sum() / np.log(len(softmax)))   # 0=certain, 1=uniform
    return {"label": label, "tier": tier, "tier_raw": tier_raw,
            "rotten_prob": round(rotten_prob, 3), "confidence": round(confidence, 3),
            "top": top, "entropy": round(entropy, 3)}
```

Then a separate function turns the grade plus a measured **decay severity** into
the actual price action — this is where ML becomes a *decision*:

```python
def markdown_recommendation(tier, severity):
    if tier == "fresh":     return "full price"
    if tier == "sell_soon": return "markdown -40% (last day)" if severity > 0.25 else "markdown -20%"
    if tier == "reject":    return "remove - donate if edible (Law 1/2025)"
    return "-"
```

`severity` (how much of the surface looks decayed) comes from **classic
computer vision**, not the neural net — see below.

### 4.9 Robustness without retraining

A model that scores 95.8% on clean test images can still wobble on a shaky phone
held under warm supermarket lighting. Rather than retrain, we added four
inference-time tricks (all in `backend/pipeline.py`):

**(a) Gray-world white balance** — neutralise a warm/cool colour cast so a real
apple under tungsten light stops drifting toward "orange." Classic CV:

```python
def white_balance(img_bgr):
    f     = img_bgr.astype(np.float32)
    avg   = f.reshape(-1, 3).mean(axis=0)        # mean of B, G, R
    scale = np.clip(avg.mean() / (avg + 1e-6), 0.7, 1.5)   # clip => no over-correction
    return np.clip(f * scale, 0, 255).astype(np.uint8)
```

**(b) Test-time augmentation (TTA)** — classify the crop *and* its horizontal
flip, then average. Steadier predictions on hard/small produce, no retraining:

```python
def _classify(self, crop_bgr):
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    rgb   = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    rgb   = cv2.resize(rgb, (224, 224)).astype(np.float32)
    batch = np.stack([rgb, rgb[:, ::-1, :]])          # original + horizontal flip
    preds = self.classifier.predict(preprocess_input(batch), verbose=0)
    return preds.mean(axis=0)                         # average the two
```

**(c) Saliency crop** — find the most colour-saturated blob so the classifier
sees *the strawberry*, not the dull background/table behind it.

**(d) Temporal majority vote** — in conveyor/live mode we keep a 15-frame
softmax history per tracked item and average it, so a single odd frame can't
flip the verdict. (`SMOOTH_WINDOW = 15`.)

**(e) Decay severity via HSV** (classic CV, drives the markdown amount): rotten
patches are dark or desaturated-brown pixels in HSV space.

```python
def rot_area_fraction(crop_bgr):
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    dark  = v < 70                                  # bruised/dark patches
    brown = (h < 30) & (s > 60) & (v < 140)         # brownish decay
    mask  = cv2.morphologyEx((dark | brown).astype(np.uint8),
                             cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))   # de-speckle
    return float(mask.mean())                       # fraction of surface that looks decayed
```

### 4.10 Grad-CAM explainability

A grade nobody trusts is useless. **Grad-CAM** shows *where* the network looked:
it back-propagates the predicted class score into the last convolutional layer
and weights the feature maps by how much they mattered, producing a heatmap we
overlay on the fruit. Bright = "this region drove the decision." If it lights up
on an actual brown patch, staff trust it.

```python
LAST_CONV_LAYER = "out_relu"   # last conv activation in MobileNetV2

def gradcam_heatmap(model, img_batch, class_index=None):
    grad_model = tf.keras.Model(model.input,
                    [model.get_layer(LAST_CONV_LAYER).output, model.output])
    with tf.GradientTape() as tape:
        conv_out, predictions = grad_model(img_batch)
        if class_index is None:
            class_index = int(tf.argmax(predictions[0]))
        class_channel = predictions[:, class_index]
    grads        = tape.gradient(class_channel, conv_out)        # d(score)/d(featuremaps)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))          # importance per channel
    heatmap      = conv_out[0] @ pooled_grads[..., tf.newaxis]    # weighted sum
    heatmap      = tf.squeeze(heatmap)
    return (tf.maximum(heatmap, 0) / (tf.reduce_max(heatmap) + 1e-8)).numpy()   # ReLU + normalise
```

> **Design decision that makes this a 15-liner:** we build the MobileNetV2 model
> **un-nested** — `Model(base.input, out)` instead of `Sequential([base, head])`.
> A nested model hides `out_relu` inside a sub-model and Grad-CAM can't reach it.
> Building it flat keeps the last conv layer directly addressable. (There's a
> fallback that searches for the last 4D layer if the architecture differs.)

### 4.11 Knowing when it doesn't know (abstention + active learning)

Notice the `confidence < 0.70 → "review"` line in §4.8. Instead of guessing on a
hard item, FreshGuard **abstains** and drops the crop into a **review queue**.
This is two good ideas at once:

- **Safety:** a low-confidence guess shown as a confident verdict erodes trust.
  "I'm not sure, please check" is the honest answer.
- **Active learning:** the flagged crops are exactly the images the model would
  learn most from. A human relabels them in the **Review** tab, and they fold
  into the next training run. The model improves on *its own* weak spots. The app
  also reports a normalised **entropy** per prediction as an out-of-distribution
  signal (high entropy = "this doesn't look like anything I know").

### 4.12 The RNN — LSTM spoilage forecast

The third required architecture. A store manager doesn't only care about *this*
apple — they care about *next week's* spoilage so they can order the right
amount. We frame it as **time-series forecasting**: given the last **28 days** of
daily flagged-item counts, predict the **next 7 days**.

The clever part is **feature engineering**. We don't feed the LSTM only the raw
count — we add deterministic **calendar features** so it can anticipate things a
naive "same as last week" baseline structurally cannot: Spanish public holidays
(stores close, rotation stalls), the pre-holiday overstock, the day-after
spillover, and the end-of-month markdown block. Day-of-week and day-of-year are
encoded as sin/cos pairs so the model sees them as smooth cycles:

```python
def build_features(dates, target_scaled):
    """Columns: [scaled_count, dow_sin, dow_cos, doy_sin, doy_cos, is_holiday, is_promo]."""
    dates = pd.DatetimeIndex(dates)
    dow, doy, dom = dates.dayofweek, dates.dayofyear, dates.day
    dow_sin, dow_cos = np.sin(2*np.pi*dow/7),   np.cos(2*np.pi*dow/7)     # weekly cycle
    doy_sin, doy_cos = np.sin(2*np.pi*doy/365), np.cos(2*np.pi*doy/365)   # yearly cycle

    holidays_md = {(1,1),(1,6),(5,1),(8,15),(10,12),(11,1),(12,6),(12,8),(12,25)}
    is_holiday = np.zeros(len(dates))
    for i, d in enumerate(dates):
        if (d.month, d.day) in holidays_md:
            is_holiday[i] = 1.0                          # closure day
            if i+1 < len(dates): is_holiday[i+1] = 1.0   # day-after spillover
            if i-1 >= 0:         is_holiday[i-1] = 1.0    # pre-holiday overstock
    is_promo = (dom >= 27).astype(float)                 # end-of-month markdown block
    return np.column_stack([target_scaled, dow_sin, dow_cos,
                            doy_sin, doy_cos, is_holiday, is_promo])
```

The model itself is small (`LSTM(64) → Dense(7)`, trained in notebook 03 and
saved to `models/spoilage_lstm.keras` with its `MinMaxScaler` in
`spoilage_scaler.pkl`). At inference we scale the series, rebuild the exact same
features, feed the last 28-day window, and inverse-transform the prediction:

```python
model, scaler = _load_lstm()                      # cached for the process lifetime
scaled = scaler.transform(series.reshape(-1, 1)).flatten()
feat   = build_features(df["date"], scaled)
window = feat[-28:][np.newaxis, :, :]             # shape (1, 28, 7)
pred   = scaler.inverse_transform(model.predict(window)[0].reshape(-1, 1)).flatten()
```

**Graceful degradation:** if the LSTM isn't trained yet, the same endpoint falls
back to a **seasonal-naive** forecast (each future day = the matching weekday a
week ago). So the dashboard and demo are never blocked on training — a real
engineering nicety.

**RNN → action (the business bit):** a 7-day number is useless to a manager
unless it becomes a decision. `compute_action_plan` turns the forecast into a
reorder instruction:

```python
delta_pct = (sum(forecast_7d) - sum(last_7d)) / (sum(last_7d) + 1e-9) * 100
if   delta_pct <= -5: reorder = f"Order ~{abs(round(delta_pct))}% less - lighter spoilage week ahead"
elif delta_pct >=  5: reorder = f"Brace for ~{round(delta_pct)}% more markdowns - tighten ordering"
else:                 reorder = "Hold ordering steady - demand in line with last week"
```

**The data flywheel:** today's live conveyor scan count is appended to the
history before forecasting, so the LSTM re-forecasts on the freshest data. The
more the store scans, the better the forecast — a self-improving loop.

---

## 5. The web application, tab by tab

The frontend (`frontend/`, served by FastAPI) is a single-page "ops console"
styled in a dark **"Lab / Spectral"** theme (near-black green surfaces,
electric-lime accent, mono telemetry readouts). It is intentionally built to
*feel deployed*, not like a class demo.

- **🔴 Live scan** — the camera view. Single-item or conveyor mode, verdict card,
  a model readout (top-3 probability bars, an entropy/OOD meter, estimated
  shelf-life in days), recovered-€ counter, session counts, a 7-day outlook
  sparkline, a recent-grades feed, Grad-CAM on demand, and a session replay
  strip. Has **Start / Turn off camera** and prefers the **back camera** on phones.
- **📊 Manager** — the decision dashboard: spoilage forecast chart, today's KPIs,
  an ROI card, the action plan, a per-produce ops board (reorder quantities), a
  **compliance card** (Law 1/2025 actions taken), an impact projector (slide
  store count → projected € recovered), and a competitive-wedge table.
- **💹 Market** — live wholesale prices per produce (EUR/kg), an RNN reorder
  banner, and a LIVE/reference badge (real USDA data if a key is configured).
- **✅ Review** — the active-learning queue: low-confidence crops the model
  abstained on, each with a relabel dropdown + submit.
- **🧠 Model** — the evidence room: the racing ablation bars, animated
  ANN/CNN/RNN explainer diagrams, the ROC curve (AUC 0.9938) + calibration plot,
  the weakest-class callout, and an interactive 20×20 confusion matrix.
- **🔬 Lab** — play with the model: threshold-tuning decision-space, live
  model-compare (ANN/CNN/MobileNetV2 on one frame), an augmentation playground, a
  t-SNE embedding map, and a Grad-CAM gallery.
- **Context rail** (wide screens) — store identity, system status, live activity
  feed, clock — the "this is a real deployment" touch.

---

## 6. The business model and ROI

**Where the money comes from.** Every "sell soon" item caught a day early is an
item that gets **marked down and sold** instead of **binned**. FreshGuard books
that as *recovered margin*. The model in code is deliberately conservative: only
`sell_soon` items recover value (fresh would have sold anyway = €0; reject is
already lost = €0), and a marked-down item recovers ~60% of its retail price:

```python
UNIT_PRICE   = {"apple":0.40,"banana":0.25,"orange":0.50,"carrot":0.15,"tomato":0.30,
                "potato":0.20,"cucumber":0.45,"bellpepper":0.60,"mango":0.90,"strawberry":1.80}
RECOVERY_RATE = 0.60
def recovered_value(tier, fruit):
    return round(UNIT_PRICE.get(fruit, 0.30) * RECOVERY_RATE, 2) if tier == "sell_soon" else 0.0
```

**Unit economics (illustrative, label as such in any pitch).** A mid-size
supermarket does meaningful produce volume daily; produce shrink runs ~4–6% of
produce revenue. Even shaving a modest slice of that shrink, per store, per day,
compounds fast across a chain. The Manager tab's **impact projector** makes this
tangible: drag the store count and watch projected annual € recovered scale
(the deck uses an illustrative figure on the order of single-digit €M at chain
scale — clearly flagged as illustrative, not measured).

**Who pays, and why now.**
- **Who:** grocery chains and food halls with loose-produce sections.
- **Why now:** Spain's **Law 1/2025** turns "reduce food waste" from a nice-to-have
  into a **compliance requirement**, and loose produce (no expiry label) is
  exactly the gap FreshGuard fills. Compliance + margin recovery in one tool.

**The wedge / why it's defensible.** It runs on **hardware stores already have**
(a phone or a cheap webcam) — no special sensor. It is **explainable** (Grad-CAM),
which matters for staff trust and for a regulator. And it **improves itself** via
the active-learning review loop and the forecasting data flywheel: the more a
chain uses it, the better it gets, which is a compounding moat.

**Honest go-to-market caveats.** A live in-store deployment needs: a per-store
model check (lighting/camera domain shift — see §15), throughput (one laptop CPU
can't grade a fast belt for a whole store — you'd batch or add a small GPU/edge
box), and POS integration to actually apply the markdown. This MVP proves the
core loop; the rollout work is real and scoped, not hand-waved.

---

## 7. Tech stack

| Layer | Tools |
|---|---|
| Deep learning | TensorFlow / Keras (CNN + LSTM), Ultralytics YOLOv8 (detect + ByteTrack) |
| Classic CV | OpenCV (white balance, HSV decay mask, saliency crop) |
| ML tooling | scikit-learn (metrics, t-SNE, scaler), pandas/numpy, matplotlib/seaborn |
| Backend | FastAPI + Uvicorn, SQLite (scan log), a tiny `.env` loader |
| Frontend | Vanilla HTML/CSS/JS, anime.js v4, qrcode.js (no framework) |
| Demo rig | cloudflared / ngrok tunnel, PowerShell launchers |

---

## 8. Repository map

```
backend/
  main.py        FastAPI app: all /api/* endpoints + serves the frontend
  pipeline.py    the two-stage inference pipeline (YOLO -> MobileNetV2), grading, CV tricks
  gradcam.py     Grad-CAM heatmap + overlay
  forecast.py    LSTM spoilage forecast, calendar features, action plan, per-produce forecast
  market.py      live/reference produce prices (USDA Market News or a reference table)
  store.py       SQLite log of graded items (scans.db) -> dashboard history

frontend/
  index.html     the single-page app shell (6 tabs + context rail)
  app.js         camera loop, grading calls, all tab logic
  style.css      base design tokens/components ("Lab / Spectral")
  fx.css/fx.js   non-invasive motion/UX layer (aurora, transitions, mobile gestures)
  story-engine.js / vision-engine.js / net-anim.js / anime-fx.js   landing + diagram animations

notebooks/
  01_EDA.ipynb            exploration + classic-CV preprocessing showcase
  02_model_training.ipynb the 3-model ablation (the core) + evaluation + Grad-CAM
  03_model_LSTM.ipynb     the spoilage forecaster

scripts/
  build_dataset.py        download + build data/dataset/{train,test}/
  train_models.py         the full 3-model ablation -> models/ + figures
  train_compare_models.py quick small baselines for the live Lab "compare" (NOT the ablation)
  build_embeddings.py     t-SNE projection (Lab map)
  build_gradcam_gallery.py / build_confusion.py / build_eval.py   precompute Model/Lab JSON
  seed_demo.py            seed a realistic demo week into scans.db + the review queue
  go_live.ps1             one-click: server (0.0.0.0) + public HTTPS tunnel + QR
  run_phone.ps1           LAN-only launcher

models/    trained artifacts + precomputed JSON (the integration contract)
docs/      figures (EDA, curves, confusion, ROC, Grad-CAM) + planning docs
data/      sample_images (committed) ; dataset/ + review_queue/ (gitignored, runtime)
```

---

## 9. API reference

All under `http://localhost:8000`. The backend serves both the API and the
frontend on one origin.

| Method | Endpoint | What it does |
|---|---|---|
| GET  | `/api/health` | is the classifier loaded? |
| POST | `/api/predict?mode=&explain=&log=` | grade one frame (the main inference call) |
| POST | `/api/compare` | run ANN + CNN + MobileNetV2 on one frame (Lab) |
| POST | `/api/augment` | grade augmentation variants of one frame (Lab) |
| GET  | `/api/embeddings` | precomputed t-SNE points (Lab map) |
| GET  | `/api/gradcam_gallery` | precomputed Grad-CAM overlays per class |
| GET  | `/api/confusion` | 20×20 confusion matrix counts |
| GET  | `/api/eval` | ROC + calibration + weakest class |
| GET  | `/api/model_report` | ablation summary + class list + per-class metrics |
| GET  | `/api/forecast` | LSTM 7-day spoilage forecast + action plan |
| GET  | `/api/forecast/produce` | per-produce 7-day demand + reorder qty |
| GET  | `/api/market?refresh=` | live/reference produce prices |
| GET  | `/api/history` / `/api/history.csv` | logged scan stats / CSV export |
| GET  | `/api/review_queue` (+ `/clear`, `/relabel`) | active-learning queue |
| POST | `/api/reset_session` | clear the live session counters |
| GET  | `/api/lan` | LAN URL + optional public tunnel URL (for the phone QR) |

`/api/predict` flags: `mode` = `single` or `conveyor`; `explain=true` adds a
Grad-CAM overlay; `log=true` persists the grade to history (set only for
deliberate grabs — upload, batch, the Explain button — never the live preview
loop, which would flood the DB).

---

## 10. Quick start (run it locally)

```bash
pip install -r requirements.txt          # Python 3.12 recommended (3.14 is too new for TF)
uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
# open http://localhost:8000
```

It works **immediately, even before training**: YOLO boxes appear and grading
shows "model not trained yet." Full grading lights up once `models/` contains the
trained files. To see a populated dashboard right away, seed demo data (§13).

---

## 11. Run it on your phone (the demo rig)

Phone browsers need **HTTPS** for camera access (`getUserMedia` is blocked on
plain `http://<lan-ip>`), so the demo uses a public HTTPS tunnel. One command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\go_live.ps1
```

This frees the port, adds a one-time Windows firewall rule for 8000, starts the
server bound to `0.0.0.0`, starts the tunnel, and writes the public URL to
`.public_url` (the app reads it live and the in-app **phone QR** points to it).
Then on the laptop: open the app → tap the phone icon → scan the QR. The phone
opens over HTTPS, the **back camera** works, and grades log to history.

Notes: the tunnel runs from the laptop, so the laptop must stay awake/online
during a demo (a phone hotspot is a good backup). Audience phones reach the
public URL over their own internet — not the venue Wi-Fi. See `DEPLOY.md` for the
ngrok-static-domain (reusable QR) vs cloudflare (no warning page) trade-off.

---

## 12. Train everything from scratch

```bash
python scripts/build_dataset.py    # downloads + builds data/dataset/{train,test}/  (needs ~/.kaggle/kaggle.json)
python scripts/train_models.py     # the 3-model ablation -> models/ + docs/figures/
# notebooks/03_model_LSTM.ipynb     # trains the spoilage LSTM -> models/spoilage_lstm.keras
# then precompute the Model/Lab JSON:
python scripts/build_eval.py        # ROC + calibration + weak class -> models/eval.json
python scripts/build_confusion.py   # 20x20 confusion -> models/confusion_matrix.json
python scripts/build_embeddings.py  # t-SNE -> models/embeddings.json (needs scikit-learn)
python scripts/build_gradcam_gallery.py
```

The notebooks export an **exact set of artifact files** that the backend reads —
that file contract is what lets the team work in parallel (notebooks produce
files, backend consumes them).

---

## 13. Seeding demo data

A fresh `scans.db` is empty, so the Manager/Compliance/ROI/Review surfaces read
zero. Seed a realistic week so the demo looks alive:

```bash
python scripts/seed_demo.py            # wipe + seed ~7 days of grades + a review queue
python scripts/seed_demo.py --append   # add without wiping
python scripts/seed_demo.py --days 14  # longer span
```

The seeded grades use the real pricing/recovery logic, so the recovered-€ figure
is internally consistent. Any grades you make in the app accumulate on top.

---

## 14. Configuration

- **`.env`** at the repo root (see `.env.example`). `USDA_API_KEY=...` (free from
  [USDA Market News](https://mymarketnews.ams.usda.gov/)) flips the Market board
  to live prices; without it, a calibrated reference table is used.
- HTML/JS/CSS are served with a no-cache header, so edits show on refresh without
  a hard reload.

---

## 15. Honest limitations and caveats

A good project knows its own weak spots:

- **Domain shift is the real-world risk.** The model is trained on a clean Kaggle
  dataset. A specific store's lighting, camera, and backgrounds differ; expect
  accuracy to drop until you collect a small in-store calibration set (the
  active-learning queue is built for exactly this).
- **The forecast history is simulated.** The 2-year scan history is generated
  (with Spanish seasonality), clearly labelled as such. The LSTM method is real;
  the data is a stand-in until a store logs real history. Live scans do feed in.
- **Throughput.** One laptop CPU can't grade a fast conveyor for a whole store in
  real time; production would batch frames or add a small edge GPU.
- **The live "model compare" baselines are quick-trained toys** (§4.6), not the
  reported ablation numbers.
- **The € figures in projections are illustrative**, not measured savings.
- **YOLO detects only 4 of the 10 produce types** (COCO limitation); the other 6
  use a center-crop fallback (grade + Grad-CAM, but no bounding box).

---

## 16. Roadmap

- Fine-tune YOLO on the remaining 6 produce types for real boxes everywhere.
- Per-store calibration mode driven by the review queue (close the domain gap).
- POS integration so the markdown is applied automatically at the shelf-edge label.
- Multi-item conveyor benchmark + an edge-deployment (GPU/Jetson) path.
- Replace simulated forecast history with real per-store logs as they accrue.

---

## 17. Team and academic mapping

**Team FreshGuard** (IE University, Deep Learning final project). Marco Ortiz
Togashi (@ma731) — project coordinator (backend + frontend integration, repo,
demo rig). Yaxin Wu — core model (the ablation, training, fine-tuning).
BigBossBass — evaluation + explainability (metrics, ROC-AUC, confusion matrix,
Grad-CAM, domain-shift study). Jorge Vildoso — forecasting (LSTM + dashboard).
Batão — data + preprocessing (EDA, classic-CV showcase, field test set).

**How it maps to the rubric:**

| Requirement | Where it lives |
|---|---|
| ANN | Model 1 baseline + the MobileNetV2 classifier head (§4.2, §4.4) |
| CNN | Model 2 from-scratch + Model 3 transfer learning (§4.3, §4.4) |
| RNN | LSTM spoilage forecast (§4.12) |
| Architecture justification | the 32 → 75 → 96 ablation (§4.1, §4.6) |
| Evaluation + overfitting evidence | curves, confusion, ROC-AUC, classification report (§4.6) |
| Explainability | Grad-CAM (§4.10) |
| Classic CV (course labs) | white balance, HSV decay mask, saliency crop, CLAHE in EDA (§4.9) |
| End-to-end application | the FastAPI + web app (§5) |

---

*Built with 🍏 by Team FreshGuard — IE University.*
*Workflow: branch from `main`, open a PR, @ma731 reviews and merges.*

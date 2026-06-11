# FreshGuard 🍏 — AI Quality Control for Perishable Retail

Deep Learning final project (IE University). A two-stage computer-vision MVP
that grades supermarket produce **fresh / sell soon / reject** from a live
camera, with Grad-CAM explainability, object tracking for batch scanning, and
an LSTM spoilage forecast for the manager dashboard.

**The business case:** supermarkets lose 4–6% of produce revenue to shrink
because decay is caught too late, by subjective manual checks. Spain's Law
1/2025 now *requires* retailers to discount or donate food approaching
expiry — but loose produce has no expiry date, so visual condition is the only
signal. FreshGuard turns any phone or webcam into an objective produce
inspector: catch decay a day earlier, mark it down instead of binning it.

---

## Architecture

```
camera frame ──▶ Stage 1: YOLOv8n (pretrained, COCO)          [backend/pipeline.py]
                  └─ detects & tracks banana / apple / orange / carrot
                     │  (other produce → center-crop fallback, no box)
                     ▼
                 Stage 2: MobileNetV2 (OUR model, fine-tuned)  [notebook 02 → models/]
                  └─ 20-class softmax → fresh / sell-soon / reject / review
                     │
                     ├─ Grad-CAM heatmap (explainability)      [backend/gradcam.py]
                     ├─ abstains to "review" when unsure (active learning)
                     └─ majority vote over tracked frames (stable demo)

scan history ──▶ LSTM 7-day spoilage forecast                 [notebook 03 → models/]
                                                               [backend/forecast.py]
FastAPI serves /api/* + the frontend                           [backend/main.py]
Web frontend: live camera, overlay, dashboard                  [frontend/]
```

The **core model** (assignment requirement: predictive ANN/CNN/RNN) is our
fine-tuned CNN classifier. YOLO is an off-the-shelf preprocessing component.
The project exercises **all three permitted architectures**: ANN (baseline +
classifier head), CNN (core model), RNN/LSTM (spoilage forecast).

## Results — the architecture ablation

We don't just claim a CNN is right; we prove it on our own 20-class data
(test set = 4,140 held-out images):

| Model | Test accuracy | Parameters | Why |
|---|---|---|---|
| ANN (flattened pixels) | **22.2%** | 14.3M | No spatial structure — most params, worst result |
| CNN from scratch | **73.3%** | 8.5M | Learns spatial features; limited by dataset size |
| **MobileNetV2 transfer learning** | **95.6%** | **2.6M** | ImageNet features + fine-tuning — best accuracy, fewest params |

The staircase (22 → 73 → 96) *is* the architectural justification: the
transfer-learning model is **4.3× more accurate than the ANN with 5.5× fewer
parameters.** On the binary fresh-vs-rotten task, ROC-AUC = **0.998**. Curves,
20×20 confusion matrix, ROC, and Grad-CAM gallery in `docs/figures/`.

## Quick start

```bash
pip install -r requirements.txt
uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
# open http://localhost:8000
```

Works immediately even before training: YOLO boxes appear, grading shows
"model not trained yet". Full grading lights up once `models/` contains the
trained files (see contract below).

**iPhone as demo camera:** install Camo or Iriun (phone = USB webcam), then
pick it in the camera dropdown. For phone-browser access instead, the page
must be served over HTTPS (iOS camera requirement) — use `ngrok http 8000`.

## Dataset

[Kaggle: Fruit and Vegetable Disease (Healthy vs Rotten)](https://www.kaggle.com/datasets/muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten).
**10 produce types × fresh/rotten = 20 classes**: apple, banana, orange,
carrot, tomato, potato, cucumber, bell pepper, mango, strawberry. ~27.7k
images; 85/15 split → 23,537 train / 4,140 test.

Apple/banana/orange/carrot are **COCO-detectable** → full real-time detection
+ tracking. The other six are graded via a **center-crop fallback** (live
verdict + Grad-CAM, no bounding box, since COCO can't detect them). Broccoli
is excluded — no clean rotten dataset.

```bash
python scripts/build_dataset.py   # downloads + builds data/dataset/{train,test}/
python scripts/train_models.py    # trains the 3 models, exports to models/
```

A small curated `data/sample_images/` (4 per class) is committed so the repo
is browsable without the full download.

---

## 👥 Team & workstreams

| Member | Role | Owns |
|---|---|---|
| **Marco Ortiz Togashi** (@ma731) | **Project coordinator** — across all workstreams; reviews every PR | MVP integration (backend + frontend), repo, demo rig |
| **Yaxin Wu** | Core model lead | Notebook 02 — ANN/CNN/transfer-learning ablation: architecture choices, training, fine-tuning |
| **BigBossBass** | Evaluation & explainability lead | Notebook 02 — metrics, ROC-AUC, confusion matrix, overfitting evidence, Grad-CAM gallery, domain-shift study |
| **Jorge Vildoso** | Forecasting lead | Notebook 03 — LSTM spoilage forecast + dashboard verification |
| **Batao** | Data & preprocessing | Notebook 01 — EDA + CV preprocessing showcase + real-fruit field test set |
| *Everyone* | Deck & pitch | Each member presents their own workstream (all must speak) |

Workflow: branch from `main`, open a PR, @ma731 reviews and merges. The
backend is built and frozen — **each notebook must export exactly the
artifact files listed below; that's the integration contract.**

Notebook 02 split: **Yaxin** owns sections 1–3 (the three models),
**BigBossBass** owns the evaluation + Grad-CAM + domain-shift sections —
same notebook, coordinate on branch.

### Notebook 01 — `notebooks/01_data_exploration_preprocessing.ipynb`
*Template: CV Session 2 labs (`1_IntroductionToImages`, `2_Histogram_Filters`).*

- Class distribution, sample image grids, RGB/intensity histograms
- CV-course preprocessing showcase: histogram equalization + **CLAHE**
  (lighting robustness), Gaussian blur, Canny edges on rot spots, thresholding
- Augmentation preview (`ImageDataGenerator`: rotation, flips, zoom, brightness)
- **Exports:** figures for the deck (no model files)

### Notebook 02 — `notebooks/02_model_training.ipynb`  ← the core
*Templates: Conchita's CNN notebook + "RockPaperScissors Applying Transfer
Learning (Keras)" + "Counteracting Overfitting (Keras)".*

Three-model ablation (this is the architecture-justification story):
1. **ANN baseline** — Sequential, Flatten + Dense on raw pixels (Conchita's
   Simpsons approach). Expected to underperform; that's the point.
2. **CNN from scratch** — Conv2D/MaxPool blocks + Dropout + BatchNorm +
   augmentation.
3. **MobileNetV2 transfer learning** — frozen base + Dense head, then
   fine-tune top layers. Callbacks: EarlyStopping, ModelCheckpoint,
   ReduceLROnPlateau, TensorBoard.
   ⚠️ Build it **un-nested** so Grad-CAM works out of the box:
   ```python
   base = MobileNetV2(include_top=False, weights="imagenet", input_shape=(224,224,3))
   x = GlobalAveragePooling2D()(base.output)
   x = Dropout(0.3)(x); x = Dense(256, activation="relu")(x); x = Dropout(0.3)(x)
   out = Dense(6, activation="softmax")(x)
   model = Model(base.input, out)          # NOT Sequential([base, ...])
   ```
   Use `mobilenet_v2.preprocess_input` as the generator's
   `preprocessing_function` (the backend preprocesses crops the same way).

Evaluation (rubric: metrics + overfitting evidence): training/validation
curves for all 3 models, comparison chart, confusion matrix,
classification_report, fresh-vs-rotten **ROC-AUC**, Grad-CAM samples.

- **Exports (exact paths, backend reads these):**
  - `models/freshguard_mobilenetv2.keras`
  - `models/class_names.json` — list ordered by `train_gen.class_indices`, e.g.
    `["fresh_apple","fresh_banana","fresh_carrot","fresh_orange","rotten_apple", ...]`
    (rotten names must start with `rotten`; each name contains the COCO word)

### Notebook 03 — `notebooks/03_lstm_spoilage_forecast.ipynb`
*Template: Conchita's RNN/forecasting session.*

- Simulate ~2 years of daily flagged-item counts (trend + weekly + yearly
  seasonality + noise). **Label clearly as simulated** in deck and Q&A.
  Keep `seed=42` and the generator consistent with `backend/forecast.py`.
- Window 28 days → predict 7. LSTM(64) + Dense(7). Compare MAE vs
  seasonal-naive baseline.
- **Exports:**
  - `models/spoilage_lstm.keras`
  - `models/scan_history.csv` — columns `date,flagged_items`

> Until notebooks 02/03 are run, the app degrades gracefully (YOLO-only boxes;
> seasonal-naive forecast) so frontend/demo rehearsal is never blocked.

## Repo map

```
backend/    FastAPI app, two-stage pipeline, Grad-CAM, forecast
frontend/   camera UI (single + conveyor modes), manager dashboard
notebooks/  ← team: 01 EDA · 02 training · 03 LSTM
models/     trained artifacts (gitignored except .gitkeep)
```

## Contributing

All changes to `main` go through a pull request and require approval from the
repository owner (@ma731) before merging. Direct pushes to `main` are disabled.

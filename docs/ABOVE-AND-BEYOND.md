# FreshGuard — Above & Beyond Roadmap

The MVP is complete: 97.1% model, two-stage YOLO→MobileNetV2 pipeline, Grad-CAM,
severity→pricing, tracking, live money counter, LSTM forecast, premium UI, and
a full evaluation (ROC-AUC 0.9986). This doc covers the **above-and-beyond**
work that turns "best project in the class" into "the one they remember."

Two tiers:

- **Tier 2 — technical flex:** a confidence-aware grading layer with an
  abstain tier and a human-review / active-learning queue.
- **Tier 1 — win the room:** live cloud deployment (scan-it-on-your-phone) and
  a seed-round-quality pitch deck.

> Order to build: **Tier 2 first** (it's a real feature the deck will show off),
> then **deploy**, then **deck**.

---

## Tier 2 — Confidence-aware grading + active-learning loop

### Why this is the best technical addition
- **Turns our weakest metric into a designed feature.** Evaluation showed
  `rotten_carrot` recall = 0.77 (smallest class, 17 predicted as fresh).
  Instead of hiding it, the model *abstains* when unsure and routes the item
  to human review — exactly what a real deployed QC system does.
- **Makes the data flywheel concrete.** Flagged items become a labeled
  retraining set → the model improves over time → feeds the LSTM demand story.
  This is the business narrative made real, not a slide promise.
- **Pre-empts the #1 Q&A landmine:** "what happens when it's wrong?" Answer:
  it knows it might be, abstains, and learns from the correction.
- **Shows ML maturity** (calibration / uncertainty) that no other group will have.

### Design

A fourth decision state alongside fresh / sell-soon / reject:

| State | Condition | Action |
|---|---|---|
| `fresh` | rotten-prob < 0.40 **and** confidence ≥ τ | full price |
| `sell_soon` | 0.40 ≤ rotten-prob < 0.65 **and** confidence ≥ τ | markdown |
| `reject` | rotten-prob ≥ 0.65 **and** confidence ≥ τ | remove / donate |
| **`review`** | top-class confidence < τ (default τ = 0.70) | **flag for human review → queue** |

"Confidence" = max softmax probability (optionally temperature-scaled — see
Calibration). Items in `review` are appended to a queue with their crop saved,
so they can be re-labeled and folded into the next training run.

### Implementation (file-by-file)

**1. `backend/pipeline.py`**
- Add `CONFIDENCE_TAU = 0.70` near the other thresholds.
- In `_grade()`, after computing `idx`/`confidence`/`tier`, override:
  ```python
  if confidence < CONFIDENCE_TAU:
      tier = "review"
  ```
  Keep the original tier as `tier_raw` in the returned dict (useful for the
  deck: "would have guessed X, but abstained").
- In `process_frame()`, when `tier == "review"` and a `track_id` is present,
  save the crop once: `data/review_queue/<fruit>_<track_id>_<n>.jpg` and append
  a row to `models/review_queue.jsonl` with
  `{fruit, tier_raw, confidence, rotten_prob, ts_placeholder}`.
  (No `Date.now()` in pipeline — pass a frame counter or let the API stamp time.)
- Add a `review` count to the session dict.

**2. `backend/main.py`**
- `GET /api/review_queue` → returns the queued items (count + recent rows) so
  the dashboard can show "N items awaiting review."
- `POST /api/review_queue/clear` → empties it (demo reset).
- Stamp `ts` server-side when writing queue rows (pipeline stays time-free).

**3. `frontend/` (verdict panel + dashboard)**
- Add a 4th tier style `review` (slate/indigo, not red) in `style.css`; the
  verdict panel shows **"NEEDS REVIEW"** with the abstain reason and the
  would-be guess (`tier_raw`).
- Conveyor counts: add a `review` tile next to fresh/sell-soon/reject.
- Dashboard: a small "Human-review queue" card — count + last few items, with
  a one-liner "these retrain the model (active learning)."

**4. `.gitignore`**
- Ignore `data/review_queue/` (runtime crops) but keep a `.gitkeep`.

### Calibration (optional polish, ~30 min)
Raw softmax is over-confident. Add **temperature scaling**: fit a single scalar
T on the validation set (minimise NLL), divide logits by T before softmax. One
reliability-diagram figure (confidence vs accuracy) for the deck = serious ML
credibility. Belongs in notebook 02b as section 7.7.

### Acceptance criteria
- [ ] Low-confidence items show **NEEDS REVIEW**, not a wrong guess.
- [ ] `rotten_carrot` borderline cases land in `review`, not silently misgraded.
- [ ] Review queue persists to `models/review_queue.jsonl`; dashboard shows count.
- [ ] Session counts include `review`; money counter unaffected.
- [ ] (optional) Reliability diagram before/after temperature scaling.

---

## Tier 1a — Live deployment (scan-it-on-your-phone)

**Why Hugging Face Spaces, not Vercel:** the backend needs TensorFlow + YOLO +
the 26 MB model — far beyond Vercel/serverless limits. HF Spaces runs a real
container (Docker), free CPU tier, persistent, public HTTPS. Perfect for "the
professor scans a QR and it just works."

### Steps
1. **Create a Space** → type **Docker**, name `freshguard`, public.
2. **`Dockerfile`** (repo root or a `deploy/` dir):
   ```dockerfile
   FROM python:3.12-slim
   RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install --no-cache-dir -r requirements.txt
   COPY backend/ backend/
   COPY frontend/ frontend/
   COPY models/ models/
   EXPOSE 7860
   CMD ["uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "7860"]
   ```
   (HF Spaces expects port **7860**.)
3. **Model file** — `freshguard_mobilenetv2.keras` is 26 MB; commit via **git-lfs**
   on the Space, or download it at build time from the GitHub release.
4. **YOLO weights** — `yolov8n.pt` downloads on first run; pre-bake it in the
   Dockerfile (`RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"`)
   so the first request isn't slow.
5. **CORS** is already open; the frontend is same-origin so nothing to configure.
6. **QR code** — generate one for the Space URL; put it on the closing slide and
   on a printed card for the audience.

### Fallback ladder for demo day (never get caught out)
1. **Primary:** laptop + local backend + iPhone-as-USB-webcam (Camo/Iriun) —
   zero network dependency, runs offline. *This is the safe path.*
2. **Bonus:** the HF Space URL + QR — audience tries it on their own phones.
3. **Parachute:** upload pre-taken photos via the Upload button.

> Demo rule: rehearse on the **primary** path. The Space is the "wow," never
> the dependency. If classroom wifi is bad, you lose nothing.

---

## Tier 1b — The pitch deck (30% of the grade)

15 minutes hard limit, **all five members must speak**, live demo included.
Target: looks like a seed-round deck, not a class project. Use the FreshGuard
dark/green palette; one idea per slide; real figures from `docs/figures/`.

### Slide-by-slide (≈12 min talk + demo, leaving Q&A buffer)

| # | Slide | Speaker | Content / asset |
|---|---|---|---|
| 1 | Title | Marco | FreshGuard logo, tagline: "Catch decay a day earlier. Sell it — don't bin it." |
| 2 | The problem | Marco | Produce shrink 12.6% fruit / 11.6% veg (USDA); €75–120k binned per store/yr; detection is manual & subjective |
| 3 | Why now | Marco | Spain Law 1/2025 *requires* discount/donate before expiry; loose produce has **no expiry date** → only visual signal works |
| 4 | The gap | Marco | Afresh forecasts ordering, Wasteless prices dated goods — **nobody watches the shelf**. That's us. |
| 5 | Product | Batao | What FreshGuard does: phone → fresh / sell-soon / reject + markdown, in real time |
| 6 | Data & preprocessing | Batao | 8 classes, ~15.6k imgs; CLAHE/augmentation; the real-fruit field set |
| 7 | Architecture | Yaxin | Two-stage YOLO→MobileNetV2; why CNN not ANN, why not ViT (own lectures) |
| 8 | The ablation | Yaxin | `model_comparison.png` — 41→78→97%, 2.4× accuracy with 5.5× fewer params |
| 9 | Does it work? | Bass | `confusion_matrix.png` + ROC-AUC **0.9986**; honest `rotten_carrot` weak spot |
| 10 | Explainability | Bass | `gradcam_gallery.png` — heatmaps on the rot spots; + the **abstain/review** feature |
| 11 | Forecast & flywheel | Jorge | LSTM 7-day spoilage forecast; scans → data → better ordering → loop |
| 12 | **LIVE DEMO** | Marco + all | Real fruit on webcam: box + verdict + Grad-CAM + money counter; conveyor mode; QR for audience |
| 13 | Business case | Marco | ROI: ~€18k recovered vs €3k SaaS/store = **6× ROI, 2-month payback**; 500 stores → €9M |
| 14 | Roadmap | Jorge/Batao | Bakery, meat, DC intake QC; broccoli & more produce; segmentation for %-spoilage |
| 15 | Close | all | One line each; QR to the live app; "FreshGuard — every phone an objective inspector" |

### Speaking time (≈ even, rubric requires all speak)
Marco 1,2,3,4,13 + demo lead · Batao 5,6 · Yaxin 7,8 · Bass 9,10 · Jorge 11,14.
Everyone says one line on slide 15.

### Demo script (slide 12, ~2.5 min, rehearse verbatim)
1. Fresh apple → **FRESH**, full price.
2. Browning banana → **SELL SOON**, "markdown −20%", money counter ticks up.
3. Rotten orange → **REJECT**, Grad-CAM heatmap on the mold.
4. Ambiguous/old carrot → **NEEDS REVIEW** (shows the abstain feature live).
5. Conveyor mode: slide 3 items across → tracked, counted, € recovered total.
6. "Scan this QR and try it yourselves." (if wifi cooperates)

### Design checklist
- FreshGuard palette (#020617 bg, #22c55e accent), Inter, dark theme to match the app.
- One message per slide; charts > bullet walls; real screenshots of the app.
- Export to **PDF** (submission requirement).
- Number every claim (shrink %, ROI, AUC) — graders reward quantified impact.

---

## Execution plan & owners

| Item | Owner | Depends on | Target |
|---|---|---|---|
| Tier 2: abstain + review queue (code) | Marco (integration) | model (done) | build first |
| Tier 2: temperature scaling + reliability fig | Bass | notebook 02b | optional polish |
| Tier 1a: HF Spaces deploy + QR | Marco | model on `main` | after Tier 2 |
| Tier 1b: deck draft (all slides) | Marco assembles | everyone's figures (done) | this week |
| Deck: each member's 2 slides + talking points | each owner | — | 2 days before |
| Two timed rehearsals + freeze | all | deck + deploy | 2–3 days before |

Presentation: **June 26.** Freeze everything 2 days prior; the last 48h are
rehearsal-only, no new features.

> Anything not in these two tiers (more produce classes, pose/dance, music
> detection) is explicitly **out of scope** — it dilutes a tight pitch and
> burns rehearsal time. Keep the product serious; keep the fun on a side branch.

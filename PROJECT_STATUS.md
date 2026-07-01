# Project Status — FreshGuard: AI Produce Quality Control

_Last updated: 2026-07-01_

## Business Use Case
- **Problem:** Supermarkets lose 4–6% of produce revenue to shrink caught too late by subjective manual
  checks. Spain's Law 1/2025 requires retailers to discount or donate near-expiry loose produce — but
  loose produce has no printed expiry date, so visual condition is the only actionable signal.
- **User / customer:** Supermarket floor staff (live scanner) + store manager (dashboard).
- **Value proposition:** Catch decay a day earlier → markdown instead of bin → recover 4–6% shrink
  margin. Every model output maps to a concrete store action: CNN grade → markdown/removal decision;
  LSTM forecast → next-week ordering/staffing + Law 1/2025 markdown-surge alerts. Grad-CAM satisfies
  the audit-trail requirement by making every grading decision interpretable.

## Architecture
**Vision component**
- **Model:** CNN — MobileNetV2 (transfer learning, fine-tuned in two phases).
- **Approach:** Transfer learning — frozen ImageNet base + Dense head (Phase 1), then top-30-layer
  fine-tune at 100× lower LR (Phase 2).
- **Why:** Proven empirically via a 3-model ablation on the same 20-class dataset:
  ANN 31.9% → CNN-from-scratch 75.0% → MobileNetV2 95.8% (AUC 0.998). The staircase is the deck's
  primary technical-depth slide — this is a decided, evaluated, current-numbers result.
- **Status:** 🟢 Trained, tuned, evaluated. 20 classes (fresh/rotten × 10 produce types), 95.8% test
  accuracy on 4,140 held-out images. YOLOv8n (pretrained, zero-shot) is a preprocessing crop/tracking
  stage only — MobileNetV2 is the graded model.

**Forecasting component**
- **Model:** LSTM (decided, not RNN/GRU). Single-layer LSTM(64) + Dense(7), window=28 days, horizon=7 days.
- **Why:** Compact by design (476 training samples — a bigger model would overfit). Multivariate input
  (28 days × 7 features: scaled count + dow/doy sin-cos + holiday/promo flags) lets the LSTM anticipate
  calendar-keyed shocks (Spanish holidays, Law 1/2025 end-of-month markdown blocks) a weekly-lag
  baseline structurally cannot see. A count-only version *lost* to the naive baseline (-6.8%) before the
  calendar-feature fix — that negative-result-to-fix arc is the strongest technical-depth story in the
  project.
- **Status:** 🟢 Trained, tuned, evaluated. MAE 3.59 / RMSE 4.64 vs seasonal-naive 6.26 / 8.25
  (+42.7% MAE, +43.8% RMSE), within ~12% of the irreducible noise floor (≈3.19). No overfitting
  (val loss stayed below train loss).

## Data
- **Images:** Kaggle "Fruit and Vegetable Disease (Healthy vs Rotten)" — 20 classes (fresh/rotten × 10
  produce: apple, banana, orange, carrot, tomato, potato, cucumber, bell pepper, mango, strawberry),
  ~27.7k images, 85/15 split → 23,537 train / 4,140 test, all classes ≥480 train images.
- **Time series:** Simulated 730-day daily series (seed=42) for a Spanish store — weekly + yearly
  seasonality + growth trend + noise, plus three calendar-keyed multi-day shocks (national holidays,
  end-of-month promotions, summer demand volatility). Explicitly labelled as simulated (no real store
  scan data). Chronological 70/15/15 split, `MinMaxScaler` fit on train only. Generator kept
  byte-identical between `backend/forecast.py::simulate_history()` and notebook 03; effects are
  calendar-keyed so the committed `scan_history.csv` is the source of truth.

## Rubric-aligned progress
| Pillar (weight) | State | Notes |
|---|---|---|
| Business Use Case & Value Prop (20%) | 🟢 | Quantified shrink loss, regulatory hook (Law 1/2025), Grad-CAM as an audit-trail feature, every output tied to a concrete store action. |
| Technical Depth & Architecture (25%) | 🟢 | CNN ablation (31.9→75.0→95.8%, AUC 0.998) + Grad-CAM + active-learning review queue. LSTM beats one-lag naive by +42.7% MAE / +43.8% RMSE, near noise floor; negative-result-to-fix arc (count-only lost, calendar features fixed it) is top-tier depth material. Exercises all 3 permitted architectures (ANN/CNN/LSTM). |
| MVP Integration & Frontend UX (25%) | 🟡 | Backend + frontend wired, both models live (`lstm_used: true`, 20-class classifier). **Risk:** `backend/pipeline.py` and `frontend/app.js` changed in teammates' 2026-07-01 push — not smoke-tested since. Dashboard eval endpoints (`/api/confusion`, `/api/eval`) also read stale JSON vs the current 95.8% model. |
| Presentation & Team Delivery (20%) | 🟡 | Deck built (`Deep_learning_presentation.html`, 17 slides, all 5 speakers assigned, Q&A defense embedded) — but **two other deck files exist on `main`** with no team alignment on which is authoritative. |
| Live Demo & Time Management (10%) | 🔴 | 15-minute timing rehearsal not done. Camera setup (iPhone via Camo/Iriun + ngrok for HTTPS) not tested end-to-end. |

## Done
- [x] Notebook 01 (EDA) — Sebastião Clemente. Merged to main.
- [x] Notebook 02 (CNN: ANN → CNN-scratch → MobileNetV2 ablation, 20-class, 95.8%, AUC 0.998) — Yaxin Wu (training) + Bassem El Halawani (evaluation, Grad-CAM).
- [x] Notebook 03 (LSTM, multivariate calendar features, +42.7% MAE vs naive) — Jorge Vildoso.
- [x] Model artefacts committed on `main`: `freshguard_mobilenetv2.keras` + `class_names.json`;
      `spoilage_lstm.keras` + `spoilage_scaler.pkl` + `scan_history.csv`.
- [x] FastAPI backend: two-stage YOLO→MobileNetV2 pipeline, Grad-CAM, forecast + live data flywheel, review queue.
- [x] Frontend: live scan (single + conveyor), manager dashboard, camera selector.
- [x] All evaluation figures committed to `docs/figures/`.
- [x] Presentation deck `Deep_learning_presentation.html` — 17 slides, speaker assignments, auto-play fragments, Q&A defense.
- [x] TF version pinned (`==2.20.0`), notebook kernel-crash root-caused and fixed, Colab setup cells added.

## Next steps (prioritized)
1. [ ] **Smoke-test the app** after teammates' 2026-07-01 push (`backend/pipeline.py`, `frontend/app.js`
       changed): `uvicorn backend.main:app` + browser test + confirm model loads
       (`python -c "import tensorflow as tf; m=tf.keras.models.load_model('models/freshguard_mobilenetv2.keras'); print('OK', m.output_shape)"` → expect `OK (None, 20)`).
2. [ ] **Align team on one presentation file** — `Deep_learning_presentation.html` vs `FreshGuard_Deck.html` vs `FreshGuard_Experience.html`.
3. [ ] **Regenerate dashboard eval JSONs** (`scripts/eval_model.py` + `scripts/build_eval.py`) so `/api/confusion`, `/api/eval`, `/api/model_report` match the 95.8% headline (Marco).
4. [ ] **End-to-end demo rehearsal** — live camera (iPhone/Camo/Iriun + ngrok) + dashboard, under the 15-minute clock, all 5 members speaking.
5. [ ] Field test images (`data/field_test/`) for notebook 02 domain-shift section 7.5 (Sebastião).

## Open decisions / risks
- **[RISK]** `backend/pipeline.py` / `frontend/app.js` changed in teammates' 2026-07-01 push, unverified since — could break the live demo.
- **[RISK]** Q&A challenge that simulated LSTM data was engineered to favor the model. Defense already
  drafted and embedded in the deck (real Spanish holidays + Law 1/2025 blocks, leakage-free calendar
  features known genuinely in advance, near-noise-floor performance). Lead with RMSE + noise-floor framing.
- **[RESOLVED]** Deck decided: `FreshGuard_Deck.html` is the submission copy (per Jorge, 2026-07-01). `Deep_learning_presentation.html` and `FreshGuard_Experience.html` are not used — still worth telling the team explicitly so no one presents from the wrong file.
- **[OPEN]** Camera/ngrok demo rig untested end-to-end.
- **[RESOLVED]** Notebook 02 kernel crash — root cause was a TF version mismatch (2.20.0 save vs `<2.20`
  load); fixed by pinning `tensorflow==2.20.0` and removing the `strip_renorm` hack. Confirmed clean on
  the 2026-06-24 Colab re-run.
- Full technical history, byte-identical-function constraints, and past-decision rationale live in
  `CLAUDE.md` (git-excluded, local-only, more detailed than this file) — consult it for the "why" behind
  any prior change.

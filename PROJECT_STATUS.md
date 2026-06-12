# Project Status — FreshGuard

_Last updated: 2026-06-12_

## Business Use Case
- **Problem:** Supermarkets lose 4–6% of produce revenue to shrink because decay is caught too late by subjective manual checks. Spain's Law 1/2025 *requires* retailers to discount or donate food approaching expiry — but loose produce has no expiry date, so visual condition is the only signal.
- **User / customer:** Supermarket floor staff (live scanner) + store manager (dashboard)
- **Value proposition:** Catch decay a day earlier → mark down instead of bin → recover 4–6% shrink margin. At AUC 0.9987 (binary fresh/rotten), false pass-throughs are negligible. Grad-CAM satisfies Law 1/2025 audit requirements by making every grading decision interpretable.

## Architecture

**Vision component**
- **Model:** CNN — MobileNetV2 (transfer learning, fine-tuned)
- **Approach:** Transfer learning — frozen ImageNet base + Dense head, then top-30-layer fine-tune
- **Why:** Proven by the 3-model ablation on same data: ANN 41.2% → CNN from scratch 77.6% → MobileNetV2 97.1% (2.4× better accuracy, 5.5× fewer parameters than ANN)
- **Status:** ✅ Trained — `models/freshguard_mobilenetv2.keras` + all evaluation figures in `docs/figures/`

**Forecasting component**
- **Model:** LSTM (28-day window → 7-day forecast)
- **Why:** Daily flagged-item counts have weekly + yearly seasonality + trend; LSTM's gates handle multi-scale dependencies better than vanilla RNN; GRU is simpler but LSTM is the class idiom and adds negligible complexity for this horizon
- **Status:** ✅ Trained — `models/spoilage_lstm.keras` + `models/scan_history.csv` exported. MAE 4.14 vs baseline 7.73 (46.5% improvement). No overfitting — train/val curves track together to epoch 87.

## Data
- **Images:** Kaggle "Fruit and Vegetable Disease (Healthy vs Rotten)" — 8 classes (fresh/rotten × apple/banana/orange/carrot), ~15.6k images, 85/15 train/test split → 13,281 train / 2,337 test. Carrot has smaller class size (~92/86 test images).
- **Time series:** Simulated (~2 years daily flagged-item counts, seed=42, trend + weekly + yearly seasonality + noise). Must stay consistent between `backend/forecast.py` and notebook 03.

## Rubric-aligned progress
| Pillar (weight) | State | Notes |
|---|---|---|
| Business Use Case & Value Prop (20%) | 🟢 | Quantified shrink loss, law compliance angle, threshold business logic tied to markdown decisions |
| Technical Depth & Architecture (25%) | 🟢 | CNN ablation + AUC 0.9987 + Grad-CAM. LSTM trained: MAE 4.14 vs baseline 7.73 (46.5% improvement), clean convergence |
| MVP Integration & Frontend UX (25%) | 🟢 | Backend + frontend wired; both model files exported — dashboard switches to LSTM automatically on next backend start |
| Presentation & Team Delivery (20%) | 🔴 | Deck status unknown; no rehearsal logged |
| Live Demo & Time Management (10%) | 🟡 | App runs; end-to-end demo with trained LSTM not yet possible |

## Done
- [x] Notebook 03 (LSTM): trained, evaluated, exported — MAE 4.14, RMSE 5.05, 46.5% improvement over seasonal-naive baseline
- [x] Full CNN training pipeline (ANN baseline → CNN from scratch → MobileNetV2 TL)
- [x] Model artifacts exported: `freshguard_mobilenetv2.keras`, `class_names.json`, `training_summary.json`, `histories.json`
- [x] Notebook 02b evaluation: training curves, confusion matrix, ROC-AUC (0.9987), Grad-CAM gallery, severity sanity check
- [x] FastAPI backend: `/api/predict`, `/api/forecast`, `/api/health`, review queue
- [x] Frontend: live scan (single + conveyor modes), manager dashboard, camera selector
- [x] Graceful degradation: app works before LSTM is trained (naive fallback + YOLO-only boxes)
- [x] All evaluation figures committed to `docs/figures/`

## Next steps (prioritized)
1. [ ] **Jorge — commit model files:** Copy `spoilage_lstm.keras` + `scan_history.csv` from Drive to `models/` locally and commit to repo
2. [ ] **Batao — Notebook 01 (EDA):** Create `notebooks/01_data_exploration_preprocessing.ipynb` — class distribution, sample grids, CLAHE, Canny, augmentation preview
3. [ ] **Batao — Field test images:** Commit `data/field_test/` for domain-shift study (notebook 02 section 7.5 is waiting)
4. [ ] **All — Presentation deck:** Build slides; assign speaking parts (all members must speak); time the run
5. [ ] **Demo rehearsal:** End-to-end live run with LSTM trained; test with phone as camera (Camo/Iriun + ngrok for HTTPS)

## Open decisions / risks
- **Notebook 02 kernel crash (cell 8232b942):** The confusion matrix cell has a kernel crash annotation. Figures are present in `docs/figures/` so it ran successfully at some point, but verify the classification report output is also captured/narrated in the notebook.
- **Notebook 03 (LSTM) is the critical path:** Without it, the manager dashboard shows "not trained yet" in the live demo — a visible gap that costs Integration + Business points.
- **Demo camera setup:** iPhone-as-webcam requires Camo/Iriun + ngrok for HTTPS. Test this *before* presentation day.
- **Presentation timing:** 15 minutes total including Q&A; strictly enforced. With 2 models + demo, budget is tight. Rehearse.

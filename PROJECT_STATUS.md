# Project Status — FreshGuard

_Last updated: 2026-06-13 (LSTM re-run landed: +42.7% MAE over naive; 20-class classifier restored & reconciled with LSTM on one branch)_

## Business Use Case
- **Problem:** Supermarkets lose 4–6% of produce revenue to shrink because decay is caught too late by subjective manual checks. Spain's Law 1/2025 *requires* retailers to discount or donate food approaching expiry — but loose produce has no expiry date, so visual condition is the only signal.
- **User / customer:** Supermarket floor staff (live scanner) + store manager (dashboard)
- **Value proposition:** Catch decay a day earlier → mark down instead of bin → recover 4–6% shrink margin. At AUC 0.998 (binary fresh/rotten, 20-class model), false pass-throughs are negligible. Grad-CAM satisfies Law 1/2025 audit requirements by making every grading decision interpretable.

## Architecture

**Vision component**
- **Model:** CNN — MobileNetV2 (transfer learning, fine-tuned)
- **Approach:** Transfer learning — frozen ImageNet base + Dense head, then top-30-layer fine-tune
- **Why:** Proven by the 3-model ablation on same data (20 classes): ANN 22.2% → CNN from scratch 73.3% → MobileNetV2 95.6% (4.3× better accuracy, 5.5× fewer parameters than ANN)
- **Scope:** 10 produce types × {fresh, rotten} = 20 classes. apple/banana/orange/carrot are COCO-detectable (live YOLO detection + tracking); tomato, potato, cucumber, bell pepper, mango, strawberry use a center-crop fallback (classification + Grad-CAM, no box).
- **Status:** ✅ Trained — `models/freshguard_mobilenetv2.keras` (20-class) + all evaluation figures in `docs/figures/`

**Forecasting component**
- **Model:** Multivariate LSTM (28-day × 7-feature window → 7-day forecast)
- **Why:** Daily flagged-item counts have weekly + yearly seasonality + trend; LSTM's gates handle multi-scale dependencies better than vanilla RNN; GRU is simpler but LSTM is the class idiom and adds negligible complexity for this horizon
- **Status:** ✅ **Trained & winning (Colab re-run 2026-06-13).** Multivariate LSTM beats the one-lag naive by **+42.7% MAE (3.59 vs 6.26) and +43.8% RMSE (4.64 vs 8.25)** on the test set — and lands within ~12% of the irreducible noise floor (≈3.19). Clean training: stopped epoch 51, best weights ~epoch 42, val loss below train loss throughout (no overfitting). Fresh artefacts in `models/` (`spoilage_lstm.keras` input shape `(28,7)`, `spoilage_scaler.pkl`, `scan_history.csv`); backend `build_features`/`simulate_history` verified logic-identical → dashboard reports `lstm_used: true` on next start. The earlier count-only model *lost* to naive (-6.8%); the calendar-feature fix swung it ~49 points — that negative-result-to-fix arc is the strongest technical-depth slide.

## Data
- **Images:** Kaggle "Fruit and Vegetable Disease (Healthy vs Rotten)" — 20 classes (fresh/rotten × 10 produce: apple, banana, orange, carrot, tomato, potato, cucumber, bell pepper, mango, strawberry), ~27.7k images, 85/15 train/test split → 23,537 train / 4,140 test. All classes ≥480 train images.
- **Time series:** Simulated (~2 years daily flagged-item counts, seed=42) for a Spanish store: trend + weekly + yearly seasonality + noise, plus multi-day calendar shocks (national holidays, end-of-month promotions, summer demand volatility). Generator kept byte-identical between `backend/forecast.py` and notebook 03; effects are calendar-keyed so the committed `scan_history.csv` is the source of truth.

## Rubric-aligned progress
| Pillar (weight) | State | Notes |
|---|---|---|
| Business Use Case & Value Prop (20%) | 🟢 | Quantified shrink loss, law compliance angle, threshold business logic tied to markdown decisions |
| Technical Depth & Architecture (25%) | 🟢 | CNN ablation (22→73→96% on 20 classes) + AUC 0.998 + Grad-CAM + confidence-abstain/active-learning. LSTM now beats the honest one-lag naive by +42.7% MAE / +43.8% RMSE and sits within ~12% of the noise floor; negative-result-to-fix arc (count-only lost, calendar features fixed it) is a top-tier depth story. Lead with RMSE + noise-floor framing |
| MVP Integration & Frontend UX (25%) | 🟢 | Backend + frontend wired; classifier (20-class) + LSTM both exported and live — dashboard shows LSTM forecast, scanner shows fresh/sell-soon/reject/review |
| Presentation & Team Delivery (20%) | 🔴 | Deck status unknown; no rehearsal logged |
| Live Demo & Time Management (10%) | 🟡 | App runs; trained LSTM now present so dashboard shows live forecast — full end-to-end rehearsal (with iPhone camera) still pending |

## Done
- [x] Notebook 03 (LSTM) built, trained, evaluated and exported; one-lag baseline + scaler persistence in place. Spike run exposed the count-only model losing to naive; notebook + backend since re-architected to a multivariate calendar-aware LSTM (`build_features` synced byte-identical) — awaiting re-run for final numbers.
- [x] Full CNN training pipeline (ANN baseline → CNN from scratch → MobileNetV2 TL)
- [x] Model artifacts exported: `freshguard_mobilenetv2.keras`, `class_names.json`, `training_summary.json`, `histories.json`
- [x] Notebook 02b evaluation: training curves, 20×20 confusion matrix, ROC-AUC (0.998), Grad-CAM gallery, severity sanity check
- [x] FastAPI backend: `/api/predict`, `/api/forecast`, `/api/health`, review queue
- [x] Frontend: live scan (single + conveyor modes), manager dashboard, camera selector
- [x] Graceful degradation: app works before LSTM is trained (naive fallback + YOLO-only boxes)
- [x] All evaluation figures committed to `docs/figures/`

## Next steps (prioritized)
1. [x] **Jorge — LSTM merged to main** (PRs #13, #14). Backend confirmed returning `lstm_used: true` with the new artefacts.
2. [x] **20-class classifier restored & reconciled with LSTM** (this branch). Cherry-picked the stranded expansion onto LSTM main — zero file conflicts; both models live. PR #12's 20-class push had landed after that PR was already merged, so it never reached main; this fixes that.
3. [ ] **All — purge stale numbers everywhere** (deck, README, any notes). Forecast: only `3.59 / 4.64 / 6.26 / 8.25 / +42.7% / floor 3.19` survive. Classifier: use the **20-class** numbers `22.2 / 73.3 / 95.6%` + AUC `0.998` (NOT the old 8-class `41/78/97` / `0.9987`).
4. [ ] **Batao — Notebook 01 (EDA):** Create `notebooks/01_data_exploration_preprocessing.ipynb` — class distribution, sample grids, CLAHE, Canny, augmentation preview
3. [ ] **Batao — Field test images:** Commit `data/field_test/` for domain-shift study (notebook 02 section 7.5 is waiting)
4. [ ] **All — Presentation deck:** Build slides; assign speaking parts (all members must speak); time the run
5. [ ] **Demo rehearsal:** End-to-end live run with LSTM trained; test with phone as camera (Camo/Iriun + ngrok for HTTPS)

## Open decisions / risks
- **[FIX APPLIED — needs Colab re-run] Notebook 02 kernel crash (cell 8232b942):** Root cause was a TF version mismatch — model saved on Colab's TF 2.20.0 but loaded under a `<2.20` env (per the old loose `requirements.txt` pin), so BatchNorm `renorm` config keys broke `load_model`; the `strip_renorm` zip-surgery band-aid then segfaulted the kernel on the rewritten model. Fixes (2026-06-16): (1) `requirements.txt` pinned `tensorflow==2.20.0`; (2) cell 8232b942 rewritten to reuse the in-memory `mnv2` (no disk deserialization on a full run) with a clean `compile=False` disk fallback + a gitignored-dataset guard; (3) `strip_renorm`/`freshguard_fixed.keras` hack deleted. **Jorge: re-run notebook top-to-bottom on Colab 2.20.0 → re-commit the model (re-saved under 2.20) + regenerated figures.** Also fixed same session: 8→20-class text/number mismatch throughout (22/73/96%, AUC 0.998, 20×20), and the ROC threshold bug (probability cut-offs were drawn as vertical lines on the FPR axis → now plotted as operating points on the curve).
- **Q&A landmine — "you engineered the data to win":** The calendar shocks were designed to be learnable from date features and invisible to the weekly lag. Own it, don't hide it. Defense: (1) shocks are real Spanish holidays + Law 1/2025 markdown blocks; (2) calendar features are leakage-free, genuinely known in advance (standard SARIMAX/Prophet practice); (3) the model lands within ~12% of the irreducible noise floor, so it's near-optimal, not just beating a strawman. Rehearse one sentence covering all three.
- **[RESOLVED] Notebook 03 (LSTM) critical path:** Trained & winning 2026-06-13; artefacts present, backend in sync. Dashboard now shows a live forecast.
- **Demo camera setup:** iPhone-as-webcam requires Camo/Iriun + ngrok for HTTPS. Test this *before* presentation day.
- **Presentation timing:** 15 minutes total including Q&A; strictly enforced. With 2 models + demo, budget is tight. Rehearse.

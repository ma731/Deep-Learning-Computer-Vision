# FreshGuard — Handoff

AI produce freshness quality-control for supermarkets. A camera grades each fruit/veg
**Fresh / Sell-soon / Reject**, drives a markdown + reorder decision, and forecasts spoilage.
IE University · Deep Learning final project.

---

## 1. Run it

```bash
# from repo root (Windows, venv = Python 3.12; system 3.14 is too new for TF)
.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
# then open http://localhost:8000   (0.0.0.0 lets a phone on the same Wi-Fi connect via the in-app QR)
```

- Health check: `GET /api/health` → `{"classifier_loaded": true}` means the model is loaded.
- If port 8000 is stuck: `Get-NetTCPConnection -LocalPort 8000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`
- Frontend is static (HTML/CSS/JS) served by FastAPI. After editing `frontend/*`, just hard-refresh
  (`Ctrl+Shift+R`); the `?v=N` query on `style.css`/`app.js` is bumped to bust cache. Editing `backend/*`
  needs a server restart.

---

## 2. Architecture

**Two-stage computer vision** (`backend/pipeline.py`):
1. **Stage 1 — detect + track:** YOLOv8n (pretrained COCO) finds apple/banana/orange/carrot; ByteTrack
   gives persistent IDs in conveyor mode. Non-COCO produce (tomato, mango, strawberry…) has no YOLO box,
   so single mode uses a **center-crop + colour-saliency-crop fallback** and keeps whichever the
   classifier is most confident on.
2. **Stage 2 — classify:** fine-tuned **MobileNetV2** (transfer learning) grades each crop across
   **20 classes** (10 produce × fresh/rotten). **95.6% top-1.**

**Robustness (inference-time, no retrain):** gray-world white balance, **test-time augmentation**
(crop + mirror averaged), the saliency crop, temporal smoothing, and a **τ=0.70 confidence gate**
(abstain → "review") + a **"no produce" guard** (<0.42 → don't guess).

**RNN/LSTM forecast** (`backend/forecast.py`): 28-day window → 7-day spoilage forecast, +42.7% MAE vs a
naive weekly baseline, using Spanish-calendar features (holidays, end-of-month, summer). Live scans
append today's tally and re-forecast (the flywheel). Plus a **per-produce** demand/reorder forecast.

**Explainability:** Grad-CAM (`backend/gradcam.py`) — heat on the bruise.

**Active-learning loop:** low-confidence items are saved to `data/review_queue/` + logged. The in-app
**Review** tab lets a human pick the correct label and **Submit** → the crop is moved into
`data/dataset/train/<label>/` so the next retrain learns from it.

The three required network families (ablation, `scripts/train_models.py`):
**ANN 22.2% → CNN 73.3% → MobileNetV2 95.6%** (same data, same split).

---

## 3. The app (frontend)

Left **sidebar** app-shell. Theme: **dark default + light toggle** (sun/moon; remembers choice;
light is projector-safe). Brand: forest `#0e2412` / gold `#cb8815`+`#e6ad3a` / cream `#fbf6ec`,
Fraunces (display) + Hanken Grotesk (UI). Official **IE logo** in the sidebar footer (white in dark mode).

Views:
- **Live scan** — webcam + detection overlay, the **verdict** panel (with the status "ring" on the video),
  a HUD (REC + crosshair), a **KPI strip** (scanned / recovered € / fresh / flagged), recovered-€ counter,
  session counts (conveyor), 7-day **outlook** card, a **Recent grades** feed, details readout (incl.
  **shelf-life "~N days"** + live market price), Grad-CAM. Upload single, **Grade batch** (drag a folder),
  single vs conveyor toggle.
- **Manager** — spoilage forecast chart (Chart.js, theme-aware), KPIs, weekly action plan, a **Today /
  7-day** summary card with **Export CSV**.
- **Market** — live produce price board (cards: €/kg, % change, sparkline, sell-soon markdown, today range,
  **reorder qty** from the per-produce LSTM), a scrolling **ticker**, and the **LSTM demand banner**.
- **Review** — active-learning queue (see above).
- **Model** — the ablation bars, confusion matrix, **per-class precision/recall/F1 table**.

Delight: **toasts + sound** on reject/sell-soon/forecast alerts (mute toggle), and **per-fruit reactions**
— an original goggle-eyed **banana mascot + synthesized "Banaaana!"** on banana, emoji + puns on the rest.
**Keyboard shortcuts:** `1–5` tabs, `S` start camera, `U` upload, `B` batch, `M` mute.
**Phone QR** (sidebar) → `GET /api/lan` builds the LAN URL.

> NOTE on IP: we deliberately use an *original* banana mascot + browser TTS, NOT the Minion character or
> its sound clip (copyright). Same for decks — no celebrity photos / branded characters.

---

## 4. Backend endpoints (`backend/main.py`)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | model loaded? |
| `POST /api/predict?mode=single|conveyor&explain=` | grade a frame/image (Grad-CAM if explain) |
| `POST /api/reset_session` | clear conveyor session |
| `GET /api/review_queue` · `POST /api/review_queue/clear` | active-learning queue |
| `POST /api/review_queue/relabel` | save corrected crop into `data/dataset/train/<label>/` |
| `GET /api/market` | live produce prices (USDA if key set, else reference) |
| `GET /api/forecast?live=` | LSTM 7-day forecast (+ live tally when `live=true`) |
| `GET /api/forecast/produce` | per-produce demand + reorder |
| `GET /api/history` · `GET /api/history.csv` | logged scan stats / CSV export |
| `GET /api/model_report` | ablation summary + per-class report |
| `GET /api/lan` | this machine's LAN URL (for the phone QR) |
| static: `/`, `/figures`, `/review-img` | frontend, training figures, review crops |

---

## 5. Models, data, scripts

- `models/freshguard_mobilenetv2.keras` — the live classifier (**95.6%**). `backup_*` = safety copies.
- `models/class_names.json`, `training_summary.json`, `classification_report.json`, `histories.json`
- `models/spoilage_lstm.keras`, `spoilage_scaler.pkl`, `scan_history.csv` — forecast
- `models/scans.db` — SQLite log of graded items (history / CSV)
- `data/dataset/{train,test}/<20 classes>` — built by `scripts/build_dataset.py` (kagglehub:
  `muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten`)
- `scripts/train_models.py` — the 3-model ablation. **Augmentation is at known-good settings**; a more
  aggressive variant was tried and HURT accuracy (CNN collapsed to ~29%, MobileNetV2 −2.4pts) — do NOT
  re-introduce it; robustness is handled at inference instead.
- `scripts/eval_model.py` — run after training to regenerate `classification_report.json` +
  `docs/figures/confusion_matrix.png` (feeds the Model tab).

To retrain: `build_dataset.py` (if `data/dataset` missing) → `train_models.py` → `eval_model.py`.
**Back up `models/freshguard_mobilenetv2.keras` first** and only keep the new one if test accuracy improves.

---

## 6. Decks / pitch

- **Figma — clean deck:** `FreshGuard — Deck (Clean)` (fileKey `fGHQVtygpet4MgX7nAII1S`), 16 slides.
- **Figma — cinematic deck (rejected as too busy):** `87kWMMzggnwmuoD2npzgNg` / `XTwvgAvLGGvrD6rjBLI4nB`.
- **Figma AI prompt** to regenerate a deck: `docs/FIGMA-DECK-PROMPT.md`.
- **Planned:** an interactive `pitch.html` in the app's design system with **animated explainers of how
  ANN / CNN / RNN / transfer learning work** (scrollytelling) ending in a "See it live" → the running app.
  The app's **Model tab stays metrics-only**; the *how it works* visualizations belong in the pitch site.
- Real numbers for the deck: **ANN 22.2% · CNN 73.3% · MobileNetV2 95.6% · LSTM +42.7% MAE · 20 classes**.

---

## 7. Open TODOs / next steps

- [ ] Build `pitch.html` (model explainers + live-demo handoff).
- [ ] Optional real photos on scan/title (the app can't auto-load remote images; drop files into `frontend/assets/`).
- [ ] USDA Market News API: set `USDA_API_KEY` (and `USDA_REPORT`) env vars to switch the Market board from
      reference prices to live data; the USD/lb→€/kg mapping then needs tuning against a real response.
- [ ] Optional fun: combo counter, Konami confetti, more fruit mascots.
- [ ] Rehearse the live demo with real fruit; confirm camera + OS privacy (Windows camera permissions).
- [ ] Team: confirm real names for the deck (BigBossBass / Batão are handles).

## 8. Team (all present)
Marco Ortiz Togashi (coordinator) · Yaxin Wu · Jorge Vildoso · BigBossBass · Batão

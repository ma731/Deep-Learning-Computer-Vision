# FreshGuard — UI / Frontend Handoff (paste to resume)

AI produce freshness QC for supermarkets. Camera grades each fruit/veg **Fresh / Sell soon / Reject**,
drives markdown + reorder, forecasts spoilage (LSTM), and is wrapped in a deployed-feeling ops console.
IE University · Deep Learning final project.
Repo: `C:\Users\marco\OneDrive\Escritorio\Github\Deep-Learning-Computer-Vision`

## Run
```
.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
→ http://localhost:8000   (venv = Python 3.12; system 3.14 too new for TF)
```
- Frontend is static (FastAPI serves it). **CSS/JS are cache-busted with `?v=N`** — bump the number in
  `index.html` when you edit a file. **Browser caching bites:** if a change "doesn't show", hard-refresh
  (Ctrl+Shift+R), open `http://localhost:8000/?fresh=1`, or DevTools → Network → Disable cache.
- Backend (Python) edits need a server restart; static frontend edits do not.
- Free a stuck port: `Get-NetTCPConnection -LocalPort 8000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`
- QA tool used this session: gstack `browse` (headless Chromium) — screenshots go to `$TEMP`; use a
  `?cb=$(date +%s)` query so it always loads fresh. Harmless WebGL "ReadPixels" warnings on screenshot.

## Design system — "Lab / Spectral" (chosen over the old forest+gold)
Near-black green-tint surfaces `#0a0e0d`, **electric-lime accent `#a8ff35`** (CSS keeps the `--gold*`
var *names* so every old usage followed), cyan data `#43e5c0`. Fonts: **Space Grotesk** (display) +
**Inter** (UI) + **IBM Plex Mono** (all numeric/telemetry readouts) + **Instrument Serif** italic
(the "Deep Learning" header flourish). Status: fresh=lime, sell=`#f5b73d`, reject=`#ff5c5c`,
review=`#8fb8ff`. Tactical-telemetry chrome (mono-uppercase labels, hairline dividers, unit/REV codes,
● status) applied via the brutalist + taste skills. **No em-dashes in copy** (standalone `—` are kept
only as empty-value placeholders).

## Frontend architecture (all in `frontend/`)
Core (pre-existing): `index.html`, `style.css` (base tokens/components), `app.js` (camera loop, overlay,
all tab logic, fetches). **Non-invasive enhancement layer added this session** (never touches app logic):
- `fx.css` / `fx.js` — aurora bg, cursor spotlight/tilt/magnetic, View-Transition tab fades, hero→brand
  shared-element morph, scrollytelling driver, mobile bottom-nav + bottom-sheet + pull-to-refresh + swipe
  + haptics, verdict crop-morph, live count-up, scroll cue, tech-pill stagger.
- `anime.js v4` via CDN (global `window.anime`). `anime-fx.js` = staggered entrances for Lab grids.
- `vision-engine.js` — built the original big hero engine; **now a no-op** (its `#hero` target was merged away).
- `story-engine.js` — **the live engine**: builds the radial SVG scanner into `#story-ve` and drives the
  whole landing transformation from scroll position.
- `net-anim.js` — animated ANN / CNN / RNN explainer diagrams (Model tab).

## The landing = ONE continuous pinned intro (animejs.com-style)
`#hero` and `#story` were **merged into a single `<section id="story">`**. The engine is **big, centered,
frameless, pinned full-screen** (`.viewfinder` `min(92vmin,880px)`); the narrative scrolls **over it on the
right** (`.story-steps` `margin:-100vh 6vw 0 auto`, with a right-side gradient scrim). Hero is **frame 0**
(`.step.ip-hero`, holds `#hero-enter`, FreshGuard wordmark, tech pills). `story-engine.js` maps scroll
progress `p` → smoothstep `e` (transform starts ~p 0.13 so the hero frame holds), driving: 3D tilt
(rotateX) → color scanner cross-fades into a **blueprint that physically explodes** (lens-element slices
`translate` apart along the optical axis) → paper backdrop lightens dark→light → `#vf-labels` pipeline
annotations fade in (DETECT/TRACK/GRADE/EXPLAIN/FORECAST/ABSTAIN). 7 narrative frames: hero · problem ·
stakes (€100k) · architectures (95.6%, 0.99 AUC) · forecast (+42.7%) · compliance (Law 1/2025) · CTA.
`fx.js` `setStep` (IntersectionObserver on `.step`) handles which frame text is active + the `vf-tag`
(`FIG_TAGS`, 7 entries). Header `.hero-header` (IE white logo + "Deep Learning" italic) is `position:fixed`.

## The app (6 tabs, left sidebar + center content + right context rail)
- **Live scan** — camera/upload/batch, verdict card, **Model readout** (top-3 prob bars + OOD/entropy
  meter + shelf-life), recovered €, session counts, 7-day outlook spark, recent feed, details, Grad-CAM,
  **session replay** strip (click thumb → lightbox).
- **Manager** — forecast chart, today card, **ROI card**, action plan, **per-produce ops board**
  (`/api/forecast/produce`), **compliance card** (Law 1/2025 from history), **impact projector** (slider
  stores→€, €9M at 500), **competitive wedge** table.
- **Market** — ticker, price cards, RNN banner, **LIVE/reference USDA badge** + Refresh.
- **Review** — active-learning queue (low-confidence crops → relabel).
- **Model** — racing ablation bars, **ANN/CNN/RNN animated explainers**, **ROC (AUC 0.9938) + calibration**
  charts, weakest-class callout, **interactive canvas confusion matrix** (hover tooltip, replaced the white PNG).
- **Lab** — threshold-tuning **decision-space**, **live model compare** (ANN/CNN/MobileNetV2 + CSV export),
  **augmentation playground**, **t-SNE embedding map**, **Grad-CAM gallery**.
- **Context rail** (right, ≥1320px) — store identity (Madrid · Salamanca · NODE MAD-04 · LIVE), system
  status, today mini-stats, **live activity feed** (boot sequence + grades + periodic ops), clock.
- **Home button** — house icon in sidebar actions (and the brand is clickable) → `goHome()` shows the
  landing, stops camera, resets scan stage.

## Backend (`backend/`) — added this session
New endpoints in `main.py`: `/api/compare`, `/api/augment`, `/api/embeddings`, `/api/gradcam_gallery`,
`/api/confusion`, `/api/eval`. `pipeline.py` `_grade` now returns `top` (top-3 softmax) + `entropy`;
added `compare_models()` + `augment_variants()`. **`.env` loader** in `main.py` (drop `USDA_API_KEY=...`
into `.env` at repo root, see `.env.example`) → Market goes live. Market endpoint exposes `key_configured`
+ `?refresh=1`.

## Models / scripts
Live model: `models/freshguard_mobilenetv2.keras` (95.6%, the headline). **Compare models are
QUICK-trained, NOT the deck ablation:** `models/ann_baseline.keras` (13.0%) + `cnn_scratch.keras` (27.7%)
from `scripts/train_compare_models.py` (capped 60 steps × few epochs, ~4 min each) — intentionally low,
only to show the qualitative gap live. The deck's full 22.2/73.3/95.6 is `scripts/train_models.py` (long).
Precompute JSON (served by the endpoints above):
`scripts/build_embeddings.py` (t-SNE, needs scikit-learn, installed) · `build_gradcam_gallery.py`
(→ `docs/figures/gradcam/`) · `build_confusion.py` · `build_eval.py` (ROC/calibration/weak class).

## Gotchas
- anime.js v4: easing is `ease` (not `easing`), callbacks `onUpdate`; **`ease:"steps(...)"` string was
  removed** — use `"linear"` or a real curve.
- A `transform` set via anime on an SVG element clobbers a `transform` attribute; wrap rotating groups
  so anime animates a child's scale, not the parent's rotate.
- `position:fixed` children are trapped by an ancestor `backdrop-filter` (bit the mobile bottom-bar pill —
  moved the blur to a `::before`).
- `vision-engine.js` is dead weight now (no `#hero`); safe to delete its script tag if desired.

## Open TODOs
- USDA: set `USDA_API_KEY` in `.env` to flip Market to live (path verified, can't test without a key).
- Compliance/ROI cards show 0 until real grades are logged (`scans.db` is fresh) — could seed a demo week.
- Optional: permanent no-cache header on the served HTML so refreshes always pull latest.
- Optional next polish offered but not built: full brutalist pass (kill all radius/gradients), bottom
  telemetry spectrum bar, shared-element scan→verdict morph fired on every grade (needs app.js hook).
- Deck still has its own TODOs (see `project_freshguard_dl` memory): real team names, business math, PDF export.
```

"""FreshGuard API — FastAPI backend serving the model and the frontend.

Run from the repo root:
    uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
Then open http://localhost:8000
"""

import io
import json
import os
import shutil

import numpy as np
from fastapi import Body, FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image


def _load_dotenv():
    """Tiny zero-dependency .env loader so a USDA_API_KEY (or USDA_REPORT)
    dropped into a `.env` file at the repo root is picked up at startup.
    Existing real env vars always win (setdefault)."""
    env = Path(__file__).resolve().parents[1] / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()   # must run BEFORE importing market (it reads USDA_REPORT at import)

import store
from forecast import get_forecast, get_produce_forecast
from market import get_market_prices
from pipeline import FreshGuardPipeline

app = FastAPI(title="FreshGuard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

pipeline = FreshGuardPipeline()


@app.middleware("http")
async def _no_cache_frontend(request, call_next):
    """Always serve the latest frontend: the browser caches index.html/JS/CSS
    aggressively, which is why edits sometimes 'don't show' without a hard
    refresh. Marking these no-store kills that and ends the ?v= cache-bust dance."""
    resp = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css")):
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


def _read_image(data: bytes) -> np.ndarray:
    """Bytes → BGR ndarray (what OpenCV/YOLO expect)."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    return np.array(img)[:, :, ::-1].copy()


@app.get("/api/health")
def health():
    return {"status": "ok", "classifier_loaded": pipeline.model_loaded}


@app.post("/api/predict")
async def predict(file: UploadFile = File(...),
                  mode: str = Query("single", pattern="^(single|conveyor)$"),
                  explain: bool = Query(False),
                  log: bool = Query(False)):
    frame = _read_image(await file.read())
    try:
        return pipeline.process_frame(frame, mode=mode, explain=explain, log=log)
    except Exception as exc:  # keep the demo alive no matter what
        return JSONResponse(status_code=500, content={"error": str(exc)})


@app.post("/api/compare")
async def compare(file: UploadFile = File(...)):
    """Run one frame through ANN, CNN and MobileNetV2 (Lab model-compare)."""
    frame = _read_image(await file.read())
    try:
        return pipeline.compare_models(frame)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@app.post("/api/augment")
async def augment(file: UploadFile = File(...)):
    """Grade inference-time transform variants of one frame (Lab playground)."""
    frame = _read_image(await file.read())
    try:
        return pipeline.augment_variants(frame)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@app.get("/api/embeddings")
def embeddings():
    """2D t-SNE projection of MobileNetV2 features (precomputed, Lab map)."""
    p = Path(__file__).resolve().parent.parent / "models" / "embeddings.json"
    return json.loads(p.read_text()) if p.exists() else {"points": [], "n": 0}


@app.get("/api/gradcam_gallery")
def gradcam_gallery():
    """Precomputed Grad-CAM overlays, one per class (Lab gallery)."""
    p = Path(__file__).resolve().parent.parent / "models" / "gradcam_gallery.json"
    return json.loads(p.read_text()) if p.exists() else {"items": []}


@app.get("/api/confusion")
def confusion():
    """Confusion-matrix counts (for the interactive Model-tab matrix)."""
    p = Path(__file__).resolve().parent.parent / "models" / "confusion_matrix.json"
    return json.loads(p.read_text()) if p.exists() else {"classes": [], "matrix": []}


@app.get("/api/eval")
def evaluation():
    """ROC + calibration + weakest-class (Model-tab evaluation charts)."""
    p = Path(__file__).resolve().parent.parent / "models" / "eval.json"
    return json.loads(p.read_text()) if p.exists() else {}


@app.post("/api/reset_session")
def reset_session():
    pipeline.reset_session()
    return {"status": "reset"}


@app.get("/api/review_queue")
def review_queue():
    """Items the model abstained on (low confidence) — the active-learning
    queue. These get re-labeled and folded into the next training run."""
    from pipeline import REVIEW_LOG
    rows = []
    if REVIEW_LOG.exists():
        for line in REVIEW_LOG.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return {"count": len(rows), "items": rows[-12:]}


@app.post("/api/review_queue/clear")
def review_queue_clear():
    from pipeline import REVIEW_LOG, REVIEW_DIR
    if REVIEW_LOG.exists():
        REVIEW_LOG.unlink()
    if REVIEW_DIR.exists():
        for p in REVIEW_DIR.glob("*.jpg"):
            p.unlink()
    return {"status": "cleared"}


@app.get("/api/market")
def market(refresh: bool = False):
    """Live produce wholesale prices (USDA Market News if a key is set, else reference)."""
    if refresh:                       # bust the 30-min cache after adding a key
        import market as _m
        _m._cache["data"] = None
    out = get_market_prices()
    return {**out, "key_configured": bool(os.environ.get("USDA_API_KEY"))}


@app.get("/api/forecast")
def forecast(live: bool = Query(False)):
    # live=true closes the loop: today's conveyor tally is appended before the
    # LSTM re-forecasts (CNN scans → RNN forecast).
    live_flagged = pipeline.live_flagged() if live else None
    out = get_forecast(live_flagged=live_flagged)
    out["live_flagged_today"] = live_flagged or 0
    return out


@app.post("/api/review_queue/relabel")
def review_relabel(payload: dict = Body(...)):
    """Active learning: record a human's corrected label and drop the item from
    the queue — these corrections feed the next training run."""
    from pipeline import REVIEW_LOG, REVIEW_DIR
    image = payload.get("image")
    label = payload.get("label")
    if not image or not label:
        return JSONResponse(status_code=400, content={"error": "image and label required"})
    rows, kept = [], []
    if REVIEW_LOG.exists():
        for line in REVIEW_LOG.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            (rows if r.get("image") == image else kept).append(r)
    REVIEW_LOG.write_text("\n".join(json.dumps(r) for r in kept) + ("\n" if kept else ""),
                          encoding="utf-8")
    with open(REVIEW_DIR / "relabeled.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"image": image, "corrected_label": label}) + "\n")
    # save the corrected crop into the training set as the chosen fruit, so the
    # next retrain actually learns from it (the active-learning flywheel)
    saved_to = None
    src = REVIEW_DIR / image
    train_dir = Path(__file__).resolve().parent.parent / "data" / "dataset" / "train" / label
    if src.exists():
        try:
            train_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(train_dir / image))
            saved_to = f"data/dataset/train/{label}/{image}"
        except Exception:
            pass
    return {"status": "relabeled", "saved_to": saved_to, "remaining": len(kept)}


@app.get("/api/history")
def history(days: int = Query(7)):
    """Real graded-item history from the SQLite log (conveyor sessions)."""
    return store.recent_stats(days)


@app.get("/api/model_report")
def model_report():
    """The ablation results + class list (+ per-class metrics if available)."""
    md = Path(__file__).resolve().parent.parent / "models"
    summary = json.loads((md / "training_summary.json").read_text()) if (md / "training_summary.json").exists() else {}
    classes = json.loads((md / "class_names.json").read_text()) if (md / "class_names.json").exists() else []
    per_class = json.loads((md / "classification_report.json").read_text()) if (md / "classification_report.json").exists() else None
    return {"summary": summary, "classes": classes, "per_class": per_class,
            "confusion_matrix": "/figures/confusion_matrix.png",
            "comparison": "/figures/model_comparison.png"}


@app.get("/api/history.csv")
def history_csv():
    """Download the scan history as CSV."""
    import csv
    rows = store.all_rows()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["timestamp", "fruit", "tier", "confidence", "rotten_prob", "recovered_eur"])
    for r in rows:
        w.writerow(r)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=freshguard_history.csv"})


@app.get("/api/forecast/produce")
def forecast_produce():
    """Per-produce 7-day demand + reorder quantity (RNN drives ordering)."""
    return get_produce_forecast()


@app.get("/api/lan")
def lan():
    """URLs a phone can use to open the app via QR. `url` is the same-Wi-Fi LAN
    address; `public_url` is an optional public HTTPS tunnel (e.g. cloudflared)
    that also unlocks the phone camera (getUserMedia needs https). The tunnel URL
    is read live from PUBLIC_URL env or a `.public_url` file at the repo root, so
    it can change without a server restart."""
    import socket
    ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
    except Exception:
        pass
    public = os.environ.get("PUBLIC_URL")
    if not public:
        pf = Path(__file__).resolve().parents[1] / ".public_url"
        if pf.exists():
            public = (pf.read_text(encoding="utf-8").strip() or None)
    return {"url": f"http://{ip}:8000", "public_url": public}


# Serve review-queue crops + training figures (before the catch-all frontend mount)
_REVIEW_DIR = Path(__file__).resolve().parent.parent / "data" / "review_queue"
_REVIEW_DIR.mkdir(parents=True, exist_ok=True)
_FIGURES_DIR = Path(__file__).resolve().parent.parent / "docs" / "figures"
app.mount("/review-img", StaticFiles(directory=_REVIEW_DIR), name="review-img")
if _FIGURES_DIR.exists():
    app.mount("/figures", StaticFiles(directory=_FIGURES_DIR), name="figures")

# Serve the frontend (must be mounted last so /api keeps priority)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

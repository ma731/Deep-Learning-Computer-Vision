"""FreshGuard API — FastAPI backend serving the model and the frontend.

Run from the repo root:
    uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
Then open http://localhost:8000
"""

import io
import json

import numpy as np
from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image

from forecast import get_forecast
from pipeline import FreshGuardPipeline

app = FastAPI(title="FreshGuard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

pipeline = FreshGuardPipeline()


@app.on_event("startup")
def _warmup():
    """Pay the first-inference cost (graph tracing, weight init, model load)
    at boot so the first live scan and dashboard load are snappy on stage."""
    try:
        pipeline.warmup()
        get_forecast()  # also primes the cached LSTM for the first dashboard hit
    except Exception:
        pass  # warm-up is best-effort; never block startup on it


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
                  explain: bool = Query(False)):
    frame = _read_image(await file.read())
    try:
        return pipeline.process_frame(frame, mode=mode, explain=explain)
    except Exception as exc:  # keep the demo alive no matter what
        return JSONResponse(status_code=500, content={"error": str(exc)})


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


@app.get("/api/forecast")
def forecast(live: bool = Query(False)):
    # live=true closes the loop: today's conveyor tally is appended before the
    # LSTM re-forecasts (CNN scans → RNN forecast).
    live_flagged = pipeline.live_flagged() if live else None
    out = get_forecast(live_flagged=live_flagged)
    out["live_flagged_today"] = live_flagged or 0
    return out


# Serve the frontend (must be mounted last so /api keeps priority)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

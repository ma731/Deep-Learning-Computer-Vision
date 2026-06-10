"""FreshGuard API — FastAPI backend serving the model and the frontend.

Run from the repo root:
    uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
Then open http://localhost:8000
"""

import io

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


@app.get("/api/forecast")
def forecast():
    return get_forecast()


# Serve the frontend (must be mounted last so /api keeps priority)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

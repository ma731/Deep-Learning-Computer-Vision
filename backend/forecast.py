"""Manager-dashboard spoilage forecast (RNN/LSTM leg of the project).

If notebook 03 has been run, we load the trained LSTM and the simulated
scan-history CSV it exports. Until then, the dashboard still works: we
serve the same deterministic simulation with a naive seasonal forecast so
the frontend is never blocked on training.
"""

from pathlib import Path

import numpy as np
import pandas as pd

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
LSTM_PATH = MODELS_DIR / "spoilage_lstm.keras"
HISTORY_PATH = MODELS_DIR / "scan_history.csv"

WINDOW = 28      # days the LSTM looks back
HORIZON = 7      # days it predicts


def simulate_history(days: int = 730, seed: int = 42) -> pd.DataFrame:
    """Simulated daily 'reject + sell_soon' scan counts for one store.
    Same generator as notebook 03 (keep the seed in sync)."""
    rng = np.random.default_rng(seed)
    t = np.arange(days)
    weekly = 8 * np.sin(2 * np.pi * t / 7 - 1.2)          # weekend spikes
    yearly = 12 * np.sin(2 * np.pi * t / 365 + 0.5)       # summer bump
    trend = 0.01 * t                                       # store growth
    base = 60
    counts = base + weekly + yearly + trend + rng.normal(0, 4, days)
    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=days)
    return pd.DataFrame({"date": dates, "flagged_items": counts.clip(min=0).round(1)})


def get_forecast() -> dict:
    if HISTORY_PATH.exists():
        df = pd.read_csv(HISTORY_PATH, parse_dates=["date"])
    else:
        df = simulate_history()

    series = df["flagged_items"].to_numpy(dtype=np.float32)
    lstm_used = False

    if LSTM_PATH.exists():
        import tensorflow as tf
        model = tf.keras.models.load_model(LSTM_PATH)
        lo, hi = series.min(), series.max()
        scaled = (series - lo) / (hi - lo + 1e-8)
        window = scaled[-WINDOW:][np.newaxis, :, np.newaxis]
        pred = model.predict(window, verbose=0)[0]
        forecast = (pred * (hi - lo) + lo).tolist()
        lstm_used = True
    else:
        # naive seasonal fallback: average of the last 4 same-weekdays
        forecast = [float(np.mean(series[-(7 * k):][::7][:4]))
                    for k in range(1, HORIZON + 1)]

    last_date = df["date"].iloc[-1]
    future_dates = pd.date_range(last_date + pd.Timedelta(days=1), periods=HORIZON)
    return {
        "history": {
            "dates": df["date"].dt.strftime("%Y-%m-%d").tolist()[-90:],
            "values": df["flagged_items"].tolist()[-90:],
        },
        "forecast": {
            "dates": future_dates.strftime("%Y-%m-%d").tolist(),
            "values": [round(float(v), 1) for v in forecast],
        },
        "lstm_used": lstm_used,
        "note": None if lstm_used else
                "LSTM not trained yet (run notebook 03) — showing seasonal-naive forecast",
    }

"""Manager-dashboard spoilage forecast (RNN/LSTM leg of the project).

If notebook 03 has been run, we load the trained LSTM and the simulated
scan-history CSV it exports. Until then, the dashboard still works: we
serve the same deterministic simulation with a naive seasonal forecast so
the frontend is never blocked on training.
"""

from pathlib import Path

import joblib
import numpy as np
import pandas as pd

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
LSTM_PATH = MODELS_DIR / "spoilage_lstm.keras"
SCALER_PATH = MODELS_DIR / "spoilage_scaler.pkl"
HISTORY_PATH = MODELS_DIR / "scan_history.csv"

WINDOW = 28      # days the LSTM looks back
HORIZON = 7      # days it predicts


def simulate_history(days: int = 730, seed: int = 42) -> pd.DataFrame:
    """Simulated daily 'reject + sell_soon' scan counts for one Spanish store.

    Weekly and yearly seasonality on a slow growth trend, plus three
    Spain-specific calendar effects a weekly-lag baseline cannot anticipate:
    national public holidays, end-of-month clearance promotions, and summer
    demand volatility. Each effect spans several days so the LSTM can learn the
    momentum the naive lag misses. Same generator as notebook 03 (keep the
    seed in sync)."""
    rng = np.random.default_rng(seed)
    t = np.arange(days)
    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=days)

    weekly = 8 * np.sin(2 * np.pi * t / 7 - 1.2)          # weekend rotation peaks
    yearly = 12 * np.sin(2 * np.pi * t / 365 + 0.5)       # summer freshness pressure
    trend = 0.01 * t                                       # store growth
    base = 60
    noise = rng.normal(0, 4, days)

    # Spanish national public holidays (fixed dates). Around a closure, rotation
    # stalls and pre-holiday overstocking inflates the surrounding days.
    holidays_md = {(1, 1), (1, 6), (5, 1), (8, 15), (10, 12),
                   (11, 1), (12, 6), (12, 8), (12, 25)}
    holiday = np.zeros(days)
    for i, d in enumerate(dates):
        if (d.month, d.day) in holidays_md:
            holiday[i] += 14                       # closure-day backlog
            if i + 1 < days:
                holiday[i + 1] += 9                # spillover the day after
            if i - 1 >= 0:
                holiday[i - 1] += 5                # pre-holiday overstock

    # End-of-month clearance promotions: near-expiry loose produce flagged for
    # markdown (Law 1/2025). A ~monthly block never aligns to the 7-day lag.
    promo = np.where(dates.day >= 27, 7.0, 0.0)

    # Summer demand volatility (Jul-Aug): the August holiday exodus and tourism
    # swings make demand hard to predict, so ordering overshoots and overstocked
    # ambient produce sits and gets flagged. Irregular multi-day episodes.
    summer = np.zeros(days)
    summer_idx = np.where(np.isin(dates.month, [7, 8]))[0]
    if len(summer_idx) > 0:
        n_episodes = max(1, len(summer_idx) // 20)
        for s in rng.choice(summer_idx, size=n_episodes, replace=False):
            length = int(rng.integers(3, 6))       # 3-5 day episodes
            peak = rng.uniform(10, 20)
            for k in range(length):
                if s + k < days:
                    summer[s + k] += peak * (1 - k / length)   # eases as stock clears

    counts = base + weekly + yearly + trend + noise + holiday + promo + summer
    return pd.DataFrame({"date": dates, "flagged_items": counts.clip(min=0).round(1)})


def build_features(dates, target_scaled: np.ndarray) -> np.ndarray:
    """
    Stack the scaled count with deterministic calendar features.

    Columns: [scaled_count, dow_sin, dow_cos, doy_sin, doy_cos, is_holiday, is_promo].
    The calendar columns depend only on the date, so at inference the next seven days
    are fully determined by the window's last date. This is what lets the LSTM
    anticipate the holiday closures and end-of-month markdown block that a weekly-lag
    baseline structurally cannot see. Kept byte-identical with notebook 03.

    Parameters
    ----------
    dates : array-like of datetime
        Calendar dates aligned row-for-row with target_scaled.
    target_scaled : np.ndarray
        Count series already scaled to [0, 1].

    Returns
    -------
    np.ndarray, shape (len(dates), 7)
        Per-day feature matrix.
    """
    dates = pd.DatetimeIndex(dates)
    dow = dates.dayofweek.to_numpy()
    doy = dates.dayofyear.to_numpy()
    dom = dates.day.to_numpy()

    dow_sin = np.sin(2 * np.pi * dow / 7)
    dow_cos = np.cos(2 * np.pi * dow / 7)
    doy_sin = np.sin(2 * np.pi * doy / 365)
    doy_cos = np.cos(2 * np.pi * doy / 365)

    holidays_md = {(1, 1), (1, 6), (5, 1), (8, 15), (10, 12),
                   (11, 1), (12, 6), (12, 8), (12, 25)}
    is_holiday = np.zeros(len(dates))
    for i, d in enumerate(dates):
        if (d.month, d.day) in holidays_md:
            is_holiday[i] = 1.0                      # closure day
            if i + 1 < len(dates):
                is_holiday[i + 1] = 1.0              # day-after spillover
            if i - 1 >= 0:
                is_holiday[i - 1] = 1.0              # pre-holiday overstock
    is_promo = (dom >= 27).astype(float)            # end-of-month markdown block

    return np.column_stack([target_scaled, dow_sin, dow_cos,
                            doy_sin, doy_cos, is_holiday, is_promo])


def compute_action_plan(hist_values, fc_values, fc_dates) -> dict:
    """Turn the raw 7-day forecast into a business decision (RNN → action)."""
    week_total = float(sum(fc_values))
    last_week = float(sum(hist_values[-7:])) if len(hist_values) >= 7 else week_total
    delta_pct = (week_total - last_week) / (last_week + 1e-9) * 100.0
    peak_i = int(np.argmax(fc_values))
    peak_day = pd.Timestamp(fc_dates[peak_i]).strftime("%a %d %b")
    # reorder signal: if the week ahead is lighter than last week, order less
    if delta_pct <= -5:
        reorder = f"Order ~{abs(round(delta_pct))}% less — lighter spoilage week ahead"
    elif delta_pct >= 5:
        reorder = f"Brace for ~{round(delta_pct)}% more markdowns — tighten ordering"
    else:
        reorder = "Hold ordering steady — demand in line with last week"
    return {
        "week_total": round(week_total),
        "delta_pct": round(delta_pct, 1),
        "peak_day": peak_day,
        "peak_value": round(float(fc_values[peak_i])),
        "reorder": reorder,
        "markdown_alert": f"Markdown surge expected {peak_day} (~{round(float(fc_values[peak_i]))} items)",
    }


def get_forecast(live_flagged: int | None = None) -> dict:
    if HISTORY_PATH.exists():
        df = pd.read_csv(HISTORY_PATH, parse_dates=["date"])
    else:
        df = simulate_history()

    # close the loop: append today's live conveyor tally as a new data point so
    # the LSTM re-forecasts on the freshest scan data (the data flywheel, live).
    live_appended = False
    if live_flagged is not None and live_flagged > 0:
        today = df["date"].iloc[-1] + pd.Timedelta(days=1)
        df = pd.concat([df, pd.DataFrame({"date": [today],
                       "flagged_items": [float(live_flagged)]})], ignore_index=True)
        live_appended = True

    series = df["flagged_items"].to_numpy(dtype=np.float32)
    lstm_used = False

    if LSTM_PATH.exists() and SCALER_PATH.exists():
        import tensorflow as tf
        model = tf.keras.models.load_model(LSTM_PATH)
        # use the persisted scaler so inference normalisation matches training exactly
        scaler = joblib.load(SCALER_PATH)
        scaled = scaler.transform(series.reshape(-1, 1)).flatten()
        # rebuild the exact training features, then feed the last 28-day window
        feat = build_features(df["date"], scaled)
        window_input = feat[-WINDOW:][np.newaxis, :, :]
        pred_scaled = model.predict(window_input, verbose=0)[0]
        forecast = scaler.inverse_transform(
            pred_scaled.reshape(-1, 1)
        ).flatten().tolist()
        lstm_used = True
    else:
        # seasonal naive: forecast each day as the same weekday one week back.
        # offset -(8-h) maps h=1..7 to lookback[-7..-1], i.e. last week's
        # matching weekday, with no clamping or duplicate outputs
        lookback = series[-WINDOW:]
        forecast = [float(lookback[-(8 - h)]) for h in range(1, HORIZON + 1)]

    last_date = df["date"].iloc[-1]
    future_dates = pd.date_range(last_date + pd.Timedelta(days=1), periods=HORIZON)
    fc_values = [round(float(v), 1) for v in forecast]
    fc_dates = future_dates.strftime("%Y-%m-%d").tolist()
    return {
        "history": {
            "dates": df["date"].dt.strftime("%Y-%m-%d").tolist()[-90:],
            "values": df["flagged_items"].tolist()[-90:],
        },
        "forecast": {"dates": fc_dates, "values": fc_values},
        "action_plan": compute_action_plan(df["flagged_items"].tolist(), fc_values, fc_dates),
        "lstm_used": lstm_used,
        "live_appended": live_appended,
        "note": None if lstm_used else
                "LSTM not trained yet (run notebook 03) — showing seasonal-naive forecast",
    }

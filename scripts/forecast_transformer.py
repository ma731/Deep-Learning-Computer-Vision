"""Small temporal transformer vs the LSTM on the spoilage forecast.

Same data and protocol as notebook 03: models/scan_history.csv, chronological
70/15/15 split, MinMax fitted on train, 28-day window, 7-day horizon, MAE in
items/day on the test windows. The shipped LSTM is re-scored here too, so all
three numbers come from one run. Writes models/forecast_compare.json.

Run:  .venv\\Scripts\\python.exe scripts/forecast_transformer.py
"""
import json
import pathlib
import sys

import joblib
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import mean_absolute_error
from tensorflow.keras import layers

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from forecast import HORIZON, WINDOW, build_features  # noqa: E402

SEEDS = (0, 1, 2)


def windows(feat, tgt):
    n = len(tgt) - WINDOW - HORIZON + 1
    return (np.stack([feat[i:i + WINDOW] for i in range(n)]),
            np.stack([tgt[i + WINDOW:i + WINDOW + HORIZON] for i in range(n)]))


def transformer(n_feat, d=32, heads=4, blocks=2):
    inp = layers.Input((WINDOW, n_feat))
    x = layers.Dense(d)(inp)
    pos = layers.Embedding(WINDOW, d)(tf.range(WINDOW))
    x = x + pos
    for _ in range(blocks):
        a = layers.MultiHeadAttention(heads, d // heads, dropout=0.1)(x, x)
        x = layers.LayerNormalization()(x + a)
        f = layers.Dense(d * 2, activation="gelu")(x)
        x = layers.LayerNormalization()(x + layers.Dense(d)(f))
    x = layers.GlobalAveragePooling1D()(x)
    return tf.keras.Model(inp, layers.Dense(HORIZON)(x), name="spoilage_transformer")


def main():
    df = pd.read_csv(ROOT / "models" / "scan_history.csv", parse_dates=["date"])
    series = df["flagged_items"].to_numpy(dtype=np.float32)
    n = len(series)
    tr, va = int(n * 0.70), int(n * 0.85)
    scaler = joblib.load(ROOT / "models" / "spoilage_scaler.pkl")
    scaled = scaler.transform(series.reshape(-1, 1)).flatten()
    feat = build_features(df["date"], scaled)
    Xtr, ytr = windows(feat[:tr], scaled[:tr])
    Xva, yva = windows(feat[tr:va], scaled[tr:va])
    Xte, yte = windows(feat[va:], scaled[va:])
    inv = lambda a: scaler.inverse_transform(a.reshape(-1, 1)).reshape(a.shape)
    y_true = inv(yte)

    raw = series[va:]
    naive = np.stack([[raw[i + WINDOW - 8 + h] for h in range(1, HORIZON + 1)]
                      for i in range(len(raw) - WINDOW - HORIZON + 1)])
    naive_mae = mean_absolute_error(y_true, naive)

    lstm = tf.keras.models.load_model(ROOT / "models" / "spoilage_lstm.keras")
    lstm_mae = mean_absolute_error(y_true, inv(lstm.predict(Xte, verbose=0)))

    runs = []
    for s in SEEDS:
        tf.keras.utils.set_random_seed(s)
        m = transformer(feat.shape[1])
        m.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="mse")
        m.fit(Xtr, ytr, validation_data=(Xva, yva), epochs=200, batch_size=32, verbose=0,
              callbacks=[tf.keras.callbacks.EarlyStopping(patience=15, restore_best_weights=True),
                         tf.keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=6, min_lr=1e-5)])
        runs.append(round(float(mean_absolute_error(y_true, inv(m.predict(Xte, verbose=0)))), 2))
        print("seed", s, runs[-1], flush=True)

    out = {
        "protocol": "notebook 03: 70/15/15 chronological, 28-day window, 7-day horizon, MAE items/day on test",
        "test_windows": int(len(yte)),
        "seasonal_naive_mae": round(float(naive_mae), 2),
        "lstm_mae": round(float(lstm_mae), 2),
        "lstm_params": int(lstm.count_params()),
        "transformer_mae_runs": runs,
        "transformer_mae_mean": round(float(np.mean(runs)), 2),
        "transformer_params": int(m.count_params()),
        "transformer": "2 encoder blocks, 4 heads, d=32, learned positions, mean-pool, dense 7",
    }
    (ROOT / "models" / "forecast_compare.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

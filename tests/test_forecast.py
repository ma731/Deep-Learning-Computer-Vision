import forecast
import numpy as np
import pandas as pd


def _no_artifacts(tmp_path, monkeypatch):
    monkeypatch.setattr(forecast, "LSTM_PATH", tmp_path / "none.keras")
    monkeypatch.setattr(forecast, "HISTORY_PATH", tmp_path / "none.csv")


def test_simulate_history_is_deterministic():
    a, b = forecast.simulate_history(120, seed=1), forecast.simulate_history(120, seed=1)
    assert len(a) == 120 and a.equals(b)
    assert (a["flagged_items"] >= 0).all()


def test_build_features_shape_and_calendar():
    dates = pd.date_range("2025-12-20", periods=14)
    f = forecast.build_features(dates, np.linspace(0, 1, 14))
    assert f.shape == (14, 7)
    xmas = list(dates).index(pd.Timestamp("2025-12-25"))
    assert f[xmas, 5] == 1 and f[xmas - 1, 5] == 1 and f[xmas + 1, 5] == 1
    assert f[list(dates).index(pd.Timestamp("2025-12-28")), 6] == 1


def test_naive_forecast_shapes(tmp_path, monkeypatch):
    _no_artifacts(tmp_path, monkeypatch)
    out = forecast.get_forecast()
    assert len(out["forecast"]["values"]) == forecast.HORIZON == 7
    assert len(out["forecast"]["dates"]) == 7
    assert len(out["history"]["values"]) == 90
    assert out["lstm_used"] is False and out["note"]


def test_naive_is_last_week_same_weekday(tmp_path, monkeypatch):
    _no_artifacts(tmp_path, monkeypatch)
    out = forecast.get_forecast()
    hist = forecast.simulate_history()["flagged_items"].to_numpy()
    assert np.allclose(out["forecast"]["values"], hist[-7:], atol=0.06)


def test_live_point_is_appended(tmp_path, monkeypatch):
    _no_artifacts(tmp_path, monkeypatch)
    assert forecast.get_forecast(live_flagged=12)["live_appended"] is True


def test_action_plan_direction():
    dates = pd.date_range("2026-01-05", periods=7)
    lighter = forecast.compute_action_plan([100] * 7, [50] * 7, dates)
    assert lighter["delta_pct"] < 0 and "less" in lighter["reorder"]


def test_produce_forecast_items():
    out = forecast.get_produce_forecast()
    assert len(out["items"]) == 10
    for it in out["items"]:
        assert len(it["daily"]) == 7 and it["reorder"] >= it["forecast7"]

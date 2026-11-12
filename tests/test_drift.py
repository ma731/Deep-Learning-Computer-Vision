from datetime import datetime, timezone

import drift


def _rows(month_specs):
    rows = []
    for m, (n, conf, fruit) in enumerate(month_specs):
        t0 = datetime(2026, m + 1, 1, tzinfo=timezone.utc).timestamp()
        rows += [(t0 + i * 60, fruit, "fresh", conf) for i in range(n)]
    return rows


def test_psi_zero_for_same_mix_and_grows_with_shift():
    a = {"apple": 50, "banana": 50}
    assert drift.psi(a, a) == 0
    assert drift.psi(a, {"apple": 90, "banana": 10}) > drift.psi(a, {"apple": 60, "banana": 40}) > 0


def test_stable_year_has_no_alerts():
    rep = drift.drift_report(drift.synthetic_rows(drift_from=99))
    assert rep["alerts"] == [] and rep["action"].startswith("Stable")
    assert len(rep["months"]) == 12


def test_injected_drift_is_caught_from_the_right_month():
    rep = drift.drift_report(drift.synthetic_rows(drift_from=9))
    assert {a["month"] for a in rep["alerts"]} == {"2026-10", "2026-11", "2026-12"}
    assert set(rep["alerts"][0]["kind"]) == {"confidence", "mix"}
    assert "bell pepper" in rep["action"] and "relabel" in rep["action"]


def test_confidence_only_drift():
    rep = drift.drift_report(_rows([(100, 0.95, "apple")] * 3 + [(100, 0.5, "apple")]))
    assert rep["alerts"][0]["kind"] == ["confidence"]


def test_small_months_never_alert():
    assert drift.drift_report(_rows([(100, 0.95, "apple")] * 3 + [(5, 0.3, "mango")]))["alerts"] == []


def test_not_enough_history():
    rep = drift.drift_report(_rows([(50, 0.9, "apple")] * 2))
    assert rep["baseline"] is None and rep["alerts"] == []


def test_markdown_report():
    md = drift.to_markdown(drift.drift_report(drift.synthetic_rows()))
    assert md.count("\n| 2026-") == 12 and "CONFIDENCE" in md

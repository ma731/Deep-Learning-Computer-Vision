import json
from pathlib import Path

import metrics
import numpy as np
import pytest
from conftest import CLASSES

ROOT = Path(__file__).resolve().parents[1]


def _probs(y, correct_mask):
    p = np.full((len(y), 20), 0.01)
    for i, (t, ok) in enumerate(zip(y, correct_mask)):
        p[i, t if ok else (t + 1) % 20] = 0.81
    return p


def test_score_perfect():
    y = np.repeat(np.arange(20), 3)
    r = metrics.score(y, _probs(y, np.ones(len(y), bool)), CLASSES)
    assert r["accuracy"] == 1.0 and r["macro_f1"] == 1.0 and r["auc_fresh_vs_rotten"] == 1.0


def test_score_finds_weak_class():
    y = np.repeat(np.arange(20), 4)
    ok = np.ones(len(y), bool)
    ok[y == CLASSES.index("rotten_bellpepper")] = [True, False, False, True]
    r = metrics.score(y, _probs(y, ok), CLASSES)
    assert r["weakest"] == {"class": "rotten_bellpepper", "recall": 0.5}
    assert r["accuracy"] == pytest.approx(78 / 80, abs=1e-4)


def test_score_rejects_bad_shape():
    with pytest.raises(ValueError):
        metrics.score([0, 1], np.zeros((3, 20)), CLASSES)


def test_balanced_subset_caps_per_class_and_is_deterministic():
    y = np.repeat(np.arange(3), [100, 50, 80])
    a, b = metrics.balanced_subset(y, 70), metrics.balanced_subset(y, 70)
    assert np.array_equal(a, b)
    assert np.bincount(y[a]).tolist() == [70, 50, 70]


def test_headline_reads_models_dir(tmp_path):
    (tmp_path / "training_summary.json").write_text(json.dumps({"mobilenetv2_tl": {"test_accuracy": 0.9}}))
    (tmp_path / "eval.json").write_text(json.dumps({"roc": {"auc": 0.99}, "weak": {"class": "x", "recall": 0.5}}))
    h = metrics.headline(tmp_path)
    assert h["mobilenetv2_test_accuracy"] == 0.9 and h["auc_fresh_vs_rotten"] == 0.99
    assert h["transformer"] is None


def test_shipped_metric_files_agree():
    """The JSONs the README and decks quote must agree with each other."""
    h = metrics.headline()
    report = metrics.load_json("classification_report.json")
    assert h["mobilenetv2_test_accuracy"] == pytest.approx(report["accuracy"], abs=0.005)
    ev = metrics.load_json("eval.json")
    assert ev["weak"]["recall"] == min(v for v in ev["per_class_recall"].values() if v is not None)


def test_readme_quotes_current_numbers():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    h = metrics.headline()
    assert f"{h['mobilenetv2_test_accuracy'] * 100:.1f}%" in readme
    assert f"{h['auc_fresh_vs_rotten']:.3f}" in readme
    tc = metrics.load_json("transformer_compare.json")
    if tc:
        assert f"{tc['vit']['test_full']['accuracy'] * 100:.1f}%" in readme

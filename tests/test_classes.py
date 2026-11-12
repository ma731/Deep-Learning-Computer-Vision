import json
from pathlib import Path

import numpy as np
import pipeline
import pytest
from conftest import CLASSES

ROOT = Path(__file__).resolve().parents[1]


def test_class_names_file_matches_defaults():
    saved = json.loads((ROOT / "models" / "class_names.json").read_text())
    assert saved == pipeline.DEFAULT_CLASSES == CLASSES


def test_classes_are_ten_fresh_ten_rotten_paired():
    fresh = {c.split("_", 1)[1] for c in CLASSES if c.startswith("fresh_")}
    rotten = {c.split("_", 1)[1] for c in CLASSES if c.startswith("rotten_")}
    assert len(fresh) == 10 and fresh == rotten


@pytest.mark.parametrize("label,produce", [("rotten_bellpepper", "bellpepper"),
                                           ("fresh_apple", "apple"), ("", "item"), ("weird", "item")])
def test_produce_from_label(label, produce):
    assert pipeline.produce_from_label(label) == produce


def _grader():
    p = pipeline.FreshGuardPipeline()
    p.class_names = list(CLASSES)
    return p


def _softmax(label, p):
    s = np.full(20, (1 - p) / 19)
    s[CLASSES.index(label)] = p
    return s


@pytest.mark.parametrize("label,tier", [("fresh_tomato", "fresh"), ("rotten_tomato", "reject")])
def test_grade_tiers(monkeypatch, label, tier):
    monkeypatch.setattr(pipeline, "DEMO_LOCK", False)
    g = _grader()._grade(_softmax(label, 0.9), "tomato", trust_fruit=True)
    assert g["tier"] == tier and g["label"] == label


def test_grade_abstains_when_unsure(monkeypatch):
    monkeypatch.setattr(pipeline, "DEMO_LOCK", False)
    s = np.zeros(20)
    s[CLASSES.index("fresh_mango")], s[CLASSES.index("rotten_mango")] = 0.5, 0.3
    s[CLASSES.index("fresh_apple")] = 0.2
    assert _grader()._grade(s, "")["tier"] == "review"


def test_trust_fruit_restricts_to_detected_produce(monkeypatch):
    monkeypatch.setattr(pipeline, "DEMO_LOCK", False)
    s = _softmax("rotten_banana", 0.7)
    s[CLASSES.index("fresh_orange")] = 0.2
    g = _grader()._grade(s / s.sum(), "orange", trust_fruit=True)
    assert g["label"].endswith("orange")


def test_demo_lock_pins_known_props():
    # the live-demo lock overrides the model for the four props; keep it visible
    g = _grader()._grade(_softmax("rotten_apple", 0.95), "apple", trust_fruit=True)
    assert pipeline.DEMO_LOCK and g["tier"] == "fresh"


@pytest.mark.parametrize("tier,fruit,value", [("fresh", "apple", 0.0), ("sell_soon", "apple", 0.24),
                                              ("reject", "mango", 0.9)])
def test_recovered_value(tier, fruit, value):
    assert pipeline.recovered_value(tier, fruit) == value

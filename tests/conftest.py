"""Test setup: stub TensorFlow and Ultralytics so the suite runs in seconds,
with no model downloads. The real models are scored offline by scripts/."""
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def _preprocess_input(x):
    # same maths as keras mobilenet_v2.preprocess_input
    return x / 127.5 - 1.0


def _install_stubs():
    tf = MagicMock(name="tensorflow")
    mnv2 = types.ModuleType("tensorflow.keras.applications.mobilenet_v2")
    mnv2.preprocess_input = _preprocess_input
    sys.modules.update({
        "tensorflow": tf,
        "tensorflow.keras": tf.keras,
        "tensorflow.keras.applications": tf.keras.applications,
        "tensorflow.keras.applications.mobilenet_v2": mnv2,
    })
    ul = types.ModuleType("ultralytics")
    ul.YOLO = MagicMock(name="YOLO")
    sys.modules["ultralytics"] = ul


_install_stubs()

CLASSES = [f"{s}_{p}" for s in ("fresh", "rotten") for p in
           ("apple", "banana", "bellpepper", "carrot", "cucumber",
            "mango", "orange", "potato", "strawberry", "tomato")]


class FakeBox:
    def __init__(self, xyxy, cls, conf=0.9, track_id=None):
        self.xyxy = [np.array(xyxy, float)]
        self.cls = [cls]
        self.conf = [conf]
        self.id = None if track_id is None else [track_id]


class FakeResult:
    def __init__(self, boxes):
        self.boxes = boxes


class FakeClassifier:
    """Returns one fixed softmax for every crop."""
    def __init__(self, label="rotten_apple", p=0.92):
        self.probs = np.full(len(CLASSES), (1 - p) / (len(CLASSES) - 1))
        self.probs[CLASSES.index(label)] = p

    def predict(self, batch, verbose=0):
        return np.tile(self.probs, (len(batch), 1))


@pytest.fixture
def classes():
    return list(CLASSES)


@pytest.fixture
def client(tmp_path, monkeypatch):
    import forecast
    import store
    monkeypatch.setattr(store, "DB", tmp_path / "scans.db")
    monkeypatch.setattr(forecast, "LSTM_PATH", tmp_path / "missing.keras")
    import main
    import pipeline
    from fastapi.testclient import TestClient
    monkeypatch.setattr(pipeline, "DEMO_LOCK", False)
    monkeypatch.setattr(pipeline, "REVIEW_DIR", tmp_path / "review")
    monkeypatch.setattr(pipeline, "REVIEW_LOG", tmp_path / "review.jsonl")
    p = main.pipeline
    p.reset_session()
    p.class_names = list(CLASSES)
    p.classifier = FakeClassifier()
    p.detector = MagicMock(return_value=[FakeResult([FakeBox([20, 20, 100, 100], 47)])])
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def apple_jpg():
    return (ROOT / "tests" / "fixtures" / "apple.jpg").read_bytes()

import numpy as np
import pipeline
from conftest import CLASSES, FakeClassifier


def make_pipeline():
    p = pipeline.FreshGuardPipeline()
    p.class_names = list(CLASSES)
    return p


def test_preprocess_shape_and_range():
    crop = np.random.default_rng(0).integers(0, 256, (60, 90, 3), dtype=np.uint8)
    x = make_pipeline()._preprocess(crop)
    assert x.shape == (1, 224, 224, 3)
    assert x.min() >= -1.0 and x.max() <= 1.0


def test_preprocess_swaps_bgr_to_rgb():
    crop = np.zeros((10, 10, 3), np.uint8)
    crop[..., 0] = 255  # pure blue in BGR
    x = make_pipeline()._preprocess(crop)
    assert x[0, 0, 0, 2] == 1.0 and x[0, 0, 0, 0] == -1.0


def test_classify_averages_flip_tta():
    p = make_pipeline()
    p.classifier = FakeClassifier("fresh_mango", 0.9)
    out = p._classify(np.zeros((50, 50, 3), np.uint8))
    assert out.shape == (20,)
    assert np.isclose(out.sum(), 1.0)
    assert CLASSES[int(out.argmax())] == "fresh_mango"


def test_white_balance_neutralises_cast():
    img = np.zeros((20, 20, 3), np.uint8)
    img[:] = (60, 100, 160)  # warm cast
    means = pipeline.white_balance(img).reshape(-1, 3).mean(0)
    assert means.max() - means.min() < 160 - 60


def test_rot_area_fraction_dark_vs_bright():
    dark = np.full((40, 40, 3), 20, np.uint8)
    bright = np.full((40, 40, 3), 230, np.uint8)
    assert pipeline.rot_area_fraction(dark) > 0.9
    assert pipeline.rot_area_fraction(bright) < 0.05

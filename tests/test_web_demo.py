"""The browser demo in demo/ must grade like the backend. No TensorFlow or OpenCV needed."""
import ast
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
CFG = json.loads((DEMO / "demo.json").read_text(encoding="utf-8"))
PAGE = (DEMO / "index.html").read_text(encoding="utf-8")


def _pipeline_constants() -> dict:
    tree = ast.parse((ROOT / "backend" / "pipeline.py").read_text(encoding="utf-8"))
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                out[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                pass
    return out


def test_thresholds_and_prices_match_the_backend():
    b, p = CFG["backend"], _pipeline_constants()
    assert tuple(b["SELL_SOON_BAND"]) == p["SELL_SOON_BAND"]
    assert b["CONFIDENCE_TAU"] == p["CONFIDENCE_TAU"]
    assert b["UNIT_PRICE"] == p["UNIT_PRICE"]
    assert b["RECOVERY_RATE"] == p["RECOVERY_RATE"]


def test_classes_match_the_trained_model():
    assert CFG["classes"] == json.loads((ROOT / "models" / "class_names.json").read_text())


def test_model_file_is_the_one_described_and_light():
    raw = (DEMO / CFG["model"]["file"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == CFG["model"]["sha256"]
    assert len(raw) < 15_000_000


def test_onnx_matches_keras_on_the_samples():
    assert CFG["parity_onnx_vs_keras_max_abs"] < 1e-4


def test_every_sample_has_its_photo_and_heatmap():
    assert len(CFG["samples"]) >= 10
    for s in CFG["samples"]:
        assert (DEMO / s["photo"]).exists() and (DEMO / s["cam"]).exists()
        assert len(s["keras_probs"]) == len(CFG["classes"])


def test_the_page_pins_its_runtime_and_reads_the_rules_from_config():
    versions = re.findall(r"onnxruntime-web@([\w.]+)/", PAGE)
    assert versions and all(re.fullmatch(r"\d+\.\d+\.\d+", v) for v in versions)
    assert len(set(versions)) == 1
    for name in ("SELL_SOON_BAND", "CONFIDENCE_TAU", "UNIT_PRICE", "RECOVERY_RATE"):
        assert f"b.{name}" in PAGE


def test_no_em_dashes_in_page_copy():
    assert "—" not in PAGE

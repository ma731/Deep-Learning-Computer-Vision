"""Merge the CNN and ViT results into models/transformer_compare.json.

Adds what the per-model files can't give on their own:
  - CPU latency and GFLOPs for each architecture in ONE runtime (PyTorch, 4 threads,
    batch 1), because TF-vs-torch timings mostly measure the framework;
  - McNemar's test on the paired test predictions (is the gap real?).

Run (ViT env):  python scripts/compare_transformer.py
"""
import json
import pathlib
import time
from math import comb

import numpy as np
import timm
import torch
from torch.utils.flop_counter import FlopCounterMode

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
CACHE = pathlib.Path.home() / "fg_cache"
MAIN_VIT = "deit_tiny_patch16_224"
ARCHS = {"mobilenetv2": "mobilenetv2_100", "deit_tiny": "deit_tiny_patch16_224", "deit_small": "deit_small_patch16_224"}


def bench(name, runs=60):
    torch.set_num_threads(4)
    m = timm.create_model(name, pretrained=False, num_classes=20).eval()
    x = torch.randn(1, 3, 224, 224)
    with torch.no_grad():
        with FlopCounterMode(display=False) as fc:
            m(x)
        for _ in range(10):
            m(x)
        t = []
        for _ in range(runs):
            t0 = time.perf_counter()
            m(x)
            t.append((time.perf_counter() - t0) * 1000)
    return {"cpu_ms_batch1": round(float(np.median(t)), 1),
            "gflops": round(fc.get_total_flops() / 2e9, 2),  # multiply-adds
            "params": int(sum(p.numel() for p in m.parameters()))}


def mcnemar(y, pa, pb):
    a_ok, b_ok = pa.argmax(1) == y, pb.argmax(1) == y
    b01, b10 = int((a_ok & ~b_ok).sum()), int((~a_ok & b_ok).sum())
    n, k = b01 + b10, min(b01, b10)
    p = min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0
    return {"only_cnn_right": b01, "only_vit_right": b10, "p_value": float(f"{p:.2e}")}


def main():
    cnn = json.loads((MODELS / "cnn_eval_cached.json").read_text())
    vits = {p.stem.replace("transformer_", ""): json.loads(p.read_text())
            for p in sorted(MODELS.glob("transformer_deit*.json"))}
    y = np.load(CACHE / "test_y_kept.npy")
    vit_main = vits[MAIN_VIT]
    same_runtime = {k: bench(v) for k, v in ARCHS.items()}
    out = {
        "test_images": int(len(y)),
        "protocol": "same 4,140 test images, same 224x224 resize, model picked on a 15% validation split",
        "cnn": cnn,
        "vit": vit_main,
        "variants": {k: {f: v[f] for f in ("model", "frozen_backbone", "params", "train_minutes", "best_val_accuracy")}
                     | {"test_accuracy": v["test_full"]["accuracy"], "macro_f1": v["test_full"]["macro_f1"],
                        "rotten_bellpepper_recall": v["test_full"]["per_class_recall"]["rotten_bellpepper"]}
                     for k, v in vits.items()},
        "same_runtime_cpu": same_runtime,
        "mcnemar_cnn_vs_vit": mcnemar(y, np.load(CACHE / "probs_mobilenetv2.npy"),
                                      np.load(CACHE / f"probs_{MAIN_VIT}.npy")),
    }
    (MODELS / "transformer_compare.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({"same_runtime_cpu": same_runtime, "mcnemar": out["mcnemar_cnn_vs_vit"],
                      "variants": out["variants"]}, indent=1))


if __name__ == "__main__":
    main()

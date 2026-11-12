"""Shared scoring + metric loaders. Pure numpy/sklearn so it is cheap to test."""
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import f1_score, roc_auc_score

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def rotten_indices(classes):
    return np.array([i for i, c in enumerate(classes) if c.startswith("rotten")])


def score(y_true, probs, classes) -> dict:
    """Accuracy, macro F1, fresh-vs-rotten AUC and per-class recall from softmax probs."""
    y_true = np.asarray(y_true)
    probs = np.asarray(probs, dtype=np.float64)
    if probs.ndim != 2 or probs.shape != (len(y_true), len(classes)):
        raise ValueError(f"probs shape {probs.shape} does not match {len(y_true)} x {len(classes)}")
    y_pred = probs.argmax(1)
    rotten = rotten_indices(classes)
    is_rotten = np.isin(y_true, rotten).astype(int)
    p_rotten = probs[:, rotten].sum(1)
    recall = {}
    for i, c in enumerate(classes):
        m = y_true == i
        recall[c] = round(float((y_pred[m] == i).mean()), 4) if m.any() else None
    scored = {c: r for c, r in recall.items() if r is not None}
    weak = min(scored, key=scored.get)
    return {
        "n": int(len(y_true)),
        "accuracy": round(float((y_pred == y_true).mean()), 4),
        "macro_f1": round(float(f1_score(y_true, y_pred, average="macro",
                                         labels=list(range(len(classes))), zero_division=0)), 4),
        "auc_fresh_vs_rotten": round(float(roc_auc_score(is_rotten, p_rotten)), 4)
        if 0 < is_rotten.sum() < len(is_rotten) else None,
        "per_class_recall": recall,
        "weakest": {"class": weak, "recall": scored[weak]},
    }


def balanced_subset(y_true, per_class=70, seed=42):
    """Indices for the 70-per-class protocol of scripts/build_eval.py: per class,
    files in sorted order, random.Random(42).shuffle, keep the first 70."""
    import random
    y_true = np.asarray(y_true)
    idx = []
    for c in np.unique(y_true):
        pool = list(np.flatnonzero(y_true == c))
        random.Random(seed).shuffle(pool)
        idx += pool[:per_class]
    return np.sort(np.array(idx, dtype=int))


def load_json(name, default=None, models_dir: Path | None = None):
    p = (models_dir or MODELS_DIR) / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def headline(models_dir: Path | None = None) -> dict:
    """The numbers the README and decks should quote, read from models/*.json."""
    md = models_dir or MODELS_DIR
    summary = load_json("training_summary.json", {}, md)
    ev = load_json("eval.json", {}, md)
    mnv2 = summary.get("mobilenetv2_tl", {})
    return {
        "mobilenetv2_test_accuracy": mnv2.get("test_accuracy"),
        "auc_fresh_vs_rotten": (ev.get("roc") or {}).get("auc"),
        "weakest_class": ev.get("weak"),
        "transformer": load_json("transformer_compare.json", None, md),
    }

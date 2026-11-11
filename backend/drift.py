"""Monthly drift monitor for the grading model.

There are no labels in production, so we watch the two signals we do have:
  1. confidence: the share of scans below CONF_TAU (the model hesitating more
     usually means new lighting, a new camera or a new supplier);
  2. class mix: how far the predicted produce/tier mix moved from the baseline
     (PSI). A new mix can land on classes we are weak on.
Each month is compared to the first BASELINE_MONTHS. An alert fires at a set ratio
and the report says what to do about it.

    python backend/drift.py                 # reads models/scans.db
    python backend/drift.py --demo          # synthetic year with drift injected
"""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

CONF_TAU = 0.70          # same abstain threshold as the pipeline
RATIO_ALERT = 1.5        # low-confidence share >= 1.5x baseline
PSI_ALERT = 0.20         # common rule of thumb: >0.2 is a real shift
BASELINE_MONTHS = 3
MIN_SCANS = 30           # fewer scans than this in a month: report, do not alert
WEAK_CLASS = "bell pepper"
DB = Path(__file__).resolve().parent.parent / "models" / "scans.db"


def psi(base: dict, cur: dict, eps: float = 1e-4) -> float:
    """Population stability index between two count dicts."""
    keys = sorted(set(base) | set(cur))
    b = np.array([base.get(k, 0) for k in keys], float)
    c = np.array([cur.get(k, 0) for k in keys], float)
    if b.sum() == 0 or c.sum() == 0:
        return 0.0
    b = np.clip(b / b.sum(), eps, None)
    c = np.clip(c / c.sum(), eps, None)
    return float(((c - b) * np.log(c / b)).sum())


def _month(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m")


def drift_report(rows, *, ratio_alert=RATIO_ALERT, psi_alert=PSI_ALERT,
                 baseline_months=BASELINE_MONTHS, conf_tau=CONF_TAU) -> dict:
    """rows: iterable of (ts, fruit, tier, confidence)."""
    months: dict[str, list] = {}
    for ts, fruit, tier, conf in rows:
        months.setdefault(_month(ts), []).append((fruit, tier, float(conf)))
    keys = sorted(months)
    if len(keys) <= baseline_months:
        return {"months": [], "alerts": [], "baseline": None,
                "action": f"Need more than {baseline_months} months of scans to set a baseline."}

    def stats(items):
        conf = np.array([c for _, _, c in items])
        mix: dict[str, int] = {}
        for fruit, tier, _ in items:
            k = f"{fruit}:{tier}"
            mix[k] = mix.get(k, 0) + 1
        return {"n": len(items), "low_conf": float((conf < conf_tau).mean()),
                "mean_conf": float(conf.mean()), "mix": mix}

    base_items = [r for k in keys[:baseline_months] for r in months[k]]
    base = stats(base_items)
    base_low = max(base["low_conf"], 1e-3)
    out, alerts = [], []
    for k in keys:
        s = stats(months[k])
        ratio = s["low_conf"] / base_low
        p = psi(base["mix"], s["mix"])
        in_base = k in keys[:baseline_months]
        enough = s["n"] >= MIN_SCANS
        conf_flag = not in_base and enough and ratio >= ratio_alert
        mix_flag = not in_base and enough and p >= psi_alert
        out.append({"month": k, "scans": s["n"], "mean_conf": round(s["mean_conf"], 3),
                    "low_conf_share": round(s["low_conf"], 3), "low_conf_ratio": round(ratio, 2),
                    "psi": round(p, 3), "confidence_drift": conf_flag, "mix_drift": mix_flag})
        if conf_flag or mix_flag:
            alerts.append({"month": k, "low_conf_ratio": round(ratio, 2), "psi": round(p, 3),
                           "kind": [n for n, f in (("confidence", conf_flag), ("mix", mix_flag)) if f],
                           "top_shift": _top_shift(base["mix"], s["mix"])})
    return {"threshold": {"low_conf_ratio": ratio_alert, "psi": psi_alert, "conf_tau": conf_tau},
            "baseline": {"months": keys[:baseline_months], "scans": base["n"],
                         "low_conf_share": round(base["low_conf"], 3)},
            "months": out, "alerts": alerts, "action": recommend(alerts)}


def _top_shift(base: dict, cur: dict) -> str:
    bt, ct = sum(base.values()) or 1, sum(cur.values()) or 1
    keys = set(base) | set(cur)
    k = max(keys, key=lambda x: abs(cur.get(x, 0) / ct - base.get(x, 0) / bt))
    fruit, tier = k.split(":")
    fruit = "bell pepper" if fruit == "bellpepper" else fruit
    return f"{fruit} graded {tier.replace('_', ' ')} went from {base.get(k, 0) / bt:.0%} to {cur.get(k, 0) / ct:.0%} of scans"


def recommend(alerts: list) -> str:
    if not alerts:
        return "Stable: confidence and produce mix are within limits. Keep the current model."
    last = alerts[-1]
    parts = []
    if "confidence" in last["kind"]:
        parts.append(f"Low-confidence scans are {last['low_conf_ratio']}x baseline in {last['month']}. "
                     "Check the camera and lighting first, then relabel the review queue and fine-tune on it.")
    if "mix" in last["kind"]:
        weak = " It includes bell pepper, our weakest class: spot-check rejects by hand." \
            if WEAK_CLASS in last["top_shift"] else ""
        parts.append(f"The produce mix moved (PSI {last['psi']}; {last['top_shift']}). "
                     f"Re-check per-class recall on the new mix before trusting auto-rejects.{weak}")
    return " ".join(parts)


def load_rows(db: Path = DB):
    if not db.exists():
        return []
    with sqlite3.connect(db) as c:
        return c.execute("SELECT ts, fruit, tier, confidence FROM scans ORDER BY ts").fetchall()


def synthetic_rows(months=12, per_month=400, drift_from=9, seed=0):
    """A clean baseline, then from month `drift_from` dimmer light (lower confidence)
    and a supplier change (much more bell pepper)."""
    rng = np.random.default_rng(seed)
    fruits = ["apple", "banana", "orange", "tomato", "bellpepper", "mango"]
    rows = []
    for m in range(months):
        drifted = m >= drift_from
        p = np.array([.25, .2, .2, .2, .05, .1]) if not drifted else np.array([.15, .15, .15, .15, .3, .1])
        start = datetime(2026 + m // 12, 1 + m % 12, 1, tzinfo=timezone.utc).timestamp()
        for i in range(per_month):
            conf = float(np.clip(rng.beta(9, 1.2) - (0.12 if drifted else 0), 0, 1))
            tier = rng.choice(["fresh", "sell_soon", "reject"], p=[.75, .15, .10])
            rows.append((start + i * 3600, str(rng.choice(fruits, p=p)), str(tier), conf))
    return rows


def to_markdown(rep: dict) -> str:
    lines = ["# FreshGuard drift report", "", f"**{rep['action']}**", ""]
    if rep["baseline"]:
        lines += ["| Month | Scans | Mean conf | Low-conf share | x baseline | PSI | |", "|---|---:|---:|---:|---:|---:|---|"]
        for r in rep["months"]:
            flag = ", ".join(n for n, f in (("CONFIDENCE", r["confidence_drift"]), ("MIX", r["mix_drift"])) if f)
            lines.append(f"| {r['month']} | {r['scans']} | {r['mean_conf']} | {r['low_conf_share']} | "
                         f"{r['low_conf_ratio']} | {r['psi']} | {flag} |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Monthly drift report for the FreshGuard grader.")
    ap.add_argument("--demo", action="store_true", help="use a synthetic year with drift injected")
    ap.add_argument("--out", default=None, help="write a markdown report here")
    a = ap.parse_args(argv)
    rep = drift_report(synthetic_rows() if a.demo else load_rows())
    print(rep["action"])
    print(f"{len(rep['alerts'])} alert(s)")
    if a.out:
        Path(a.out).write_text(to_markdown(rep), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

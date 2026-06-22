"""Lightweight SQLite log of graded items, so the dashboard can show real
session history/trends instead of only the simulated forecast. Best-effort:
any DB error is swallowed so it can never break the live demo."""
import sqlite3
import time
import threading
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "models" / "scans.db"
_lock = threading.Lock()


def _conn():
    c = sqlite3.connect(DB, check_same_thread=False)
    c.execute("""CREATE TABLE IF NOT EXISTS scans
                 (ts REAL, fruit TEXT, tier TEXT, confidence REAL,
                  rotten_prob REAL, recovered REAL)""")
    return c


def log_scan(fruit, tier, confidence, rotten_prob, recovered):
    if tier not in ("fresh", "sell_soon", "reject"):
        return
    try:
        with _lock, _conn() as c:
            c.execute("INSERT INTO scans VALUES (?,?,?,?,?,?)",
                      (time.time(), fruit, tier, float(confidence or 0),
                       float(rotten_prob or 0), float(recovered or 0)))
    except Exception:
        pass


def recent_stats(days: int = 7) -> dict:
    rows = []
    try:
        with _lock, _conn() as c:
            cutoff = time.time() - days * 86400
            rows = c.execute(
                "SELECT fruit, tier, recovered FROM scans WHERE ts>=?",
                (cutoff,)).fetchall()
    except Exception:
        rows = []
    by_tier, by_fruit, recovered = {}, {}, 0.0
    for fruit, tier, rec in rows:
        by_tier[tier] = by_tier.get(tier, 0) + 1
        by_fruit[fruit] = by_fruit.get(fruit, 0) + 1
        recovered += rec or 0
    return {"days": days, "total": len(rows), "by_tier": by_tier,
            "by_fruit": by_fruit, "recovered_eur": round(recovered, 2)}


def all_rows():
    try:
        with _lock, _conn() as c:
            return c.execute("SELECT ts, fruit, tier, confidence, rotten_prob, recovered "
                             "FROM scans ORDER BY ts").fetchall()
    except Exception:
        return []

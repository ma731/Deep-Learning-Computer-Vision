"""Seed a realistic demo week of graded items so the Manager dashboard,
compliance/ROI cards, recovered-€, and the active-learning Review queue all come
alive on first open (a fresh scans.db otherwise reads zero everywhere).

Run from the repo root:
    python scripts/seed_demo.py            # wipe + reseed a clean demo week
    python scripts/seed_demo.py --append   # add the demo week without wiping
    python scripts/seed_demo.py --days 14  # span more days

Idempotent by default: it clears the scans table and review queue first, then
writes a freshly generated week. Real scans you log afterwards just accumulate
on top. The numbers are synthetic but internally consistent with the live
pricing/recovery logic in backend/pipeline.py."""
import argparse
import json
import random
import shutil
import sqlite3
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DB = REPO / "models" / "scans.db"
REVIEW_LOG = REPO / "models" / "review_queue.jsonl"
REVIEW_DIR = REPO / "data" / "review_queue"
TEST_DIR = REPO / "data" / "dataset" / "test"

# Mirror of backend/pipeline.py so the seeded recovered-€ matches the live math.
UNIT_PRICE = {
    "apple": 0.40, "banana": 0.25, "orange": 0.50, "carrot": 0.15,
    "tomato": 0.30, "potato": 0.20, "cucumber": 0.45, "bellpepper": 0.60,
    "mango": 0.90, "strawberry": 1.80,
}
RECOVERY_RATE = 0.60

# Relative throughput per produce (busy supermarket: bananas/apples move most).
POPULARITY = {
    "banana": 1.0, "apple": 0.95, "tomato": 0.8, "orange": 0.7, "potato": 0.65,
    "carrot": 0.6, "cucumber": 0.45, "bellpepper": 0.4, "mango": 0.35,
    "strawberry": 0.3,
}
# Tier mix per produce — perishables skew toward sell_soon/reject.
PERISHABLE = {"strawberry", "mango", "banana", "tomato"}


def recovered_value(tier: str, fruit: str) -> float:
    if tier == "sell_soon":
        return round(UNIT_PRICE.get(fruit, 0.30) * RECOVERY_RATE, 2)
    return 0.0


def pick_tier(fruit: str) -> str:
    """Weighted fresh / sell_soon / reject draw; perishables decay faster."""
    if fruit in PERISHABLE:
        weights = (0.58, 0.27, 0.15)
    else:
        weights = (0.74, 0.18, 0.08)
    return random.choices(("fresh", "sell_soon", "reject"), weights=weights)[0]


def grade_numbers(tier: str):
    """Plausible (confidence, rotten_prob) for a settled grade in this tier."""
    if tier == "fresh":
        return round(random.uniform(0.86, 0.99), 3), round(random.uniform(0.02, 0.18), 3)
    if tier == "sell_soon":
        return round(random.uniform(0.70, 0.90), 3), round(random.uniform(0.45, 0.68), 3)
    return round(random.uniform(0.80, 0.97), 3), round(random.uniform(0.78, 0.98), 3)


def hour_weight(hour: int) -> float:
    """Store traffic curve: morning restock + lunch + evening peaks."""
    return {7: .3, 8: .8, 9: 1.0, 10: .9, 11: .8, 12: 1.0, 13: .9, 14: .6,
            15: .5, 16: .7, 17: 1.0, 18: 1.0, 19: .8, 20: .5, 21: .3}.get(hour, 0.05)


def seed_scans(conn, days: int, per_day: int):
    fruits = list(POPULARITY)
    fweights = [POPULARITY[f] for f in fruits]
    now = time.time()
    rows, total_recovered = [], 0.0
    for d in range(days):
        # gentle day-to-day variation in volume (±25%)
        n = int(per_day * random.uniform(0.75, 1.25))
        day_start = now - (days - 1 - d) * 86400
        midnight = day_start - (day_start % 86400)
        for _ in range(n):
            hour = random.choices(range(24), weights=[hour_weight(h) for h in range(24)])[0]
            ts = midnight + hour * 3600 + random.uniform(0, 3600)
            if ts > now:
                continue
            fruit = random.choices(fruits, weights=fweights)[0]
            tier = pick_tier(fruit)
            conf, rot = grade_numbers(tier)
            rec = recovered_value(tier, fruit)
            total_recovered += rec
            rows.append((ts, fruit, tier, conf, rot, rec))
    rows.sort(key=lambda r: r[0])
    conn.executemany("INSERT INTO scans VALUES (?,?,?,?,?,?)", rows)
    conn.commit()
    return len(rows), round(total_recovered, 2)


def seed_review_queue(n: int = 6):
    """A handful of low-confidence items the model abstained on, with real crop
    thumbnails copied from the test set so the Review tab shows pictures."""
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    # Ambiguous / borderline classes make believable abstentions.
    picks = ["rotten_banana", "rotten_mango", "rotten_strawberry",
             "rotten_tomato", "fresh_orange", "rotten_apple"][:n]
    for i, cls in enumerate(picks):
        fruit = cls.split("_", 1)[1]
        src_dir = TEST_DIR / cls
        srcs = sorted(src_dir.glob("*")) if src_dir.exists() else []
        fname = f"{fruit}_demo{i}.jpg"
        if srcs:
            shutil.copy(srcs[i % len(srcs)], REVIEW_DIR / fname)
        # tier the model *would* have guessed at low confidence
        tier_raw = "reject" if cls.startswith("rotten") else "sell_soon"
        rows.append({
            "image": fname,
            "fruit": fruit,
            "tier_raw": tier_raw,
            "confidence": round(random.uniform(0.38, 0.56), 3),
            "rotten_prob": round(random.uniform(0.45, 0.7), 3),
        })
    with open(REVIEW_LOG, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return len(rows)


def main():
    ap = argparse.ArgumentParser(description="Seed a demo week of FreshGuard scans.")
    ap.add_argument("--days", type=int, default=7, help="days of history (default 7)")
    ap.add_argument("--per-day", type=int, default=60, help="avg grades per day (default 60)")
    ap.add_argument("--append", action="store_true", help="add without wiping existing data")
    ap.add_argument("--seed", type=int, default=42, help="RNG seed for reproducibility")
    args = ap.parse_args()
    random.seed(args.seed)

    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS scans
                    (ts REAL, fruit TEXT, tier TEXT, confidence REAL,
                     rotten_prob REAL, recovered REAL)""")
    if not args.append:
        conn.execute("DELETE FROM scans")
        conn.commit()
        if REVIEW_LOG.exists():
            REVIEW_LOG.unlink()
        if REVIEW_DIR.exists():
            for p in REVIEW_DIR.glob("*.jpg"):
                p.unlink()

    n, recovered = seed_scans(conn, args.days, args.per_day)
    conn.close()
    rq = seed_review_queue()

    print(f"Seeded {n} grades across {args.days} days "
          f"({'appended' if args.append else 'fresh'}).")
    print(f"  recovered (sell-soon margin): EUR {recovered:,.2f}")
    print(f"  review queue: {rq} low-confidence items")
    print(f"  db: {DB}")
    print("Reload the app - Manager, Compliance, ROI, recovered-EUR and Review are now live.")


if __name__ == "__main__":
    main()

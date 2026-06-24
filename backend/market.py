"""Live produce market prices for the Market board.

Serves wholesale prices in EUR/kg. If a USDA Market News API key is present
(env USDA_API_KEY — free from https://mymarketnews.ams.usda.gov/), we fetch
real US terminal-market fruit & vegetable prices; otherwise we serve a
calibrated reference table. Result is cached so we never hammer upstream, and
any per-item failure falls back to the reference price for that item.
"""
import os
import time
import json
import base64
import urllib.request

# our 10 produce types: key, display name, emoji, reference wholesale EUR/kg
REFERENCE = [
    ("tomato",     "Tomato",      "\U0001F345", 2.40),
    ("apple",      "Apple",       "\U0001F34E", 1.85),
    ("banana",     "Banana",      "\U0001F34C", 1.30),
    ("orange",     "Orange",      "\U0001F34A", 1.55),
    ("strawberry", "Strawberry",  "\U0001F353", 5.40),
    ("mango",      "Mango",       "\U0001F96D", 3.80),
    ("bellpepper", "Bell pepper", "\U0001FAD1", 3.10),
    ("cucumber",   "Cucumber",    "\U0001F952", 1.40),
    ("carrot",     "Carrot",      "\U0001F955", 0.95),
    ("potato",     "Potato",      "\U0001F954", 0.80),
]

# USDA commodity label -> our key (USDA labels are upper-case)
USDA_MAP = {
    "TOMATOES": "tomato", "APPLES": "apple", "BANANAS": "banana",
    "ORANGES": "orange", "STRAWBERRIES": "strawberry", "MANGOES": "mango",
    "PEPPERS, BELL TYPE": "bellpepper", "CUCUMBERS": "cucumber",
    "CARROTS": "carrot", "POTATOES": "potato",
}

USD_PER_EUR = 0.92      # rough FX; tune as needed
LB_PER_KG = 2.20462

# USDA MARS terminal-market report slug. 2852 is a terminal market F&V report;
# adjust to the market closest to your use case once you have a key.
USDA_REPORT = os.environ.get("USDA_REPORT", "2852")
CACHE_TTL = 1800       # 30 min
_cache = {"t": 0.0, "data": None}


def _usda_prices() -> dict:
    """Best-effort fetch of real per-commodity EUR/kg from USDA. Returns {} on any issue."""
    key = os.environ.get("USDA_API_KEY")
    if not key:
        return {}
    url = f"https://marsapi.ams.usda.gov/services/v1.2/reports/{USDA_REPORT}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Basic " + base64.b64encode((key + ":").encode()).decode())
    with urllib.request.urlopen(req, timeout=8) as r:
        payload = json.load(r)
    rows = payload.get("results", payload) if isinstance(payload, dict) else payload
    acc: dict = {}
    for row in rows or []:
        k = USDA_MAP.get(str(row.get("commodity", "")).upper())
        if not k:
            continue
        raw = row.get("avg_price") or row.get("price") or row.get("mostly_high")
        try:
            usd_per_lb = float(str(raw).split("-")[0].replace("$", "").strip())
        except (TypeError, ValueError):
            continue
        acc.setdefault(k, []).append(usd_per_lb * USD_PER_EUR * LB_PER_KG)
    return {k: round(sum(v) / len(v), 2) for k, v in acc.items() if v}


def get_market_prices() -> dict:
    now = time.time()
    if _cache["data"] and now - _cache["t"] < CACHE_TTL:
        return _cache["data"]
    source = "reference"
    try:
        live = _usda_prices()
        if live:
            source = "USDA Market News"
    except Exception:
        live = {}
    items = [{"key": k, "name": n, "emoji": e, "price": live.get(k, base)}
             for (k, n, e, base) in REFERENCE]
    out = {"source": source, "items": items, "updated": int(now)}
    _cache.update(t=now, data=out)
    return out

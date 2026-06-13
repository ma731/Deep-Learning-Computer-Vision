# FreshGuard — Business Roadmap & Vision

> The MVP grades produce freshness from a camera and converts the verdict into a
> markdown decision. This doc is the **business case for where it goes** — the
> wedge, the expansion path, the moat, and the model. It's the source for the
> deck's "Business Case" and "Roadmap" slides.

---

## 1. The problem (recap, quantified)

Supermarkets lose **4–6% of produce revenue to shrink** — produce is the
worst-shrink category in the store (USDA: ~12.6% fruit, ~11.6% veg). On grocery
net margins of 2–3%, every €1 of waste avoided is worth **€30–50 of revenue** in
margin terms. A mid-size store bins **€75–120k of produce a year.**

Root cause: **detection latency.** Freshness is checked manually, subjectively,
once or twice a shift. By the time a human flags decay, the window to *sell it
at a markdown* is already gone — and the item has been accelerating the decay of
everything next to it.

**Regulatory forcing function (Spain, in force):** Law 1/2025 *prohibits*
discarding edible food and *requires* discounting or donating produce nearing
expiry, with mandatory waste-prevention plans for stores >1,300 m². EU CSRD adds
food-waste reporting. To comply for loose produce — which has **no expiry date**
— you must *detect* condition at scale, auditably. That's infrastructure that
doesn't exist today.

## 2. The wedge — the gap nobody serves

The funded players cluster into two groups, and **both are blind to the shelf**:

| Player | What they do | The gap |
|---|---|---|
| Afresh, Freshflow | Forecast *how much to order* | Blind once produce is on the shelf |
| Wasteless | Dynamic markdowns by **expiry date** | Loose produce **has no date** to key on |
| Strella, OneThird | Upstream ripeness via **hardware** | Cost/friction; doesn't scale to every aisle |

**FreshGuard is the missing layer: software-only, phone-native, shelf-level
condition.** For loose produce, visual condition is the *only* available signal —
and we're the ones reading it. *"Afresh decides how much arrives, Wasteless
prices what has a date — FreshGuard is what's actually decaying on the shelf
right now."*

## 3. Value mechanism

Three-tier output maps directly to money:
- **Fresh** → full price.
- **Sell soon** → markdown *today* while still sellable. **This tier is the
  recovered margin** — 50–70% of price beats 0% in the bin.
- **Reject** → pull before it contaminates the display; donate if edible (Law 1/2025).
- **(Needs review** → low-confidence items abstain to a human + retrain queue.)

**Per-store unit economics:** ~€100k annual shrink. Catch 30% of decay one day
earlier, recover ~60% of price via markdown → **~€18k/store/year recovered.**
SaaS at €250/store/month = €3k/year → **~6× ROI, ~2-month payback**, plus
compliance value. A 500-store chain → **~€9M/year impact.**

---

## 4. Roadmap

### Near-term — turn the scanner into a system that *acts*
- **Close the active-learning loop.** Review-queue items → relabel → auto-retrain.
  The model improves itself per store. *(Queue already built in the MVP.)*
- **POS / electronic-shelf-label (ESL) integration** → markdowns push to the
  price tag automatically. The leap from "a tool staff use" to "a system that
  recovers margin with zero staff effort." **Biggest single value unlock.**
- **Fixed overhead cameras** on the produce display → passive 24/7 monitoring
  instead of handheld sweeps.

### Mid-term — more value from the same data
- **Shrink analytics:** which items / times / suppliers spoil most → supplier
  scorecards and smarter ordering.
- **Vertical-integrate the two models:** shelf scans feed the LSTM → demand-aware
  auto-ordering (the "Afresh layer") powered by our own ground-truth data. Vision
  model + forecast model become **one flywheel.**
- **Spoilage-% via segmentation** (SAM / U-Net) → graded markdown tiers
  (−20% vs −50%) instead of binary.

### Long-term — platform & moat
- **Whole cold chain:** distribution-center intake QC, supplier accept/reject
  dispute settlement, in-transit monitoring. Bigger contracts, longer cycles.
- **All perishables:** bakery, meat, dairy, florals — same pipeline.
- **Compliance-as-a-service:** auto-generate Law 1/2025 + EU CSRD
  waste-prevention reports from scan logs. Selling a legal obligation, not just
  an optimization.

## 5. The moat — data flywheel

Every scan, in every store, is **proprietary real-world produce imagery nobody
else has.** More stores → more data → a better freshness model → better results →
more stores. Compounding. Reinforced by **integration lock-in** (ESL/POS) and
**compliance record-keeping** switching costs. The off-the-shelf CNN is
commodity; the *accumulated real-world dataset* is the defensible asset.

## 6. Business model expansion

1. **SaaS per store** (land) — €250/store/month.
2. **Outcome-based pricing** (expand) — a % of recovered margin; aligns us with
   the customer's savings.
3. **Data products** (platform) — anonymized freshness benchmarks sold back to
   suppliers and brands.

## 7. Go-to-market

- **Beachhead:** Spanish regional grocery chains (Law 1/2025 pressure + IE-local).
  Named targets: Mercadona, Carrefour España.
- **Buyer:** Director of Fresh Operations / Sustainability officer (the latter now
  carries legal exposure). Pilot decision at regional level → short sales cycle.
- **Land:** zero-hardware pilot on staff phones, manual markdown stickers.
- **Expand:** ESL/POS integration, fixed cameras, DC intake, more categories.

## 8. Why now
- **Regulation** just made waste reduction mandatory, not optional (Spain 2025, EU CSRD).
- **Validation:** OneThird shipped in-store AI visual inspection (Jan 2026);
  Afresh raised $34M (late 2025). The category is real and funded — we're early
  to the *shelf-level, software-only* slice, not delusional.
- **Tech:** transfer learning + edge-capable CNNs make phone-native, real-time
  grading feasible with no special hardware.

---

## 9. Honest risks (own them in Q&A)
- **False rejects cost inventory.** Mitigation: tunable threshold + the abstain
  tier (AI flags, human confirms the borderline call).
- **Defensibility.** The model is commodity; the moat is the proprietary data
  flywheel + integration lock-in, not the architecture.
- **Incumbents moving down-market** (OneThird). Counter: speed, zero hardware,
  Spain-first regulatory wedge.
- **Adoption friction.** The sweep must be *faster* than today's manual check —
  why the UX (instant verdict, no data entry) is the product, not a nicety.

---
*Scope note: this is the vision. The graded MVP delivers the core scanner +
two models + dashboard. Everything past "Near-term" is deliberately roadmap, not
built — focus stays on a flawless demo.*

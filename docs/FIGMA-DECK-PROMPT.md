# FreshGuard — Figma AI Deck Prompt

Paste the block below into **Figma Slides AI** ("Generate" / sparkle icon) or **Figma Make**.
Produced by specialized agents (design · visuals · content · fact-check) → synthesized into one prompt.

## How to use
1. New **Figma Slides** file → click the **AI / Generate** (sparkle) button (or open **Figma Make**).
2. Paste the entire prompt below as one message → generate. It's self-contained (style guide + all 16 slides).
3. For the photo slides, if the AI doesn't fetch images, run each provided Unsplash query, place full-bleed, add the forest `#0e2412` 0→88% gradient scrim on the text side.
4. Set the two fonts (Fraunces headings/numbers, Hanken Grotesk body) and the 5 color styles as shared styles.
5. Do the final **one-gold-per-slide** and **ILLUSTRATIVE / PLACEHOLDER label** pass by hand — AI generators most often drop these.
6. Present at 1920×1080 (16:9).

---

```text
ROLE + GOAL
You are an expert presentation designer. Build a 16-slide, 16:9 (1920x1080) pitch deck titled "FreshGuard" for a university Deep Learning final project. Follow the GLOBAL STYLE GUIDE exactly on every slide, then build each of the 16 slides precisely as specified. The aesthetic is restrained luxury-grocer / food-hall editorial (think Harrods): premium, confident, calm, never busy and never bare. Every slide must be COMPLETE and informative — a strong LEFT hero plus a RIGHT supporting panel — with generous but anchored negative space. Keep all copy EXACTLY as written; the numbers and labels have been fact-checked and must not be altered.

==================================================
GLOBAL STYLE GUIDE (apply to ALL slides)
==================================================
CANVAS: Every slide is a fixed 1920x1080 frame, one artboard per slide, 16 total.

COLORS (use these hex values exactly):
- Forest (primary background): #0e2412 — the default full background of nearly every slide.
- Forest-2 (secondary surface): #1e3d1d — fill for the right supporting panel / inset blocks. Separate it from the background by this tonal step ONLY; never put a visible border or outline around it.
- Cream (all text and lines): #fbf6ec — headings/body at 100%; secondary and lead text at ~80% opacity; captions/kickers at ~60-72% opacity; hairlines at ~18-24% opacity.
- Gold (THE accent): #cb8815 — exactly ONE gold element per slide (one number, OR one rule, OR one kicker tick, OR one keyword). Never two.
- Gold-pop (tiny highlight only): #e6ad3a — only a sub-detail inside the same gold moment (a 4px tick, a decimal point, a live dot, one arrowhead). Counts as part of the single accent.
- Photo scrim: a linear gradient from #0e2412 at 0% opacity to #0e2412 at ~88% opacity, anchored to the text side, so cream text stays highly legible (AAA contrast) over any photo.

FONTS (two families only):
- Fraunces (display serif): all headlines, all hero numbers, and all numerals/stats. Weight 300-500, high optical size, tight tracking on large sizes. Editorial, not decorative (no swashes).
- Hanken Grotesk (sans): all body, lead lines, labels, captions, panel points, footer. Weight 400/500/600.

TYPE HIERARCHY (size / line-height / family):
- Hero Number (D1): ~300-320px / Fraunces — the single biggest element on number slides (e.g. EUR250k, 95.6%).
- Display Headline (D2): ~120-128px / Fraunces — main statement headline, max 4 lines.
- Sub-display (D3): ~84px / Fraunces — product name on title, secondary headlines.
- Section Head (H1): ~56px / Fraunces.
- Lead line: ~32px / Hanken 400 — the ONE supporting sentence under the hero.
- Kicker: ~16px / Hanken 600, UPPERCASE, +14% tracking — the eyebrow above every headline; pair it with a 4px x 64px gold rule OR a small gold tick.
- Body: ~22px / Hanken 400 — panel paragraphs.
- Panel label: ~18px / Hanken 600, UPPERCASE — the label above each right-panel point.
- Caption / footer: ~14px / Hanken 500, +4% tracking — page number, speaker, ILLUSTRATIVE / PLACEHOLDER tags.
NUMERALS: every figure (EUR250k, 48h, 95.6%, 42.7%, EUR37.5M, t=0.70) is Fraunces. Set the unit/symbol (k, M, %, h, EUR) at about half the numeral size, baseline-aligned, cream at ~72%.
HARD HIERARCHY RULE: every slide must have ONE dominant element (a hero number or headline) at least 4x larger than its next-largest text. One decisive size jump per slide — never two competing big things.

LAYOUT PATTERN (the spine of the deck): a 12-column grid, ~120px left/right margins, ~96px top / ~88px bottom. The DEFAULT layout is a 7/5 split:
- LEFT HERO = columns 1-7: kicker -> gold rule/tick -> the focal element (big number or headline) -> one lead line beneath. Vertically centered or anchored to a 1/3 line.
- RIGHT PANEL = columns 8-12: 2-3 stacked supporting points, each a PANEL-LABEL (uppercase) + a short BODY sentence, spaced ~40px apart. Separate the panel by the forest-2 tonal fill (use this method consistently deck-wide; do NOT outline it).
Exceptions: process/flow slides use a full-width centered band; cover/close slides are full-bleed photo. Snap everything to the grid and to an 8px vertical rhythm. Spacing: kicker->headline 24px; headline->lead 40px; panel point->panel point 40px; label->text 8px.

ACCENT DISCIPLINE (the anti-clutter law): ONE gold moment, ONE focal element, ONE photographic OR diagrammatic device per slide. If two things want to be gold, demote one to cream. If a slide feels busy, REMOVE something — do not rebalance.

EDITORIAL DENSITY (the anti-empty law): never ship a near-bare slide. Every content slide carries kicker + focal + lead line on the LEFT and 2-3 concrete points on the RIGHT. A headline-only slide reads as unfinished. But never exceed 3 panel points or 4 headline lines.

SHAPE LANGUAGE: 0px corner radius everywhere (architectural). Hairlines only (1px cream 18-24%) or a single 4px x 64px gold rule as a kicker accent. NO boxes around text, NO cards-on-cards, NO drop shadows, NO glows, NO gradients except photo scrims, NO decorative vector scenery or clip-art. Icons (if any) are thin 1.5px cream line icons, max one per panel point, inline with their label, never filled or colored except the single gold accent.

IMAGERY RULE: use real, moody, premium produce/retail PHOTOGRAPHY full-bleed ONLY on slides 1, 2, 3, 9, 13, 14, 16 (and a faint ghosted texture on 5). All data/architecture slides (4, 6, 7, 8, 10, 11, 12, 15) are solid forest #0e2412 — type and diagrams do the work; never put a photo behind a chart. Every photo gets the forest-tinted scrim anchored to the text side so cream text holds AAA contrast. Photo mood: dark, warm-but-desaturated market-stall produce, shallow depth of field, Harrods-grade — never a bright supermarket flyer. For each photo slide I give an Unsplash search query; source a matching image.

FOOTER: every slide EXCEPT 1 and 16 carries a 3-part footer on a baseline near y:1024, above a hairline divider (cream 18%). Left: "FreshGuard" (Fraunces ~20px cream). Center: the slide topic (caption, cream 72%). Right: the slide number e.g. "03 / 16" (caption). Footer is cream, never gold unless it is the slide's only accent.

ACCURACY / HONESTY LABELS (mandatory, fact-checked — render these exactly):
- Every euro figure (EUR250k, EUR37.5k, EUR37.5M, the 15%) carries a small 14px cream-72% "ILLUSTRATIVE" tag directly under/beside the number.
- The ANN ~58% and CNN ~84% accuracies carry a 14px "PLACEHOLDER - pending notebook-02" tag, rendered so they cannot be mistaken for measured results.
- The 95.6% figure carries a small 14px cream-72% qualifier "Reported on held-out test set - pending final notebook export" (do NOT present it as more verified than the placeholders; its authority comes from the size/contrast, but it still gets this honest qualifier).
- The forecast figure must read "reduces MAE by 42.7% vs a seasonal-naive baseline" (lower error is better) and carries the same 14px "ILLUSTRATIVE - pending forecast notebook" tag.

==================================================
THE 16 SLIDES
==================================================

SLIDE 1 — TITLE (full-bleed photo, no footer)
Section: Title. Layout: full-bleed produce photography, bottom-left-anchored scrim.
Imagery: full-bleed luxury food-hall produce display, elevated slightly-overhead angle (echoes a ceiling camera), glossy peppers/citrus/leafy greens in dark crates under warm directional light. Forest-tinted scrim heaviest at bottom-left (~90%) fading up-right (~25%) so the lower-left holds text. Unsplash query: "luxury grocery produce display dark moody".
LEFT/lower-third content:
- Kicker: DEEP LEARNING - FINAL PROJECT
- Below kicker: the single 4px x 64px GOLD rule (this is slide 1's only gold).
- Product name (D3, ~84px Fraunces, cream): FreshGuard
- Lead (32px): AI produce freshness quality-control, watching every aisle from the ceiling.
- Bottom strip caption: 5 speakers - Deep Learning final project
Speaker: Marco Ortiz Togashi.

SLIDE 2 — PROBLEM (full-bleed photo, hero-number A)
Section: The Problem. Layout: full-bleed photo with heavy scrim on LEFT third; hero number over the dark left, spoiled produce visible right two-thirds.
Imagery: wilting/bruised produce or a half-empty end-of-day produce bin; desaturated, shadows pushed toward forest. Unsplash query: "bruised wilted produce market waste".
LEFT hero:
- Kicker: THE PROBLEM (with gold tick OR set the hero number as the gold — choose the EUR250k numeral as gold; kicker tick stays cream).
- Hero number (D1, GOLD): EUR250k  [tag directly beneath, 14px cream-72%: ILLUSTRATIVE]
- Lead (32px): Shrink per store, per year — produce is the #1 grocery shrink category (illustrative).
- Headline note above/near hero (H1 cream): Produce is where grocery margin quietly dies.
RIGHT panel (forest-2, 3 points):
- SPOILAGE OUTPACES STAFF / Produce spoils faster than anyone can manually track it.
- INSPECTION DOESN'T SCALE / Staff can't re-inspect thousands of items several times a day.
- LOSS IS INVISIBLE / By the time waste is visible, the margin is already gone.
Footer center: The Problem. Right: 02 / 16.
Speaker: Marco Ortiz Togashi.

SLIDE 3 — REGULATION + TIMING (photo as textured band, statement-headline B)
Section: Problem. Layout: imagery as a textured left/background band; forest scrim over the right panel; the 48h figure dominates.
Imagery: close low-light macro of ripening tomatoes/stone fruit (the ticking sell-soon clock); strong negative space. Unsplash query: "ripening tomatoes macro low light".
LEFT hero:
- Kicker: REGULATION + TIMING
- Headline (D2): The law now penalises non-compliance — and you have 48 hours.
- Hero figure (the slide's GOLD, large Fraunces): 48h
- Lead (32px): Spain's Ley 1/2025 imposes waste-prevention and donation-hierarchy duties with sanctions for non-compliance; the ~48h sell-soon window is where margin is recovered.
RIGHT panel (3 points):
- LEY 1/2025 / Imposes waste-prevention and donation obligations on retailers, with sanctions for non-compliance.
- THE 48H WINDOW / The ~48h sell-soon window is the moment to recover value.
- ACT IN TIME / Sell at markdown inside the window instead of writing it off.
Footer center: Regulation + Timing. Right: 03 / 16.
Speaker: Yaxin Wu.

SLIDE 4 — SOLUTION (solid forest, statement-headline B)
Section: The Solution. Layout: 7/5, no photo, solid forest.
LEFT hero:
- Kicker: THE SOLUTION (gold tick).
- Headline (D2, with ONE gold word — set "graded" in gold): One camera. Every item graded. Every decision made.
- Lead (32px): FreshGuard sees the aisle, grades each item, and drives the markdown and reorder.
RIGHT panel (3 points):
- DETECT + TRACK / Detect and track every fruit and vegetable in the aisle.
- GRADE IN REAL TIME / Grade each item Fresh / Sell-soon / Reject, live.
- ACT BEFORE LOSS / Trigger the right markdown and reorder before value is lost.
Footer center: The Solution. Right: 04 / 16.
Speaker: Yaxin Wu.

SLIDE 5 — HOW IT WORKS / 2-STAGE CV (process band C, faint photo texture)
Section: How it works. Layout: full-width centered flow band; kicker + H1 top-left above it.
Imagery: OPTIONAL faint background texture only (~8-12% opacity over forest) of a ceiling-mounted retail camera looking down an aisle; keep it ghosted so the cream-stroke diagram is the focus. Unsplash query: "ceiling security camera retail aisle overhead".
Top-left: Kicker HOW IT WORKS; H1 headline: A two-stage computer vision pipeline. Lead (32px): First find every item, then judge its freshness — one feeds the other.
CENTER BAND — two cream-stroke pill nodes (0 radius, no fill) connected by a thin 1.5px cream connector with a small GOLD arrowhead (the connector arrow is the slide's only gold):
- Node 01 — DETECT + TRACK: YOLOv8n detects, ByteTrack follows each item across frames.
- Node 02 — CLASSIFY + GRADE: MobileNetV2 grades freshness per tracked item.
Below band, one BODY line: Tracking means each item is judged consistently, not frame by frame.
Footer center: How It Works. Right: 05 / 16.
Speaker: Jorge Vildoso.

SLIDE 6 — ABLATION 1/3: ANN (solid forest, comparison ladder D)
Section: Models. Layout: LEFT kicker+H1+body (cols 1-6); RIGHT a vertical 3-rung accuracy ladder (thin 1px cream-outline bars, fill height = accuracy). Keep the ladder in the SAME screen position on slides 6, 7, 8.
LEFT:
- Kicker: ABLATION - 1 OF 3
- H1: The baseline: a plain neural network can't see.
- Body (22px): An ANN flattens the image to pixels and loses all spatial structure.
- Lead/qualifier: placeholder, pending notebook-02.
RIGHT ladder: ANN rung filled to ~58%, rendered as the active/low rung in MUTED gold to signal "weak", with a value label ~58% (Fraunces) and the tag PLACEHOLDER - pending notebook-02 (14px). CNN (~84%) and MobileNetV2 (95.6%) rungs are shown faint/cream as upcoming.
Supporting points:
- Flattening throws away geometry — where a bruise sits stops mattering.
- Weak on images by design; this is the floor, not the goal.
- Establishes why vision needs more than dense layers.
Footer center: Ablation - ANN. Right: 06 / 16.
Speaker: Jorge Vildoso.

SLIDE 7 — ABLATION 2/3: CNN (solid forest, comparison ladder D)
Section: Models. Same ladder position as slide 6.
LEFT:
- Kicker: ABLATION - 2 OF 3
- H1: A CNN keeps the geometry — but it's data-hungry.
- Body: Convolutions preserve spatial structure and jump well above the baseline.
- Qualifier: placeholder, pending notebook-02.
RIGHT ladder: ANN rung stays cream/muted at ~58%; CNN rung now the active rung in muted gold filled to ~84%, value label ~84% (Fraunces) with tag PLACEHOLDER - pending notebook-02; MobileNetV2 rung still faint.
Supporting points:
- Convolutions read texture and shape, not just isolated pixels.
- Big gain over the ANN — geometry is exactly what freshness lives in.
- Trained from scratch it needs far more data to keep climbing.
Footer center: Ablation - CNN. Right: 07 / 16.
Speaker: BigBossBass.

SLIDE 8 — ABLATION 3/3: THE WINNER (solid forest, hero-number A; the loudest gold)
Section: Models. The winning rung promotes to the D1 hero number. Keep all three rungs visible together so the climb reads instantly.
LEFT hero:
- Kicker: ABLATION - 3 OF 3 - THE WINNER
- 4px x 64px GOLD rule under kicker.
- Hero number (D1, the deck's loudest GOLD moment): 95.6%  [qualifier directly beneath, 14px cream-72%: Reported on held-out test set - pending final notebook export]
- Headline (H1 cream): Transfer learning wins.
- Lead (32px): MobileNetV2 transfer learning, top-1 across 20 classes (10 produce types x fresh/rotten).
RIGHT panel (3 points):
- BORROWED KNOWLEDGE / Borrows visual knowledge from millions of images, then specialises.
- THE RESULT / 95.6% top-1 — report per-class precision/recall on the held-out test set.
- 20 CLASSES / 10 produce types, each fresh vs rotten. (Note: the 3-tier business grade Fresh/Sell-soon/Reject is derived from the rotten-probability via a calibrated confidence threshold — it is not a native class.)
Also keep the small ANN ~58% (placeholder) and CNN ~84% (placeholder) rungs visible cream in the same ladder position so the gold 95.6% rung is obviously the tallest.
Footer center: Ablation - The Winner. Right: 08 / 16.
Speaker: BigBossBass.

SLIDE 9 — EXPLAINABILITY / GRAD-CAM (photo, evidence split E)
Section: Trust. Layout: LEFT (cols 1-7) the visual evidence image full-height; RIGHT (cols 8-12) kicker + H1 + 2-3 body points. Scrim on the image's right edge so it marries the panel.
Imagery: a single clean studio macro of one fruit (apple/pear) with a visible bruise on dark forest ground, lots of negative space; render a Grad-CAM heatmap overlay treatment — warm GOLD/amber heat concentrated ON the bruise, cool/transparent elsewhere (the heat blob is the slide's only gold). Unsplash query: "single apple bruise macro dark background".
RIGHT:
- Kicker: EXPLAINABILITY
- H1: Heat on the bruise, not the background.
- Lead (32px): Grad-CAM shows exactly what the model looked at to make its call.
- Points:
  - PROOF, NOT GUESSWORK / Visual proof the model grades the produce, not the lighting or shelf.
  - TRUST FOR MANAGERS / Turns a black-box score into something a store manager can trust.
  - LEGIBLE FAILURES / You can see when it looks at the wrong thing.
Footer center: Explainability. Right: 09 / 16.
Speaker: Batao.

SLIDE 10 — RELIABILITY + DATA FLYWHEEL (solid forest, process/flywheel C)
Section: Trust. Layout: LEFT kicker + headline + hero value; RIGHT or center a simple 4-step circular arrow loop (thin cream strokes), gold only on the t node.
LEFT hero:
- Kicker: RELIABILITY + DATA FLYWHEEL
- Hero value (Fraunces, the slide's GOLD): t=0.70
- Headline (H1 cream): When unsure, it asks — and gets smarter.
- Lead (32px): A confidence gate abstains below threshold and routes hard cases to a review queue.
RIGHT flywheel: a single thin GOLD circular arrow loop with 4 labeled stops (scan -> abstain at t=0.70 -> human review -> retrain); gold only on the t stop, the rest cream.
Supporting points (3):
- ABSTAIN, DON'T GUESS / Below t=0.70 the model abstains instead of guessing.
- REVIEW QUEUE / Uncertain items go to an active-learning review queue.
- THE FLYWHEEL / Every reviewed item retrains the model.
Footer center: Reliability + Flywheel. Right: 10 / 16.
Speaker: Batao.

SLIDE 11 — FORECAST / RNN-LSTM (solid forest, hero-number A + clean line chart)
Section: Forecast. Layout: LEFT hero number; RIGHT an axis-light line chart.
LEFT hero:
- Kicker: DEMAND + SPOILAGE - RNN/LSTM
- Hero number (D1, the slide's GOLD): 42.7%  [render as "42.7% lower MAE"; tag beneath 14px cream-72%: ILLUSTRATIVE - pending forecast notebook]
- Headline (H1 cream): It doesn't just grade today — it forecasts the week.
- Lead (32px): An LSTM turns 28 days of history into a 7-day forecast, reducing MAE by 42.7% vs a seasonal-naive baseline (on held-out data).
RIGHT chart (editorial, no gridlines, single cream-20% baseline hairline): 28-day history in cream ~40%, a thin vertical "today" hairline, 7-day forecast in GOLD, the naive baseline as a dashed cream-25% ghost line; annotate once near the gap in Fraunces: "-42.7% MAE vs naive". Below the chart, small Hanken cream-stroke pills: holidays, end-of-month, summer.
Supporting points (compact):
- 28-day window in, 7-day demand-and-spoilage forecast out.
- Spanish-calendar features: national holidays, end-of-month markdowns, summer volatility.
- Live scans feed the forecast — it stays current with the shelf.
Footer center: Forecast - LSTM. Right: 11 / 16.
Speaker: Yaxin Wu.

SLIDE 12 — SYSTEM / INTEGRATION (solid forest, one-system diagram B/C)
Section: System. Layout: LEFT kicker + headline + lead; RIGHT/center a single left-to-right "one system" spine of max 5 cream-stroke pill nodes (no fills/shadows), connected by thin cream arrows, with the central node in GOLD.
LEFT:
- Kicker: INTEGRATION
- Headline (D2): Four model families, one working system.
- Lead (32px): Vision, explainability, the confidence gate, and the forecast operate as a single loop.
DIAGRAM spine: camera -> CV grade (GOLD central node) -> confidence gate -> markdown / reorder, with the forecast feeding in from below into the spine. Gold only on the central CV-grade node.
Supporting points (3):
- HONEST BY DESIGN / Camera grades items; Grad-CAM and the gate keep it honest.
- FORECAST-DRIVEN ORDERING / Scans feed the LSTM; the forecast shapes ordering.
- CLOSED LOOP / The review queue retrains everything — not a demo.
Footer center: Integration. Right: 12 / 16.
Speaker: Jorge Vildoso.

SLIDE 13 — PRODUCT / GRADE TO DECISION (photo, evidence split E, grade chips)
Section: Product. Layout: photo right-anchored or full-bleed with forest scrim on the LEFT for the grade->action explanation and three grade chips.
Imagery: a produce shelf with a price/markdown shelf-edge label, warm and premium; ideally a hand placing a markdown sticker — the moment of decision. Unsplash query: "grocery price tag produce shelf label".
LEFT:
- Kicker: THE PRODUCT
- Headline (D2): From a grade to a decision, on the shelf.
- Lead (32px): Each grade becomes a concrete markdown and reorder action — automatically.
- THREE GRADE CHIPS (flat pills, 0 radius, no shadow), only "Sell-soon" in GOLD (the margin moment), the other two cream:
  - FRESH (cream stroke) -> keep at full price and reorder on schedule.
  - SELL-SOON (GOLD) -> mark down now, inside the 48h window.
  - REJECT (cream 40%, dimmed) -> pull from sale and trigger replenishment.
Footer center: The Product. Right: 13 / 16.
Speaker: Marco Ortiz Togashi.

SLIDE 14 — BUSINESS CASE (photo, hero-number A, typographic step-up)
Section: Business. Layout: wide establishing photo with strong forest scrim across the lower band; a typographic step-up sits on the darkness.
Imagery: a wide aspirational upscale supermarket produce-hall interior implying 1,000-store scale, warm light. Unsplash query: "upscale supermarket interior produce hall wide".
LEFT/lower hero:
- Kicker: THE BUSINESS CASE
- Headline (H1 cream): Recover 15% of shrink — then multiply by every store.
- Typographic STEP-UP (sizes escalating left to right, the final EUR37.5M is the slide's GOLD): EUR250k -> EUR37.5k / store -> EUR37.5M
- One caption directly beneath the figures (14px cream-60%): ILLUSTRATIVE - assumption-based worked example.
- Lead (32px): ~EUR37.5k recovered per store scales to ~EUR37.5M across a 1,000-store chain (illustrative).
RIGHT panel (3 points, each carrying its illustrative tag inline):
- PER STORE (ILLUSTRATIVE) / ~EUR250k shrink/store/yr, recover ~15% = ~EUR37.5k/store.
- CHAIN-WIDE (ILLUSTRATIVE) / x1,000 stores ~ EUR37.5M recovered.
- VALUE + RISK / Plus compliance advantage under Ley 1/2025 — value and risk, together.
Footer center: The Business Case. Right: 14 / 16.
Speaker: Marco Ortiz Togashi.

SLIDE 15 — WHY US / RUBRIC COVERAGE (solid forest, statement-headline B + checklist)
Section: Why us. Layout: 7/5, no photo.
LEFT hero:
- Kicker: RUBRIC COVERAGE
- Hero (D1 or large, the slide's GOLD): 100%
- Headline (H1 cream): Every requirement, demonstrated — not claimed.
- Lead (32px): ANN, CNN, RNN, computer vision, a frontend, and a live demo — all present and working.
RIGHT panel — a checklist of rubric rows (thin 1.5px cream check icons); make the single signature row (live demo) the one emphasised row (still cream — gold is spent on the 100%):
- ANN + CNN + transfer learning shown as a real ablation.
- RNN/LSTM forecast + Grad-CAM explainability + confidence gate.
- Live frontend demo grading produce end to end. (signature move)
Footer center: Rubric Coverage. Right: 15 / 16.
Speaker: Marco Ortiz Togashi.

SLIDE 16 — CLOSE / TEAM + LIVE DEMO (full-bleed photo, no footer)
Section: Close. Layout: full-bleed produce photo (a different crop/angle from slide 1), even forest scrim from the bottom up; text hugs the lower third. LEFT D2 CTA headline; RIGHT panel = 5 team names as panel-label rows.
Imagery: abundant, beautifully lit, inviting food-hall produce scene signalling resolution and abundance. Unsplash query: "abundant fresh produce market warm light".
LEFT:
- Kicker: TEAM + LIVE DEMO
- Headline (D2, with one gold word "live"): Let's watch it grade the aisle, live.
- Lead (32px): Five of us built FreshGuard — now see it work in real time.
RIGHT panel — 5 team rows (PANEL-LABEL names + role captions); the coordinator tagged in GOLD (the slide's only gold):
- Marco Ortiz Togashi — Coordinator (GOLD)
- Yaxin Wu
- Jorge Vildoso
- BigBossBass
- Batao
Closing caption line: Live demo: detect, track, grade, and decide on real produce. FreshGuard — freshness, graded automatically.
No footer.
Speaker: Marco Ortiz Togashi.

==================================================
FINAL CHECK BEFORE YOU FINISH
==================================================
- Audit each slide: exactly ONE gold element. If you can point to two, demote one to cream.
- Audit each slide: ONE focal element at least 4x its next-largest text.
- Audit each slide: not empty (kicker + focal + lead + 2-3 panel points) and not cluttered (max 3 panel points, max 4 headline lines, no boxes, no decorative vectors).
- Photography only on slides 1, 2, 3, 9, 13, 14, 16 (faint texture on 5); all others solid forest #0e2412. Never a photo behind a chart.
- Every euro figure tagged ILLUSTRATIVE; ANN/CNN tagged PLACEHOLDER - pending notebook-02; 95.6% carries its held-out-test qualifier; forecast worded as "reduces MAE by 42.7%". Numbers are Fraunces. Footer on 2-15 only.
```

> Note: ANN ~58% / CNN ~84% are placeholders — replace with notebook-02's real numbers before presenting.

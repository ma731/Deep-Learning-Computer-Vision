# FreshGuard — Cinematic Pitch Deck Plan ("Inside FreshGuard's Eye")

Master direction produced by a multi-agent workflow (3 competing concepts → judge synthesis).
Build target: **Figma Slides**, 1920×1080. Motion via **Smart Animate** (applied once in the UI;
the Plugin API cannot set transitions). The whole deck plays as ONE continuous tracking shot.

## Metaphor
The camera IS FreshGuard. Open on a Harrods-grade Food Hall aisle at dawn → dive THROUGH the
ceiling-camera lens (iris dilates) → travel inside the machine's perception as physical rooms that
ARE the architecture → pull back out into the Decision Room (the live frontend) → keep retreating
until the aisle is one lit window in a facade of 1,000 stores. A single **SUN** arcs dawn→noon→dusk
and the **SKY_GRADIENT** morphs cold-blue→gold→navy, so time-of-day light literally encodes the P&L
(cold dawn = fresh stock at full value; gold noon = the 48h sell-soon margin window; dusk = the reckoning).

## Palette / type (locked Food Hall)
Forest #0e2412 (backplate/night) + #1e3d1d (reading cards/mid scenery). Gold #cb8815 (structure/brackets)
+ #e6ad3a (the ONE number per slide, sell-soon glow, sun, data-mote, Grad-CAM rim). Cream #fbf6ec (hero word + captions).
Grade chips in-family: Fresh = light leaf-green, Sell-soon = gold #e6ad3a, **Reject = DIMMED near-black green (never alarm red)**.
Fonts: Fraunces (display, one 120–220pt hero element/slide, anchored to a rotating edge) + Hanken Grotesk (body, 18–28pt opposite the hero).
Discipline: exactly one gold number per slide; one display element per slide; generous green negative space.

## Persistent cast (BYTE-IDENTICAL name on every slide → Smart Animate tweens them)
- `STATIC_BACKPLATE` — full-bleed forest solid, never moves (motion 0).
- `SKY_GRADIENT` — full-bleed; only the FILL morphs by room/hour. The biggest "alive" element.
- `SUN` — soft gold gradient ellipse; arcs across the deck; size peaks at the noon verdict.
- `BG_Horizon` — far parallax band (0.15); morphs aisle→lens wall→feature-map horizon→1,000-window facade.
- `MID_Scenery` — workhorse mid set (0.60); metamorphoses table→iris→ANN ribbon→CNN sheets→gallery→turnstile→memory panels→facade. Scales 1.3–1.6× on dives.
- `MID_Floor` — continuous ground (0.60).
- `DOORWAY` — the lens/iris; scales past canvas + fades on hand-offs (the dive).
- `FG_Foreground` — near plane (1.10); streaks fastest, fades on push-throughs.
- `HUD_Bracket_TL/TR/BL/BR` — gold viewfinder brackets = the live lens HUD; squeeze inward to "focus" (Grad-CAM/push-in), pull wide for establishing/business shots.
- `HUD_Reticle` — crosshair + per-room readout (REC 05:00 → TRACKING → ANN → CNN → 95.6% → τ=0.70 → FORECAST → VERDICT → LIVE DEMO).
- `HERO_MARK` — "FreshGuard" wordmark; center-large at title → docks small top-left through journey → final lockup.
- `VIGNETTE` — radial dark frame; keeps copy legible; deepens at climaxes.
- `LETTERBOX_TOP/BOTTOM` — cinematic bars; grow on climax beats (dive, Grad-CAM, 95.6%, €37.5M).
- Chapter layers (opacity 0 when absent): `HEAT_BLOOM` (Grad-CAM), `Chart_Axis`+`Chart_Marker` (ablation climb), `Chart_ForecastLine` (LSTM), `Hero_Crate_Glow` (the data-mote flywheel).

## 24-slide outline (speaker)
1. Cold open — aisle at dawn, title (Marco)
2. Problem — €250k shrink/store/yr (Marco)
3. Problem — Law 1/2025 + the 48h window; push-in begins (Marco)
4. Solution in one line; wordmark docks; dive cued (Yaxin)
5. CV pipeline overview — THE DIVE through the lens (Yaxin)
6. CV Stage 1 — detect + track (YOLOv8n + ByteTrack) (Yaxin)
7. THEORY ANN — the Flatland (ablation 1/3) (Jorge)
8. THEORY CNN — the Convolutional Corridor (2/3) (Jorge)
9. THEORY Transfer — the Gallery, 95.6% (3/3) (Jorge)
10. THEORY Grad-CAM — heat on the bruise (Jorge)
11. Ops — Confidence Gate τ=0.70 + flywheel seed (BigBossBass)
12. THEORY RNN/LSTM setup — Memory Corridor, 28-day window (BigBossBass)
13. THEORY RNN/LSTM payoff — +42.7%, 7-day forecast (BigBossBass)
14. INTEGRATION — one brain, four networks (Yaxin)
15. Product — the Verdict / frontend; 48h (Batão)
16. Product — markdown + reorder ticket prints (Batão)
17. LIVE DEMO beat (Batão)
18. Business — €37.5k/store economics (Marco)
19. Business — the chain, €37.5M, 1,000-window pull-back (Marco)
20. Business — the flywheel mote arcs back to the field (BigBossBass)
21. Competitive — why us (Jorge)
22. Course coverage — rubric ledger (Yaxin)
23. Team + CTA — five windows light up (Marco)
24. Appendix (not presented) — Smart Animate instructions + reserve metrics

## Theory soundbites (presenter lines)
- ANN: "Flatten the apple and you've thrown away the one thing that makes it an apple — its shape."
- CNN: "Convolutions don't care where the bruise is — a feature learned in one corner is recognized everywhere."
- Transfer: "We didn't teach it to see — we taught a network that already sees how to recognize our shelves."
- LSTM: "The camera tells us what's on the shelf today; the LSTM remembers enough to write tomorrow's order."
- CV pipeline: "First we find and follow every piece of produce, then we look each one in the eye and grade it."
- Integration: "Every network feeds the next — one decision system, not four science-fair projects."

## Apply Smart Animate (team, in Figma UI)
1. Open the deck in Figma Slides. 2. Select the first slide, Shift+click the last (all selected).
3. Right panel → transition control. 4. Trigger: On click. 5. Animation: **Smart animate**.
6. Easing: Ease in & out (Gentle), ~700ms; override the dive (S4→5) and push-ins to ~400ms.
7. Apply (hits all transitions at once). 8. Present and arrow through — anything that JUMPS instead of
gliding has a layer-name mismatch on that slide; fix the name and it tweens.

> Full agent output (concepts, judge rationale, all speaker notes): workflow run `wf_d73a8c3b-1c5`.

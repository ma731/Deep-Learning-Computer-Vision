/* FreshGuard — "Vision Engine" hero centerpiece (Act 1).
   A living radial freshness scanner built with anime.js v4: a spectrum tick-ring
   with a rotating pulse, counter-rotating dial rings, an oscillating iris/waveform,
   and produce particles flowing along motion paths into the lens.
   Self-contained; falls back to the static hero on reduced-motion / no anime. */
(() => {
  const A = window.anime;
  const hero = document.getElementById("hero");
  if (!hero) return;
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (!A || reduced) return;   // keep the existing static hero

  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const SPEC = ["#a8ff35", "#f5b73d", "#ff5c5c", "#43e5c0"].map(hex);   // fresh→sell→reject→data
  const spec = (t) => {
    const s = t * SPEC.length, i = Math.floor(s) % SPEC.length, j = (i + 1) % SPEC.length, f = s - Math.floor(s);
    const c = [0, 1, 2].map((k) => Math.round(lerp(SPEC[i][k], SPEC[j][k], f)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  // ---- mount ----
  const wrap = document.createElement("div"); wrap.className = "hero-engine"; wrap.setAttribute("aria-hidden", "true");
  const svg = el("svg", { viewBox: "-300 -300 600 600", class: "ve-svg" });
  wrap.appendChild(svg);
  hero.insertBefore(wrap, hero.querySelector(".hero-inner"));
  const orchard = hero.querySelector(".hero-img"); if (orchard) orchard.style.opacity = ".18";

  // center glow
  const defs = el("defs"); svg.appendChild(defs);
  const grad = el("radialGradient", { id: "veGlow" });
  grad.appendChild(el("stop", { offset: "0%", "stop-color": "rgba(168,255,53,.20)" }));
  grad.appendChild(el("stop", { offset: "100%", "stop-color": "rgba(168,255,53,0)" }));
  defs.appendChild(grad);
  svg.appendChild(el("circle", { cx: 0, cy: 0, r: 230, fill: "url(#veGlow)", class: "ve-coreglow" }));

  const gTicks = el("g", { class: "ve-ticks" }); svg.appendChild(gTicks);
  const gMid = el("g", { class: "ve-mid" }); svg.appendChild(gMid);
  const gInner = el("g", { class: "ve-inner" }); svg.appendChild(gInner);
  const gWave = el("g", { class: "ve-wave" }); svg.appendChild(gWave);
  const gPaths = el("g", { class: "ve-paths" }); svg.appendChild(gPaths);
  const gDots = el("g", { class: "ve-dots" }); svg.appendChild(gDots);

  // ---- outer spectrum tick ring (each tick wrapped in a rotate-group so anime
  //      can pulse the rect's scale without clobbering the rotation) ----
  const N = 76, R = 256, ticks = [];
  for (let i = 0; i < N; i++) {
    const g = el("g", { transform: `rotate(${(i / N) * 360})` });
    const r = el("rect", { x: -1.7, y: -R, width: 3.4, height: 20, rx: 1.7, fill: spec(i / N), class: "ve-tick" });
    g.appendChild(r); gTicks.appendChild(g); ticks.push(r);
  }
  // mid dashed dial + inner ring
  gMid.appendChild(el("circle", { cx: 0, cy: 0, r: 212, fill: "none", stroke: "rgba(234,242,236,.22)", "stroke-width": 2, "stroke-dasharray": "2 12", "stroke-linecap": "round" }));
  gInner.appendChild(el("circle", { cx: 0, cy: 0, r: 168, fill: "none", stroke: "rgba(234,242,236,.10)", "stroke-width": 1 }));
  gInner.appendChild(el("circle", { cx: 0, cy: 0, r: 150, fill: "none", stroke: "rgba(67,229,192,.30)", "stroke-width": 1.5, "stroke-dasharray": "60 360", "stroke-linecap": "round", class: "ve-sweep" }));

  // ---- iris / waveform: vertical bars across an eye envelope ----
  const M = 56, span = 280, bars = [];
  for (let i = 0; i < M; i++) {
    const x = -span / 2 + (i / (M - 1)) * span;
    const env = Math.cos((i / (M - 1) - 0.5) * Math.PI);     // tall centre → pointed-oval
    const h = 14 + env * env * 150;
    const b = el("rect", { x: x - 1.4, y: -h / 2, width: 2.8, height: h, rx: 1.4, fill: i % 7 === 0 ? "#a8ff35" : "rgba(255,92,76,.85)", class: "ve-bar" });
    gWave.appendChild(b); bars.push(b);
  }

  // ---- particle motion paths (produce flowing into the lens) ----
  const PATHS = [
    "M -270 -90 C -150 -150 -60 -30 0 0",
    "M 270 80 C 150 150 60 30 0 0",
    "M -40 -280 C -10 -150 10 -70 0 0",
  ];
  PATHS.forEach((d, i) => {
    gPaths.appendChild(el("path", { d, id: `ve-path-${i}`, fill: "none", stroke: "rgba(234,242,236,.07)", "stroke-width": 1, "stroke-dasharray": "1 7" }));
  });
  const dots = [];
  PATHS.forEach((_, i) => {
    for (let k = 0; k < 3; k++) {
      const c = el("circle", { cx: 0, cy: 0, r: 3.2, fill: spec((i * 3 + k) / 9), class: `ve-dot ve-dot-${i}` });
      gDots.appendChild(c); dots.push({ c, i, k });
    }
  });

  // ---------- animate ----------
  const { animate, stagger, utils, svg: svgU } = A;

  // rotating pulse around the ring
  animate(ticks, {
    scaleY: [0.55, 1.35], opacity: [0.4, 1],
    delay: stagger(34, { from: "first" }),
    duration: 1300, loop: true, alternate: true, ease: "inOutSine",
  });
  // slow ring rotations
  animate(gTicks, { rotate: 360, duration: 48000, loop: true, ease: "linear" });
  animate(gMid, { rotate: -360, duration: 30000, loop: true, ease: "linear" });
  animate(".ve-sweep", { rotate: 360, duration: 6000, loop: true, ease: "linear" });
  // core glow breathe
  animate(".ve-coreglow", { scale: [0.92, 1.08], opacity: [0.7, 1], duration: 2600, loop: true, alternate: true, ease: "inOutQuad" });

  // iris waveform oscillation (organic, per-bar)
  bars.forEach((b, i) => {
    animate(b, {
      scaleY: [0.25, 1], opacity: [0.55, 1],
      duration: utils.random(700, 1500), delay: i * 14,
      loop: true, alternate: true, ease: "inOutSine",
    });
  });

  // particles travel the paths into the lens, then fade
  PATHS.forEach((_, i) => {
    const mp = svgU.createMotionPath(`#ve-path-${i}`);
    animate(`.ve-dot-${i}`, {
      translateX: mp.translateX, translateY: mp.translateY,
      opacity: [{ to: 1, duration: 200 }, { to: 1, duration: 2200 }, { to: 0, duration: 400 }],
      duration: 2800, loop: true, ease: "inQuad",
      delay: stagger(900),
    });
  });

  // gentle parallax: engine drifts toward the cursor
  let rx = 0, ry = 0, tx = 0, ty = 0, raf = 0;
  const onMove = (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 26; ty = (e.clientY / innerHeight - 0.5) * 26;
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const tick = () => {
    rx += (tx - rx) * 0.06; ry += (ty - ry) * 0.06;
    svg.style.transform = `translate(${rx.toFixed(2)}px,${ry.toFixed(2)}px)`;
    raf = (Math.abs(tx - rx) + Math.abs(ty - ry) > 0.1) ? requestAnimationFrame(tick) : 0;
  };
  if (matchMedia("(hover:hover) and (pointer:fine)").matches) addEventListener("pointermove", onMove, { passive: true });
})();

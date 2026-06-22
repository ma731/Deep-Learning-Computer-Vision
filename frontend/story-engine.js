/* FreshGuard — Vision Engine in the scrollytelling sticky figure (Acts 2-4).
   The colorful scanner tilts into a 3D lens and cross-fades into an exploded
   blueprint as you scroll the story; a "paper" backdrop lightens (dark→light).
   anime.js drives the ambient motion; scroll position drives the choreography. */
(() => {
  const A = window.anime;
  const host = document.getElementById("story-ve");
  const story = document.getElementById("story");
  if (!host || !story) return;
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;

  const NS = "http://www.w3.org/2000/svg";
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a || {}) e.setAttribute(k, a[k]); return e; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const SPEC = ["#a8ff35", "#f5b73d", "#ff5c5c", "#43e5c0"].map(hex);
  const spec = (t) => { const s = t * SPEC.length, i = Math.floor(s) % SPEC.length, j = (i + 1) % SPEC.length, f = s - Math.floor(s); const c = [0, 1, 2].map((k) => Math.round(lerp(SPEC[i][k], SPEC[j][k], f))); return `rgb(${c[0]},${c[1]},${c[2]})`; };

  const svg = el("svg", { viewBox: "-300 -300 600 600", class: "ve-svg" });
  host.appendChild(svg);

  const defs = el("defs"); svg.appendChild(defs);
  const grad = el("radialGradient", { id: "sveGlow" });
  grad.appendChild(el("stop", { offset: "0%", "stop-color": "rgba(168,255,53,.18)" }));
  grad.appendChild(el("stop", { offset: "100%", "stop-color": "rgba(168,255,53,0)" }));
  defs.appendChild(grad);

  // paper backdrop (dark→light)
  const paper = el("circle", { cx: 0, cy: 0, r: 270, fill: "#f4faf0", class: "ve-paper" }); svg.appendChild(paper);

  // ---- blueprint group (exploded lens cross-section) ----
  const gBlue = el("g", { class: "ve-blue" }); svg.appendChild(gBlue);
  // minimal aperture (stays centred): iris + mount ring + optical axis
  const gAp = el("g"); gBlue.appendChild(gAp);
  gAp.appendChild(el("circle", { cx: 0, cy: 0, r: 58, fill: "none", stroke: "rgba(16,26,20,.5)", "stroke-width": 1.4 }));
  gAp.appendChild(el("circle", { cx: 0, cy: 0, r: 262, fill: "none", stroke: "rgba(16,26,20,.32)", "stroke-width": 1.2 }));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; gAp.appendChild(el("line", { x1: Math.cos(a) * 58, y1: Math.sin(a) * 58, x2: Math.cos(a) * 262, y2: Math.sin(a) * 262, stroke: "rgba(16,26,20,.12)", "stroke-width": 1 })); }
  gAp.appendChild(el("line", { x1: -290, y1: 0, x2: 290, y2: 0, stroke: "rgba(16,26,20,.34)", "stroke-width": 1.2, "stroke-dasharray": "5 7", class: "ve-axis" }));
  // bold lens-element slices that string out ALONG the optical axis (the explode)
  const SLICE = [44, 78, 112, 78, 44], slices = [];
  SLICE.forEach((rx, i) => {
    const g = el("g", { class: "ve-slice" });
    g.appendChild(el("ellipse", { cx: 0, cy: 0, rx: rx * 0.42, ry: rx * 1.5, fill: i % 2 ? "rgba(16,26,20,.05)" : "rgba(168,255,53,.06)", stroke: "rgba(16,26,20,.72)", "stroke-width": 2 }));
    gBlue.appendChild(g); slices.push(g);
  });

  // ---- colorful scanner group ----
  const gColor = el("g", { class: "ve-color" }); svg.appendChild(gColor);
  gColor.appendChild(el("circle", { cx: 0, cy: 0, r: 230, fill: "url(#sveGlow)", class: "sve-glow" }));
  const gTicks = el("g", { class: "ve-ticks" }); gColor.appendChild(gTicks);
  const gMid = el("g", { class: "ve-mid" }); gColor.appendChild(gMid);
  const gWave = el("g", { class: "ve-wave" }); gColor.appendChild(gWave);

  const N = 64, R = 256, ticks = [];
  for (let i = 0; i < N; i++) { const g = el("g", { transform: `rotate(${(i / N) * 360})` }); const r = el("rect", { x: -1.7, y: -R, width: 3.4, height: 19, rx: 1.7, fill: spec(i / N), class: "ve-tick" }); g.appendChild(r); gTicks.appendChild(g); ticks.push(r); }
  gMid.appendChild(el("circle", { cx: 0, cy: 0, r: 210, fill: "none", stroke: "rgba(234,242,236,.22)", "stroke-width": 2, "stroke-dasharray": "2 12", "stroke-linecap": "round" }));
  gMid.appendChild(el("circle", { cx: 0, cy: 0, r: 150, fill: "none", stroke: "rgba(67,229,192,.3)", "stroke-width": 1.5, "stroke-dasharray": "60 360", "stroke-linecap": "round", class: "sve-sweep" }));

  const M = 44, span = 280, bars = [];
  for (let i = 0; i < M; i++) { const x = -span / 2 + (i / (M - 1)) * span; const env = Math.cos((i / (M - 1) - 0.5) * Math.PI); const h = 12 + env * env * 150; const b = el("rect", { x: x - 1.4, y: -h / 2, width: 2.8, height: h, rx: 1.4, fill: i % 7 === 0 ? "#a8ff35" : "rgba(255,92,76,.85)", class: "ve-bar" }); gWave.appendChild(b); bars.push(b); }

  // ---- ambient anime ----
  if (A && !reduced) {
    const { animate, stagger, utils } = A;
    animate(ticks, { scaleY: [0.55, 1.35], opacity: [0.4, 1], delay: stagger(36, { from: "first" }), duration: 1300, loop: true, alternate: true, ease: "inOutSine" });
    animate(gTicks, { rotate: 360, duration: 52000, loop: true, ease: "linear" });
    animate(gMid, { rotate: -360, duration: 32000, loop: true, ease: "linear" });
    animate(".story-ve .sve-sweep", { rotate: 360, duration: 6000, loop: true, ease: "linear" });
    bars.forEach((b, i) => animate(b, { scaleY: [0.25, 1], opacity: [0.55, 1], duration: utils.random(700, 1500), delay: i * 16, loop: true, alternate: true, ease: "inOutSine" }));
  }

  // ---- scroll choreography: tilt → decompose(blueprint) → lighten ----
  const vfLabels = document.getElementById("vf-labels");
  let raf = 0;
  const apply = () => {
    raf = 0;
    const total = story.offsetHeight - innerHeight;
    const r = story.getBoundingClientRect();
    const p = total > 0 ? Math.min(Math.max(-r.top / total, 0), 1) : 0;
    const pe = Math.max(0, Math.min(1, (p - 0.13) / 0.82));   // hold the hero frame, then transform
    const e = pe * pe * (3 - 2 * pe);                          // smoothstep
    svg.style.transform = `perspective(1100px) rotateX(${(e * 46).toFixed(1)}deg) rotateZ(${(e * -16).toFixed(1)}deg) scale(${(1 - e * 0.06).toFixed(3)})`;
    gColor.style.opacity = (1 - e * 0.94).toFixed(3);
    gBlue.style.opacity = Math.min(1, e * 1.35).toFixed(3);
    paper.style.opacity = (e * 0.5).toFixed(3);
    // the lens elements physically separate along the optical axis (the "explode")
    const mid = (slices.length - 1) / 2, spread = 100;
    slices.forEach((g, i) => g.setAttribute("transform", `translate(${((i - mid) * spread * e).toFixed(1)} 0)`));
    if (vfLabels) vfLabels.style.opacity = Math.min(1, Math.max(0, (e - 0.4) / 0.5)).toFixed(2);   // labels fade in with the blueprint
  };
  if (!reduced) {
    addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    addEventListener("resize", () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    apply();
  }
})();

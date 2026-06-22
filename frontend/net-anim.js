/* FreshGuard — animated architecture explainers (ANN · CNN · RNN).
   Live signal-flow diagrams built as SVG + anime.js timelines, so a viewer
   literally watches how each network processes the image / sequence.
   Tactical-telemetry styling; respects reduced-motion (renders a static frame). */
(() => {
  const A = window.anime;
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a || {}) e.setAttribute(k, a[k]); return e; };
  const mk = (id, vb) => { const h = document.getElementById(id); if (!h) return null; const s = el("svg", { viewBox: vb, class: "na-svg" }); h.appendChild(s); return s; };
  const animate = A ? A.animate : null, stagger = A ? A.stagger : null;
  let built = false;

  function buildANN() {
    const svg = mk("net-ann", "0 0 220 150"); if (!svg) return;
    const layers = [5, 7, 6, 2], xs = [24, 86, 148, 200], gl = el("g"), gn = el("g");
    svg.append(gl, gn);
    const pos = layers.map((n, li) => Array.from({ length: n }, (_, i) => ({ x: xs[li], y: 22 + i * (106 / (n - 1)) })));
    const lines = [];
    for (let l = 0; l < pos.length - 1; l++) for (const a of pos[l]) for (const b of pos[l + 1]) {
      const ln = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "var(--ink-line-hi)", "stroke-width": 0.6, opacity: 0.12 });
      gl.appendChild(ln); lines.push(ln);
    }
    const nodes = [];
    pos.forEach((layer, li) => layer.forEach((p, i) => {
      const fill = li === 3 ? (i === 0 ? "#a8ff35" : "#ff5c5c") : "var(--data)";
      const c = el("circle", { cx: p.x, cy: p.y, r: li === 3 ? 6 : 4.2, fill, opacity: 0.5, class: "na-node" });
      gn.appendChild(c); nodes.push(c);
    }));
    if (!animate || reduced) { nodes.forEach((n) => n.setAttribute("opacity", 1)); return; }
    animate(lines, { opacity: [0.1, 0.4], duration: 700, delay: stagger(2.2), loop: true, alternate: true, ease: "inOutSine" });
    animate(nodes, { scale: [0.8, 1.25], opacity: [0.45, 1], duration: 720, delay: stagger(34), loop: true, alternate: true, ease: "inOutSine" });
  }

  function buildCNN() {
    const svg = mk("net-cnn", "0 0 220 150"); if (!svg) return;
    const N = 6, cs = 13, ox = 12, oy = 24;
    const gIn = el("g"), gK = el("g"), gF = el("g"); svg.append(gIn, gK, gF);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = 0.10 + 0.5 * Math.abs(Math.sin((r + c) * 1.3));
      gIn.appendChild(el("rect", { x: ox + c * cs, y: oy + r * cs, width: cs - 1.5, height: cs - 1.5, fill: `rgba(67,229,192,${v.toFixed(2)})` }));
    }
    // sliding kernel (3x3)
    const kernel = el("rect", { x: ox, y: oy, width: cs * 3 - 1.5, height: cs * 3 - 1.5, fill: "none", stroke: "#a8ff35", "stroke-width": 1.8, rx: 0 });
    gK.appendChild(kernel);
    // feature map (4x4) on the right
    const fN = 4, fcs = 12, fx = 150, fy = 34, fcells = [];
    for (let r = 0; r < fN; r++) for (let c = 0; c < fN; c++) {
      const cell = el("rect", { x: fx + c * fcs, y: fy + r * fcs, width: fcs - 1.5, height: fcs - 1.5, fill: "#a8ff35", opacity: 0.06 });
      gF.appendChild(cell); fcells.push(cell);
    }
    svg.appendChild(el("path", { d: `M ${ox + N * cs + 4} 75 L ${fx - 6} 75`, stroke: "var(--ink-line-hi)", "stroke-width": 1, "stroke-dasharray": "2 3", "marker-end": "" }));
    if (!animate || reduced) { fcells.forEach((c) => c.setAttribute("opacity", 0.85)); return; }
    // kernel walks the 4x4 stride positions; feature cells light in sync
    const steps = [];
    for (let r = 0; r < fN; r++) for (let c = 0; c < fN; c++) steps.push({ x: ox + c * cs, y: oy + r * cs });
    const kf = steps.map((s) => ({ to: s.x, duration: 300 }));
    animate(kernel, { x: kf, ease: "linear", loop: true });
    animate(kernel, { y: steps.map((s) => ({ to: s.y, duration: 300 })), ease: "linear", loop: true });
    animate(fcells, { opacity: [0.06, 0.95], duration: 300, delay: stagger(300), loop: true, loopDelay: 0, alternate: false, ease: "inOutQuad" });
  }

  function buildRNN() {
    const svg = mk("net-rnn", "0 0 220 150"); if (!svg) return;
    const T = 6, x0 = 18, dx = 34, y = 64, w = 22;
    const gC = el("g"), gH = el("g"); svg.append(gC, gH);
    const cells = [];
    for (let t = 0; t < T; t++) {
      const x = x0 + t * dx;
      gC.appendChild(el("rect", { x, y, width: w, height: w, fill: "var(--well)", stroke: "var(--ink-line-hi)", "stroke-width": 1 }));
      gC.appendChild(el("line", { x1: x + w / 2, y1: y + w + 4, x2: x + w / 2, y2: y + w + 14, stroke: "var(--data)", "stroke-width": 2 }));   // input x_t tick
      if (t < T - 1) gC.appendChild(el("path", { d: `M ${x + w} ${y + w / 2} L ${x + dx} ${y + w / 2}`, stroke: "var(--ink-line-hi)", "stroke-width": 1 }));
      const cell = el("rect", { x: x + 2, y: y + 2, width: w - 4, height: w - 4, fill: "#a8ff35", opacity: 0.05, class: "na-rc" });
      gC.appendChild(cell); cells.push(cell);
    }
    // forecast output box
    gC.appendChild(el("rect", { x: x0 + T * dx - 6, y: y - 22, width: 26, height: 16, fill: "none", stroke: "#a8ff35", "stroke-width": 1.4 }));
    gC.appendChild(el("text", { x: x0 + T * dx + 7, y: y - 10, fill: "#a8ff35", "font-size": 8, "font-family": "var(--mono)", "text-anchor": "middle" })).textContent = "ŷ";
    // hidden-state token travels left→right
    const tok = el("circle", { cx: x0 + w / 2, cy: y + w / 2, r: 6, fill: "#a8ff35", opacity: 0.9, filter: "" });
    gH.appendChild(tok);
    if (!animate || reduced) { cells.forEach((c) => c.setAttribute("opacity", 0.7)); return; }
    const xkf = cells.map((_, t) => ({ to: x0 + t * dx + w / 2, duration: 360 }));
    animate(tok, { cx: xkf, ease: "inOutQuad", loop: true });
    animate(cells, { opacity: [0.05, 0.85], duration: 320, delay: stagger(360), loop: true, alternate: false, ease: "inOutQuad" });
  }

  function buildAll() {
    if (built) return; built = true;
    buildANN(); buildCNN(); buildRNN();
  }
  // build when the Model tab is first shown (containers have size then)
  const model = document.getElementById("view-model");
  if (model) {
    const io = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) { buildAll(); io.disconnect(); } }); });
    io.observe(model);
    // also catch the case where it's already visible
    if (!model.hidden) buildAll();
  }
  document.getElementById("tab-model")?.addEventListener("click", () => requestAnimationFrame(buildAll));
})();

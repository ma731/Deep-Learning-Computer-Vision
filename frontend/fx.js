/* FreshGuard — FX layer. Decorative only; never touches app state.
   Cursor glow · spotlight cards · 3D tilt · magnetic buttons · count-up. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const fine = matchMedia("(hover:hover) and (pointer:fine)").matches;
  const coarse = matchMedia("(pointer:coarse)").matches;

  /* ---- inject decorative DOM (no markup edits needed elsewhere) ---- */
  const add = (cls, parent, tag = "div") => {
    const el = document.createElement(tag);
    el.className = cls; (parent || document.body).prepend(el); return el;
  };
  const aurora = add("aurora"); aurora.appendChild(document.createElement("i"));
  const glow = fine && !reduced ? add("cursor-glow") : null;

  const hero = document.getElementById("story");   // landing is now the continuous story
  if (hero) {
    const cue = document.createElement("div");
    cue.className = "scroll-cue";
    cue.innerHTML = "<span>Scroll</span><i></i>";
    hero.appendChild(cue);
    cue.addEventListener("click", () => scrollTo({ top: innerHeight, behavior: "smooth" }));
    // staggered entrance for the tech-stack pills
    if (window.anime && !reduced) {
      const pills = hero.querySelectorAll(".hero-stack span");
      if (pills.length) window.anime.animate(pills, { opacity: [0, 1], translateY: [14, 0], duration: 620, delay: window.anime.stagger(55, { start: 1150 }), ease: "outCubic" });
    }
  }

  /* ---- ambient cursor glow (lerped follow) ---- */
  if (glow) {
    let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, raf = 0;
    addEventListener("pointermove", (e) => {
      tx = e.clientX; ty = e.clientY;
      document.body.classList.add("cursor-on");
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    const tick = () => {
      x += (tx - x) * 0.18; y += (ty - y) * 0.18;
      glow.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      raf = (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) ? requestAnimationFrame(tick) : 0;
    };
  }

  /* ---- spotlight + 3D tilt (single delegated listener) ---- */
  const TILT = ".card--hero,.card--interactive,.kstat,.mk-card";
  if (fine && !reduced) {
    let frame = 0, ev = null;
    document.addEventListener("pointermove", (e) => { ev = e; if (!frame) frame = requestAnimationFrame(apply); }, { passive: true });
    const apply = () => {
      frame = 0; const e = ev; if (!e) return;
      const el = e.target.closest && e.target.closest(".card,.kstat");
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      if (el.matches(TILT)) {
        const rx = (0.5 - py) * 6, ry = (px - 0.5) * 6;
        el.classList.add("tilting");
        el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
      }
    };
    document.addEventListener("pointerout", (e) => {
      const el = e.target.closest && e.target.closest(TILT);
      if (el && !el.contains(e.relatedTarget)) {
        el.classList.remove("tilting"); el.style.transform = "";
      }
    }, { passive: true });
  }

  /* ---- magnetic buttons ---- */
  if (fine && !reduced) {
    const magnetize = (btn, strength = 0.3) => {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const mx = (e.clientX - (r.left + r.width / 2)) * strength;
        const my = (e.clientY - (r.top + r.height / 2)) * strength;
        btn.style.transform = `translate(${mx.toFixed(1)}px,${my.toFixed(1)}px)`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.transform = ""; });
    };
    document.querySelectorAll(".hero-cta,.btn--primary").forEach((b) => magnetize(b));
  }

  /* ---- count-up on the static hero stats ---- */
  const countUp = (el) => {
    const raw = el.textContent.trim();
    const m = raw.match(/^([^\d-]*)(-?[\d.]+)(.*)$/);
    if (!m) return;
    const pre = m[1], target = parseFloat(m[2]), suf = m[3];
    const dec = (m[2].split(".")[1] || "").length;
    const dur = 1100; let start = 0;
    const run = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = pre + (target * e).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  };
  if (!reduced) {
    const stats = document.querySelectorAll(".hero-stats b");
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => { if (en.isIntersecting) { countUp(en.target); obs.unobserve(en.target); } });
    }, { threshold: 0.6 });
    stats.forEach((b) => io.observe(b));
  }

  /* ---- live count-up: animate KPI numbers when app.js updates them ----
     Safe: app.js only ever writes these nodes, never reads them back.
     We disconnect the observer around our own writes to avoid recursion. */
  const liveCount = (el) => {
    let raf = 0, disp = null, target = null, watching;
    const fmt = (v, dec, pre, suf) => pre + (dec ? v.toFixed(dec) : Math.round(v).toString()) + suf;
    const cb = () => {
      const m = el.textContent.trim().match(/^([^\d-]*)(-?[\d.]+)(.*)$/);
      if (!m) return;
      const t = parseFloat(m[2]); if (isNaN(t)) return;
      if (t === target) return;                 // already heading there
      const pre = m[1], suf = m[3], dec = (m[2].split(".")[1] || "").length;
      target = t;
      if (disp === null) { disp = t; return; }   // first real value: snap, no anim
      const from = disp, dur = 600; let start = 0;
      cancelAnimationFrame(raf);
      const run = (ts) => {
        if (!start) start = ts;
        const p = Math.min((ts - start) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        disp = from + (t - from) * e;
        watching.disconnect();
        el.textContent = fmt(disp, dec, pre, suf);
        watching.observe(el, { childList: true, characterData: true, subtree: true });
        if (p < 1) raf = requestAnimationFrame(run); else disp = t;
      };
      raf = requestAnimationFrame(run);
    };
    watching = new MutationObserver(cb);
    watching.observe(el, { childList: true, characterData: true, subtree: true });
  };
  if (!reduced) {
    ["k-scanned", "k-fresh", "k-flagged", "k-recovered", "td-total", "td-fresh", "td-flagged", "kpi-next7"]
      .forEach((id) => { const el = document.getElementById(id); if (el) liveCount(el); });
  }

  /* ---- haptic feedback on touch devices (confirmation pulses) ---- */
  const buzz = (ms) => { if (coarse && navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} } };
  if (coarse && navigator.vibrate) {
    document.querySelectorAll(".nav-item,.seg,.side-act,.btn").forEach((b) =>
      b.addEventListener("click", () => buzz(8), { passive: true }));
    const vl = document.getElementById("verdict-label");
    if (vl) new MutationObserver(() => buzz(14)).observe(vl, { childList: true, characterData: true, subtree: true });
  }

  /* ---- disable "open on phone" when we ARE the phone ----
     Hide it on touch devices, or when the page was loaded via the QR/LAN
     (any non-loopback host) — pointless to QR yourself from your phone. */
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(location.hostname);
  if (coarse || !isLoopback) {
    const pb = document.getElementById("btn-phone");
    if (pb) { pb.style.display = "none"; pb.disabled = true; }
  }

  /* ---- View Transitions API: wrap each tab handler for Apple-style fades.
     app.js assigns .onclick on the nav buttons; we wrap those so swipes and
     clicks both animate. Progressive enhancement — no-op if unsupported. */
  if (document.startViewTransition && !reduced) {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      const orig = btn.onclick;
      if (typeof orig !== "function") return;
      btn.onclick = (e) => {
        try { document.startViewTransition(() => orig.call(btn, e)); }
        catch (_) { orig.call(btn, e); }
      };
    });
  }

  /* ---- shared-element morph: hero wordmark → sidebar brand on enter ----
     Both get view-transition-name fg-brand, but only one is rendered at a
     time (app starts hidden), so the big title morphs down into the sidebar. */
  if (document.startViewTransition && !reduced) {
    const heM = document.getElementById("hero-enter");
    if (heM && typeof heM.onclick === "function") {
      const orig = heM.onclick;
      heM.onclick = (e) => {
        const title = document.querySelector(".hero-title");
        const brand = document.querySelector(".brand-name");
        if (title) title.style.viewTransitionName = "fg-brand";
        if (brand) brand.style.viewTransitionName = "fg-brand";
        let vt;
        try {
          vt = document.startViewTransition(() => {
            orig.call(heM, e);
            if (title) title.style.viewTransitionName = "none"; // drop the dup in the new state
            const s = document.getElementById("story"); if (s) s.style.display = "none";
            scrollTo(0, 0);
          });
        } catch (_) { orig.call(heM, e); return; }
        vt.finished.finally(() => { if (brand) brand.style.viewTransitionName = ""; });
      };
    }
  }

  /* ---- mobile swipe gesture: left/right between tabs ---- */
  const TAB_ORDER = ["tab-scan", "tab-dashboard", "tab-market", "tab-review", "tab-model", "tab-lab"];
  if (coarse) {
    const content = document.querySelector(".content");
    if (content) {
      let x0 = 0, y0 = 0, t0 = 0, ok = false;
      content.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) { ok = false; return; }
        // don't hijack horizontally-scrollable regions or form controls
        if (e.target.closest && e.target.closest(".pc-wrap,select,input,textarea,.ticker")) { ok = false; return; }
        const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); ok = true;
      }, { passive: true });
      content.addEventListener("touchend", (e) => {
        if (!ok) return; ok = false;
        const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
        if (Date.now() - t0 > 600) return;
        if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return; // dominant horizontal only
        const cur = TAB_ORDER.findIndex((id) => document.getElementById(id).classList.contains("is-active"));
        if (cur < 0) return;
        const next = Math.max(0, Math.min(TAB_ORDER.length - 1, cur + (dx < 0 ? 1 : -1)));
        if (next !== cur) { document.getElementById(TAB_ORDER[next]).click(); buzz(10); }
      }, { passive: true });
    }
  }

  /* ---- scrollytelling: reveal panels, animate ablation, progress bar ---- */
  const countTo = (el, target, dec, suf) => {
    const dur = 900; let start = 0;
    const run = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * e).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(run); else el.textContent = target.toFixed(dec) + suf;
    };
    requestAnimationFrame(run);
  };
  let ablDone = false;
  const animateAblation = (container) => {
    if (ablDone || !container) return;
    const abls = container.querySelectorAll(".abl");
    if (!abls.length) return;
    ablDone = true;
    abls.forEach((a, i) => {
      const acc = parseFloat(a.dataset.acc);
      setTimeout(() => {
        const fill = a.querySelector("i"); if (fill) fill.style.width = acc + "%";
        const val = a.querySelector(".abl-val"); if (val && !reduced) countTo(val, acc, 1, "%"); else if (val) val.textContent = acc.toFixed(1) + "%";
      }, i * 180);
    });
  };
  // sticky-figure: each step drives which figure is framed in the viewfinder
  const steps = [...document.querySelectorAll("#story .step")];
  const figs = [...document.querySelectorAll("#story .fig")];
  const vfTag = document.getElementById("vf-tag");
  const FIG_TAGS = ["VISION · LIVE", "DECAY · DETECTED", "COST · QUANTIFIED", "MODEL · ABLATION", "FORECAST · LSTM", "COMPLIANCE · LAW 1/2025", "SYSTEM · READY"];
  let curStep = -1;
  const setStep = (i) => {
    if (i === curStep) return; curStep = i;
    steps.forEach((s) => s.classList.toggle("is-active", +s.dataset.step === i));
    figs.forEach((f) => f.classList.toggle("is-on", +f.dataset.fig === i));
    if (vfTag && FIG_TAGS[i]) vfTag.textContent = FIG_TAGS[i];
    if (i === 1) animateAblation(document.querySelector(".fig-abl"));
  };
  if (steps.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) setStep(+en.target.dataset.step); });
    }, { threshold: 0.5, rootMargin: "-12% 0px -12% 0px" });
    steps.forEach((s) => io.observe(s));
    setStep(0);
  }

  /* story scroll-progress bar (works everywhere; passive) */
  const bar = document.getElementById("story-bar"), story = document.getElementById("story");
  if (bar && story) {
    const onScroll = () => {
      const total = story.offsetHeight - innerHeight;
      const passed = Math.min(Math.max(-story.getBoundingClientRect().top, 0), Math.max(total, 1));
      bar.style.transform = "scaleX(" + (total > 0 ? passed / total : 0) + ")";
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    onScroll();
  }

  /* entering the app hides the whole landing (hero + story) and resets scroll */
  const enterApp = () => { if (story) story.style.display = "none"; scrollTo(0, 0); };
  const he = document.getElementById("hero-enter");
  if (he) he.addEventListener("click", enterApp);
  const se = document.getElementById("story-enter");
  if (se) se.addEventListener("click", () => { const cta = document.getElementById("hero-enter"); if (cta) cta.click(); });

  /* ---- verdict morph: snapshot the scanned frame, fly it into the verdict ---- */
  const verdictEl = document.getElementById("verdict");
  if (verdictEl && !reduced) {
    const PRODUCE = new Set(["fresh", "sell_soon", "reject", "review"]);
    let lastTier = "", lastFly = 0;
    // session replay strip — one thumbnail per distinct grade this session
    const REPLAY_MAX = 24;
    const replayCard = document.getElementById("replay-card");
    const replayStrip = document.getElementById("replay-strip");
    let replayCount = 0;
    const addReplay = (dataUrl, tier) => {
      if (!replayStrip) return;
      const lbl = (document.getElementById("verdict-label") || {}).textContent || "";
      const cell = document.createElement("div");
      cell.className = "replay-cell " + tier;
      cell.dataset.src = dataUrl; cell.dataset.tier = tier; cell.dataset.label = lbl;
      cell.innerHTML = `<img src="${dataUrl}" alt=""><span>${lbl}</span>`;
      replayStrip.prepend(cell);
      while (replayStrip.children.length > REPLAY_MAX) replayStrip.lastChild.remove();
      replayCount = Math.min(replayCount + 1, REPLAY_MAX);
      const n = document.getElementById("replay-n"); if (n) n.textContent = replayCount;
      if (replayCard) replayCard.hidden = false;
    };
    const replayClear = document.getElementById("replay-clear");
    if (replayClear) replayClear.addEventListener("click", () => {
      if (replayStrip) replayStrip.innerHTML = "";
      replayCount = 0;
      const n = document.getElementById("replay-n"); if (n) n.textContent = "0";
      if (replayCard) replayCard.hidden = true;
    });
    // click a replay thumbnail → enlarged lightbox
    let lightbox = null;
    const openLightbox = (src, tier, label) => {
      if (!lightbox) {
        lightbox = document.createElement("div");
        lightbox.className = "lightbox"; lightbox.hidden = true;
        lightbox.innerHTML = '<div class="lb-inner"><img alt=""><div class="lb-cap"></div></div>';
        lightbox.addEventListener("click", () => { lightbox.classList.remove("open"); setTimeout(() => { lightbox.hidden = true; }, 250); });
        document.body.appendChild(lightbox);
      }
      lightbox.querySelector("img").src = src;
      const col = { fresh: "#a8ff35", sell_soon: "#f5b73d", reject: "#ff5c5c", review: "#8fb8ff" }[tier] || "#7e8a84";
      lightbox.querySelector(".lb-cap").innerHTML = `<span class="lb-chip" style="background:${col}">${label || ""}</span>`;
      lightbox.hidden = false; requestAnimationFrame(() => lightbox.classList.add("open"));
    };
    if (replayStrip) replayStrip.addEventListener("click", (e) => {
      const cell = e.target.closest(".replay-cell"); if (!cell) return;
      openLightbox(cell.dataset.src, cell.dataset.tier, cell.dataset.label);
    });
    const flyCrop = (tier) => {
      const now = performance.now();
      if (now - lastFly < 450) return; lastFly = now;
      const v = document.getElementById("video"), stage = document.getElementById("video-wrap");
      if (!v || !stage || !v.videoWidth) return;                 // need a live frame
      const size = 130, s = Math.min(v.videoWidth, v.videoHeight);
      const cv = document.createElement("canvas"); cv.width = size; cv.height = size;
      try { cv.getContext("2d").drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, size, size); } catch (_) { return; }
      let dataUrl;
      try { dataUrl = cv.toDataURL("image/jpeg", 0.8); } catch (_) { return; }
      addReplay(dataUrl, tier);
      const img = document.createElement("img"); img.className = "crop-fly"; img.alt = ""; img.src = dataUrl;
      const sr = stage.getBoundingClientRect(), vr = verdictEl.getBoundingClientRect();
      const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2, ex = vr.left + vr.width - 48, ey = vr.top + 48;
      img.style.left = sx + "px"; img.style.top = sy + "px";
      document.body.appendChild(img);
      requestAnimationFrame(() => {
        img.style.transform = `translate(-50%,-50%) translate(${ex - sx}px,${ey - sy}px) scale(.34) rotate(4deg)`;
        img.style.opacity = "0";
      });
      verdictEl.classList.add("verdict-hit");
      setTimeout(() => { img.remove(); verdictEl.classList.remove("verdict-hit"); }, 720);
    };
    new MutationObserver(() => {
      const tier = verdictEl.dataset.tier || "";
      if (tier !== lastTier && PRODUCE.has(tier)) flyCrop(tier);
      lastTier = tier;
    }).observe(verdictEl, { attributes: true, attributeFilter: ["data-tier", "class"] });
  }

  /* ---- mobile bottom-sheet (draggable) + tap verdict to open details ---- */
  if (coarse) {
    const scrim = document.createElement("div"); scrim.className = "sheet-scrim"; scrim.hidden = true;
    const sheet = document.createElement("div"); sheet.className = "sheet"; sheet.hidden = true;
    sheet.innerHTML = '<div class="sheet-handle"></div><div class="sheet-head"><span class="sheet-title" id="sheet-title">Details</span><button class="sheet-x" aria-label="Close">×</button></div><div class="sheet-body" id="sheet-body"></div>';
    document.body.append(scrim, sheet);
    const body = sheet.querySelector("#sheet-body"), titleEl = sheet.querySelector("#sheet-title");
    let openY = 0, dragY = 0, dragging = false;
    const openSheet = (title, node) => {
      titleEl.textContent = title || "Details";
      body.innerHTML = "";
      if (node && node.children.length) body.appendChild(node.cloneNode(true));
      else body.innerHTML = '<p class="sheet-empty">Scan an item to see its details.</p>';
      scrim.hidden = sheet.hidden = false;
      requestAnimationFrame(() => { scrim.classList.add("open"); sheet.classList.add("open"); });
      buzz(8);
    };
    const closeSheet = () => {
      scrim.classList.remove("open"); sheet.classList.remove("open"); sheet.style.transform = "";
      setTimeout(() => { scrim.hidden = sheet.hidden = true; }, 380);
    };
    scrim.addEventListener("click", closeSheet);
    sheet.querySelector(".sheet-x").addEventListener("click", closeSheet);
    // drag-to-dismiss on the handle / head
    sheet.addEventListener("touchstart", (e) => {
      if (!e.target.closest(".sheet-handle,.sheet-head")) return;
      dragging = true; openY = e.touches[0].clientY; dragY = 0; sheet.style.transition = "none";
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (!dragging) return; dragY = Math.max(0, e.touches[0].clientY - openY);
      sheet.style.transform = `translateY(${dragY}px)`;
    }, { passive: true });
    sheet.addEventListener("touchend", () => {
      if (!dragging) return; dragging = false; sheet.style.transition = "";
      if (dragY > 90) closeSheet(); else sheet.style.transform = "";
    }, { passive: true });
    const vTap = document.getElementById("verdict");
    if (vTap) vTap.addEventListener("click", () => {
      const det = document.getElementById("details");
      const lab = document.getElementById("verdict-label");
      openSheet(lab ? lab.textContent : "Details", det);
    });
  }

  /* ---- pull-to-refresh (mobile): pull down at top re-runs the active view ---- */
  if (coarse) {
    const ptr = document.createElement("div"); ptr.className = "ptr"; ptr.innerHTML = '<span class="ptr-spin"></span>';
    document.body.appendChild(ptr);
    const scroller = document.scrollingElement || document.documentElement;
    let py = 0, pulling = false, dist = 0, busy = false;
    addEventListener("touchstart", (e) => {
      if (busy || e.touches.length !== 1 || scroller.scrollTop > 0) { pulling = false; return; }
      py = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    addEventListener("touchmove", (e) => {
      if (!pulling) return;
      dist = e.touches[0].clientY - py;
      if (dist <= 0) { ptr.style.opacity = "0"; ptr.style.transform = "translate(-50%,-120%)"; return; }
      const d = Math.min(dist * 0.5, 92);
      ptr.style.opacity = String(Math.min(d / 60, 1));
      ptr.style.transform = `translate(-50%,${d - 38}px) rotate(${d * 3}deg)`;
    }, { passive: true });
    addEventListener("touchend", () => {
      if (!pulling) return; pulling = false;
      if (dist > 82) {
        busy = true; buzz(12);
        ptr.classList.add("spinning"); ptr.style.opacity = "1"; ptr.style.transform = "translate(-50%,16px)";
        const active = document.querySelector(".nav-item.is-active") || document.getElementById("tab-scan");
        if (active) active.click();                                  // re-runs the view's loader
        setTimeout(() => {
          ptr.classList.remove("spinning"); ptr.style.opacity = "0"; ptr.style.transform = "translate(-50%,-120%)"; busy = false;
        }, 850);
      } else { ptr.style.opacity = "0"; ptr.style.transform = "translate(-50%,-120%)"; }
    }, { passive: true });
  }
})();

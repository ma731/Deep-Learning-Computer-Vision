/* FreshGuard frontend, camera loop, overlay, money counter, dashboard. */

// API base: same-origin by default (FastAPI serves this page). Override for a
// separately-hosted frontend (e.g. Vercel) via ?api=https://backend-url or
// window.FRESHGUARD_API. Persisted so a scanned QR keeps working.
const API = (() => {
  const q = new URLSearchParams(location.search).get("api");
  if (q) localStorage.setItem("fg_api", q);
  return window.FRESHGUARD_API || localStorage.getItem("fg_api") || "";
})();
const FRAME_INTERVAL = 400; // ms between frames sent to backend

const $ = (id) => document.getElementById(id);
const video = $("video"), overlay = $("overlay"), ctx = overlay.getContext("2d");
const statusPill = $("model-status"), statusText = $("status-text");

let mode = "single";
let stream = null, loopTimer = null, busy = false;
let displayedRecovered = 0; // for smooth counter animation

const TIERS = {
  fresh:     { color: "#a8ff35", text: "FRESH" },
  sell_soon: { color: "#f5b73d", text: "SELL SOON" },
  reject:    { color: "#ff5c5c", text: "REJECT" },
  review:    { color: "#8fb8ff", text: "NEEDS REVIEW" },
  none:      { color: "#7e8a84", text: "NO PRODUCE" },
  legend:    { color: "#e6ad3a", text: "LEGENDARY" },   // demo easter egg
  untrained: { color: "#7e8a84", text: "MODEL NOT TRAINED" },
};

/* ---------------- hero → app ---------------- */
$("hero-enter").onclick = () => {
  const intro = $("story");
  $("app").hidden = false;
  intro.classList.add("leaving");
  setTimeout(() => { intro.style.display = "none"; }, 700);
  requestAnimationFrame(() => moveRail("scan"));   // position nav rail now app is visible
  fetchForecast(false);   // now the outlook card is visible, size the sparkline
};

/* ---------------- app → home ---------------- */
// Turn the camera off: stop the inference loop, release the camera (this is
// what switches off the webcam light / the phone's rear lens), and restore the
// "start" panel. Same behaviour on laptop and phone (one web app).
function stopCamera() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (video) video.srcObject = null;
  if ($("video-empty")) $("video-empty").hidden = false;
  $("video-wrap") && $("video-wrap").classList.remove("scanning");
  if ($("scanline")) $("scanline").hidden = true;
  if ($("btn-explain")) $("btn-explain").disabled = true;
  if ($("btn-stop")) $("btn-stop").hidden = true;
  if ($("fps-badge")) $("fps-badge").hidden = true;
  if (window.ctxStatus) ctxStatus("ctx-cam", "idle", "");
}
if ($("btn-stop")) $("btn-stop").onclick = () => { stopCamera(); if (window.ctxActivity) ctxActivity("Camera turned off", "sys"); };

function goHome() {
  stopCamera();
  $("app").hidden = true;
  const intro = $("story"); if (intro) { intro.classList.remove("leaving"); intro.style.display = ""; }
  scrollTo(0, 0);
}
if ($("btn-home")) $("btn-home").onclick = goHome;
document.querySelector(".brand") && document.querySelector(".brand").addEventListener("click", goHome);

/* ---------------- collapsible sidebar ---------------- */
(() => {
  const btn = $("btn-collapse"); if (!btn) return;
  const KEY = "fg-nav-collapsed";
  const apply = (on) => {
    $("app").classList.toggle("is-collapsed", on);
    const label = on ? "Expand sidebar" : "Collapse sidebar";
    btn.setAttribute("aria-expanded", String(!on));
    btn.setAttribute("aria-label", label);
    btn.title = label;
  };
  apply(localStorage.getItem(KEY) === "1");
  btn.onclick = () => {
    const on = !$("app").classList.contains("is-collapsed");
    localStorage.setItem(KEY, on ? "1" : "0");
    apply(on);
  };
})();

/* ---------------- sidebar nav ---------------- */
const views = { scan: $("view-scan"), dashboard: $("view-dashboard"), market: $("view-market"), review: $("view-review"), model: $("view-model"), lab: $("view-lab") };
const tabs  = { scan: $("tab-scan"), dashboard: $("tab-dashboard"), market: $("tab-market"), review: $("tab-review"), model: $("tab-model"), lab: $("tab-lab") };
let activeTab = "scan";
$("tab-scan").onclick = () => switchTab("scan");
$("tab-dashboard").onclick = () => { switchTab("dashboard"); fetchForecast(mode === "conveyor"); loadToday(); loadProduceBoard(); };
$("tab-market").onclick = () => { switchTab("market"); fetchForecast(mode === "conveyor"); };
$("tab-review").onclick = () => { switchTab("review"); loadReview(); };
$("tab-model").onclick = () => { switchTab("model"); loadModelReport(); };
$("tab-lab").onclick = () => { switchTab("lab"); loadLab(); };
function moveRail(name) {
  const rail = $("nav-rail"), item = tabs[name];
  if (rail && item) rail.style.transform = `translateY(${item.offsetTop}px)`;
}
function switchTab(name) {
  activeTab = name;
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  for (const [k, t] of Object.entries(tabs)) {
    const on = k === name;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  }
  moveRail(name);
}
window.addEventListener("resize", () => moveRail(activeTab));

/* ---------------- health ---------------- */
fetch(`${API}/api/health`).then(r => r.json()).then(h => {
  if (h.classifier_loaded) { statusText.textContent = "model live"; statusPill.className = "status-pill ok"; }
  else { statusText.textContent = "classifier not trained"; statusPill.className = "status-pill warn"; }
  if (window.ctxStatus) ctxStatus("ctx-model", h.classifier_loaded ? "live · 95.6%" : "not trained", h.classifier_loaded ? "ok" : "warn");
}).catch(() => { statusText.textContent = "backend offline"; statusPill.className = "status-pill err"; if (window.ctxStatus) ctxStatus("ctx-model", "offline", "err"); });

/* ---------------- camera ---------------- */
let userPickedCamera = false;   // true once the user chooses a camera by hand
if ($("camera-select")) $("camera-select").addEventListener("change", () => { userPickedCamera = true; });

async function listCameras() {
  const sel = $("camera-select");
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === "videoinput");
  sel.innerHTML = cams.map((d, i) => `<option value="${d.deviceId}">${d.label || "Camera " + (i + 1)}</option>`).join("");
  // Default the dropdown to the rear camera (labels only appear once permission
  // is granted) unless the user has already picked one themselves.
  if (!userPickedCamera) {
    const rear = cams.find(d => /back|rear|environment|world/i.test(d.label || ""));
    if (rear) sel.value = rear.deviceId;
  }
}

async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const deviceId = $("camera-select").value;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("This browser blocks camera access unless the page is on https or localhost. Open http://localhost:8000 (not a file:// path or LAN IP).");
    return;
  }
  // Prefer the BACK camera on phones (facingMode ideal:"environment") for
  // scanning produce. `ideal` (not `exact`) lets a laptop with no rear camera
  // fall back to its only camera instead of erroring. A camera the user
  // explicitly picked from the dropdown wins; otherwise the back camera leads.
  const back = { video: { facingMode: { ideal: "environment" } } };
  const attempts = (deviceId && userPickedCamera)
    ? [{ video: { deviceId: { exact: deviceId } } }, back, { video: true }]
    : [back, { video: true }, { video: { facingMode: "user" } }];
  let lastErr = null;
  for (const c of attempts) {
    try { stream = await navigator.mediaDevices.getUserMedia({ ...c, audio: false }); lastErr = null; break; }
    catch (e) { lastErr = e; }
  }
  if (lastErr || !stream) {
    const n = lastErr && lastErr.name;
    alert(
      n === "NotAllowedError"  ? "Camera permission is blocked. Click the camera icon in the address bar → Allow, then press Start camera again."
    : n === "NotReadableError" ? "The camera is in use by another app (Zoom, Teams, Photo Booth…). Close it and press Start camera again."
    : n === "NotFoundError"    ? "No camera was found on this device. You can use Upload photo instead."
    : `Camera error: ${n || "unknown"}. You can still use Upload photo.`
    );
    return;
  }
  video.srcObject = stream;
  if (window.ctxStatus) ctxStatus("ctx-cam", "active", "ok");
  if (window.ctxActivity) ctxActivity("Camera started · live scan", "sys");
  $("video-empty").hidden = true;
  $("video-wrap").classList.add("scanning");   // reveal the live HUD
  $("scanline").hidden = false;
  $("btn-explain").disabled = false;
  if ($("btn-stop")) $("btn-stop").hidden = false;   // reveal the "Turn off" control
  $("fps-badge").hidden = false;
  await listCameras();
  video.onloadedmetadata = () => {
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = setInterval(() => sendFrame(false), FRAME_INTERVAL);
  };
}
$("btn-start").onclick = startCamera;

/* ---------------- mode ---------------- */
function setMode(m) {
  mode = m;
  $("mode-single").classList.toggle("is-active", m === "single");
  $("mode-conveyor").classList.toggle("is-active", m === "conveyor");
  $("seg").style.setProperty("--seg-x", m === "conveyor" ? "100%" : "0%");
  const conveyor = m === "conveyor";
  $("session-counts").hidden = !conveyor;
  $("recovered-card").hidden = !conveyor;
  $("btn-reset").hidden = !conveyor;
  $("heatmap-box").hidden = true;
  // close the loop: in conveyor mode, keep re-forecasting on the live tally
  if (fcTimer) { clearInterval(fcTimer); fcTimer = null; }
  if (conveyor) fcTimer = setInterval(() => fetchForecast(true), 4000);
}
$("mode-single").onclick = () => setMode("single");
$("mode-conveyor").onclick = () => setMode("conveyor");
$("btn-reset").onclick = async () => {
  await fetch(`${API}/api/reset_session`, { method: "POST" });
  displayedRecovered = 0; $("recovered-value").textContent = "€0.00";
};

/* ---------------- frame loop ---------------- */
const grab = document.createElement("canvas");
async function sendFrame(explain) {
  if (busy || !video.videoWidth) return;
  busy = true;
  const t0 = performance.now();
  try {
    grab.width = video.videoWidth; grab.height = video.videoHeight;
    grab.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise(r => grab.toBlob(r, "image/jpeg", 0.82));
    const fd = new FormData(); fd.append("file", blob, "frame.jpg");
    // log=explain: the Explain button is a deliberate "grade this" grab, so it
    // goes to history; the continuous preview loop (explain=false) does not.
    const res = await fetch(`${API}/api/predict?mode=${mode}&explain=${explain}&log=${explain}`, { method: "POST", body: fd });
    render(await res.json());
    $("fps-val").textContent = Math.round(performance.now() - t0);
  } catch (e) { /* keep loop alive */ }
  busy = false;
}
$("btn-explain").onclick = () => sendFrame(true);

/* ---------------- upload ---------------- */
function wireUpload(input) {
  if (!input) return;
  input.onchange = async (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`${API}/api/predict?mode=single&explain=true&log=true`, { method: "POST", body: fd });
    const data = await res.json();
    const img = new Image();
    img.onload = () => { overlay.width = img.width; overlay.height = img.height;
      $("video-empty").hidden = true; render(data); };
    img.src = URL.createObjectURL(file);
  };
}
wireUpload($("file-input"));

/* ---------------- rendering ---------------- */
function render(data) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!data || data.error) return;
  const dets = data.detections || [];
  if (!(dets[0] && dets[0].easter)) easterActive = false;  // re-arm the easter egg

  for (const d of dets) {
    const [x1, y1, x2, y2] = d.box;
    const s = TIERS[d.tier] || TIERS.untrained;
    ctx.save();
    ctx.shadowColor = s.color; ctx.shadowBlur = 16;   // glow
    ctx.lineWidth = Math.max(2.5, overlay.width / 300);
    ctx.strokeStyle = s.color;
    roundRect(ctx, x1, y1, x2 - x1, y2 - y1, 10); ctx.stroke();
    ctx.restore();
    const tag = `${prettyFruit(d.fruit).toUpperCase()}${d.track_id != null ? " #" + d.track_id : ""} · ${s.text}` +
                (d.confidence != null ? ` ${(d.confidence * 100).toFixed(0)}%` : "");
    ctx.font = `600 ${Math.max(13, overlay.width / 48)}px "IBM Plex Mono", monospace`;
    const pad = 7, tw = ctx.measureText(tag).width + pad * 2, th = Math.max(20, overlay.width / 34);
    ctx.fillStyle = s.color;
    roundRect(ctx, x1, Math.max(0, y1 - th - 2), tw, th, 6); ctx.fill();
    ctx.fillStyle = "#06140b"; ctx.textBaseline = "middle";
    ctx.fillText(tag, x1 + pad, Math.max(th / 2, y1 - th / 2 - 2));
  }

  // panel: largest detection drives the verdict
  if (!dets.length) {
    setVerdict("idle", "No item in view", "hold produce up to the camera");
    $("details").innerHTML = PLACEHOLDER_DETAILS; $("heatmap-box").hidden = true;
    $("readout-card").hidden = true;
  } else if (dets[0] && dets[0].easter) {
    renderEaster(dets[0]);
  } else {
    const m = dets.reduce((a, b) => area(a) >= area(b) ? a : b);
    const s = TIERS[m.tier] || TIERS.untrained;
    const sub = m.tier === "review"
      ? `low confidence, flagged for human review`
      : (m.action || m.note || "");
    setVerdict(m.tier, s.text, sub);
    const rk = m.fruit + ":" + m.tier;
    if (rk !== lastRecent && ["fresh", "sell_soon", "reject"].includes(m.tier)) {
      lastRecent = rk; pushRecent(m.fruit, m.tier); fruitReaction(m.fruit, m.tier);
      if (window.ctxActivity) ctxActivity(`<b>${prettyFruit(m.fruit)}</b> graded ${(TIERS[m.tier] || {}).text || m.tier}`, m.tier);
    }
    const mkt = MARKET.find(p => p.key === m.fruit);
    $("details").innerHTML = [
      ["Item", prettyFruit(m.fruit)],
      ["Detector conf.", m.source === "fallback" ? "center-crop" : pct(m.det_conf)],
      ["Grade conf.", pct(m.confidence)],
      m.tier === "review" ? ["Would guess", (m.tier_raw || "—").replace("_", " ")] : null,
      ["Rot probability", pct(m.rotten_prob)],
      ["Decay surface", pct(m.severity)],
      m.shelf_life_days != null ? ["Shelf life", `~${m.shelf_life_days} days left`] : null,
      mkt ? ["Live mkt price", `€${mkt.price.toFixed(2)}/kg`] : null,
      mkt && m.tier === "sell_soon" ? ["Sell-soon now", `€${(mkt.price * 0.7).toFixed(2)}/kg`] : null,
      ["Unit price", m.unit_price != null ? "€" + m.unit_price.toFixed(2) : "—"],
      ["Recoverable", m.recovered ? "€" + m.recovered.toFixed(2) : "—"],
      ["Detector ↔ model", m.fruit_agreement == null ? "—" : (m.fruit_agreement ? "agree" : "⚠ differ")],
    ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v ?? "—"}</dd>`).join("");
    if (m.heatmap_png) { $("heatmap-img").src = `data:image/png;base64,${m.heatmap_png}`; $("heatmap-box").hidden = false; }
    renderReadout(m);
  }

  if (data.session) {
    $("c-scanned").textContent = data.session.scanned;
    $("c-fresh").textContent = data.session.fresh;
    $("c-sellsoon").textContent = data.session.sell_soon;
    $("c-reject").textContent = data.session.reject;
    $("c-review").textContent = data.session.review || 0;
    const s = data.session;
    $("k-scanned").textContent = s.scanned;
    $("k-fresh").textContent = s.fresh;
    $("k-flagged").textContent = (s.sell_soon || 0) + (s.reject || 0);
    $("k-recovered").textContent = "€" + (s.recovered_eur || 0).toFixed(2);
    animateMoney(data.session.recovered_eur || 0);
  }
}

function setVerdict(tier, label, sub) {
  const v = $("verdict");
  const changed = v.dataset.tier !== tier;
  v.className = "card card--hero verdict" + (tier === "idle" ? "" : " " + tier);
  v.dataset.tier = tier;
  // drive the living verdict ring on the video frame
  const RING = { fresh: "var(--st-fresh)", sell_soon: "var(--st-sell)", reject: "var(--st-reject)", review: "var(--st-review)", legend: "#e6ad3a" };
  const vw = $("video-wrap"); if (vw) vw.style.setProperty("--ring", RING[tier] || "var(--ink-line)");
  if (changed) {            // re-trigger the pop animation on a real change
    v.classList.remove("pop"); void v.offsetWidth; v.classList.add("pop");
    if (tier === "reject") { toast("Reject, pull from shelf", "reject"); beep("low"); }
    else if (tier === "sell_soon") { toast("Sell-soon, mark it down within 48h", "sell"); beep("high"); }
  }
  $("verdict-label").textContent = label;
  $("verdict-sub").textContent = sub;
}

/* smooth count-up for the money counter, with a bump + floating "+€x" on gains */
function animateMoney(target) {
  const start = displayedRecovered, delta = target - start;
  if (Math.abs(delta) < 0.005) return;
  if (delta > 0) {
    const el = $("recovered-value");
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    const gain = document.createElement("span");
    gain.className = "float-gain"; gain.textContent = "+€" + delta.toFixed(2);
    $("recovered-card").appendChild(gain);
    gain.addEventListener("animationend", () => gain.remove(), { once: true });
  }
  const dur = 600, t0 = performance.now();
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    displayedRecovered = start + delta * eased;
    $("recovered-value").textContent = "€" + displayedRecovered.toFixed(2);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const PLACEHOLDER_DETAILS = [
  ["Item", "—"], ["Grade conf.", "—"], ["Rot probability", "—"],
  ["Decay surface", "—"], ["Unit price", "—"], ["Recoverable", "—"],
].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(0)}%`;
const prettyFruit = (f) => f === "bellpepper" ? "bell pepper" : f;
const area = (d) => (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]);
function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r); c.closePath();
}

/* ---------------- forecast (RNN), surfaced on scan screen + dashboard ---------------- */
let chart = null, fcTimer = null, lastAlert = "";

async function fetchForecast(live) {
  try {
    const data = await (await fetch(`${API}/api/forecast?live=${live ? "true" : "false"}`)).json();
    renderOutlook(data);
    if (!views.dashboard.hidden) renderDash(data);
    return data;
  } catch (e) { /* ignore */ }
}

// compact RNN card on the scan screen
function renderOutlook(d) {
  const ap = d.action_plan || {};
  $("ol-total").textContent = ap.week_total ?? "—";
  $("ol-action").textContent = ap.markdown_alert || ap.reorder || "";
  $("outlook-live").hidden = !(d.live_flagged_today > 0);
  drawSpark(d.forecast.values);
  // RNN forecast also drives the Market tab's reorder guidance
  if ($("rnn-week")) $("rnn-week").textContent = ap.week_total ?? "—";
  if ($("rnn-action")) $("rnn-action").textContent = ap.reorder || ap.markdown_alert || "";
  // forecast alert: surface a markdown surge once
  if (ap.markdown_alert && ap.markdown_alert !== lastAlert) {
    lastAlert = ap.markdown_alert;
    toast(ap.markdown_alert, "sell");
  }
}

function drawSpark(vals) {
  const cv = $("ol-spark"); if (!cv || !vals || !vals.length) return;
  const w = cv.width = cv.clientWidth || 260, h = cv.height = 34;
  const c = cv.getContext("2d"); c.clearRect(0, 0, w, h);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  c.beginPath();
  vals.forEach((v, i) => {
    const x = i / (vals.length - 1) * (w - 4) + 2, y = h - 3 - ((v - mn) / rng) * (h - 8);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.strokeStyle = "#f5b53d"; c.lineWidth = 2; c.lineJoin = "round"; c.stroke();
}

// full dashboard: chart + KPIs + action plan
function renderDash(data) {
  $("forecast-note").textContent = data.note || "next 7 days · LSTM forecast";
  const ap = data.action_plan || {};
  $("ap-reorder").textContent = ap.reorder || "—";
  $("ap-markdown").textContent = ap.markdown_alert || "—";
  $("ap-live").textContent = (data.live_flagged_today || 0) + " items flagged today (live)";
  const labels = [...data.history.dates, ...data.forecast.dates];
  const hist = [...data.history.values, ...Array(data.forecast.dates.length).fill(null)];
  const fore = [...Array(data.history.dates.length - 1).fill(null),
                data.history.values.at(-1), ...data.forecast.values];
  const avg = data.history.values.reduce((a, b) => a + b, 0) / data.history.values.length;
  $("kpi-next7").textContent = Math.round(data.forecast.values.reduce((a, b) => a + b, 0));
  $("kpi-avg").textContent = avg.toFixed(0);

  if (chart) chart.destroy();
  const c = $("forecast-chart").getContext("2d");
  Chart.defaults.font.family = "Inter";
  const grad = c.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, "rgba(168,255,53,0.22)"); grad.addColorStop(0.55, "rgba(168,255,53,0.06)"); grad.addColorStop(1, "rgba(168,255,53,0)");
  const light = document.body.classList.contains("light");
  const cream = light ? "rgba(14,26,20,0.6)" : "rgba(234,242,236,0.45)";
  const line = light ? "rgba(14,26,20,0.10)" : "rgba(234,242,236,0.08)";
  const histColor = light ? "rgba(14,26,20,0.5)" : "rgba(234,242,236,0.42)";
  const tipBg = light ? "#ffffff" : "#1a241f";
  const tipBorder = light ? "rgba(14,26,20,0.16)" : "rgba(234,242,236,0.16)";
  const tipBody = light ? "#0e1a14" : "#eaf2ec";
  chart = new Chart(c, {
    type: "line",
    data: { labels, datasets: [
      { label: "Flagged / day", data: hist, borderColor: histColor, backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.35 },
      { label: "LSTM forecast", data: fore, borderColor: "#a8ff35", backgroundColor: grad, fill: true, pointRadius: 0, borderWidth: 2, tension: 0.35 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: { legend: { labels: { color: cream, usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
                 tooltip: { backgroundColor: tipBg, borderColor: tipBorder, borderWidth: 1, padding: 10, cornerRadius: 10, displayColors: false,
                            titleColor: cream, bodyColor: tipBody } },
      scales: {
        x: { ticks: { color: cream, maxTicksLimit: 8, font: { size: 11 } }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: cream, font: { size: 11 } }, grid: { color: line }, border: { display: false }, beginAtZero: true },
      },
    },
  });
}

/* ---------------- live produce market ---------------- */
const MARKET = [
  { key: "tomato",     name: "Tomato",      emoji: "🍅", price: 2.40 },
  { key: "apple",      name: "Apple",       emoji: "🍎", price: 1.85 },
  { key: "banana",     name: "Banana",      emoji: "🍌", price: 1.30 },
  { key: "orange",     name: "Orange",      emoji: "🍊", price: 1.55 },
  { key: "strawberry", name: "Strawberry",  emoji: "🍓", price: 5.40 },
  { key: "mango",      name: "Mango",       emoji: "🥭", price: 3.80 },
  { key: "bellpepper", name: "Bell pepper", emoji: "🫑", price: 3.10 },
  { key: "cucumber",   name: "Cucumber",    emoji: "🥒", price: 1.40 },
  { key: "carrot",     name: "Carrot",      emoji: "🥕", price: 0.95 },
  { key: "potato",     name: "Potato",      emoji: "🥔", price: 0.80 },
];
MARKET.forEach(p => { p.open = p.price; p.hist = [p.price]; });
const eur = (v) => "€" + v.toFixed(2);

function buildMarket() {
  const grid = $("market-grid"); if (!grid || grid.dataset.built) return;
  grid.dataset.built = "1";
  grid.innerHTML = MARKET.map(p => `
    <article class="card card--interactive mk-card" id="pc-${p.key}">
      <div class="mk-top"><span class="mk-emoji">${p.emoji}</span><span class="mk-name">${p.name}</span></div>
      <span class="chip mk-change flat" id="chg-${p.key}">— 0.0%</span>
      <div class="mk-price"><b id="pr-${p.key}">${eur(p.price)}</b><span>/kg</span></div>
      <canvas class="mk-spark" id="sp-${p.key}"></canvas>
      <div class="mk-foot"><span class="lbl">Sell-soon</span><b id="ss-${p.key}">${eur(p.price * 0.7)}</b></div>
      <div class="mk-detail" id="dt-${p.key}">today —</div>
      <div class="mk-reorder">Reorder <b>${p.reorder ?? "—"}</b> · 7-day demand ${p.fc7 ?? "—"}</div>
    </article>`).join("");
}

function tickMarket() {
  let sum = 0, up = 0, down = 0;
  for (const p of MARKET) {
    const drift = (Math.random() - 0.5) * 0.014;            // ±0.7% random walk
    p.price = Math.max(0.2, p.price * (1 + drift));
    p.hist.push(p.price); if (p.hist.length > 40) p.hist.shift();
    sum += p.price;
    const chgPct = (p.price / p.open - 1) * 100;
    if (chgPct >= 0.05) up++; else if (chgPct <= -0.05) down++;
    const prEl = $("pr-" + p.key); if (!prEl) continue;     // grid not built yet
    prEl.textContent = eur(p.price);
    $("ss-" + p.key).textContent = eur(p.price * 0.7);
    const flat = Math.abs(chgPct) < 0.05, isUp = chgPct >= 0;
    const chg = $("chg-" + p.key);
    chg.textContent = (flat ? "— " : isUp ? "▲ " : "▼ ") + Math.abs(chgPct).toFixed(1) + "%";
    chg.className = "chip mk-change " + (flat ? "flat" : isUp ? "up" : "down");
    prEl.classList.remove("flash-up", "flash-down", "pop"); void prEl.offsetWidth;
    prEl.classList.add(drift >= 0 ? "flash-up" : "flash-down", "pop");
    setTimeout(() => prEl.classList.remove("flash-up", "flash-down"), 320);
    sparkline($("sp-" + p.key), p.hist, isUp);
    p.hi = Math.max(p.hi ?? p.price, p.price); p.lo = Math.min(p.lo ?? p.price, p.price);
    const dt = $("dt-" + p.key);
    if (dt) dt.textContent = `today €${p.lo.toFixed(2)} to €${p.hi.toFixed(2)} · ${isUp ? "+" : ""}${chgPct.toFixed(1)}%`;
  }
  if ($("mk-avg")) $("mk-avg").textContent = eur(sum / MARKET.length);
  if ($("mk-movers")) $("mk-movers").innerHTML =
    `<span style="color:var(--st-fresh)">+${up}</span> / <span style="color:var(--st-reject)">-${down}</span>`;
  buildTicker();
}

function sparkline(cv, vals, up) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 200, h = cv.clientHeight || 38;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1, pad = 4;
  const X = (i) => i / (vals.length - 1) * (w - pad * 2) + pad;
  const Y = (v) => h - pad - ((v - mn) / rng) * (h - pad * 2);
  const col = up ? "#a8ff35" : "#ff5c5c";
  c.beginPath(); vals.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)));
  c.strokeStyle = col; c.lineWidth = 1.5; c.lineJoin = "round"; c.lineCap = "round"; c.stroke();
  c.beginPath(); c.arc(X(vals.length - 1), Y(vals.at(-1)), 2.6, 0, Math.PI * 2); c.fillStyle = col; c.fill();
}

function buildTicker() {
  const t = $("ticker-track"); if (!t) return;
  const item = (p) => {
    const pct = (p.price / p.open - 1) * 100, up = pct >= 0;
    return `<span class="tk-item">${p.name} <span class="p">${eur(p.price)}</span> <span class="${up ? "up" : "down"}">${up ? "▲" : "▼"}${Math.abs(pct).toFixed(1)}%</span></span>`;
  };
  const sep = '<span class="tk-item" style="color:var(--ink-3)">·</span>';
  const row = MARKET.map(item).join(sep);
  t.innerHTML = row + sep + row;   // duplicated for a seamless marquee loop
}

async function loadMarket(refresh) {
  try {
    const d = await (await fetch(`${API}/api/market${refresh ? "?refresh=1" : ""}`)).json();
    if (d && d.items) {
      const byKey = Object.fromEntries(d.items.map(i => [i.key, i]));
      MARKET.forEach(p => {
        const r = byKey[p.key];
        if (r) { p.price = r.price; p.open = r.price; p.hist = [r.price]; p.hi = r.price; p.lo = r.price; if (r.emoji) p.emoji = r.emoji; }
      });
      const note = $("market-note");
      if (note) note.textContent = d.source === "reference"
        ? "Wholesale reference · €/kg · live ticking"
        : `Live · ${d.source} · €/kg`;
      const src = $("market-src");
      if (src) {
        const live = d.source !== "reference";
        src.textContent = live ? "● LIVE · USDA" : (d.key_configured ? "key set · awaiting USDA" : "reference feed");
        src.className = "src-pill" + (live ? " live" : d.key_configured ? " pending" : "");
        if (window.ctxStatus) ctxStatus("ctx-market", live ? "live · USDA" : "reference", live ? "ok" : "");
      }
    }
  } catch (e) { /* keep reference prices */ }
  try {   // per-produce LSTM demand → reorder quantity on each card
    const pf = await (await fetch(`${API}/api/forecast/produce`)).json();
    const ro = Object.fromEntries((pf.items || []).map(i => [i.key, i]));
    MARKET.forEach(p => { const r = ro[p.key]; if (r) { p.reorder = r.reorder; p.fc7 = r.forecast7; } });
  } catch (e) { /* cards still render without reorder */ }
  buildMarket();
  tickMarket();
}

/* ---------------- toasts + sound ---------------- */
function toast(msg, kind) {
  const wrap = $("toasts"); if (!wrap || !msg) return;
  const t = document.createElement("div");
  t.className = "toast" + (kind ? " toast--" + kind : "");
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in");
    t.addEventListener("transitionend", () => t.remove(), { once: true }); }, 3400);
}
let _ac, soundOn = localStorage.getItem("fg_sound") !== "0";
function beep(kind) {
  if (!soundOn) return;
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(), g = _ac.createGain();
    o.connect(g); g.connect(_ac.destination);
    o.type = "sine"; o.frequency.value = kind === "low" ? 200 : 680;
    g.gain.setValueAtTime(0.0001, _ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, _ac.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + 0.18);
    o.start(); o.stop(_ac.currentTime + 0.2);
  } catch (e) { /* audio not available */ }
}

/* ---------------- active-learning review ---------------- */
const LABELS = ["apple", "banana", "orange", "carrot", "tomato", "potato",
  "cucumber", "bellpepper", "mango", "strawberry"].flatMap(k => [`fresh_${k}`, `rotten_${k}`]);

function updateReviewBadge(n) { const b = $("review-badge"); if (!b) return; b.textContent = n; b.hidden = !n; }
async function refreshReviewBadge() { try { const d = await (await fetch(`${API}/api/review_queue`)).json(); updateReviewBadge(d.count); } catch (e) {} }

async function seedKpis() {   // populate the scan KPI strip from real logged history
  try {
    const h = await (await fetch(`${API}/api/history`)).json();
    const t = h.by_tier || {};
    if ($("k-scanned")) $("k-scanned").textContent = h.total || 0;
    if ($("k-recovered")) $("k-recovered").textContent = "€" + (h.recovered_eur || 0).toFixed(2);
    if ($("k-fresh")) $("k-fresh").textContent = t.fresh || 0;
    if ($("k-flagged")) $("k-flagged").textContent = (t.sell_soon || 0) + (t.reject || 0);
  } catch (e) {}
}

async function loadReview() {
  const grid = $("review-grid"); if (!grid) return;
  grid.innerHTML = `<p class="muted">Loading…</p>`;
  let d; try { d = await (await fetch(`${API}/api/review_queue`)).json(); }
  catch (e) { grid.innerHTML = `<p class="muted">Could not load the review queue.</p>`; return; }
  updateReviewBadge(d.count);
  if (!d.items || !d.items.length) {
    grid.innerHTML = `<p class="muted">Nothing to review, the model is confident. Run <b>Conveyor</b> mode to surface low-confidence items here.</p>`;
    return;
  }
  grid.innerHTML = d.items.map(it => `
    <article class="card rev-card">
      <div class="rev-imgwrap"><img class="rev-img" src="${API}/review-img/${encodeURIComponent(it.image)}" alt="" onerror="this.parentNode.classList.add('noimg')"></div>
      <div class="rev-meta"><b>${prettyFruit(it.fruit || "item")}</b><span class="muted small">conf ${Math.round((it.confidence || 0) * 100)}% · would call “${(it.tier_raw || "—")}”</span></div>
      <div class="rev-actions">
        <select class="rev-sel" data-img="${it.image}">${LABELS.map(l => `<option value="${l}"${(it.fruit && l.endsWith(it.fruit)) ? " selected" : ""}>${l.replace("_", " ")}</option>`).join("")}</select>
        <button class="btn btn--primary btn--sm rev-save" data-img="${it.image}">Submit</button>
      </div>
    </article>`).join("");
  grid.querySelectorAll(".rev-save").forEach(b => b.onclick = () => {
    const sel = grid.querySelector(`.rev-sel[data-img="${CSS.escape(b.dataset.img)}"]`);
    relabel(b.dataset.img, sel.value);
  });
}
async function relabel(image, label) {
  let saved = false;
  try {
    const r = await (await fetch(`${API}/api/review_queue/relabel`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, label }) })).json();
    saved = !!(r && r.saved_to);
  } catch (e) {}
  toast(`Submitted → ${label.replace("_", " ")}` + (saved ? " · saved to training set" : ""), "good");
  loadReview();
}

/* ---------------- in-app model report ---------------- */
async function loadModelReport() {
  let d; try { d = await (await fetch(`${API}/api/model_report`)).json(); } catch (e) { return; }
  const order = [
    ["ann_baseline", "ANN baseline", "flatten the pixels, loses all spatial structure"],
    ["cnn_scratch", "CNN from scratch", "convolutions keep the geometry"],
    ["mobilenetv2_tl", "MobileNetV2 transfer", "a borrowed visual backbone, the winner"],
  ];
  const MAXACC = 0.96;
  $("model-bars").innerHTML = order.map(([k, name, sub]) => {
    const s = d.summary[k] || {}; const acc = s.test_accuracy || 0; const win = k === "mobilenetv2_tl";
    return `<div class="card mbar${win ? " win" : ""}">
      <div class="mbar-head"><b data-acc="${acc}">0.0%</b><span>${name}</span></div>
      <div class="mbar-track"><div class="mbar-fill" data-w="${Math.round(acc / MAXACC * 100)}" style="width:0"></div></div>
      <div class="muted small">${sub} · ${(s.params || 0).toLocaleString()} params</div>
    </div>`;
  }).join("");
  raceBars();
  renderConfusion();
  renderEval();
  const pc = $("pc-wrap");
  if (pc) {
    if (d.per_class) {
      const skip = new Set(["accuracy", "macro avg", "weighted avg"]);
      const rows = Object.entries(d.per_class).filter(([k]) => !skip.has(k))
        .map(([k, v]) => `<tr><td>${k.replace("_", " ")}</td><td>${(v.precision * 100).toFixed(1)}%</td><td>${(v.recall * 100).toFixed(1)}%</td><td>${(v["f1-score"] * 100).toFixed(1)}%</td><td>${v.support}</td></tr>`).join("");
      pc.innerHTML = `<table class="pc-table"><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr>${rows}</table>`;
    } else {
      pc.innerHTML = `<p class="pc-empty small">Per-class precision/recall generates after the retrain finishes.</p>`;
    }
  }
}

/* ---------------- recent grades feed ---------------- */
let lastRecent = "";
const recents = [];
function pushRecent(fruit, tier) {
  recents.unshift({ fruit, tier });
  if (recents.length > 8) recents.pop();
  renderRecent();
}
function renderRecent() {
  const ul = $("recent-list"); if (!ul) return;
  if (!recents.length) { ul.innerHTML = `<li class="muted small">No scans yet, start the camera or grade a batch.</li>`; return; }
  ul.innerHTML = recents.map(r => {
    const c = { fresh: "var(--st-fresh)", sell_soon: "var(--st-sell)", reject: "var(--st-reject)", review: "var(--st-review)" }[r.tier] || "var(--ink-3)";
    const t = (TIERS[r.tier] || {}).text || r.tier;
    return `<li><span class="rdot" style="background:${c}"></span><b>${prettyFruit(r.fruit)}</b><span class="muted small">${t}</span></li>`;
  }).join("");
}

/* ---------------- playful per-fruit reactions ---------------- */
const FRUIT_FUN = {
  banana: { e: "🍌", p: "the minions approve 🟡" }, apple: { e: "🍎", p: "how do you like them apples?" },
  orange: { e: "🍊", p: "orange you glad it's fresh?" }, strawberry: { e: "🍓", p: "berry nice." },
  mango: { e: "🥭", p: "mango-nificent." }, tomato: { e: "🍅", p: "you say tomato…" },
  potato: { e: "🥔", p: "a-peeling spud." }, cucumber: { e: "🥒", p: "cool as a cucumber." },
  bellpepper: { e: "🫑", p: "pepper-fectly fresh." }, carrot: { e: "🥕", p: "what's up, doc?" },
};
// original goggly-eyed banana mascot (our own art, not a Minion)
const BANANA_BUDDY = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M28 16c-7 28 5 53 38 59 7 1 11-3 8-8-23-6-32-27-28-49 1-6-5-8-8-2z" fill="#f6c945" stroke="#caa12f" stroke-width="2"/>
  <path d="M30 14c-1 3-2 5-2 7 3-1 6-1 8 0 0-3 0-5-1-7-1-3-4-3-5 0z" fill="#7a6a2a"/>
  <circle cx="47" cy="42" r="12" fill="#fff" stroke="#5a4a1a" stroke-width="3"/>
  <circle cx="64" cy="46" r="12" fill="#fff" stroke="#5a4a1a" stroke-width="3"/>
  <circle cx="49" cy="43" r="4.5" fill="#26241f"/>
  <circle cx="66" cy="47" r="4.5" fill="#26241f"/>
  <path d="M45 61c6 5 15 6 21 1" fill="none" stroke="#5a4a1a" stroke-width="3" stroke-linecap="round"/>
</svg>`;
function sayBanana() {
  if (!soundOn) return;
  try {
    const u = new SpeechSynthesisUtterance("Bananaaa!");
    u.pitch = 2; u.rate = 1.15; u.volume = 0.9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { /* speech not available */ }
}
function spawnBanana(r) {
  const b = document.createElement("div");
  b.className = "banana-buddy"; b.innerHTML = BANANA_BUDDY;
  b.style.left = (r.left + r.width * 0.5 - 44) + "px";
  b.style.top = (r.top + r.height * 0.35) + "px";
  document.body.appendChild(b);
  b.addEventListener("animationend", () => b.remove(), { once: true });
}
function fruitReaction(fruit, tier) {
  const v = $("verdict"); if (!v) return;
  const f = FRUIT_FUN[fruit];
  const e = tier === "reject" ? "🥲" : tier === "sell_soon" ? "⏳" : (f ? f.e : "✨");
  const r = v.getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("span");
    s.className = "fruit-pop"; s.textContent = e;
    s.style.left = (r.left + r.width * (0.2 + Math.random() * 0.6)) + "px";
    s.style.top = (r.top + r.height * 0.5) + "px";
    s.style.animationDelay = (i * 90) + "ms";
    document.body.appendChild(s);
    s.addEventListener("animationend", () => s.remove(), { once: true });
  }
  if (fruit === "banana" && tier !== "reject") { spawnBanana(r); sayBanana(); }
  if (tier === "fresh" && f && Math.random() < 0.5) toast(f.p, "good");
}

/* ---------------- demo easter egg: a face fills the frame ---------------- */
let easterActive = false;
function renderEaster(m) {
  setVerdict("legend", "LEGENDARY FIND", m.note || "");
  const lines = (m.fun && m.fun.lines) || [["Specimen", m.fruit]];
  $("details").innerHTML = lines
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  if ($("heatmap-box")) $("heatmap-box").hidden = true;
  if ($("readout-card")) $("readout-card").hidden = true;
  if (!easterActive) {            // celebrate only on the transition into it
    easterActive = true;
    easterCelebrate();
    toast(`${m.fruit} detected — certified legend`, "good");
    beep("high");
    if (window.ctxActivity) ctxActivity(`<b>${m.fruit}</b> detected — legendary 👑`, "fresh");
  }
}
function easterCelebrate() {
  const v = $("verdict"); if (!v) return;
  const r = v.getBoundingClientRect();
  const emojis = ["🎉", "👑", "🧔", "🔥", "⭐", "🏆"];
  for (let i = 0; i < 12; i++) {
    const s = document.createElement("span");
    s.className = "fruit-pop";
    s.textContent = emojis[i % emojis.length];
    s.style.left = (r.left + r.width * Math.random()) + "px";
    s.style.top = (r.top + r.height * (0.3 + Math.random() * 0.4)) + "px";
    s.style.animationDelay = (i * 55) + "ms";
    document.body.appendChild(s);
    s.addEventListener("animationend", () => s.remove(), { once: true });
  }
}

/* ---------------- batch grading (drag a folder of images) ---------------- */
const batchTally = { scanned: 0, fresh: 0, flagged: 0, recovered: 0 };
function tallyBatch(m) {
  batchTally.scanned++;
  if (m.tier === "fresh") batchTally.fresh++;
  if (m.tier === "sell_soon" || m.tier === "reject") batchTally.flagged++;
  batchTally.recovered += m.recovered || 0;
  $("k-scanned").textContent = batchTally.scanned;
  $("k-fresh").textContent = batchTally.fresh;
  $("k-flagged").textContent = batchTally.flagged;
  $("k-recovered").textContent = "€" + batchTally.recovered.toFixed(2);
}
async function gradeBatch(files) {
  if (!files.length) return;
  switchTab("scan");
  toast(`Grading ${files.length} image${files.length > 1 ? "s" : ""}…`);
  let n = 0;
  for (const f of files) {
    try {
      const fd = new FormData(); fd.append("file", f);
      const data = await (await fetch(`${API}/api/predict?mode=single&explain=false&log=true`, { method: "POST", body: fd })).json();
      const dets = data.detections || [];
      if (dets.length) {
        const m = dets.reduce((a, b) => area(a) >= area(b) ? a : b);
        if (["fresh", "sell_soon", "reject"].includes(m.tier)) { pushRecent(m.fruit, m.tier); tallyBatch(m); }
      }
      n++;
    } catch (e) { /* skip bad file */ }
  }
  toast(`Batch done, ${n} graded · €${batchTally.recovered.toFixed(2)} recoverable`, "good");
}
if ($("file-batch")) $("file-batch").onchange = (ev) => gradeBatch([...ev.target.files]);

/* ---------------- daily report (printable / PDF) ---------------- */
if ($("btn-report")) $("btn-report").onclick = async () => {
  let hist = {}, fc = {}, pf = {};
  try { hist = await (await fetch(`${API}/api/history`)).json(); } catch (e) {}
  try { fc = await (await fetch(`${API}/api/forecast?live=false`)).json(); } catch (e) {}
  try { pf = await (await fetch(`${API}/api/forecast/produce`)).json(); } catch (e) {}
  const ap = fc.action_plan || {}, t = hist.by_tier || {};
  const w = window.open("", "_blank"); if (!w) { toast("Allow pop-ups to open the report"); return; }
  const rows = (pf.items || []).map(i => `<tr><td>${i.key}</td><td>${i.forecast7}</td><td>${i.reorder}</td></tr>`).join("");
  w.document.write(`<html><head><title>FreshGuard Daily Report</title><style>
    body{font-family:Georgia,serif;color:#16231a;padding:48px;max-width:740px;margin:auto}
    h1{font-size:34px;margin:0;letter-spacing:-.01em}.sub{color:#6b7a68;margin-top:4px}
    .k{display:flex;gap:40px;margin:28px 0}.k div b{font-size:30px;display:block;color:#0e2412}.k div span{color:#6b7a68;font-size:13px}
    h2{margin-top:30px;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:10px;font-family:Arial}
    td,th{border-bottom:1px solid #e3e0d6;padding:8px 6px;text-align:left}th{color:#6b7a68;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
    .foot{margin-top:36px;color:#9aa392;font-size:12px}.gold{color:#2f8500}</style></head><body>
    <h1>FreshGuard Daily Report</h1><p class="sub">${new Date().toLocaleString()}</p>
    <div class="k"><div><b>${hist.total || 0}</b><span>items graded</span></div><div><b class="gold">€${(hist.recovered_eur || 0).toFixed(2)}</b><span>recovered</span></div><div><b>${t.reject || 0}</b><span>rejected</span></div></div>
    <h2>This week · LSTM forecast</h2><p>${ap.reorder || "—"}<br>${ap.markdown_alert || ""}</p>
    <h2>Reorder plan · per produce</h2><table><tr><th>Produce</th><th>7-day demand</th><th>Reorder</th></tr>${rows}</table>
    <p class="foot">FreshGuard · AI produce freshness quality-control · IE University Deep Learning</p>
  </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 450);
};

/* ---------------- phone QR ---------------- */
if ($("btn-phone")) $("btn-phone").onclick = async () => {
  let url = location.origin;
  try {
    const d = await (await fetch(`${API}/api/lan`)).json();
    // Prefer the public HTTPS tunnel (camera works on the phone over https);
    // fall back to the LAN URL (same Wi-Fi, upload/batch only).
    if (d.public_url) url = d.public_url;
    else if (d.url) url = d.url;
  } catch (e) {}
  const full = url + "/?api=" + encodeURIComponent(url);
  $("qr-url").textContent = url;
  const c = $("qr-canvas"); c.innerHTML = "";
  try { new QRCode(c, { text: full, width: 208, height: 208, colorDark: "#0a0e0d", colorLight: "#f4faf0" }); }
  catch (e) { c.textContent = "QR library not loaded"; }
  $("qr-modal").hidden = false;
};
if ($("qr-close")) $("qr-close").onclick = () => $("qr-modal").hidden = true;
if ($("qr-modal")) $("qr-modal").onclick = (e) => { if (e.target.id === "qr-modal") $("qr-modal").hidden = true; };

/* ---------------- sound mute ---------------- */
function updateMute() { const b = $("btn-mute"); if (b) b.classList.toggle("is-off", !soundOn); }
if ($("btn-mute")) $("btn-mute").onclick = () => {
  soundOn = !soundOn; localStorage.setItem("fg_sound", soundOn ? "1" : "0");
  updateMute(); toast(soundOn ? "Sound on" : "Sound muted");
};

/* ---------------- theme toggle ---------------- */
function applyTheme(t) { document.body.classList.toggle("light", t === "light"); }
let theme = localStorage.getItem("fg_theme") || "dark";
if ($("btn-theme")) $("btn-theme").onclick = () => {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("fg_theme", theme); applyTheme(theme);
  if (!views.dashboard.hidden) fetchForecast(mode === "conveyor");   // recolor chart
  toast(theme === "light" ? "Light theme" : "Dark theme");
};

/* ---------------- dashboard today summary ---------------- */
async function loadToday() {
  try {
    const h = await (await fetch(`${API}/api/history`)).json();
    const t = h.by_tier || {};
    if ($("td-total")) $("td-total").textContent = h.total || 0;
    if ($("td-recovered")) $("td-recovered").textContent = "€" + (h.recovered_eur || 0).toFixed(2);
    if ($("td-fresh")) $("td-fresh").textContent = t.fresh || 0;
    if ($("td-flagged")) $("td-flagged").textContent = (t.sell_soon || 0) + (t.reject || 0);
    // ROI: recovered margin vs the cost of what still got binned
    const AVG_PRICE = 0.45, reject = t.reject || 0;
    const lost = reject * AVG_PRICE, saved = h.recovered_eur || 0;
    const rate = (saved + lost) > 0 ? saved / (saved + lost) : 0;
    if ($("roi-saved")) $("roi-saved").textContent = "€" + saved.toFixed(2);
    if ($("roi-lost")) $("roi-lost").textContent = "€" + lost.toFixed(2);
    if ($("roi-rate")) $("roi-rate").textContent = Math.round(rate * 100) + "%";
    if ($("roi-month")) $("roi-month").textContent = "€" + (saved * 30 / 7).toFixed(2);
    if ($("roi-fill")) $("roi-fill").style.width = Math.round(rate * 100) + "%";
    // Law 1/2025 compliance audit (logged sell-soon + reject calls)
    const sell = t.sell_soon || 0, rej = t.reject || 0;
    if ($("comp-diverted")) $("comp-diverted").textContent = sell + rej;
    if ($("comp-markdown")) $("comp-markdown").textContent = sell;
    if ($("comp-donate")) $("comp-donate").textContent = rej;
    if ($("comp-recovered")) $("comp-recovered").textContent = "€" + saved.toFixed(2);
    if ($("ctx-scanned")) $("ctx-scanned").textContent = h.total || 0;
    if ($("ctx-recovered")) $("ctx-recovered").textContent = "€" + Math.round(saved);
    if ($("ctx-flagged")) $("ctx-flagged").textContent = sell + rej;
  } catch (e) {}
}
async function loadProduceBoard() {
  const list = $("pb-list"); if (!list) return;
  let d; try { d = await (await fetch(`${API}/api/forecast/produce`)).json(); } catch (e) { return; }
  const items = (d.items || []).slice().sort((a, b) => b.forecast7 - a.forecast7);
  const max = Math.max(1, ...items.map((i) => i.forecast7));
  const spark = (vals) => {
    const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
    return vals.map((v, i) => `${(i / (vals.length - 1) * 100).toFixed(1)},${(26 - ((v - mn) / rng) * 24).toFixed(1)}`).join(" ");
  };
  list.innerHTML = items.map((it) => {
    const mk = (typeof MARKET !== "undefined" && MARKET.find((p) => p.key === it.key)) || {};
    const name = mk.name || prettyFruit(it.key), emoji = mk.emoji || "", up = it.trend_pct >= 0;
    return `<div class="pb-row">
      <div class="pb-name">${emoji ? `<span class="pb-emoji">${emoji}</span>` : ""}<b>${name}</b></div>
      <div class="pb-bar"><i style="width:${Math.round(it.forecast7 / max * 100)}%"></i></div>
      <div class="pb-num"><b class="num">${it.forecast7}</b><span>flagged/wk</span></div>
      <div class="pb-num"><b class="num">${it.reorder}</b><span>reorder</span></div>
      <div class="pb-trend ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(it.trend_pct).toFixed(0)}%</div>
      <svg class="pb-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline points="${spark(it.daily)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    </div>`;
  }).join("");
}

/* ---------------- keyboard shortcuts ---------------- */
document.addEventListener("keydown", (e) => {
  if (/input|select|textarea/i.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
  const map = {
    s: () => startCamera(), u: () => $("file-input") && $("file-input").click(),
    b: () => $("file-batch") && $("file-batch").click(), m: () => $("btn-mute") && $("btn-mute").click(),
    1: () => $("tab-scan").click(), 2: () => $("tab-dashboard").click(), 3: () => $("tab-market").click(),
    4: () => $("tab-review").click(), 5: () => $("tab-model").click(), 6: () => $("tab-lab").click(),
  };
  const fn = map[e.key.toLowerCase()];
  if (fn) { e.preventDefault(); fn(); }
});

/* init */
if ($("csv-link")) $("csv-link").href = `${API}/api/history.csv`;
applyTheme(theme);
$("details").innerHTML = PLACEHOLDER_DETAILS;   // never-empty readout
renderRecent(); updateMute(); loadToday();
listCameras().catch(() => {});
setMode("single");
moveRail("scan");
loadMarket();                       // seed real prices, then start ticking
setInterval(tickMarket, 2600);
fetchForecast(false);   // populate the scan-screen outlook card on load
refreshReviewBadge();   // show count on the Review nav badge
seedKpis();             // fill the scan KPI strip from history

/* ============ MODEL READOUT, top-3 probability bars · OOD · shelf-life ============ */
const DECISION = [];                                  // accumulated {rp, conf, fruit}
const THRESH = { tau: 0.70, lo: 0.40, hi: 0.65 };     // live-tunable decision thresholds

function prettyClass(name) {
  const rotten = name.startsWith("rotten");
  return (rotten ? "rotten " : "fresh ") + name.replace(/^(rotten|fresh)_/, "");
}
function renderReadout(m) {
  const card = $("readout-card");
  if (!m || !m.top || !m.top.length) { card.hidden = true; return; }
  card.hidden = false;
  $("readout-top").innerHTML = m.top.map(([name, p], i) =>
    `<div class="pbar ${i === 0 ? "is-top" : ""} ${name.startsWith("rotten") ? "rot" : "frsh"}">
       <span class="pbar-k">${prettyClass(name)}</span>
       <div class="pbar-track"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
       <b class="num">${(p * 100).toFixed(0)}%</b></div>`).join("");
  const conf = m.confidence || 0, cert = 1 - (m.entropy != null ? m.entropy : 1);
  $("m-conf").style.width = (conf * 100).toFixed(0) + "%";  $("m-conf-v").textContent = (conf * 100).toFixed(0) + "%";
  $("m-cert").style.width = (cert * 100).toFixed(0) + "%";  $("m-cert-v").textContent = (cert * 100).toFixed(0) + "%";
  $("m-shelf").textContent = m.shelf_life_days != null ? `${m.shelf_life_days}d` : "—";
  const ood = $("m-ood");
  if (conf < 0.42) { ood.textContent = "out-of-distribution"; ood.className = "ood-pill bad"; }
  else if ((m.entropy || 0) > 0.55) { ood.textContent = "uncertain"; ood.className = "ood-pill warn"; }
  else { ood.textContent = "in-distribution"; ood.className = "ood-pill ok"; }
  if (m.rotten_prob != null && m.confidence != null && ["fresh", "sell_soon", "reject", "review"].includes(m.tier)) {
    DECISION.push({ rp: m.rotten_prob, conf: m.confidence, fruit: m.fruit });
    if (DECISION.length > 120) DECISION.shift();
  }
}

/* ============ LAB, interactive decision-space + threshold tuning ============ */
function tierOf(rp, conf, t) {
  if (conf < t.tau) return "review";
  if (rp >= t.hi) return "reject";
  if (rp >= t.lo) return "sell_soon";
  return "fresh";
}
function renderDecision() {
  if (!$("dec-plot")) return;
  $("dec-n").textContent = DECISION.length;
  $("dec-empty").style.display = DECISION.length ? "none" : "inline";
  $("dec-band").style.left = (THRESH.lo * 100) + "%";
  $("dec-band").style.width = ((THRESH.hi - THRESH.lo) * 100) + "%";
  $("dec-tau-line").style.bottom = (THRESH.tau * 100) + "%";
  const tally = { fresh: 0, sell_soon: 0, reject: 0, review: 0 };
  $("dec-dots").innerHTML = DECISION.map((d) => {
    const t = tierOf(d.rp, d.conf, THRESH); tally[t]++;
    return `<span class="dec-dot ${t}" title="${prettyFruit(d.fruit)} · rot ${(d.rp*100).toFixed(0)}% · conf ${(d.conf*100).toFixed(0)}%" style="left:${(d.rp*100).toFixed(1)}%;bottom:${(d.conf*100).toFixed(1)}%"></span>`;
  }).join("");
  const n = DECISION.length || 1;
  $("dec-tally").innerHTML = ["fresh", "sell_soon", "reject", "review"].map((k) =>
    `<div class="tally ${k}"><b class="num">${tally[k]}</b><span>${k.replace("_", " ")} · ${Math.round(tally[k] / n * 100)}%</span></div>`).join("");
}
(function wireThresholds() {
  const bind = (id, key, vid) => {
    const el = $(id); if (!el) return;
    el.addEventListener("input", () => {
      THRESH[key] = parseFloat(el.value);
      if (key === "lo" && THRESH.lo > THRESH.hi - 0.05) { THRESH.hi = Math.min(0.95, THRESH.lo + 0.05); $("band-hi").value = THRESH.hi; $("band-hi-v").textContent = THRESH.hi.toFixed(2); }
      if (key === "hi" && THRESH.hi < THRESH.lo + 0.05) { THRESH.lo = Math.max(0.10, THRESH.hi - 0.05); $("band-lo").value = THRESH.lo; $("band-lo-v").textContent = THRESH.lo.toFixed(2); }
      $(vid).textContent = THRESH[key].toFixed(2);
      renderDecision();
    });
  };
  bind("tau", "tau", "tau-v"); bind("band-lo", "lo", "band-lo-v"); bind("band-hi", "hi", "band-hi-v");
  const reset = $("thresh-reset");
  if (reset) reset.addEventListener("click", () => {
    Object.assign(THRESH, { tau: 0.70, lo: 0.40, hi: 0.65 });
    $("tau").value = 0.70; $("band-lo").value = 0.40; $("band-hi").value = 0.65;
    $("tau-v").textContent = "0.70"; $("band-lo-v").textContent = "0.40"; $("band-hi-v").textContent = "0.65";
    renderDecision();
  });
})();

/* ============ LAB · model compare + augmentation playground ============ */
function tierChip(tier) {
  const s = TIERS[tier] || TIERS.untrained;
  return `<span class="tchip" style="--tc:${s.color}">${s.text}</span>`;
}
async function runCompare(file) {
  const body = $("compare-body");
  body.innerHTML = '<p class="muted small">Running all three models…</p>';
  try {
    const fd = new FormData(); fd.append("file", file);
    const d = await (await fetch(`${API}/api/compare`, { method: "POST", body: fd })).json();
    if (d.error) { body.innerHTML = `<p class="muted small">Error: ${d.error}</p>`; return; }
    const rows = (d.models || []).map((m) => {
      if (m.pending) return `<div class="cmp-row pending"><div class="cmp-name">${m.name}</div><div class="cmp-pending">training… check back shortly</div></div>`;
      const acc = m.test_acc != null ? `${(m.test_acc * 100).toFixed(1)}% test` : "";
      return `<div class="cmp-row ${m.key === "mobilenet" ? "win" : ""}">
        <div class="cmp-name">${m.name}<span>${acc}</span></div>
        <div class="cmp-verdict">${tierChip(m.tier)}<b>${prettyClass(m.label || "—")}</b></div>
        <div class="cmp-meta"><span>${(m.confidence * 100).toFixed(0)}% conf</span><span class="num">${m.ms} ms</span></div></div>`;
    }).join("");
    body.innerHTML = `<div class="cmp-grid"><img class="cmp-thumb" src="${d.thumb || ""}" alt=""><div class="cmp-rows">${rows}</div></div>`;
    LAST_COMPARE = d;
    if ($("compare-export")) $("compare-export").hidden = false;
  } catch (e) { body.innerHTML = '<p class="muted small">Compare failed, is the backend running?</p>'; }
}
let LAST_COMPARE = null;
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
if ($("compare-export")) $("compare-export").addEventListener("click", () => {
  if (!LAST_COMPARE) return;
  const rows = [["model", "verdict", "label", "confidence", "inference_ms", "test_accuracy"]];
  LAST_COMPARE.models.forEach((m) => { if (!m.pending) rows.push([m.name, m.tier, m.label, m.confidence, m.ms, m.test_acc]); });
  downloadCSV("freshguard_model_compare.csv", rows);
});
async function runAugment(file) {
  const body = $("augment-body");
  body.innerHTML = '<p class="muted small">Applying transforms…</p>';
  try {
    const fd = new FormData(); fd.append("file", file);
    const d = await (await fetch(`${API}/api/augment`, { method: "POST", body: fd })).json();
    if (!d.variants || !d.variants.length) { body.innerHTML = '<p class="muted small">No variants (model not trained?).</p>'; return; }
    body.innerHTML = `<div class="aug-grid">${d.variants.map((v) => `
      <div class="aug-cell"><img src="${v.thumb}" alt=""><div class="aug-name">${v.name}</div>
      <div class="aug-verdict">${tierChip(v.tier)}</div>
      <div class="aug-lab">${prettyClass(v.label || "—")} · ${(v.confidence * 100).toFixed(0)}%</div></div>`).join("")}</div>`;
  } catch (e) { body.innerHTML = '<p class="muted small">Augment failed.</p>'; }
}
if ($("compare-file")) $("compare-file").addEventListener("change", (e) => { if (e.target.files[0]) runCompare(e.target.files[0]); });
if ($("augment-file")) $("augment-file").addEventListener("change", (e) => { if (e.target.files[0]) runAugment(e.target.files[0]); });
if ($("market-refresh")) $("market-refresh").addEventListener("click", () => loadMarket(true));

/* ============ LAB · embedding map + Grad-CAM gallery ============ */
const PRODUCE_COLORS = {
  apple: "#a8ff35", banana: "#f5d33d", orange: "#ff9f43", carrot: "#ff7a1a",
  tomato: "#ff5c5c", potato: "#c9a06a", cucumber: "#43e5c0", bellpepper: "#8fb8ff",
  mango: "#ffd24a", strawberry: "#ff6b9d",
};
let EMB = null, embMode = "produce", GALLERY = false;

function drawEmbeddings(prog) {
  prog = prog == null ? 1 : prog;                 // 0..1 fly-in factor (anime.js)
  const cv = $("embed-canvas"); if (!cv || !EMB) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 640, h = 440;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const pad = 18, cx = w / 2, cy = h / 2;
  for (const p of EMB) {
    const tx = pad + p.x * (w - 2 * pad), ty = pad + (1 - p.y) * (h - 2 * pad);
    const x = cx + (tx - cx) * prog, y = cy + (ty - cy) * prog;   // ease out from centre
    c.beginPath(); c.arc(x, y, 3.4, 0, 7);
    c.fillStyle = embMode === "fresh" ? (p.rotten ? "#ff5c5c" : "#a8ff35") : (PRODUCE_COLORS[p.produce] || "#888");
    c.globalAlpha = 0.85 * prog; c.fill();
  }
  c.globalAlpha = 1;
}
function buildEmbLegend() {
  const el = $("embed-legend"); if (!el) return;
  el.innerHTML = embMode === "fresh"
    ? '<span class="lg"><i style="background:#a8ff35"></i>fresh</span><span class="lg"><i style="background:#ff5c5c"></i>rotten</span>'
    : Object.entries(PRODUCE_COLORS).map(([k, v]) => `<span class="lg"><i style="background:${v}"></i>${k}</span>`).join("");
}
async function loadEmbeddings() {
  if (!EMB) {
    try { EMB = (await (await fetch(`${API}/api/embeddings`)).json()).points || []; }
    catch (e) { EMB = []; }
  }
  if ($("embed-empty")) $("embed-empty").style.display = EMB.length ? "none" : "inline";
  buildEmbLegend();
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (window.anime && !reduce && EMB.length && !EMB._flew) {
    EMB._flew = true;                                // anime.js fly-in, once
    const d = { p: 0 };
    requestAnimationFrame(() => window.anime.animate(d, { p: 1, duration: 1100, ease: "outCubic", onUpdate: () => drawEmbeddings(d.p) }));
  } else {
    requestAnimationFrame(() => drawEmbeddings(1));
  }
}
async function loadGradcam() {
  const grid = $("gradcam-grid"); if (!grid || GALLERY) return;
  try {
    const d = await (await fetch(`${API}/api/gradcam_gallery`)).json();
    if (!d.items || !d.items.length) { grid.innerHTML = '<p class="muted small">Gallery not built yet, run scripts/build_gradcam_gallery.py</p>'; return; }
    grid.innerHTML = d.items.map((it) => `<figure class="gc-cell"><img src="${it.img}" alt="${it.label}" loading="lazy"><figcaption>${prettyClass(it.label)}</figcaption></figure>`).join("");
    GALLERY = true;
  } catch (e) { grid.innerHTML = '<p class="muted small">Gallery failed to load.</p>'; }
}
function loadLab() { renderDecision(); loadEmbeddings(); loadGradcam(); }

document.querySelectorAll("#embed-toggle .seg").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#embed-toggle .seg").forEach((x) => x.classList.remove("is-active"));
  b.classList.add("is-active"); embMode = b.dataset.mode; drawEmbeddings(); buildEmbLegend();
}));
window.addEventListener("resize", () => { if (activeTab === "lab") drawEmbeddings(); });

/* ============ MODEL TAB, racing ablation bars + interactive confusion matrix ============ */
function raceBars() {
  const fills = document.querySelectorAll("#model-bars .mbar-fill");
  const nums = document.querySelectorAll("#model-bars .mbar-head b");
  if (window.anime && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    fills.forEach((f) => window.anime.animate(f, { width: f.dataset.w + "%", duration: 1100, delay: 120, ease: "outExpo" }));
    nums.forEach((b) => { const t = +b.dataset.acc, o = { v: 0 }; window.anime.animate(o, { v: t, duration: 1100, ease: "outExpo", onUpdate: () => { b.textContent = (o.v * 100).toFixed(1) + "%"; } }); });
  } else {
    requestAnimationFrame(() => { fills.forEach((f) => { f.style.width = f.dataset.w + "%"; }); nums.forEach((b) => { b.textContent = (+b.dataset.acc * 100).toFixed(1) + "%"; }); });
  }
}
let CM = null;
async function renderConfusion() {
  const cv = $("cm-canvas"); if (!cv) return;
  if (!CM) { try { CM = await (await fetch(`${API}/api/confusion`)).json(); } catch (e) { CM = { classes: [], matrix: [] }; } }
  if (!CM.matrix || !CM.matrix.length) { if ($("cm-acc")) $("cm-acc").textContent = "building…"; return; }
  if ($("cm-acc") && CM.accuracy != null) $("cm-acc").textContent = (CM.accuracy * 100).toFixed(1) + "% overall";
  if (window.anime && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    const o = { p: 0 }; window.anime.animate(o, { p: 1, duration: 950, ease: "outCubic", onUpdate: () => drawConfusion(o.p) });
  } else drawConfusion(1);
}
function drawConfusion(prog) {
  const cv = $("cm-canvas"); if (!cv || !CM || !CM.matrix.length) return;
  const n = CM.classes.length, side = Math.min(cv.clientWidth || 520, 560), dpr = window.devicePixelRatio || 1;
  cv.width = side * dpr; cv.height = side * dpr; cv.style.height = side + "px";
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, side, side);
  const cell = side / n;
  for (let i = 0; i < n; i++) {
    if (i > prog * n) continue;                       // reveal rows top→down
    const row = CM.matrix[i], sum = row.reduce((a, b) => a + b, 0) || 1;
    for (let j = 0; j < n; j++) {
      const frac = row[j] / sum, x = j * cell, y = i * cell, diag = i === j;
      let col;
      if (frac <= 0) col = "rgba(234,242,236,0.035)";
      else if (diag) col = `rgba(168,255,53,${(0.18 + 0.82 * Math.pow(frac, 0.55)).toFixed(3)})`;
      else col = `rgba(255,92,76,${(0.16 + 0.84 * Math.pow(frac, 0.55)).toFixed(3)})`;
      c.fillStyle = col; c.fillRect(x + 0.6, y + 0.6, cell - 1.2, cell - 1.2);
    }
  }
}
(function cmHover() {
  const cv = $("cm-canvas"), tip = $("cm-tip"); if (!cv || !tip) return;
  cv.addEventListener("mousemove", (e) => {
    if (!CM || !CM.matrix.length) return;
    const n = CM.classes.length, side = Math.min(cv.clientWidth || 520, 560), cell = side / n, r = cv.getBoundingClientRect();
    const j = Math.floor((e.clientX - r.left) / cell), i = Math.floor((e.clientY - r.top) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) { tip.hidden = true; return; }
    const cnt = CM.matrix[i][j];
    tip.innerHTML = `<b>true</b> ${CM.classes[i].replace("_", " ")}<br><b>pred</b> ${CM.classes[j].replace("_", " ")}<br><span class="num">${cnt}</span> ${i === j ? "correct" : "confused"}`;
    tip.style.left = Math.min(e.clientX - r.left + 14, side - 150) + "px";
    tip.style.top = (e.clientY - r.top + 14) + "px"; tip.hidden = false;
  });
  cv.addEventListener("mouseleave", () => { tip.hidden = true; });
})();
window.addEventListener("resize", () => { if (activeTab === "model" && CM && CM.matrix.length) drawConfusion(1); });

/* ============ MODEL TAB, ROC + calibration (Chart.js) ============ */
let rocChart = null, calChart = null;
async function renderEval() {
  let d; try { d = await (await fetch(`${API}/api/eval`)).json(); } catch (e) { return; }
  if (!d || !d.roc) { if ($("roc-auc")) $("roc-auc").textContent = "building…"; return; }
  if ($("roc-auc")) $("roc-auc").textContent = "AUC " + d.roc.auc.toFixed(4);
  const light = document.body.classList.contains("light");
  const grid = light ? "rgba(14,26,20,.10)" : "rgba(234,242,236,.08)";
  const tick = light ? "rgba(14,26,20,.6)" : "rgba(234,242,236,.5)";
  const opts = (xl, yl) => ({ responsive: true, maintainAspectRatio: false, animation: { duration: 700 },
    plugins: { legend: { display: false } },
    scales: {
      x: { type: "linear", min: 0, max: 1, title: { display: true, text: xl, color: tick }, grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 6 } },
      y: { min: 0, max: 1, title: { display: true, text: yl, color: tick }, grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 6 } },
    } });
  if (rocChart) rocChart.destroy();
  rocChart = new Chart($("roc-canvas").getContext("2d"), { type: "line", data: { datasets: [
    { data: d.roc.fpr.map((f, i) => ({ x: f, y: d.roc.tpr[i] })), borderColor: "#a8ff35", backgroundColor: "rgba(168,255,53,.12)", fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.08 },
    { data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: tick, borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false },
  ] }, options: opts("false positive rate", "true positive rate") });
  if (calChart) calChart.destroy();
  const pts = d.calibration.filter((b) => b.acc != null).map((b) => ({ x: b.conf, y: b.acc }));
  calChart = new Chart($("cal-canvas").getContext("2d"), { type: "line", data: { datasets: [
    { data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: tick, borderWidth: 1, borderDash: [5, 5], pointRadius: 0 },
    { data: pts, borderColor: "#43e5c0", backgroundColor: "rgba(67,229,192,.14)", fill: false, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#43e5c0", tension: 0.1 },
  ] }, options: opts("predicted confidence", "actual accuracy") });
  if (d.weak && $("weak-card")) {
    $("weak-card").hidden = false;
    $("weak-line").innerHTML = `<b>${prettyClass(d.weak.class)}</b>, recall <b class="num">${(d.weak.recall * 100).toFixed(0)}%</b>. Overall test accuracy <b class="num">${(d.overall_acc * 100).toFixed(1)}%</b> · fresh-vs-rotten <b class="num">AUC ${d.roc.auc.toFixed(4)}</b>.`;
  }
}

/* ============ MANAGER, business impact projector ============ */
(function impactProjector() {
  const s = $("stores"); if (!s) return;
  const fmtEur = (v) => v >= 1e6 ? "€" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "€" + (v / 1e3).toFixed(0) + "k" : "€" + Math.round(v);
  const upd = () => { const n = +s.value; $("stores-v").textContent = n; $("imp-recovered").textContent = fmtEur(n * 18000); $("imp-saas").textContent = fmtEur(n * 3000); };
  s.addEventListener("input", upd); upd();
})();

/* ============ CONTEXT RAIL, live deployment context ============ */
(function contextRail() {
  const feed = $("ctx-feed"); if (!feed) return;
  const pad = (n) => String(n).padStart(2, "0");
  const now = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
  const clock = () => { const c = $("ctx-clock"); if (c) c.textContent = now() + " CET"; };
  setInterval(clock, 1000); clock();

  window.ctxActivity = (html, kind) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="fdot ${kind || "sys"}"></span><span>${html}</span><span class="ftime">${now()}</span>`;
    feed.prepend(li);
    while (feed.children.length > 40) feed.lastChild.remove();
  };
  window.ctxStatus = (id, text, cls) => { const e = $(id); if (e) { e.textContent = text; e.className = "ctx-stat" + (cls ? " " + cls : ""); } };

  const boot = [
    ["Node MAD-04 online · firmware REV 2.6", "sys"],
    ["MobileNetV2 classifier loaded · 95.6%", "sys"],
    ["LSTM forecast model synced", "sys"],
    ["YOLOv8n detector armed", "sys"],
    ["Market feed connected", "sys"],
  ];
  boot.forEach((b, i) => setTimeout(() => window.ctxActivity(b[0], b[1]), 240 * i));

  const periodic = [
    ["Forecast re-run · 7-day horizon", "sys"],
    ["Market prices refreshed", "sys"],
    ["Active-learning queue checked", "sys"],
    ["Shelf sweep · aisle 4 complete", "sys"],
  ];
  let pi = 0;
  setInterval(() => { if (!document.hidden) window.ctxActivity(periodic[pi++ % periodic.length][0], "sys"); }, 22000);
})();

/* FreshGuard frontend — camera loop, overlay, money counter, dashboard. */

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
  fresh:     { color: "#22c55e", text: "FRESH" },
  sell_soon: { color: "#f5b53d", text: "SELL SOON" },
  reject:    { color: "#ef4444", text: "REJECT" },
  review:    { color: "#818cf8", text: "NEEDS REVIEW" },
  untrained: { color: "#61748c", text: "MODEL NOT TRAINED" },
};

/* ---------------- hero → app ---------------- */
$("hero-enter").onclick = () => {
  const hero = $("hero");
  $("app").hidden = false;
  hero.classList.add("leaving");
  setTimeout(() => { hero.style.display = "none"; }, 700);
  fetchForecast(false);   // now the outlook card is visible — size the sparkline
};

/* ---------------- tabs ---------------- */
const views = { scan: $("view-scan"), dashboard: $("view-dashboard") };
$("tab-scan").onclick = () => switchTab("scan");
$("tab-dashboard").onclick = () => { switchTab("dashboard"); fetchForecast(mode === "conveyor"); };
function switchTab(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  $("tab-scan").classList.toggle("is-active", name === "scan");
  $("tab-dashboard").classList.toggle("is-active", name === "dashboard");
  $("tab-scan").setAttribute("aria-selected", name === "scan");
  $("tab-dashboard").setAttribute("aria-selected", name === "dashboard");
}

/* ---------------- health ---------------- */
fetch(`${API}/api/health`).then(r => r.json()).then(h => {
  if (h.classifier_loaded) { statusText.textContent = "model live"; statusPill.className = "status-pill ok"; }
  else { statusText.textContent = "classifier not trained"; statusPill.className = "status-pill warn"; }
}).catch(() => { statusText.textContent = "backend offline"; statusPill.className = "status-pill err"; });

/* ---------------- camera ---------------- */
async function listCameras() {
  const sel = $("camera-select");
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === "videoinput");
  sel.innerHTML = cams.map((d, i) => `<option value="${d.deviceId}">${d.label || "Camera " + (i + 1)}</option>`).join("");
}

async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const deviceId = $("camera-select").value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
      audio: false,
    });
  } catch (e) { alert("Camera access denied or unavailable. You can still use Upload."); return; }
  video.srcObject = stream;
  $("video-empty").hidden = true;
  $("scanline").hidden = false;
  $("btn-explain").disabled = false;
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
    const res = await fetch(`${API}/api/predict?mode=${mode}&explain=${explain}`, { method: "POST", body: fd });
    render(await res.json());
    $("fps-val").textContent = Math.round(performance.now() - t0);
  } catch (e) { /* keep loop alive */ }
  busy = false;
}
$("btn-explain").onclick = () => sendFrame(true);

/* ---------------- upload ---------------- */
function wireUpload(input) {
  input.onchange = async (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`${API}/api/predict?mode=single&explain=true`, { method: "POST", body: fd });
    const data = await res.json();
    const img = new Image();
    img.onload = () => { overlay.width = img.width; overlay.height = img.height;
      $("video-empty").hidden = true; render(data); };
    img.src = URL.createObjectURL(file);
  };
}
wireUpload($("file-input")); wireUpload($("file-input-2"));

/* ---------------- rendering ---------------- */
function render(data) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!data || data.error) return;
  const dets = data.detections || [];

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
    ctx.font = `600 ${Math.max(13, overlay.width / 48)}px "Hanken Grotesk", sans-serif`;
    const pad = 7, tw = ctx.measureText(tag).width + pad * 2, th = Math.max(20, overlay.width / 34);
    ctx.fillStyle = s.color;
    roundRect(ctx, x1, Math.max(0, y1 - th - 2), tw, th, 6); ctx.fill();
    ctx.fillStyle = "#06140b"; ctx.textBaseline = "middle";
    ctx.fillText(tag, x1 + pad, Math.max(th / 2, y1 - th / 2 - 2));
  }

  // panel: largest detection drives the verdict
  if (!dets.length) {
    setVerdict("idle", "No item in view", "hold produce up to the camera");
    $("details").innerHTML = ""; $("heatmap-box").hidden = true;
  } else {
    const m = dets.reduce((a, b) => area(a) >= area(b) ? a : b);
    const s = TIERS[m.tier] || TIERS.untrained;
    const sub = m.tier === "review"
      ? `low confidence — flagged for human review`
      : (m.action || m.note || "");
    setVerdict(m.tier, s.text, sub);
    $("details").innerHTML = [
      ["Item", prettyFruit(m.fruit)],
      ["Detector conf.", m.source === "fallback" ? "center-crop" : pct(m.det_conf)],
      ["Grade conf.", pct(m.confidence)],
      m.tier === "review" ? ["Would guess", (m.tier_raw || "—").replace("_", " ")] : null,
      ["Rot probability", pct(m.rotten_prob)],
      ["Decay surface", pct(m.severity)],
      ["Unit price", m.unit_price != null ? "€" + m.unit_price.toFixed(2) : "—"],
      ["Recoverable", m.recovered ? "€" + m.recovered.toFixed(2) : "—"],
      ["Detector ↔ model", m.fruit_agreement == null ? "—" : (m.fruit_agreement ? "agree" : "⚠ differ")],
    ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v ?? "—"}</dd>`).join("");
    if (m.heatmap_png) { $("heatmap-img").src = `data:image/png;base64,${m.heatmap_png}`; $("heatmap-box").hidden = false; }
  }

  if (data.session) {
    $("c-scanned").textContent = data.session.scanned;
    $("c-fresh").textContent = data.session.fresh;
    $("c-sellsoon").textContent = data.session.sell_soon;
    $("c-reject").textContent = data.session.reject;
    $("c-review").textContent = data.session.review || 0;
    animateMoney(data.session.recovered_eur || 0);
  }
}

function setVerdict(tier, label, sub) {
  const v = $("verdict");
  const changed = v.dataset.tier !== tier;
  v.className = "verdict card " + (tier === "idle" ? "" : tier);
  v.dataset.tier = tier;
  if (changed) {            // re-trigger the pop animation on a real change
    v.classList.remove("pop"); void v.offsetWidth; v.classList.add("pop");
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

/* ---------------- forecast (RNN) — surfaced on scan screen + dashboard ---------------- */
let chart = null, fcTimer = null;

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
  const grad = c.createLinearGradient(0, 0, 0, 240);
  grad.addColorStop(0, "rgba(34,197,94,0.28)"); grad.addColorStop(1, "rgba(34,197,94,0)");
  chart = new Chart(c, {
    type: "line",
    data: { labels, datasets: [
      { label: "Flagged / day", data: hist, borderColor: "#22c55e", backgroundColor: grad, fill: true, pointRadius: 0, borderWidth: 2, tension: 0.35 },
      { label: "LSTM forecast", data: fore, borderColor: "#f5b53d", borderDash: [6, 4], pointRadius: 2, borderWidth: 2, tension: 0.35 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: { legend: { labels: { color: "#8aa0b8", usePointStyle: true, boxWidth: 8 } },
                 tooltip: { backgroundColor: "#0f1a2e", borderColor: "#1e2a40", borderWidth: 1 } },
      scales: {
        x: { ticks: { color: "#61748c", maxTicksLimit: 8, font: { size: 10 } }, grid: { color: "#16203250" } },
        y: { ticks: { color: "#61748c", font: { size: 10 } }, grid: { color: "#16203250" }, beginAtZero: true },
      },
    },
  });
}

/* init */
listCameras().catch(() => {});
setMode("single");
fetchForecast(false);   // populate the scan-screen outlook card on load

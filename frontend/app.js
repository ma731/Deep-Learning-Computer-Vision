/* FreshGuard frontend — camera loop, overlay drawing, dashboard chart. */

const API = "";          // same origin
const FPS_INTERVAL = 400; // ms between frames sent to the backend

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const verdictEl = document.getElementById("verdict");
const detailsEl = document.getElementById("details");
const countsEl = document.getElementById("session-counts");
const heatmapBox = document.getElementById("heatmap-box");
const heatmapImg = document.getElementById("heatmap-img");
const statusEl = document.getElementById("model-status");

let mode = "single";
let stream = null;
let loopTimer = null;
let busy = false;

const TIER_STYLES = {
  fresh: { color: "#34c477", text: "FRESH" },
  sell_soon: { color: "#e8b545", text: "SELL SOON" },
  reject: { color: "#e85d5d", text: "REJECT" },
  untrained: { color: "#93a89b", text: "MODEL NOT TRAINED" },
};

/* ---------------- tabs ---------------- */
const views = { scan: document.getElementById("view-scan"), dashboard: document.getElementById("view-dashboard") };
document.getElementById("tab-scan").onclick = () => switchTab("scan");
document.getElementById("tab-dashboard").onclick = () => { switchTab("dashboard"); loadForecast(); };
function switchTab(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  document.getElementById("tab-scan").classList.toggle("active", name === "scan");
  document.getElementById("tab-dashboard").classList.toggle("active", name === "dashboard");
}

/* ---------------- health ---------------- */
fetch(`${API}/api/health`).then(r => r.json()).then(h => {
  statusEl.textContent = h.classifier_loaded ? "model loaded" : "classifier not trained yet";
  statusEl.className = "status " + (h.classifier_loaded ? "ok" : "warn");
}).catch(() => { statusEl.textContent = "backend offline"; statusEl.className = "status warn"; });

/* ---------------- camera ---------------- */
async function listCameras() {
  const sel = document.getElementById("camera-select");
  const devices = await navigator.mediaDevices.enumerateDevices();
  sel.innerHTML = "";
  devices.filter(d => d.kind === "videoinput").forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    sel.appendChild(opt);
  });
}

document.getElementById("btn-start").onclick = startCamera;
async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const deviceId = document.getElementById("camera-select").value;
  stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
    audio: false,
  });
  video.srcObject = stream;
  await listCameras(); // labels appear after permission is granted
  document.getElementById("btn-explain").disabled = false;
  video.onloadedmetadata = () => {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = setInterval(sendFrame, FPS_INTERVAL);
  };
}

/* ---------------- mode toggle ---------------- */
document.getElementById("mode-single").onclick = () => setMode("single");
document.getElementById("mode-conveyor").onclick = () => setMode("conveyor");
function setMode(m) {
  mode = m;
  document.getElementById("mode-single").classList.toggle("active", m === "single");
  document.getElementById("mode-conveyor").classList.toggle("active", m === "conveyor");
  countsEl.hidden = m !== "conveyor";
  document.getElementById("btn-reset").hidden = m !== "conveyor";
  heatmapBox.hidden = true;
}

document.getElementById("btn-reset").onclick = async () => {
  await fetch(`${API}/api/reset_session`, { method: "POST" });
};

/* ---------------- frame loop ---------------- */
const grabCanvas = document.createElement("canvas");

async function sendFrame(explain = false) {
  if (busy || !video.videoWidth) return;
  busy = true;
  try {
    grabCanvas.width = video.videoWidth;
    grabCanvas.height = video.videoHeight;
    grabCanvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise(res => grabCanvas.toBlob(res, "image/jpeg", 0.8));
    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    const r = await fetch(`${API}/api/predict?mode=${mode}&explain=${explain}`, { method: "POST", body: fd });
    render(await r.json());
  } catch (e) { /* keep the loop alive */ }
  busy = false;
}

document.getElementById("btn-explain").onclick = () => sendFrame(true);

/* ---------------- upload fallback ---------------- */
document.getElementById("file-input").onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API}/api/predict?mode=single&explain=true`, { method: "POST", body: fd });
  const data = await r.json();
  const img = new Image();
  img.onload = () => {
    overlay.width = img.width; overlay.height = img.height;
    render(data);
  };
  img.src = URL.createObjectURL(file);
};

/* ---------------- rendering ---------------- */
function render(data) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (data.error) return;

  for (const det of data.detections || []) {
    const [x1, y1, x2, y2] = det.box;
    const style = TIER_STYLES[det.tier] || TIER_STYLES.untrained;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const tag = `${det.fruit.toUpperCase()}${det.track_id != null ? " #" + det.track_id : ""} — ${style.text}` +
                (det.rotten_prob != null ? ` ${(det.confidence * 100).toFixed(0)}%` : "");
    ctx.font = "bold 16px system-ui";
    const w = ctx.measureText(tag).width + 12;
    ctx.fillStyle = style.color;
    ctx.fillRect(x1, Math.max(0, y1 - 24), w, 24);
    ctx.fillStyle = "#08130c";
    ctx.fillText(tag, x1 + 6, Math.max(16, y1 - 6));
  }

  // side panel: largest detection drives the verdict
  const dets = data.detections || [];
  if (!dets.length) {
    verdictEl.className = "verdict idle";
    verdictEl.textContent = "No fruit in view";
    detailsEl.innerHTML = "";
  } else {
    const main = dets.reduce((a, b) =>
      ((a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) >= (b.box[2] - b.box[0]) * (b.box[3] - b.box[1])) ? a : b);
    const style = TIER_STYLES[main.tier] || TIER_STYLES.untrained;
    verdictEl.className = `verdict ${main.tier}`;
    verdictEl.textContent = style.text;
    detailsEl.innerHTML = [
      ["Fruit", main.fruit],
      ["Detector confidence", fmtPct(main.det_conf)],
      ["Grade confidence", fmtPct(main.confidence)],
      ["Rot probability", fmtPct(main.rotten_prob)],
      ["Detector ↔ classifier agree", main.fruit_agreement == null ? "—" : (main.fruit_agreement ? "yes" : "no ⚠")],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v ?? "—"}</dd>`).join("");
    if (main.heatmap_png) {
      heatmapImg.src = `data:image/png;base64,${main.heatmap_png}`;
      heatmapBox.hidden = false;
    }
  }

  if (data.session) {
    document.getElementById("c-scanned").textContent = data.session.scanned;
    document.getElementById("c-fresh").textContent = data.session.fresh;
    document.getElementById("c-sellsoon").textContent = data.session.sell_soon;
    document.getElementById("c-reject").textContent = data.session.reject;
  }
}

const fmtPct = v => v == null ? "—" : `${(v * 100).toFixed(0)}%`;

/* ---------------- dashboard ---------------- */
let chart = null;
async function loadForecast() {
  const r = await fetch(`${API}/api/forecast`);
  const data = await r.json();
  document.getElementById("forecast-note").textContent = data.note || "LSTM forecast (trained on scan history)";
  const labels = [...data.history.dates, ...data.forecast.dates];
  const hist = [...data.history.values, ...Array(data.forecast.dates.length).fill(null)];
  const fore = [...Array(data.history.dates.length).fill(null), ...data.forecast.values];
  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("forecast-chart"), {
    type: "line",
    data: { labels, datasets: [
      { label: "Flagged items / day", data: hist, borderColor: "#34c477", pointRadius: 0, tension: 0.3 },
      { label: "LSTM forecast", data: fore, borderColor: "#e8b545", borderDash: [6, 4], pointRadius: 3, tension: 0.3 },
    ]},
    options: {
      scales: {
        x: { ticks: { color: "#93a89b", maxTicksLimit: 10 }, grid: { color: "#24332b" } },
        y: { ticks: { color: "#93a89b" }, grid: { color: "#24332b" } },
      },
      plugins: { legend: { labels: { color: "#e8efe9" } } },
    },
  });
}

/* init */
listCameras();
setMode("single");

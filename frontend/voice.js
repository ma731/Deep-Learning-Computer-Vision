/* FreshGuard voice assistant — free, browser-native (Web Speech API).
 *
 *  Listening : webkitSpeechRecognition / SpeechRecognition  (Chrome/Edge, no key, free)
 *  Speaking  : speechSynthesis                               (built-in, free)
 *
 * Fully client-side, zero cost, no build step. Drives every tab + the scanner
 * by clicking the real controls, and reads back live verdicts/metrics. Needs
 * https or localhost (mic) — both the laptop (:8000) and the ngrok phone URL
 * qualify. Degrades gracefully where SpeechRecognition is absent (e.g. iOS).
 *
 * Self-contained: injects its own button, panel and styles so nothing else in
 * the app has to change. Pull the <script> tag to remove it entirely.
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;

  /* ---------------- styles ---------------- */
  const css = `
  .fg-voice-fab{position:fixed;right:22px;bottom:22px;z-index:9999;width:60px;height:60px;border-radius:50%;
    border:1px solid rgba(168,255,53,.35);cursor:pointer;display:grid;place-content:center;
    background:radial-gradient(120% 120% at 30% 20%,#1a2412,#0b0f0a);color:#a8ff35;
    box-shadow:0 10px 30px -8px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.04);
    transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s,border-color .25s}
  .fg-voice-fab:hover{transform:translateY(-2px) scale(1.04)}
  .fg-voice-fab svg{width:26px;height:26px}
  .fg-voice-fab.listening{border-color:#a8ff35;box-shadow:0 0 0 0 rgba(168,255,53,.5),0 10px 30px -8px rgba(0,0,0,.6);
    animation:fgpulse 1.4s ease-out infinite}
  .fg-voice-fab.speaking{border-color:#8fb8ff;color:#8fb8ff}
  @keyframes fgpulse{0%{box-shadow:0 0 0 0 rgba(168,255,53,.45),0 10px 30px -8px rgba(0,0,0,.6)}
    70%{box-shadow:0 0 0 16px rgba(168,255,53,0),0 10px 30px -8px rgba(0,0,0,.6)}
    100%{box-shadow:0 0 0 0 rgba(168,255,53,0),0 10px 30px -8px rgba(0,0,0,.6)}}
  .fg-voice-panel{position:fixed;right:22px;bottom:94px;z-index:9999;max-width:320px;min-width:210px;
    padding:14px 16px;border-radius:16px;background:rgba(12,16,11,.86);backdrop-filter:blur(14px);
    border:1px solid rgba(255,255,255,.08);color:#e8efe6;font:500 13px/1.45 "Inter",system-ui,sans-serif;
    box-shadow:0 18px 44px -14px rgba(0,0,0,.7);opacity:0;transform:translateY(8px) scale(.98);
    pointer-events:none;transition:opacity .22s,transform .22s}
  .fg-voice-panel.show{opacity:1;transform:none}
  .fg-voice-k{font:600 10px/1 "IBM Plex Mono",monospace;letter-spacing:.16em;text-transform:uppercase;
    color:#a8ff35;display:flex;align-items:center;gap:7px;margin-bottom:8px}
  .fg-voice-k::before{content:"";width:7px;height:7px;border-radius:50%;background:#a8ff35;
    box-shadow:0 0 8px #a8ff35;animation:fgblink 1.5s ease-in-out infinite}
  @keyframes fgblink{0%,100%{opacity:1}50%{opacity:.35}}
  .fg-voice-heard{color:#aebbb2;font-size:12px;min-height:1.2em;margin-bottom:6px}
  .fg-voice-heard b{color:#fff;font-weight:600}
  .fg-voice-reply{color:#e8efe6}
  .fg-voice-hint{margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07);
    color:#7e8a84;font-size:11px}
  @media (prefers-reduced-motion:reduce){.fg-voice-fab.listening{animation:none}}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- UI ---------------- */
  const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4M8 22h8"/></svg>`;
  const fab = document.createElement("button");
  fab.className = "fg-voice-fab";
  fab.title = "FreshGuard voice assistant — click and speak";
  fab.setAttribute("aria-label", "Voice assistant");
  fab.innerHTML = MIC;
  const panel = document.createElement("div");
  panel.className = "fg-voice-panel";
  panel.innerHTML = `<div class="fg-voice-k" id="fg-voice-state">voice · ready</div>
    <div class="fg-voice-heard" id="fg-voice-heard"></div>
    <div class="fg-voice-reply" id="fg-voice-reply">Click the mic, then say “Hey FreshGuard, introduce yourself”, “scan this”, or “explain the model”.</div>
    <div class="fg-voice-hint">“Hey FreshGuard” to greet · “explain the forecast” · “narrate on” · “thank you FreshGuard” to stop</div>`;
  document.body.appendChild(panel);
  document.body.appendChild(fab);
  const stateEl = () => $("fg-voice-state"), heardEl = () => $("fg-voice-heard"), replyEl = () => $("fg-voice-reply");
  let panelTimer = null;
  function showPanel(sticky) {
    panel.classList.add("show");
    if (panelTimer) clearTimeout(panelTimer);
    if (!sticky && !listening) panelTimer = setTimeout(() => panel.classList.remove("show"), 6000);
  }
  function showHeard(t) { heardEl().innerHTML = `“<b>${t}</b>”`; showPanel(true); }
  function showReply(t) { replyEl().textContent = t; showPanel(false); }
  function setState(txt) { stateEl().textContent = txt; }

  /* ---------------- speaking ---------------- */
  let voice = null, speaking = false, lastSpokeAt = 0;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices() || [];
    voice = vs.find(v => /Google US English/i.test(v.name))
         || vs.find(v => /Microsoft (Aria|Jenny|Zira|Michelle)/i.test(v.name))
         || vs.find(v => v.lang === "en-US" && /google|microsoft|natural/i.test(v.name))
         || vs.find(v => (v.lang || "").startsWith("en")) || vs[0] || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  function say(text, cb) {
    showReply(text);
    if (!synth) { if (cb) cb(); return; }
    try { synth.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.03; u.pitch = 1.0; u.volume = 1.0;
    u.onstart = () => { speaking = true; fab.classList.add("speaking"); setState("speaking…"); };
    u.onend = () => {
      speaking = false; lastSpokeAt = Date.now(); fab.classList.remove("speaking");
      setState(listening ? "listening…" : "voice · ready");
      if (cb) cb();
    };
    synth.speak(u);
  }

  /* ---------------- acting on the app ---------------- */
  const click = (id) => { const el = $(id); if (el && !el.disabled) { el.click(); return true; } return false; };
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  function verdictSpeech() {
    const m = window.fgLastVerdict;
    if (!m || !m.fruit || m.fruit === "—") return "I don't see produce yet. Hold an item up to the camera.";
    const fruit = String(m.fruit).replace(/_/g, " ");
    const conf = (m.confidence != null) ? ` I'm ${Math.round(m.confidence * 100)} percent sure.` : "";
    switch (m.tier) {
      case "reject":    return `That ${fruit} is rotten. Reject it — pull it from the shelf.${conf}`;
      case "sell_soon": return `That ${fruit} is starting to turn. Sell it soon and mark it down.${conf}`;
      case "fresh":     return `That's a fresh ${fruit}. Safe to sell at full price.${conf}`;
      case "review":    return `I'm not fully sure about that ${fruit}, so I'm flagging it for a human to review.`;
      case "none":      return "I don't see any produce in view right now.";
      default:          return `${cap(fruit)}, graded ${m.tier}.`;
    }
  }

  /* ---------------- the assistant's own script ---------------- */
  const NAME = /\b(hey |ok |okay |yo |hi |hello )?fresh ?guard\b/;
  function revealApp() { const a = $("app"); if (a && a.hidden) { const he = $("hero-enter"); if (he) he.click(); } }
  function introduce() {
    revealApp(); click("tab-scan");
    return say("Hi, I'm FreshGuard — an AI produce quality inspector. I use a two-stage computer-vision pipeline: YOLO finds the item, then a fine-tuned MobileNet grades it fresh, sell-soon, or reject at 95.8 percent accuracy, and an LSTM forecasts spoilage a week ahead so shops mark down instead of binning. Hold produce up and say “scan this”, or ask me to explain the model, the forecast, or the business.");
  }
  const PARTS = {
    pipeline:  "FreshGuard is a two-stage vision pipeline. First, YOLO version 8 detects and tracks the item in frame. Then a fine-tuned MobileNet sorts it into one of twenty classes — ten produce types, each fresh or rotten — and maps that to a decision: fresh, sell soon, or reject. Alongside, an LSTM forecasts spoilage a week out, and classic OpenCV measures how much of the surface has decayed. Ask about the detector, the classifier, or the forecast to go deeper.",
    detect:    "Stage one is detection. A pretrained YOLO version 8 nano model finds the produce, and on a conveyor it tracks each item with ByteTrack so every piece is graded exactly once. For produce it doesn't know from its training set, we crop to the most colourful region and hand that to the classifier instead.",
    classifier:"Stage two is the classifier: MobileNet version 2, fine-tuned with transfer learning. In our ablation a plain neural net scored 32 percent, a convolutional net built from scratch 75, and MobileNet reached 95.8 percent — with three times fewer parameters. At inference we average a crop and its mirror, and vote over fifteen frames, for a steady live read.",
    forecast:  "The forecasting head is an LSTM recurrent network. It reads the recent spoilage trend and predicts the next seven days, so a shop knows what to reorder and what to mark down first. It cuts the error to about 3.6 units — roughly 43 percent better than a naive baseline, and close to the noise floor of the data.",
    business:  "The business case: about a tenth of fresh produce is lost to spoilage. By catching decay a day early, a shop marks the item down and recovers most of its value instead of binning it. It also supports Spain's Law one of twenty twenty-five, since loose produce carries no expiry label. That's the value-saved counter you watch tick up as I grade.",
    evaluation:"On evaluation: 95.8 percent overall accuracy, and a fresh-versus-rotten area under the curve of 0.99 across four thousand test images. The weakest class is rotten bell pepper, at 0.60 recall. Anything the model isn't sure about goes to a review queue and is folded into the next training run.",
    data:      "The dataset is twenty classes: ten produce types — apple, banana, orange, carrot, tomato, potato, cucumber, bell pepper, mango and strawberry — each in a fresh and a rotten version. Every image is white-balanced first, to neutralise warm store lighting before it reaches the model.",
    team:      "The team: Marco on integration and this demo, Sebastião on data and preprocessing, Yaxin on the core model and ablation, Bassem on evaluation and explainability, and Jorge on forecasting and the dashboard.",
    course:    "By design it uses all three architectures from the course: a plain neural-net baseline from Part one, a convolutional net with transfer learning from Part two, and an LSTM time-series model from Part five."
  };

  /* ---------------- command grammar ---------------- */
  function handle(raw) {
    let t = (raw || "").toLowerCase().trim();
    if (!t) return;
    showHeard(raw.trim());

    // --- stop phrases: "thank you FreshGuard", "that's it", "goodbye" ---
    const bye = /\b(thank you|thanks|thank u|cheers|goodbye|good ?bye|bye now|see you)\b/;
    if (/\bstop listening\b/.test(t)
        || /^that('?s| is| will be)?\s*(it|all|everything)\b/.test(t)
        || (NAME.test(t) && bye.test(t))
        || /\bgood ?bye\b.*\bfresh ?guard\b/.test(t)) {
      stopListening();
      return say(bye.test(t) ? "You're welcome — good luck with the presentation!"
                             : "Okay, I'll stop. Tap me any time.");
    }

    // --- wake word "Hey FreshGuard …" — greet if called alone, else run the rest ---
    if (NAME.test(t)) {
      const rest = t.replace(NAME, " ").replace(/\s+/g, " ").trim().replace(/^(please|can you|could you)\s+/, "");
      if (!rest || /^(hi|hey|hello|you there|are you (there|listening)|listen up)$/.test(rest)) return introduce();
      t = rest;
    }

    // if we're still on the landing hero, step into the console first so the
    // tabs/scanner actually exist and are visible for the command below.
    const app = $("app");
    if (app && app.hidden && !/\b(help|what can you)\b/.test(t)) {
      const he = $("hero-enter"); if (he) he.click();
    }

    // --- introduce / full overview ---
    if (/\b(introduce|present)\s+(yourself|your ?self)\b/.test(t) || /\bwho are you\b/.test(t)
        || /\b(overview|the pitch|pitch it|elevator|whole (thing|project)|in a nutshell|sum(marise|marize) (everything|the project|it all))\b/.test(t)) {
      return introduce();
    }

    // --- part-by-part summaries (spoken; also hop to the relevant tab) ---
    const wantsSummary = /\b(explain|tell me about|summar|walk me through|talk about|describe|what('?s| is) (the|your)|how does .*(work)|go deeper|deep dive|break down|more about)\b/.test(t);
    if (/\b(pipeline|architecture|two.?stage)\b/.test(t) || /\bhow (does|do) (it|you|this|the (model|system|pipeline)) work\b/.test(t)) { click("tab-model"); return say(PARTS.pipeline); }
    if (/\b(yolo|detector|detection|tracking|bytetrack|bounding box)\b/.test(t)) { click("tab-scan"); return say(PARTS.detect); }
    if (/\b(mobile ?net|classifier|the cnn|transfer learning|fine.?tun\w*|ablation)\b/.test(t) || (wantsSummary && /\bmodel\b/.test(t))) { click("tab-model"); return say(PARTS.classifier); }
    if (/\b(lstm|\brnn\b|forecast|spoilage|reorder|time series|demand)\b/.test(t)) { click("tab-dashboard"); return say(PARTS.forecast); }
    if (/\b(business|value prop|roi|shrink|compliance|law 1|waste)\b/.test(t) && (wantsSummary || /\b(case|model|prop|matter|why|about)\b/.test(t))) { click("tab-market"); return say(PARTS.business); }
    if (/\b(evaluation|metrics|performance|confusion|weakest class|accuracy)\b/.test(t) || /\bhow (accurate|good|well)\b/.test(t)) { click("tab-model"); return say(PARTS.evaluation); }
    if (wantsSummary && /\b(data|dataset|classes|images|training set)\b/.test(t)) { return say(PARTS.data); }
    if (/\b(the team|who (made|built|did)|team members)\b/.test(t)) { return say(PARTS.team); }
    if (/\b(course|syllabus|three architectures|deliverable)\b/.test(t)) { return say(PARTS.course); }

    // grade + read the current verdict (check before the plain "scan" nav word)
    if (/\b(scan|grade|check|analy[sz]e|inspect|read)\b.*\b(this|it|now|item|fruit|produce|thing)\b/.test(t)
        || /^(scan|grade|explain|check it|read it|what is it|what'?s this)\b/.test(t)
        || /\bis it (fresh|rotten|good|ok)\b/.test(t) || /\bwhat'?s the verdict\b/.test(t)) {
      const btn = $("btn-explain");
      if (!btn || btn.disabled) {
        click("tab-scan"); click("btn-start");
        return say("Starting the camera. Hold your item up, then say scan this.");
      }
      btn.click();
      setState("scanning…");
      return void setTimeout(() => say(verdictSpeech()), 900);
    }

    // narration toggle (auto-announce each new verdict)
    if (/\b(narrat\w*|auto.?announce|commentary|keep (talking|going)|call (it|them) out|announce (each|every))\b/.test(t)) {
      if (/\b(off|stop|quiet|silence|disable)\b/.test(t)) { narrate = false; return say("Narration off."); }
      narrate = true; lastNarrated = "";
      return say("Narration on. I'll call out each item as you scan it.");
    }

    // camera control
    if (/\b(start|open|turn on|switch on)\b.*\b(camera|scan|scanner|webcam)\b/.test(t) || /^start( it| up)?$/.test(t)) {
      click("tab-scan"); const ok = click("btn-start");
      return say(ok ? "Starting the camera." : "The camera's already running.");
    }
    if (/\b(stop|turn off|switch off|close)\b.*\b(camera|scan|scanner|webcam)\b/.test(t) || /^(stop|turn off)$/.test(t)) {
      return say(click("btn-stop") ? "Camera off." : "The camera isn't running.");
    }
    if (/\b(single|one item)\b/.test(t)) { click("tab-scan"); click("mode-single"); return say("Single item mode."); }
    if (/\b(conveyor|belt|batch mode|production)\b/.test(t)) { click("tab-scan"); click("mode-conveyor"); return say("Conveyor mode — counting the whole line."); }
    if (/\breset\b/.test(t) || /\bclear (the )?(session|count|counter|tally)\b/.test(t)) {
      return say(click("btn-reset") ? "Session reset." : "Nothing to reset — switch to conveyor mode first.");
    }

    // navigation
    if (/\b(dashboard|forecast|outlook|overview)\b/.test(t)) { click("tab-dashboard"); return say("Here's the dashboard."); }
    if (/\b(market|price|prices|wholesale)\b/.test(t)) { click("tab-market"); return say("Market prices."); }
    if (/\b(review|queue|active learning|flagged)\b/.test(t)) { click("tab-review"); return say("The review queue — items the model wasn't sure about."); }
    if (/\b(model|metric|metrics|evaluation|confusion|roc)\b/.test(t)) { click("tab-model"); return say("Model metrics and evaluation."); }
    if (/\b(lab|playground|experiment|augment|embedding|grad.?cam)\b/.test(t)) { click("tab-lab"); return say("Opening the lab."); }
    if (/\b(live ?scan|scanner|camera view|scan tab|scanning)\b/.test(t)) { click("tab-scan"); return say("Live scan."); }
    if (/\b(go )?home|landing|start over|main (screen|page)\b/.test(t)) {
      if (!click("btn-home")) { const b = document.querySelector(".brand"); if (b) b.click(); }
      return say("Back home.");
    }

    // spoken queries
    if (/\b(recover|recovered|saved|value|money|euros?|margin|protected)\b/.test(t)) {
      const r = (($("k-recovered") || {}).textContent || "€0").replace(/[€,]/g, "").trim();
      return say(`So far you've saved ${r || "0"} euros — recovered margin on sell-soon items, plus the loss prevented by catching rejects before they hit the shelf.`);
    }
    if (/\b(how many|scanned|count)\b/.test(t)) {
      const n = (($("k-scanned") || {}).textContent || "0").trim();
      return say(`You've scanned ${n} item${n === "1" ? "" : "s"} this session.`);
    }
    if (/\b(what (are you|is this)|what can you do|help|commands|options)\b/.test(t)) {
      return say("Say “Hey FreshGuard” and I'll introduce myself. I can scan this, start or stop the camera, switch single or conveyor mode, open any tab, and explain each part — the pipeline, the detector, the classifier, the forecast, the business, or the evaluation. Ask how much we've saved, or say “thank you FreshGuard” to stop me.");
    }
    if (/\b(thank|thanks|cheers|nice|great|awesome)\b/.test(t)) return say("Happy to help.");

    // no match
    return say("Sorry, I didn't catch a command. Say “help” to hear what I can do.");
  }

  /* ---------------- narration (auto-announce verdicts) ---------------- */
  let narrate = false, lastNarrated = "";
  setInterval(() => {
    if (!narrate || speaking || (Date.now() - lastSpokeAt < 1200)) return;
    const m = window.fgLastVerdict;
    if (!m || !m.fruit || m.fruit === "—" || !["fresh", "sell_soon", "reject"].includes(m.tier)) return;
    const key = m.fruit + ":" + m.tier;
    if (key === lastNarrated) return;
    lastNarrated = key;
    say(verdictSpeech());
  }, 600);

  /* ---------------- recognition ---------------- */
  let rec = null, listening = false, restartGuard = false;
  function buildRec() {
    const r = new SR();
    r.lang = "en-US"; r.continuous = true; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => {
      if (speaking || Date.now() - lastSpokeAt < 500) return;   // ignore our own voice
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handle(e.results[i][0].transcript);
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        listening = false; fab.classList.remove("listening"); setState("mic blocked");
        say("I need microphone permission. Click the mic icon in the address bar, allow it, then tap me again.");
      }
      // "no-speech" / "aborted" / "network" fall through → onend restarts
    };
    r.onend = () => {
      if (listening && !restartGuard) {   // keep the session alive
        restartGuard = true;
        setTimeout(() => { restartGuard = false; if (listening) { try { r.start(); } catch (e) {} } }, 250);
      }
    };
    return r;
  }
  function startListening() {
    if (!rec) rec = buildRec();
    try { rec.start(); } catch (e) {}
    listening = true; fab.classList.add("listening"); setState("listening…");
    showReply("Listening — say a command."); showPanel(true);
  }
  function stopListening() {
    listening = false; fab.classList.remove("listening"); setState("voice · ready");
    if (rec) { try { rec.stop(); } catch (e) {} }
  }

  fab.addEventListener("click", () => {
    if (!SR) {   // no speech-to-text (e.g. iOS Safari) — still greet via TTS
      showPanel(true);
      return say("Voice commands need Chrome or Edge. But I can still talk. Open this on the laptop for the full assistant.");
    }
    if (listening) { stopListening(); say("Okay, stopping."); }
    else { startListening(); }
  });

  // stop listening cleanly if the tab is hidden (saves the mic light)
  document.addEventListener("visibilitychange", () => { if (document.hidden && listening) stopListening(); });

  // small public hook: drive the assistant by text (e.g. a button, or a test)
  window.fgVoice = { ask: (text) => handle(text), say, introduce };

  console.log("[FreshGuard] voice assistant ready", SR ? "(speech-to-text on)" : "(TTS only — no SpeechRecognition)");
})();

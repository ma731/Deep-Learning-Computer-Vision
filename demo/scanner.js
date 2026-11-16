// The checkout scanner: a 3D fruit, drawn from what the model saw in the photo, rides a belt under a
// scanning light, gets its sticker and hops into a crate.
// A picture of the decision. The verdict itself comes from the model in index.html.
import * as THREE from 'three';
import { makeFruit, withBeam } from './fruits.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const TIERS = {
  fresh: { color: '#a8ff35', sign: 'FULL PRICE', glyph: 'tick' },
  sell_soon: { color: '#f5b73d', sign: 'MARK DOWN TODAY', glyph: 'percent' },
  reject: { color: '#ff5c5c', sign: 'OFF THE SHELF', glyph: 'cross' },
  review: { color: '#8fb8ff', sign: 'ASK A PERSON', glyph: 'ask' },
};
const ORDER = ['fresh', 'sell_soon', 'reject', 'review'];
const BELT_Y = 0.9, ARCH_X = -1, BELT_END = 2.3, CRATE_X = (i) => 4.9 + i * 2.6, CARD = 1.9;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const outCubic = (x) => 1 - (1 - clamp(x)) ** 3;
const spring = (t, f = 3, d = 0.5) => { if (t <= 0) return 0; const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - d * d); return 1 - Math.exp(-d * w * t) * (Math.cos(wd * t) + ((d * w) / wd) * Math.sin(wd * t)); };
const knock = (u) => (u <= 0 ? 0 : Math.exp(-u * 9) * Math.sin(u * 22));

// ------------------------------------------------------------------ sound (off until asked for) ---
let actx = null, soundOn = false;
export function setSound(v) { soundOn = !!v; if (v) { actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } }
function blip(f, dur, { type = 'sine', gain = 0.2, to = 0, at = 0 } = {}) {
  if (!soundOn || !actx) return;
  const t = actx.currentTime + at, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  beep: () => blip(1900, 0.09, { type: 'square', gain: 0.07 }),
  stamp: () => { blip(150, 0.2, { to: 50, gain: 0.5 }); blip(900, 0.04, { type: 'triangle', gain: 0.12 }); },
  land: (tier) => { blip(110, 0.22, { to: 48, gain: 0.45 }); const n = { fresh: [784, 1047], sell_soon: [659, 784], reject: [233, 196], review: [587, 587] }[tier]; n.forEach((f, i) => blip(f, 0.7, { type: 'triangle', gain: 0.12, at: 0.05 + i * 0.09 })); },
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.paint = (fn) => { const g = c.getContext('2d'); g.clearRect(0, 0, w, h); fn(g, w, h); t.needsUpdate = true; };
  t.paint(draw); return t;
}
const plastic = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1, ...o });
const glow = (color, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

export function createScanner(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), VOID = new THREE.Color('#0a0e0d');
  scene.background = VOID; scene.fog = new THREE.Fog(VOID, 16, 42);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture; scene.environmentIntensity = 0.55; pm.dispose();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight('#cfe9dc', '#07100c', 0.6));
  const key = new THREE.DirectionalLight('#fff4e2', 2.2); key.position.set(5, 11, 8);
  key.castShadow = true; key.shadow.mapSize.setScalar(2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  scene.add(key, key.target);
  const archLight = new THREE.PointLight('#a8ff35', 6, 9, 1.6); archLight.position.set(ARCH_X, 2.4, 0.6); scene.add(archLight);
  const crateLight = new THREE.PointLight('#ffffff', 0, 8, 1.6); scene.add(crateLight);

  const add = (geo, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const floor = add(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ color: '#0b1210', roughness: 0.32, metalness: 0.4 }), 2, 0, 0);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;

  // ---- the belt
  const beltTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#141a18'; g.fillRect(0, 0, w, h); g.strokeStyle = '#26302c'; g.lineWidth = 10; g.lineJoin = 'round';
    for (let x = -32; x < w + 64; x += 64) { g.beginPath(); g.moveTo(x, 24); g.lineTo(x + 40, h / 2); g.lineTo(x, h - 24); g.stroke(); }
  });
  beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping; beltTex.repeat.set(7, 1);
  const BELT_LEN = 14, beltMid = BELT_END + 0.4 - BELT_LEN / 2;
  add(new RoundedBoxGeometry(BELT_LEN, 0.5, 2.7, 4, 0.12), plastic('#1b2421'), beltMid, BELT_Y - 0.27, 0);
  const beltTop = add(new THREE.PlaneGeometry(BELT_LEN - 0.3, 2.3), new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.85 }), beltMid, BELT_Y - 0.015, 0);
  beltTop.rotation.x = -Math.PI / 2; beltTop.castShadow = false;
  const steel = new THREE.MeshStandardMaterial({ color: '#c9d3ce', metalness: 1, roughness: 0.28 });
  for (const z of [-1.42, 1.42]) add(new RoundedBoxGeometry(BELT_LEN, 0.16, 0.14, 3, 0.05), steel, beltMid, BELT_Y + 0.06, z);
  for (let x = beltMid - 6; x <= beltMid + 6; x += 3) for (const z of [-1.1, 1.1]) add(new THREE.CylinderGeometry(0.1, 0.1, BELT_Y - 0.5, 12), steel, x, (BELT_Y - 0.5) / 2, z);

  // ---- the scanning arch and its sheet of light
  // one post at the back and an arm over the belt, so nothing stands between the camera and the photo
  add(new RoundedBoxGeometry(0.4, 3.7, 0.4, 4, 0.1), plastic('#18211e'), ARCH_X, 1.85, -1.75);
  add(new THREE.BoxGeometry(0.06, 2.4, 0.05), glow('#a8ff35'), ARCH_X + 0.21, 2.1, -1.75);
  add(new RoundedBoxGeometry(0.5, 0.42, 3.6, 4, 0.12), plastic('#18211e'), ARCH_X, 3.55, 0);
  add(new THREE.BoxGeometry(0.06, 0.06, 3.0), glow('#a8ff35', 3), ARCH_X, 3.32, 0);
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.4), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uPower: { value: 0.25 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime, uPower;
      void main(){ float fall = pow(vUv.y, 1.6); float lines = 0.55 + 0.45 * sin(vUv.y * 90.0 - uTime * 9.0);
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        gl_FragColor = vec4(vec3(0.66, 1.0, 0.21) * fall * lines * edge * uPower * 1.6, 1.0); }`,
  }));
  sheet.rotation.y = Math.PI / 2; sheet.position.set(ARCH_X, BELT_Y + 1.2, 0); scene.add(sheet);

  // ---- four crates, one per decision
  const crates = ORDER.map((tier, i) => {
    const g = new THREE.Group(); g.position.set(CRATE_X(i), 0, 0); scene.add(g);
    const c = new THREE.Color(TIERS[tier].color), body = plastic(c.clone().multiplyScalar(0.34));
    add(new RoundedBoxGeometry(2.2, 0.14, 2.2, 3, 0.05), body, 0, 0.07, 0, g);
    for (const [x, z, w, d] of [[0, 1.03, 2.2, 0.14], [0, -1.03, 2.2, 0.14], [1.03, 0, 0.14, 2.2], [-1.03, 0, 0.14, 2.2]]) add(new RoundedBoxGeometry(w, 1.05, d, 3, 0.05), body, x, 0.6, z, g);
    const rim = add(new THREE.BoxGeometry(2.24, 0.05, 0.05), glow(TIERS[tier].color, 1.2), 0, 1.14, 1.1, g); rim.castShadow = false;
    let count = 0;
    const tex = canvasTex(512, 220, () => {});
    const paint = () => tex.paint((ctx, w, h) => {
      ctx.fillStyle = '#070a09'; ctx.beginPath(); ctx.roundRect(4, 4, w - 8, h - 8, 26); ctx.fill();
      ctx.fillStyle = TIERS[tier].color; ctx.font = '700 46px "Space Grotesk", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(TIERS[tier].sign, w / 2, 70, w - 40);
      ctx.fillStyle = '#eaf2ec'; ctx.font = '600 84px "IBM Plex Mono", monospace'; ctx.fillText(String(count), w / 2, 152);
    });
    paint();
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.82), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); sign.position.set(0, 0.62, 1.105); g.add(sign);
    return { g, rim, tier, color: c, hit: -9, bump() { count += 1; paint(); } };
  });

  // ---- the carrier: a tray with the fruit on it and a front plate for the sticker
  const card = new THREE.Group(); scene.add(card); card.visible = false;
  add(new RoundedBoxGeometry(2.0, 0.18, 2.0, 4, 0.08), plastic('#232e2a'), 0, 0.09, 0, card);
  add(new RoundedBoxGeometry(2.0, 0.62, 0.12, 3, 0.05), plastic('#232e2a'), 0, 0.31, 1.0, card);
  const holder = new THREE.Group(); holder.position.y = 0.18; card.add(holder);
  const beam = { uArchX: { value: ARCH_X }, uBeam: { value: 0 } };
  const stickerTex = canvasTex(256, 256, () => {});
  const sticker = new THREE.Group(); sticker.position.set(0.55, 0.33, 1.065); sticker.rotation.x = Math.PI / 2; card.add(sticker);
  const stickerBody = add(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 40), plastic('#ffffff'), 0, 0.03, 0, sticker);
  const stickerTop = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), new THREE.MeshBasicMaterial({ map: stickerTex, transparent: true })); stickerTop.rotation.x = -Math.PI / 2; stickerTop.position.y = 0.062; sticker.add(stickerTop);
  const drawSticker = (tier) => stickerTex.paint((g, w) => {
    g.strokeStyle = '#06100b'; g.fillStyle = '#06100b'; g.lineWidth = 26; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
    const k = TIERS[tier].glyph;
    if (k === 'tick') { g.moveTo(70, 132); g.lineTo(112, 172); g.lineTo(188, 86); g.stroke(); }
    else if (k === 'cross') { g.moveTo(80, 80); g.lineTo(176, 176); g.moveTo(176, 80); g.lineTo(80, 176); g.stroke(); }
    else { g.font = '700 150px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k === 'percent' ? '%' : '?', w / 2, w / 2 + 8); }
  });
  const clearFruit = () => { holder.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); holder.clear(); };

  // ---- sparks
  const N = 180, pPos = new Float32Array(N * 3).fill(-99), pCol = new Float32Array(N * 3), pVel = new Float32Array(N * 3), pLife = new Float32Array(N);
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const sparks = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sparks.frustumCulled = false; scene.add(sparks);
  let pNext = 0;
  function burst(at, color, n, power) {
    const c = new THREE.Color(color).multiplyScalar(2.2);
    for (let k = 0; k < n; k++) {
      const i = pNext = (pNext + 1) % N, a = Math.random() * Math.PI * 2, up = Math.random();
      pPos.set([at.x + (Math.random() - 0.5) * 0.8, at.y, at.z + (Math.random() - 0.5) * 0.8], i * 3);
      pVel.set([Math.cos(a) * power * (0.4 + Math.random()), power * (0.7 + up * 1.6), Math.sin(a) * power * (0.4 + Math.random())], i * 3);
      pCol.set([c.r, c.g, c.b], i * 3); pLife[i] = 0.7 + Math.random() * 0.7;
    }
  }

  // ---- post: bloom on anything brighter than white
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.6, 1.08); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- the clock, small tweens and the camera
  const tweens = new Set();
  let speed = 1, spin = 0.5, moving = 0, w = 1, h = 1, seen = true, raf = 0, last = 0, waiting = null, busy = false, stuck = -9;
  const tween = (dur, fn, ease = smooth) => new Promise((res) => tweens.add({ t: 0, dur, fn, ease, res }));
  const goal = { pos: new THREE.Vector3(1.5, 5.4, 14), look: new THREE.Vector3(1.5, 1, 0) }, look = goal.look.clone();
  const aim = (px, py, pz, lx, ly, lz) => { goal.pos.set(px, py, pz); goal.look.set(lx, ly, lz); };
  camera.position.copy(goal.pos);
  const world = new THREE.Vector3();

  function frame(ms) {
    raf = requestAnimationFrame(frame);
    const now = ms / 1000, dt = Math.min(0.05, now - last || 0); last = now;
    for (const tw of [...tweens]) { tw.t += dt * speed; const u = Math.min(1, tw.t / tw.dur); tw.fn(tw.ease(u), u); if (u >= 1) { tweens.delete(tw); tw.res(); } }
    beltTex.offset.x -= moving * dt * speed * 0.9;
    sheet.material.uniforms.uTime.value = now;
    archLight.intensity = 3 + sheet.material.uniforms.uPower.value * 14;
    sticker.scale.setScalar(stuck > 0 ? Math.max(0.001, spring((now - stuck) * speed, 3.4, 0.42)) : 0.001);
    holder.rotation.y += dt * spin * speed;
    holder.position.y = 0.18 + 0.1 * Math.abs(knock((now - stuck) * speed));          // the fruit jumps when the sticker lands
    crates.forEach((c) => { const u = now - c.hit; c.g.scale.y = 1 - 0.1 * knock(u); c.rim.material.color.copy(c.color).multiplyScalar(1.2 + 3.2 * Math.exp(-Math.max(0, u) * 2.2)); });
    crateLight.intensity *= Math.exp(-dt * 2.4);
    for (let i = 0; i < N; i++) if (pLife[i] > 0) {
      pLife[i] -= dt; pVel[i * 3 + 1] -= 6.5 * dt;
      for (let k = 0; k < 3; k++) pPos[i * 3 + k] += pVel[i * 3 + k] * dt;
      if (pLife[i] <= 0) pPos[i * 3 + 1] = -99;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    // the camera drifts a little even when nothing moves, and eases to wherever the action is
    const tall = w < h ? 1.75 : 1, sway = Math.sin(now * 0.35) * 0.25;
    world.copy(goal.pos).sub(goal.look).multiplyScalar(tall).add(goal.look); world.x += sway;
    const k = 1 - Math.exp(-dt * 2.6);
    camera.position.lerp(world, k); look.lerp(goal.look, k); camera.lookAt(look);
    key.position.set(look.x + 5, 11, 8); key.target.position.set(look.x, 0, 0);
    composer.render();
  }
  const size = () => {
    w = canvas.clientWidth || 1; h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.fov = w < h ? 46 : 34; camera.updateProjectionMatrix();
  };
  const run = () => { cancelAnimationFrame(raf); if (seen && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; run(); }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  size(); run();

  // one item, start to finish. `verdict` is a promise of the model's answer; `label` is what the photo is known to be
  // (the samples) and otherwise the model's best guess; `onStamp` fires when the sticker lands.
  async function one({ label, verdict, onStamp }) {
    const v = await verdict, tier = TIERS[v.tier] ? v.tier : 'review', crate = crates[ORDER.indexOf(tier)];
    const [state, kind] = (label || v.label).split('_');
    clearFruit();
    // how far gone it looks: fresh, rotten, or on the turn when the model puts it in between or is unsure
    const rot = tier === 'reject' ? 1 : tier === 'fresh' ? 0 : tier === 'sell_soon' ? clamp(0.25 + v.rot * 0.5, 0.4, 0.65) : clamp(v.rot, state === 'rotten' ? 0.6 : 0, 1);
    const fruit = makeFruit(kind, rot); withBeam(fruit, beam);
    fruit.traverse((m) => { if (m.isMesh) m.castShadow = true; }); holder.add(fruit); holder.rotation.y = -0.6;
    beam.uBeam.value = 0; stuck = -9; spin = 0.5; card.visible = true; card.rotation.set(0, 0, 0); card.position.set(-6.4, BELT_Y, 0);

    // 1. it pops into being and rides in
    aim(-3.6, 4.0, 8.0, -3.2, 1.6, 0); moving = 1;
    tween(0.8, (e, raw) => card.scale.setScalar(Math.max(0.001, spring(raw * 0.8, 2.4, 0.5))), (x) => x);
    await tween(1.25, (e) => { card.position.x = -6.4 + (ARCH_X - 1.2 + 6.4) * e; }, outCubic);
    // 2. through the sheet of light, slowly, turning, with a line of light running over it
    aim(ARCH_X + 1.2, 3.3, 5.2, ARCH_X + 0.1, 1.75, 0); moving = 0.32; spin = 2.4; sfx.beep();
    tween(0.3, (e) => { sheet.material.uniforms.uPower.value = 0.25 + 0.75 * e; beam.uBeam.value = e; });
    const x0 = card.position.x;
    await tween(1.6, (e) => { card.position.x = x0 + 2.4 * e; }, (x) => x);
    // 3. the sticker
    moving = 0; spin = 0.5; drawSticker(tier); stickerBody.material.color.set(TIERS[tier].color);
    stuck = performance.now() / 1000; sfx.stamp(); onStamp?.(v);
    sticker.getWorldPosition(world); burst(world, TIERS[tier].color, 34, 2.4);
    tween(0.5, (e) => { sheet.material.uniforms.uPower.value = 1 - 0.75 * e; beam.uBeam.value = 1 - e; });
    await tween(0.8, () => {});
    // 4. off the belt and into its crate
    moving = 1; aim(crate.g.position.x - 1.6, 4.8, 9.4, crate.g.position.x - 1.2, 1.1, 0);
    const x1 = card.position.x;
    await tween(0.55, (e) => { card.position.x = x1 + (BELT_END - x1) * e; }, (x) => x * x);
    moving = 0; spin = 3;
    const from = card.position.clone(), to = new THREE.Vector3(crate.g.position.x, 0.3, 0);
    await tween(0.85, (e, raw) => {
      card.position.lerpVectors(from, to, e); card.position.y += 4 * 1.7 * raw * (1 - raw);
      card.rotation.z = -0.7 * e; card.scale.setScalar(1 - (tier === 'reject' ? 0.75 : 0.3) * e);
    }, (x) => x);
    crate.hit = performance.now() / 1000; crate.bump(); sfx.land(tier);
    crateLight.color.copy(crate.color); crateLight.position.set(to.x, 2.2, 1.2); crateLight.intensity = 26;
    burst(to.clone().setY(1.2), TIERS[tier].color, tier === 'reject' ? 90 : 40, tier === 'reject' ? 3.4 : 2.6);
    card.visible = false;
    await tween(0.9, () => {});
    aim(1.5, 5.4, 14, 1.5, 1, 0);
  }
  // only one photo at a time: a new pick waits, and the current one hurries up
  async function play(job) {
    if (busy) { waiting = job; speed = 3.2; return; }
    busy = true;
    try { await one(job); } finally { busy = false; speed = 1; }
    if (waiting) { const next = waiting; waiting = null; play(next); }
  }
  return { play };
}

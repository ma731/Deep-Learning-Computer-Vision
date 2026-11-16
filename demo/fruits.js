// Ten kinds of produce, modelled in code. makeFruit('apple', rot) returns a group that stands on y = 0 and
// fits in about 1.5 units. rot runs from 0 (fresh) through about 0.5 (on the turn: a few brown spots, duller)
// to 1 (rotten: brown patches, mould, lumps and a sag).
import * as THREE from 'three';

const n3 = (x, y, z) => Math.sin(x * 3.1 + 1.7) * Math.sin(y * 2.7 + 0.3) * Math.sin(z * 3.3 + 2.1) + 0.5 * Math.sin(x * 7.3 + y * 5.1 + 0.9) * Math.sin(z * 6.7 + 1.3);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const C = (hex) => new THREE.Color(hex);
const ROT = C('#3a2414'), MOULD = C('#c9d2bd'), GREEN = C('#3d8b37'), WOOD = C('#5a3d24');
const v = new THREE.Vector3(), c = new THREE.Color();

// move every vertex, then repaint the normals
function shape(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); return geo;
}
// colour every vertex with at(position); rot adds brown patches (more and bigger as it rises) and, late on, pale mould
function paint(geo, at, rot) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), from = 0.95 - 1.25 * rot;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); c.copy(at(v));
    if (rot > 0) {
      const patch = ss(from, from + 0.7, n3(v.x * 2.4, v.y * 2.4, v.z * 2.4)), mould = ss(0.5, 0.9, n3(v.x * 5 + 3, v.y * 5, v.z * 5 + 1)) * ss(0.65, 1, rot);
      c.multiplyScalar(1 - 0.2 * rot).lerp(ROT, patch * 0.85).lerp(MOULD, mould * 0.45);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
}
const lumpy = (geo, amp, freq) => shape(geo, (q) => q.multiplyScalar(1 + amp * n3(q.x * freq, q.y * freq, q.z * freq)));
const skin = (rot) => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36 + 0.5 * rot, clearcoat: 0.7 * (1 - rot), clearcoatRoughness: 0.22 });
const flat = (color, rot) => new THREE.MeshStandardMaterial({ color: C(color).lerp(ROT, 0.6 * rot), roughness: 0.7 });
const ball = () => new THREE.SphereGeometry(0.6, 56, 40);
function body(g, geo, at, rotten, lump = 0) {
  if (rotten || lump) lumpy(geo, 0.05 * rotten + lump, 3.1);
  const m = new THREE.Mesh(paint(geo, at, rotten), skin(rotten)); g.add(m); return m;
}
function stem(g, y, rotten, h = 0.2, r = 0.035, color = WOOD) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 10), flat(color, rotten)); m.position.y = y + h / 2; m.rotation.z = 0.12; g.add(m); return m;
}
function calyx(g, y, rotten, n = 5, len = 0.26) {       // the green star on a tomato or a strawberry
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, len, 6), flat('#3d8b37', rotten));
    const a = (i / n) * Math.PI * 2; leaf.position.set(Math.cos(a) * len * 0.42, y, Math.sin(a) * len * 0.42);
    leaf.rotation.set(0, -a, -Math.PI / 2 + 0.28); leaf.rotation.order = 'YZX'; g.add(leaf);
  }
}

const MAKE = {
  apple(g, rot) {
    const geo = shape(ball(), (q) => { const r = Math.hypot(q.x, q.z) / 0.6, k = 1 + 0.1 * (q.y / 0.6); q.x *= k; q.z *= k; q.y = q.y * 0.9 - Math.sign(q.y) * 0.13 * Math.exp(-r * r * 9); });
    const red = C('#d42a2a'), blush = C('#e6c23a');
    body(g, geo, (q) => c.copy(red).lerp(blush, ss(0.1, 0.9, n3(q.x * 1.3 + 2, q.y * 1.1, q.z * 1.3)) * 0.55), rot);
    stem(g, 0.38, rot, 0.24);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), flat('#3d8b37', rot)); leaf.scale.set(1.4, 0.18, 0.7); leaf.position.set(0.16, 0.58, 0); leaf.rotation.z = 0.5; g.add(leaf);
  },
  orange(g, rot) {
    const orange = C('#f08a1c');
    body(g, lumpy(ball(), 0.012, 19), () => orange, rot);
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8), flat('#3d8b37', rot)); nub.position.y = 0.6; g.add(nub);
  },
  tomato(g, rot) {
    const geo = shape(ball(), (q) => { const a = Math.atan2(q.z, q.x), k = 1 + 0.05 * Math.cos(5 * a) * ss(-0.2, 0.6, q.y / 0.6); q.x *= k; q.z *= k; q.y *= 0.82; });
    const red = C('#d8261c');
    body(g, geo, () => red, rot); calyx(g, 0.5, rot); stem(g, 0.48, rot, 0.12, 0.03, GREEN);
  },
  banana(g, rot) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.85, 0.35, 0), new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0.85, 0.35, 0));
    const geo = new THREE.TubeGeometry(curve, 48, 0.2, 14, false), p = geo.attributes.position, uv = geo.attributes.uv, mid = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {                 // thin it toward both ends
      const t = uv.getX(i); curve.getPoint(t, mid); v.fromBufferAttribute(p, i).sub(mid).multiplyScalar(0.3 + 0.7 * Math.sin(Math.PI * t) ** 0.55).add(mid); p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const yellow = C('#f2d22e'), tip = C('#4a3520');
    body(g, geo, (q) => c.copy(yellow).lerp(tip, ss(0.72, 0.84, Math.abs(q.x))), rot);
  },
  bellpepper(g, rot) {
    const geo = shape(ball(), (q) => { const a = Math.atan2(q.z, q.x), r = Math.hypot(q.x, q.z) / 0.6, k = 1 + 0.11 * Math.cos(4 * a); q.x *= k; q.z *= k; q.y = q.y * 1.08 - (q.y > 0 ? 0.16 : -0.06) * Math.exp(-r * r * 6); });
    const base = C('#2f9e3a').lerp(C('#b8321f'), ss(0.3, 0.8, rot));          // a green pepper reddens as it goes
    body(g, geo, () => base, rot); stem(g, 0.44, rot, 0.26, 0.07, GREEN);
  },
  carrot(g, rot) {
    const pts = []; for (let i = 0; i <= 28; i++) { const t = i / 28; pts.push(new THREE.Vector2((0.04 + 0.28 * (1 - t) ** 0.8) * (1 + 0.04 * Math.sin(t * 46)) * (i === 0 ? 0.2 : 1), -0.8 + 1.6 * (1 - t))); }
    const geo = new THREE.LatheGeometry(pts.reverse(), 28), orange = C('#ee7a22');
    const m = body(g, geo, () => orange, rot); m.rotation.z = Math.PI / 2 - 0.08;
    for (let i = 0; i < 5; i++) { const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 6), flat('#3d8b37', rot)); leaf.position.set(-0.95, 0.06 + (i - 2) * 0.03, (i - 2) * 0.07); leaf.rotation.z = Math.PI / 2 + (i - 2) * 0.16; g.add(leaf); }
  },
  cucumber(g, rot) {
    const geo = lumpy(new THREE.CapsuleGeometry(0.25, 1.25, 12, 28), 0.02, 9), dark = C('#256b2c'), light = C('#5fa046');
    const m = body(g, geo, (q) => c.copy(dark).lerp(light, 0.5 + 0.5 * Math.sin(Math.atan2(q.z, q.x) * 9)), rot); m.rotation.z = Math.PI / 2;
  },
  mango(g, rot) {
    const geo = shape(ball(), (q) => { q.y *= 1.22; q.z *= 0.86; q.x += 0.3 * (q.y * q.y) - 0.08; });
    const red = C('#d8452a'), gold = C('#ecb42a');
    body(g, geo, (q) => c.copy(gold).lerp(red, ss(-0.2, 0.6, q.y + q.x * 0.6)), rot); stem(g, 0.7, rot, 0.08);
  },
  potato(g, rot) {
    const geo = shape(ball(), (q) => { q.x *= 1.28; q.y *= 0.84; q.z *= 0.95; });
    const tan = C('#c9a468'), dark = C('#8a6a3c');
    body(g, geo, (q) => c.copy(tan).lerp(dark, ss(0.55, 0.95, n3(q.x * 6, q.y * 6, q.z * 6)) * 0.7), rot, 0.03);
  },
  strawberry(g, rot) {
    const geo = shape(ball(), (q) => { const t = Math.min(1, Math.max(0, (q.y / 0.6 + 1) / 2)), k = 0.3 + 0.7 * t ** 0.65; q.x *= k; q.z *= k; q.y *= 1.12; });
    const red = C('#d81f2f');
    const m = body(g, geo, () => red, rot);
    const p = m.geometry.attributes.position, seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 6, 5), flat('#f1d77a', rot), 60), o = new THREE.Object3D();
    for (let i = 0; i < 60; i++) { v.fromBufferAttribute(p, Math.floor((i + 0.5) * p.count / 60 * 0.83 + p.count * 0.12)); o.position.copy(v).multiplyScalar(1.01); o.updateMatrix(); seeds.setMatrixAt(i, o.matrix); }
    g.add(seeds); calyx(g, 0.62, rot, 6, 0.3);
  },
};

export function makeFruit(kind, rot = 0) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  rot = Math.min(1, Math.max(0, +rot || 0));
  (MAKE[kind] || MAKE.apple)(inner, rot);
  inner.scale.y = 1 - 0.1 * rot;                         // it sags as it goes
  const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), k = 1.5 / Math.max(size.x, size.y, size.z);
  inner.scale.multiplyScalar(k); inner.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
  return g;
}

// a line of light on the fruit wherever it crosses the scanner's sheet (world x = uArchX)
export function withBeam(group, uniforms) {
  group.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh) return;
    m.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = 'varying float vWX;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWX = (modelMatrix * vec4(transformed, 1.0)).x;');
      sh.fragmentShader = 'uniform float uArchX, uBeam; varying float vWX;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.66, 1.0, 0.21) * exp(-pow((vWX - uArchX) * 15.0, 2.0)) * uBeam * 1.7;');
    };
  });
}

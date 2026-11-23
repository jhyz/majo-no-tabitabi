// Fire, drawn the way anime paints it: soft, layered tongues on camera-facing cards. Every card scrolls two octaves of a
// tileable noise through a teardrop mask, so each tongue licks upward, splits and flickers on its own phase; a dark-red
// soft edge, an orange body and a hot yellow core (just over the bloom threshold, never white). Tongues lean their tips
// downwind (visual wind at the fire) and sway; a back layer (big, dim, red), a middle layer and a front layer (small,
// hot) per patch read as depth. Embers rise and smoke rolls off the top as stateless looping cards (the vertex shader
// moves them, the CPU only writes the source). Everything — ground fire, burning trees / props / creatures, fire
// tornadoes, fireball blooms, lava pools, electric sparks and the ground firelight — is ONE instanced draw.
// Also here: frost shells on frozen reactors and the pool of flickering fire point lights.
//
// G.elements.flames (see docs/api/elements.md "Fire look"):
//   lick(pos, { n, r, h, dur, heat, spread, delay })          short-lived tongues (kit.tongues routes here)
//   burst(pos, normal, radius, big)                           a fireball bloom: puff, licking tongues, smoke
//   whirl({ pos, R, H, dur? }) -> handle { pos, R, H, k, alive, kill(sec), remove() }   swirling flame sheet
//   patch({ pos, r, I? }) -> handle { pos, r, I, alive, dims(r0, r1), kill(sec), remove() }   low flames on a pool
import * as THREE from 'three';
import { G } from '../core/game.js';
import { hookMaterial } from '../core/mats.js';
import { hash2, smoothstep } from '../core/util.js';
import { MAX_FLAMES, MAX_FIRE_LIGHTS } from './consts.js';
import { FX_OUT, FOG_PARS_VERT, FOG_VERT, fxMaterial } from '../fx/glsl.js';

const FLAME = 0, SPARK = 1, GLOW = 2, EMBER = 3, SMOKE = 4;
const TAU = Math.PI * 2;
const LEAN = 0.08;           // tip lean (m per m of height) per m/s of wind
const LEAN_MAX = 0.8;        // never more than this × height

const VS = /* glsl */`
attribute vec4 aPos;   // base xyz, seed
attribute vec4 aSize;  // flame: width, height, heat, type | ember / smoke: spread radius, rise, heat (density), type
attribute vec4 aBend;  // flame: tip lean x, z (m), layer 0 back / 1 mid / 2 front, - | ember / smoke: wind x, z (m/s),
                       //   rate (1/s, looping) or -phase (timed, CPU-placed), swirl radius (ember) / puff size (smoke)
uniform float uTime;
varying vec2 vUv;
varying vec4 vD;       // seed, heat, type, layer | phase
varying float vNear;   // fades cards that the camera is about to pass through (no hard planes across the lens)
${FOG_PARS_VERT}
float h11(float n) { return fract(sin(n * 127.1 + 0.37) * 43758.5453); }
void main() {
  float seed = aPos.w, type = aSize.w;
  vUv = vec2(position.x + 0.5, position.y);
  vD = vec4(seed, aSize.z, type, aBend.z);
  vNear = 1.0;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp;
  if (type < 0.5) {
    // a tongue stands on its base, turns to the camera (tilting back when seen from above), sways and leans downwind
    float y = position.y;
    vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, 0.4));
    vec3 right = normalize(camRight - up * dot(camRight, up));
    float t = uTime * (0.9 + 0.3 * h11(seed * 7.0)) + seed * 37.0;
    float hh = aSize.y * (1.0 + 0.09 * sin(t * 6.1) + 0.05 * sin(t * 13.3 + 1.7));
    float sway = (0.09 * sin(t * 2.3 + y * 2.2) + 0.045 * sin(t * 4.9 - y * 4.6)) * y;
    wp = aPos.xyz + right * ((position.x + sway) * aSize.x) + up * (y * hh);
    float bend = y * y;
    wp.xz += aBend.xy * bend;
    wp.y -= length(aBend.xy) * bend * 0.3;
    wp += normalize(cameraPosition - aPos.xyz) * (((aBend.z - 1.0) * 0.3 + 0.1) * aSize.x);
    float dc = length(cameraPosition - aPos.xyz - vec3(0.0, aSize.y * 0.4, 0.0));
    vNear = smoothstep(0.35, 1.0, dc / max(1.2, aSize.y * 0.9));
  } else if (type < 1.5) {
    vec3 up = normalize(mix(camUp, vec3(0.0, 1.0, 0.0), 0.55));
    wp = aPos.xyz + camRight * (position.x * aSize.x) + up * ((position.y - 0.5) * aSize.y);
    wp += normalize(cameraPosition - aPos.xyz) * (aSize.x * 0.3);
  } else if (type < 2.5) {
    wp = aPos.xyz + vec3(position.x * aSize.x, 0.35, (position.y - 0.5) * aSize.y);
  } else {
    float ph; vec3 p;
    if (aBend.z > 0.0) {
      // looping: born at a random spot of the source, rises, drifts with the wind, dies, is born again
      float life = 1.0 / aBend.z;
      ph = fract(uTime * aBend.z + h11(seed * 13.7));
      float a0 = h11(seed * 3.1) * 6.2832, r0 = sqrt(h11(seed * 5.7)) * aSize.x;
      if (type < 3.5 && aBend.w > 0.0) {
        float ang = a0 + ph * 5.5, rr = r0 * 0.6 + aBend.w * (0.5 + ph);
        p = aPos.xyz + vec3(cos(ang) * rr, 0.0, sin(ang) * rr);
      } else p = aPos.xyz + vec3(cos(a0) * r0, 0.0, sin(a0) * r0);
      p.xz += aBend.xy * (0.5 * ph * life);
      p.y += aSize.y * ph * (1.45 - 0.45 * ph);
    } else { ph = -aBend.z; p = aPos.xyz; }
    vD.w = ph;
    if (type < 3.5) {
      p.x += sin(ph * 9.0 + seed * 20.0) * 0.3 * ph; p.z += cos(ph * 7.0 + seed * 11.0) * 0.3 * ph;
      float s = 0.1 * (1.0 - 0.45 * ph) * (0.7 + 0.6 * h11(seed));
      wp = p + camRight * (position.x * s) + camUp * ((position.y - 0.5) * s * 3.2);
    } else {
      float s = aBend.w * mix(0.55, 1.35, ph);
      float rot = seed * 6.2832 + ph * (h11(seed * 2.3) - 0.5) * 2.4;
      vec2 l = vec2(position.x, position.y - 0.5);
      l = vec2(l.x * cos(rot) - l.y * sin(rot), l.x * sin(rot) + l.y * cos(rot));
      wp = p + (camRight * l.x + camUp * l.y) * s;
      vNear = smoothstep(0.5, 1.2, length(cameraPosition - p) / max(s, 0.5));
    }
  }
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_VERT}
}`;

const FS = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime, uNight;
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec4 vD;
varying float vNear;
${FX_OUT}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h11(float n) { return fract(sin(n * 127.1 + 0.37) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float seed = vD.x, heat = vD.y, type = vD.z;
  if (type < 0.5) {
    float layer = vD.w, lm = min(layer, 1.0), fr = max(layer - 1.0, 0.0);
    float x = vUv.x - 0.5, y = vUv.y;
    float sp = 0.85 + 0.3 * h11(seed * 3.3);
    // two octaves of rising noise: the big one sways and splits the tongue, the fine one eats it from the top
    float n1 = texture2D(uNoise, vec2(x * 0.7 + seed * 3.1, y * 0.5 - uTime * 0.8 * sp)).r;
    float n2 = texture2D(uNoise, vec2(x * 1.5 - seed * 1.7, y * 1.0 - uTime * 1.7 * sp)).g;
    float flick = 0.9 + 0.1 * sin(uTime * 9.0 + seed * 23.0) * sin(uTime * 4.1 + seed * 9.0);
    float n3 = texture2D(uNoise, vec2(x * 2.6 + seed * 5.3, y * 0.9 - uTime * 2.3 * sp)).r;
    float xd = x + (n1 - 0.5) * 0.5 * y;
    float w = 0.47 * pow(max(1.0 - y, 0.0), 0.4) * smoothstep(-0.05, 0.25, y);   // round foot, broad shoulders
    float s = 1.0 - abs(xd) / max(w, 1e-3);
    // the noise eats the upper half into two or three licking tips that tear off and rise
    float eat = (1.0 - n2) * (0.15 + 0.85 * y) * 0.95 + (1.0 - n3) * y * y * 0.75;
    float F = (s - eat - y * 0.08 + 0.08 * (layer - 1.0)) * flick;
    float a = smoothstep(0.0, 0.07, F);
    if (a < 0.004) discard;
    // the hot heart: small, low, its own flicker
    float yc = y / (0.46 + 0.1 * fr);
    float xc = x + (n1 - 0.5) * 0.3 * y;
    float wc = 0.19 * pow(max(1.0 - yc, 0.0), 0.5) * smoothstep(-0.05, 0.25, yc);
    float Fc = 1.0 - abs(xc) / max(wc, 1e-3) - (1.0 - n2) * 0.8 * yc;
    float core = smoothstep(0.05, 0.3, Fc) * clamp(heat * 1.2 - 0.15, 0.0, 1.0) * (0.35 + 0.65 * lm);
    float T = smoothstep(0.06, 0.4, F);
    // tuned through the soft look's filmic curve (AgX rolls bright orange toward cream): deep red rim, orange-red body,
    // orange heat, golden heart — the heart stays under the day bloom threshold
    vec3 cEdge = mix(vec3(0.13, 0.009, 0.001), vec3(0.25, 0.02, 0.002), lm);
    vec3 cBody = mix(vec3(0.3, 0.04, 0.002), vec3(0.5, 0.085, 0.002), lm);
    vec3 cHot = vec3(0.8, 0.2, 0.004);
    vec3 cCore = vec3(0.95, 0.48, 0.02);
    vec3 col = mix(cEdge, cBody, smoothstep(0.0, 0.45, T));
    col = mix(col, cHot, smoothstep(0.55, 1.0, T) * (0.3 + 0.7 * lm) * min(heat * 1.3, 1.0));
    col = mix(col, cCore, core);
    col *= (0.75 + 0.25 * min(heat, 1.0)) * (1.0 - 0.2 * uNight);
    float alpha = a * mix(0.5, 0.94, T) * mix(0.82, 0.95, lm) * clamp(heat * 1.6, 0.0, 1.0) * vNear;
    gl_FragColor = fxOut(col * core * 0.3 * alpha, col, alpha * (1.0 - 0.3 * core));
    return;
  }
  if (type < 1.5) {   // electric crackle (shocked reactors)
    vec2 p = (vUv - 0.5) * 2.0;
    float k = floor(uTime * 16.0 + seed * 50.0);
    float e = 0.0;
    for (int i = 0; i < 3; i++) {
      float an = h21(vec2(k, float(i) + seed * 9.0)) * 6.2832;
      vec2 d = vec2(cos(an), sin(an));
      float along = dot(p, d), perp = dot(p, vec2(-d.y, d.x));
      float jag = (vn(vec2(along * 7.0 + k, float(i) * 3.0 + seed)) - 0.5) * 0.4 * along;
      e += exp(-abs(perp - jag) * 38.0) * step(0.0, along) * (1.0 - smoothstep(0.3, 0.95, along));
    }
    e += exp(-length(p) * 7.0) * 0.6;
    float blink = step(0.3, h21(vec2(k, seed * 3.0)));
    gl_FragColor = fxOut(vec3(0.6, 0.84, 1.0) * e * blink * 4.0 * heat, vec3(0.0), 0.0);
    return;
  }
  if (type < 2.5) {   // firelight pooled on the ground
    float d = length(vUv - 0.5) * 2.0;
    float g = max(0.0, 1.0 - d); g *= g;
    float fl = 0.85 + 0.15 * sin(uTime * 11.0 + seed * 40.0);
    gl_FragColor = fxOut(vec3(1.0, 0.42, 0.1) * g * heat * fl, vec3(0.0), 0.0);
    return;
  }
  float ph = vD.w;
  if (type < 3.5) {   // ember: a hot speck that twinkles and cools as it rises
    float d = length((vUv - 0.5) * 2.0);
    float g = 1.0 - smoothstep(0.0, 1.0, d); g *= g;
    float tw = 0.6 + 0.4 * sin(uTime * 17.0 + seed * 50.0);
    float fade = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.5, 1.0, ph));
    vec3 col = mix(vec3(1.5, 0.36, 0.05), vec3(1.7, 0.9, 0.32), g * (1.0 - ph)) * heat * (1.0 - 0.25 * uNight);
    gl_FragColor = fxOut(col * g * tw * fade, vec3(0.0), 0.0);
    return;
  }
  // smoke: a soft rolling puff, lit by the sky, warm underneath while it is still close to the flames
  float n = texture2D(uNoise, vUv * 0.55 + vec2(seed * 3.7, seed * 1.3 - ph * 0.25)).r;
  float m2 = texture2D(uNoise, vUv * 1.2 + vec2(seed * 1.9, -ph * 0.6)).g;
  float d = length(vUv - 0.5) * 2.0 + (n - 0.5) * 0.8 + (m2 - 0.5) * 0.3;
  float m = 1.0 - smoothstep(0.4, 1.0, d);
  float env = smoothstep(0.0, 0.18, ph) * pow(1.0 - ph, 1.4);
  float alpha = m * env * heat * vNear;
  if (alpha < 0.004) discard;
  vec3 col = mix(vec3(0.1, 0.094, 0.092), vec3(0.36, 0.34, 0.335), clamp(n * 0.8 + vUv.y * 0.45 - 0.15, 0.0, 1.0)) * uAmbient;
  col += vec3(0.3, 0.07, 0.008) * pow(1.0 - ph, 3.0) * (1.0 - vUv.y) * (0.4 + 0.8 * uNight);
  gl_FragColor = fxOut(vec3(0.0), col, alpha);
}`;

/** Tileable value-noise fbm: R big billows (period 4), G finer (period 8). */
function makeNoise(N = 128) {
  const data = new Uint8Array(N * N * 4);
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
  const vnoise = (x, y, p, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % p) + p) % p, x1 = (x0 + 1) % p, y0 = ((yi % p) + p) % p, y1 = (y0 + 1) % p;
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (u, v, p, s, oct) => { let sum = 0, amp = 0.5, nrm = 0; for (let o = 0; o < oct; o++) { sum += amp * vnoise(u * p, v * p, p, s + o * 31); nrm += amp; amp *= 0.5; p *= 2; } return sum / nrm; };
  const st = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = (y * N + x) * 4;
    data[k] = Math.round(255 * st(0.22, 0.78, fbm(u, v, 4, 3, 4)));
    data[k + 1] = Math.round(255 * st(0.2, 0.8, fbm(u, v, 8, 11, 3)));
    data[k + 2] = 128; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Staging list for one draw layer (instance order inside the single draw = paint order). */
function makeLayer(cap) { return { cap, n: 0, P: new Float32Array(cap * 4), S: new Float32Array(cap * 4), B: new Float32Array(cap * 4) }; }

export function createFlames(E) {
  const scene = G.scene;
  // draw order: smoke, then firelight + back tongues, then the tongues and sparks, then embers on top
  const L_SMOKE = makeLayer(360), L_BACK = makeLayer(480), L_EMBER = makeLayer(640), L_MAIN = makeLayer(MAX_FLAMES - 1480);
  const LAYERS = [L_SMOKE, L_BACK, L_MAIN, L_EMBER];
  const CAP = LAYERS.reduce((s, l) => s + l.cap, 0);

  const geo = new THREE.InstancedBufferGeometry();
  {
    const pos = [], idx = [], ROWS = 4;
    for (let j = 0; j <= ROWS; j++) pos.push(-0.5, j / ROWS, 0, 0.5, j / ROWS, 0);
    for (let j = 0; j < ROWS; j++) { const a = j * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
  }
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  const aBend = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  const ATTRS = [aPos, aSize, aBend];
  for (const a of ATTRS) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos); geo.setAttribute('aSize', aSize); geo.setAttribute('aBend', aBend);
  geo.instanceCount = 0;
  const mat = fxMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uNoise: { value: makeNoise() } },
    vertexShader: VS, fragmentShader: FS,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'elements-flames';
  mesh.visible = false;
  scene.add(mesh);

  const push = (L, x, y, z, seed, w, h, heat, type, b0, b1, b2, b3) => {
    if (L.n >= L.cap) return;
    const i = L.n * 4;
    L.P[i] = x; L.P[i + 1] = y; L.P[i + 2] = z; L.P[i + 3] = seed;
    L.S[i] = w; L.S[i + 1] = h; L.S[i + 2] = heat; L.S[i + 3] = type;
    L.B[i] = b0; L.B[i + 1] = b1; L.B[i + 2] = b2; L.B[i + 3] = b3;
    L.n++;
  };
  // a tongue; lean from the wind (wx, wz in m/s) plus an extra lean (ex, ez in m)
  const tongue = (L, x, y, z, seed, w, h, heat, layer, wx, wz, ex = 0, ez = 0) => {
    let lx = wx * LEAN * h + ex, lz = wz * LEAN * h + ez;
    const l = Math.hypot(lx, lz), m = LEAN_MAX * h;
    if (l > m) { lx *= m / l; lz *= m / l; }
    push(L, x, y, z, seed, w, h, heat, FLAME, lx, lz, layer, 0);
  };
  const smokeLoop = (x, y, z, seed, spread, rise, density, size, rate, wx, wz) => push(L_SMOKE, x, y, z, seed, spread, rise, density, SMOKE, wx, wz, rate, size);
  const emberLoop = (x, y, z, seed, spread, rise, heat, rate, swirl, wx, wz) => push(L_EMBER, x, y, z, seed, spread, rise, heat, EMBER, wx, wz, rate, swirl);

  // ---- short-lived pieces (licks, blooms, puffs): a small struct-of-arrays pool ----------------------------------------
  const PN = 256;
  const tp = { x: new Float32Array(PN), y: new Float32Array(PN), z: new Float32Array(PN), vx: new Float32Array(PN), vy: new Float32Array(PN), vz: new Float32Array(PN),
    w: new Float32Array(PN), h: new Float32Array(PN), t0: new Float32Array(PN), dur: new Float32Array(PN), seed: new Float32Array(PN), heat: new Float32Array(PN),
    type: new Uint8Array(PN), layer: new Uint8Array(PN), ex: new Float32Array(PN), ez: new Float32Array(PN) };
  const TPA = Object.values(tp);
  let tn = 0;
  function spawn(type, x, y, z, vx, vy, vz, w, h, dur, heat, layer, ex = 0, ez = 0, delay = 0) {
    let i = tn;
    if (tn >= PN) {   // full: replace the oldest
      i = 0; for (let k = 1; k < tn; k++) if (tp.t0[k] < tp.t0[i]) i = k;
    } else tn++;
    tp.x[i] = x; tp.y[i] = y; tp.z[i] = z; tp.vx[i] = vx; tp.vy[i] = vy; tp.vz[i] = vz; tp.w[i] = w; tp.h[i] = h;
    tp.t0[i] = G.time.t + delay; tp.dur[i] = Math.max(0.05, dur); tp.seed[i] = Math.random() * 97; tp.heat[i] = heat;
    tp.type[i] = type; tp.layer[i] = layer; tp.ex[i] = ex; tp.ez[i] = ez;
  }
  function removeAt(i) {
    const j = --tn;
    if (i === j) return;
    for (let k = 0; k < TPA.length; k++) TPA[k][i] = TPA[k][j];
  }
  const quality = () => G.quality?.particles ?? 1;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- persistent sources: fire whirls (tornado) and flame patches (lava) ------------------------------------------
  const whirls = [], patches = [];
  const handleKill = (h) => (sec = 0.3) => { if (!h.alive || h.dying >= 0) return; h.dying = G.time.t; h.fade = Math.max(0.01, sec); };
  function whirl(o = {}) {
    const h = { pos: new THREE.Vector3().copy(o.pos || _v0), R: o.R ?? 4, H: o.H ?? 20, k: 1, dur: o.dur ?? 0, t0: G.time.t, alive: true, dying: -1, fade: 0.3, seed: Math.random() * 50 };
    h.kill = handleKill(h); h.remove = () => h.kill(0.01);
    whirls.push(h);
    return h;
  }
  function patch(o = {}) {
    const h = { pos: new THREE.Vector3().copy(o.pos || _v0), r: o.r ?? 2, I: o.I ?? 1, alive: true, dying: -1, fade: 0.8, t0: G.time.t, seed: Math.floor(Math.random() * 1000) };
    h.dims = (r0, r1) => { h.r = r1 ?? r0; };
    h.kill = handleKill(h); h.remove = () => h.kill(0.01);
    patches.push(h);
    return h;
  }
  const _v0 = new THREE.Vector3();
  const fadeOf = (h, now) => (h.dying < 0 ? 1 : 1 - (now - h.dying) / h.fade);

  /** short flame licks around pos (kit.tongues uses this for fire). */
  function lick(pos, { n = 3, r = 0.5, h = 1.2, dur = 0.7, heat = 1, spread = 1, delay = 0 } = {}) {
    if (!pos) return;
    n = Math.max(1, Math.round(n * quality()));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r * spread;
      const hh = h * rnd(0.7, 1.25) * 1.35;
      spawn(FLAME, pos.x + Math.cos(a) * d, pos.y - 0.1, pos.z + Math.sin(a) * d, 0, hh * 0.12, 0, hh * rnd(0.5, 0.62), hh, dur * rnd(0.8, 1.25), heat, i % 2 ? 2 : 1,
        rnd(-0.12, 0.12) * hh, rnd(-0.12, 0.12) * hh, delay + Math.random() * 0.08);
    }
  }
  const _t = new THREE.Vector3(), _a = new THREE.Vector3(), _n = new THREE.Vector3();
  /** a fireball bloom on a surface (normal): a fat puff of flame that rises, tongues licking out round it, smoke. */
  function burst(pos, normal, radius = 1, big = false) {
    if (!pos) return;
    const q = quality(), low = q < 0.6;
    _n.copy(normal || _a.set(0, 1, 0)); if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0); _n.normalize();
    _t.crossVectors(_n, Math.abs(_n.y) < 0.95 ? _a.set(0, 1, 0) : _a.set(1, 0, 0)).normalize();
    _a.crossVectors(_t, _n).normalize();
    const R = radius, D = big ? 0.72 : 0.52;
    const bx = pos.x + _n.x * R * 0.15, by = pos.y + _n.y * R * 0.15 - R * 0.35, bz = pos.z + _n.z * R * 0.15;
    spawn(FLAME, bx, by, bz, _n.x * R * 0.8, R * 1.6, _n.z * R * 0.8, R * 2.3, R * 2.7, D * 1.15, 1, 0);
    spawn(FLAME, bx, by, bz, _n.x * R, R * 1.9, _n.z * R, R * 1.75, R * 2.3, D, 1.1, 1);
    if (!low) spawn(FLAME, bx, by + R * 0.1, bz, _n.x * R, R * 2.1, _n.z * R, R * 1.2, R * 1.7, D * 0.8, 1.15, 2);
    const cnt = low ? 3 : big ? 8 : 5;
    const ph = Math.random() * TAU;
    for (let i = 0; i < cnt; i++) {
      const a = ph + i * 2.39996, c = Math.cos(a), s = Math.sin(a);
      const dx = _t.x * c + _a.x * s, dy = _t.y * c + _a.y * s, dz = _t.z * c + _a.z * s;
      const hh = R * rnd(0.9, 1.45);
      spawn(FLAME, pos.x + dx * R * 0.4, pos.y + dy * R * 0.4 - R * 0.25, pos.z + dz * R * 0.4,
        dx * R * 1.2 + _n.x * R * 0.5, dy * R * 1.2 + R * 1.6, dz * R * 1.2 + _n.z * R * 0.5,
        hh * 0.6, hh, D * rnd(0.85, 1.45), 1, i % 2 ? 2 : 1, dx * hh * 0.3, dz * hh * 0.3, Math.random() * 0.05);
    }
    const sm = R < 0.5 ? 0 : low ? 1 : big ? 4 : 2;   // no smoke off the small release puff at the wand
    for (let i = 0; i < sm; i++) {
      spawn(SMOKE, pos.x + rnd(-0.4, 0.4) * R, pos.y + R * 0.9, pos.z + rnd(-0.4, 0.4) * R, rnd(-0.3, 0.3) * R, R * rnd(1.4, 2.0), rnd(-0.3, 0.3) * R,
        R * rnd(1.3, 1.9), 0, rnd(1.8, 2.6) * (big ? 1.2 : 1), 0.62, 0, 0, 0, D * 0.45 + i * 0.1);
    }
  }

  // ---- frost shells ---------------------------------------------------------------------------------------------
  const shellGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = shellGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.88 + 0.24 * hash2(Math.round(x * 50) + 7, Math.round(y * 50) * 3 + Math.round(z * 50));
      p.setXYZ(i, x * k, y * k, z * k);
    }
    shellGeo.computeVertexNormals();
  }
  const shellMat = hookMaterial(new THREE.MeshLambertMaterial({
    color: 0xc4ecff, emissive: 0x3d7fa8, emissiveIntensity: 0.35, transparent: true, opacity: 0.62, flatShading: true, depthWrite: false,
  }));
  const shells = [];
  const shellFor = new Map();

  // ---- fire lights ---------------------------------------------------------------------------------------------
  const lights = [];
  for (let i = 0; i < MAX_FIRE_LIGHTS; i++) {
    const L = new THREE.PointLight(0xff8a3a, 0, 22, 2);
    L.castShadow = false;
    L.userData.target = 0; L.userData.seed = Math.random() * 100;
    scene.add(L);
    lights.push(L);
  }
  const CAND = Array.from({ length: 48 }, () => ({ x: 0, y: 0, z: 0, d: 0, w: 0 }));
  let cn = 0;
  const cand = (x, y, z, d, w) => { if (cn >= CAND.length) return; const c = CAND[cn++]; c.x = x; c.y = y; c.z = z; c.d = d; c.w = w; };
  let lightT = 0;
  function pickLights(cam) {
    cn = 0;
    for (const h of E.fire.heat.values()) {
      if (h.n < 0.9) continue;
      const x = h.sx / h.n, y = h.sy / h.n, z = h.sz / h.n;
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      if (d < 90) cand(x, y + 1.6, z, d, Math.min(1.6, 0.5 + h.n * 0.12));
    }
    for (const r of E.active) {
      if (!r.burning) continue;
      const d = r.pos.distanceTo(cam);
      if (d < 90) cand(r.pos.x, r.cy + r.height * 0.2, r.pos.z, d, Math.min(1.6, 0.5 + r.radius * r.height * 0.15));
    }
    for (const h of whirls) { const d = h.pos.distanceTo(cam); if (d < 110) cand(h.pos.x, h.pos.y + 3, h.pos.z, d, 1.6 * h.k); }
    for (const h of patches) { const d = h.pos.distanceTo(cam); if (d < 90) cand(h.pos.x, h.pos.y + 1.2, h.pos.z, d, Math.min(1.4, 0.4 + h.r * 0.2) * h.I); }
    // nearest first (insertion sort: a few dozen at most)
    for (let i = 1; i < cn; i++) { const c = CAND[i]; let j = i - 1; while (j >= 0 && CAND[j].d > c.d) { CAND[j + 1] = CAND[j]; j--; } CAND[j + 1] = c; }
    // spread the lights: skip candidates too close to an already chosen one
    let k = 0;
    for (let i = 0; i < cn && k < lights.length; i++) {
      const c = CAND[i];
      let close = false;
      for (let j = 0; j < k; j++) { const L = lights[j]; if (Math.hypot(L.position.x - c.x, L.position.z - c.z) < 7) { close = true; break; } }
      if (close) continue;
      const L = lights[k++];
      if (L.userData.target === 0) L.intensity = 0;
      L.position.set(c.x, c.y, c.z);
      L.userData.target = c.w;
    }
    for (; k < lights.length; k++) lights[k].userData.target = 0;
  }

  const _p = new THREE.Vector3(), _w = new THREE.Vector3();
  const windAt = (x, y, z) => { _p.set(x, y, z); const W = E.weather; return W.visualWindAt ? W.visualWindAt(_p, _w) : W.breezeAt(_p, _w); };

  // ---- per-frame emission -------------------------------------------------------------------------------------------
  function emitGround(cam, q, low) {
    const glowK = 0.02 + 0.24 * mat.uniforms.uNight.value;   // HDR budget: pools overlap ~10 deep in a big fire
    // patches of the coarse heat grid: wind, firelight on the grass, a big dim back tongue, smoke and embers
    for (const h of E.fire.heat.values()) {
      if (h.n < 0.6) { h.wx = 0; h.wz = 0; continue; }
      const x = h.sx / h.n, y = h.sy / h.n, z = h.sz / h.n;
      windAt(x, y + 1, z); h.wx = _w.x; h.wz = _w.z;
      const k = Math.min(1, h.n / 5);
      const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      push(L_BACK, x, y, z, h.n, 7 + 4 * k, 7 + 4 * k, glowK * (0.4 + 0.6 * k), GLOW, 0, 0, 0, 0);
      // the cluster's own grid square gives stable seeds / anchors (the centroid wanders as cells come and go)
      const ix = Math.floor(x / 6), iz = Math.floor(z / 6), cx = (ix + 0.5) * 6, cz = (iz + 0.5) * 6;
      const sd = hash2(ix * 7 + 3, iz * 13 + 5) * 50;
      if (h.n >= (low ? 3 : 1.5) && d2 < 160 * 160) {
        const bh = 2.6 + 2.6 * k;
        tongue(L_BACK, x, y - 0.3, z, sd, bh * 0.95, bh, 0.55 + 0.3 * k, 0, h.wx, h.wz);
      }
      if (h.n >= 1.2 && d2 < 170 * 170) {
        const dens = Math.min(1, h.n / 3.5);
        const ns = low ? 1 : h.n > 4 ? 3 : 2;
        for (let i = 0; i < ns; i++) smokeLoop(cx, y + 1.4 + 1.2 * k, cz, sd + i * 7.1, 2.4, 6 + 5 * k, 0.5 * dens, 1.7 + 1.4 * k, 1 / (3.6 + i * 0.7), h.wx, h.wz);
        if (d2 < 110 * 110) {
          const ne = Math.round((low ? 2 : 5) * (0.5 + 0.5 * k));
          for (let i = 0; i < ne; i++) emberLoop(cx, y + 0.4, cz, sd + 30 + i * 3.3, 2.8, 4 + 3.5 * k, 0.9, 1 / (1.5 + (i % 3) * 0.45), 0, h.wx, h.wz);
        }
      }
    }
    // burning ground cells: a middle tongue and (near) a hot front one
    const far2 = (low ? 45 : 75) ** 2;
    for (const c of E.fire.cells.values()) {
      const g = smoothstep(0, 0.6, c.age);
      const end = 1 - smoothstep(c.life * 0.6, c.life, c.age);
      const s = c.size * (0.25 + 0.75 * g) * (0.3 + 0.7 * end) * (0.75 + 0.35 * Math.min(1.3, Math.max(0.3, c.str)));
      const heat = 0.35 + 0.65 * end;
      const h = E.fire.heatCell(c.x, c.z);
      const wx = h ? h.wx || 0 : 0, wz = h ? h.wz || 0 : 0;
      const near = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < far2;
      const mh = (near && !low ? 2.3 : 2.6) * s * (0.75 + 0.5 * c.sa);
      tongue(L_MAIN, c.ax, c.ay - 0.15, c.az, c.sa * 50, mh * 0.56, mh, heat, 1, wx, wz);
      if (near && !low) tongue(L_MAIN, c.bx, c.by - 0.15, c.bz, c.sb * 50 + 9, 1.05 * s, 1.65 * s, heat * 0.95, 2, wx, wz);
    }
  }

  function emitReactor(r, low, cam) {
    const ramp = smoothstep(0, 0.8, r._burnAge || 0);
    const fade = r.living ? 1 : 0.35 + 0.65 * smoothstep(0, 3, r.fuel);
    const k = ramp * fade;
    if (k <= 0.01) return;
    const heat = (r.living ? 0.6 + 0.4 * fade : 0.5 + 0.45 * fade) * (0.4 + 0.6 * ramp);
    const x = r.pos.x, z = r.pos.z, y0 = r.y0, H = r.height;
    windAt(x, y0 + H * 0.6, z);
    const wx = _w.x, wz = _w.z;
    const id = r.id || 0;
    if (r.kind === 'tree') {
      // the crown burns most; tongues climb the trunk; the crown smokes
      const o = r.owner;
      const cr = Math.max(0.8, o?.radius ?? r.radius / 0.7);
      const cy = o?.crownY ?? H * 0.64, cry = Math.max(0.6, Math.min(o?.crownRY ?? cr * 0.8, H * 0.35));
      const yc = y0 + cy;
      // the leaves would hide tongues inside the crown: they burn on the side that faces the camera
      let fx = cam.x - x, fz = cam.z - z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const nc = Math.max(4, Math.round(Math.min(12, 2 + cr * 3) * (low ? 0.55 : 1)));
      for (let i = 0; i < nc; i++) {
        const s1 = hash2(id * 7 + i, i * 13 + 1), s2 = hash2(id * 3 + i * 5, i + 77);
        const a = i * 2.39996 + id;
        let px, py, pz;
        if (i % 2) {   // over the top of the crown
          const rr = cr * 0.6 * s1;
          px = x + Math.cos(a) * rr; pz = z + Math.sin(a) * rr; py = yc + cry * (0.15 + 0.55 * s2);
        } else {       // on its skin, on the side the camera sees
          const sa = (s1 - 0.5) * 2.4, ca = Math.cos(sa), sn = Math.sin(sa);
          const ox = fx * ca - fz * sn, oz = fz * ca + fx * sn;
          px = x + ox * cr * 0.95; pz = z + oz * cr * 0.95; py = yc - cry * 0.85 + cry * 1.1 * s2;
        }
        const hh = cr * (1.0 + 0.7 * s2) * k;
        tongue(L_MAIN, px, py, pz, s1 * 40 + i, hh * 0.6, hh, heat, i % 3 === 0 ? 2 : 1, wx, wz);
      }
      const tb = Math.max(0.5, cy - cry);
      tongue(L_MAIN, x + fx * 0.3, y0 - 0.1, z + fz * 0.3, id + 0.5, 1.1 * k, Math.min(2.6, tb * 0.8 + 0.8) * k, heat, 1, wx, wz);
      if (!low) tongue(L_MAIN, x + fx * 0.35, y0 + tb * 0.45, z + fz * 0.35, id + 0.9, 0.75 * k, Math.min(2.2, tb * 0.6 + 0.6) * k, heat * 0.9, 2, wx, wz);
      const ns = low ? 1 : 3;
      for (let i = 0; i < ns; i++) smokeLoop(x, yc + cry * 0.6, z, id * 3.1 + i * 7.7, cr * 0.5, 7 + H * 0.4, 0.55 * k, cr * 1.1 + 0.8, 1 / (3.8 + i * 0.6), wx, wz);
      const ne = low ? 3 : 7;
      for (let i = 0; i < ne; i++) emberLoop(x, yc - cry * 0.3, z, id * 5.3 + i * 2.9, cr * 0.8, 5 + H * 0.25, 1, 1 / (1.6 + (i % 3) * 0.5), 0, wx, wz);
      return;
    }
    // props and creatures: flames hugging the body, a little smoke off non-living things
    const cnt = Math.max(1, Math.min(5, Math.round(r.radius * H * 0.5)));
    const base = Math.min(7, H * 0.55 + r.radius * 0.9) * k;
    tongue(L_BACK, x, y0, z, id + 0.3, Math.max(r.radius * 2.2, base * 0.8), base * 1.35, heat * 0.7, 0, wx, wz);
    for (let i = 0; i < cnt; i++) {
      const sd = hash2(id * 7 + i, i * 13);
      const a = i * 2.4 + id;
      const rr = i ? r.radius * (0.35 + 0.35 * sd) : 0;
      const yy = y0 + H * (i ? 0.1 + 0.5 * sd : 0.05);
      const sz = base * (i ? 0.6 + 0.35 * sd : 1);
      tongue(L_MAIN, x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, sd * 40 + i, sz * 0.62, sz * 1.25, heat, i % 2 ? 2 : 1, wx, wz);
    }
    if (!r.living && H > 0.8) smokeLoop(x, y0 + H + 0.3, z, id * 2.3, r.radius * 0.5, 5 + H, 0.45 * k, 0.8 + r.radius, 1 / 3.4, wx, wz);
    emberLoop(x, y0 + H * 0.4, z, id * 4.1, r.radius, 3 + H, 0.9, 1 / 1.7, 0, wx, wz);
    if (!low) emberLoop(x, y0 + H * 0.4, z, id * 4.1 + 2, r.radius, 3 + H, 0.9, 1 / 2.1, 0, wx, wz);
  }

  function emitWhirl(h, now, low, q) {
    const env = Math.max(0, fadeOf(h, now)) * Math.min(1, (now - h.t0) / 0.35) * (h.dur ? 1 - smoothstep(h.dur * 0.75, h.dur, now - h.t0) : 1);
    const k = Math.max(0, Math.min(1.2, h.k)) * env;
    if (k <= 0.01) return;
    const { R, H } = h, P = h.pos;
    windAt(P.x, P.y + 4, P.z);
    const wx = _w.x * 0.4, wz = _w.z * 0.4;
    const t = now, spin = 3.0;
    // the sheet: three arms of tongues spiralling up the funnel, each trailing behind its own motion
    const per = low ? 4 : q < 0.9 ? 7 : 9;
    for (let a = 0; a < 3; a++) for (let j = 0; j < per; j++) {
      const u = (j / per + t * 0.36 + a * 0.13) % 1;
      const e = smoothstep(0, 0.1, u) * (1 - smoothstep(0.72, 1, u));
      if (e <= 0.02) continue;
      const ang = a * 2.0944 + u * 3.6 - t * spin + h.seed;
      const rr = R * (0.16 + 0.62 * u);
      const tx = Math.sin(ang), tz = -Math.cos(ang);          // direction of travel round the funnel
      const hh = R * (0.7 + 1.1 * u) * k;
      tongue(L_MAIN, P.x + Math.cos(ang) * rr, P.y + u * H * 0.7 - hh * 0.25, P.z + Math.sin(ang) * rr, h.seed + a * 17 + j * 3.1,
        hh * 0.55, hh, (0.75 + 0.3 * e) * Math.min(1, k * 1.2) * e, j % 3 === 2 ? 0 : (j % 3) + 1, 0, 0, -tx * hh * 0.6, -tz * hh * 0.6);
    }
    // the foot: a ring of tongues turning on the ground
    const nb = low ? 3 : 6;
    for (let i = 0; i < nb; i++) {
      const ang = i * TAU / nb - t * spin * 0.7 + h.seed, rr = R * 0.42;
      const hh = R * (0.75 + 0.2 * Math.sin(t * 3 + i)) * k;
      tongue(L_MAIN, P.x + Math.cos(ang) * rr, P.y - 0.2, P.z + Math.sin(ang) * rr, h.seed + 60 + i, hh * 0.6, hh, 0.9 * Math.min(1, k), i % 2 + 1, 0, 0,
        -Math.sin(ang) * hh * 0.5, Math.cos(ang) * hh * 0.5);
    }
    tongue(L_BACK, P.x, P.y - 0.3, P.z, h.seed + 90, R * 1.5 * k, R * 2.0 * k, 0.6, 0, 0, 0);
    const ns = low ? 1 : 3;
    for (let i = 0; i < ns; i++) smokeLoop(P.x, P.y + H * 0.45, P.z, h.seed + i * 5.3, R * 0.5, H * 0.45, 0.55 * Math.min(1, k), R * 1.1, 1 / (4 + i * 0.6), wx, wz);
    const ne = low ? 5 : 12;
    for (let i = 0; i < ne; i++) emberLoop(P.x, P.y + 0.5, P.z, h.seed + 20 + i * 1.9, R * 0.4, H * 0.55, 1, 1 / (1.8 + (i % 4) * 0.35), R * 0.35, wx, wz);
  }

  function emitPatch(h, now, low) {
    const env = Math.max(0, fadeOf(h, now));
    const k = env * Math.max(0, h.I);
    if (k <= 0.01 || h.r < 0.2) return;
    const P = h.pos, t = now;
    windAt(P.x, P.y + 1, P.z);
    const wx = _w.x, wz = _w.z;
    const n = Math.max(2, Math.round(Math.min(10, h.r * 2) * (low ? 0.5 : 1)));
    for (let i = 0; i < n; i++) {
      const s1 = hash2(h.seed + i * 7, i * 3 + 1), s2 = hash2(h.seed * 3 + i, i * 11 + 5);
      const a = i * 2.39996 + s1, d = Math.sqrt(s2) * h.r * 0.8;
      const breathe = 0.8 + 0.2 * Math.sin(t * (0.8 + s1) + i * 2.1);
      const hh = (1.0 + 0.9 * s1) * breathe * k;
      tongue(L_MAIN, P.x + Math.cos(a) * d, P.y - 0.1, P.z + Math.sin(a) * d, h.seed + i * 3.7, hh * 0.6, hh, 0.85 * k, i % 2 + 1, wx, wz);
    }
    const ne = low ? 2 : 5;
    for (let i = 0; i < ne; i++) emberLoop(P.x, P.y + 0.2, P.z, h.seed + 40 + i * 2.3, h.r * 0.7, 3.5, 1, 1 / (1.6 + (i % 3) * 0.4), 0, wx, wz);
    smokeLoop(P.x, P.y + 1.2, P.z, h.seed + 70, h.r * 0.5, 5.5, 0.4 * k, 1.2 + h.r * 0.25, 1 / 3.6, wx, wz);
  }

  function emitTimed(now) {
    for (let i = 0; i < tn; i++) {
      const age = now - tp.t0[i];
      if (age < 0) continue;
      const D = tp.dur[i];
      if (age >= D) { removeAt(i); i--; continue; }
      const a = age / D;
      const travel = D * (1 - (1 - a) * (1 - a)) * 0.5;    // decelerating
      const x = tp.x[i] + tp.vx[i] * travel, y = tp.y[i] + tp.vy[i] * travel, z = tp.z[i] + tp.vz[i] * travel;
      if (tp.type[i] === SMOKE) {
        push(L_SMOKE, x, y, z, tp.seed[i], 0, 0, tp.heat[i], SMOKE, 0, 0, -Math.max(0.001, a), tp.w[i]);
        continue;
      }
      const grow = smoothstep(0, 0.16, a), shrink = 1 - 0.72 * smoothstep(0.4, 1, a);
      const s = grow * shrink;
      const heat = tp.heat[i] * (1 - smoothstep(0.5, 1, a) * 0.85);
      const L = tp.layer[i] === 0 ? L_BACK : L_MAIN;
      push(L, x, y, z, tp.seed[i], tp.w[i] * s, tp.h[i] * s, heat, FLAME, tp.ex[i] * s, tp.ez[i] * s, tp.layer[i], 0);
    }
  }

  function upload() {
    const P = aPos.array, S = aSize.array, B = aBend.array;
    let o = 0;
    for (const L of LAYERS) {
      const m = L.n * 4;
      for (let i = 0; i < m; i++) { P[o + i] = L.P[i]; S[o + i] = L.S[i]; B[o + i] = L.B[i]; }
      o += m;
    }
    const n = o / 4;
    geo.instanceCount = n;
    if (n) {
      for (let k = 0; k < 3; k++) { const a = ATTRS[k]; a.clearUpdateRanges(); a.addUpdateRange(0, o); a.needsUpdate = true; }
    }
    mesh.visible = n > 0;
    return n;
  }
  let count = 0;

  const api = {
    mesh, lights,
    get count() { return count; },
    lick, burst, whirl, patch,
    get whirls() { return whirls; },
    update(dt, rdt) {
      const t = G.time.t;
      const cam = G.camera.position;
      const day = G.env ? G.env.light : 1;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uNight.value = 1 - day;
      const q = quality(), low = q < 0.6;
      for (const L of LAYERS) L.n = 0;
      emitGround(cam, q, low);
      for (const r of E.active) {
        if (r.burning && !r.dead) emitReactor(r, low, cam);
        if (r.shocked && !r.dead) {
          for (let i = 0; i < 2; i++) {
            const sd = hash2(r.id + i * 31, Math.floor(t * 9));
            const a = sd * 6.283;
            const s = Math.max(1.5, Math.min(3, r.radius * 2.4));
            push(L_MAIN, r.pos.x + Math.cos(a) * r.radius * 0.7, r.cy + (hash2(r.id, i + Math.floor(t * 9)) - 0.5) * r.height * 0.8,
              r.pos.z + Math.sin(a) * r.radius * 0.7, sd + i, s, s, Math.min(1, r.shocked * 2), SPARK, 0, 0, 0, 0);
          }
        }
      }
      for (let i = whirls.length - 1; i >= 0; i--) {
        const h = whirls[i];
        if ((h.dying >= 0 && t - h.dying >= h.fade) || (h.dur && t - h.t0 >= h.dur)) { h.alive = false; whirls.splice(i, 1); continue; }
        emitWhirl(h, t, low, q);
      }
      for (let i = patches.length - 1; i >= 0; i--) {
        const h = patches[i];
        if (h.dying >= 0 && t - h.dying >= h.fade) { h.alive = false; patches.splice(i, 1); continue; }
        emitPatch(h, t, low);
      }
      emitTimed(t);
      count = upload();

      // frost shells
      for (const [r, s] of shellFor) {
        if (!r.frozen || r.dead) {
          s.userData.out = (s.userData.out || 0) + rdt * 4;
          const k = Math.max(0, 1 - s.userData.out);
          s.scale.set(s.userData.sx * k, s.userData.sy * k, s.userData.sz * k);
          if (k <= 0) { s.visible = false; shellFor.delete(r); shells.push(s); }
        }
      }
      for (const r of E.active) {
        if (!r.frozen || r.dead) continue;
        let s = shellFor.get(r);
        if (!s) {
          s = shells.pop();
          if (!s) { s = new THREE.Mesh(shellGeo, shellMat); s.castShadow = false; s.receiveShadow = false; s.renderOrder = 3; scene.add(s); }
          s.visible = true; s.userData.age = 0; s.userData.out = 0;
          s.rotation.set(Math.random() * 0.4, Math.random() * 6.28, Math.random() * 0.4);
          s.userData.sx = r.radius * 1.3 + 0.12; s.userData.sy = r.height * 0.62 + 0.12; s.userData.sz = r.radius * 1.3 + 0.12;
          shellFor.set(r, s);
        }
        s.userData.age += rdt;
        const k = Math.min(1, s.userData.age * 6) * (1 + 0.15 * Math.max(0, 1 - s.userData.age * 3));
        s.position.set(r.pos.x, r.cy, r.pos.z);
        s.scale.set(s.userData.sx * k, s.userData.sy * k, s.userData.sz * k);
      }

      // lights
      lightT -= rdt;
      if (lightT <= 0) { lightT = 0.2; pickLights(cam); }
      for (const L of lights) {
        const sd = L.userData.seed;
        const fl = 0.78 + 0.14 * Math.sin(t * 13 + sd) + 0.08 * Math.sin(t * 29 + sd * 3);
        const tgt = L.userData.target * (8 + 20 * (1 - day)) * fl; // HDR budget: ~45 cd peak at night (was 770: white hotspots)
        L.intensity += (tgt - L.intensity) * Math.min(1, rdt * 10);
        if (L.intensity < 0.05 && L.userData.target === 0) L.intensity = 0;
      }
    },
    clear() {
      for (const L of LAYERS) L.n = 0;
      tn = 0;
      for (const h of whirls) h.alive = false;
      for (const h of patches) h.alive = false;
      whirls.length = 0; patches.length = 0;
      count = upload();
      for (const [, s] of shellFor) { s.visible = false; shells.push(s); }
      shellFor.clear();
      for (const L of lights) { L.intensity = 0; L.userData.target = 0; }
    },
  };
  return api;
}

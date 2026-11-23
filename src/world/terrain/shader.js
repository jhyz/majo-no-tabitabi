// The terrain material: MeshToonMaterial (same 4-step ramp as core toon()) whose base colour is painted per fragment —
// biome by Veil (spring meadow / ochre-gold-red dusk / teal-indigo night with glow veins), slope rock with faceted
// planes and strata, snow on 霜见岳, sand on the shore, gravel river banks, worn footpaths and stone paving in
// settlements, farm plots around 朝颜村, craters / mounds, and the fading scorch layer. Goes through hookMaterial().
import * as THREE from 'three';
import { toonGradient, hookMaterial } from '../../core/mats.js';
import { VEIL, POI, MOUNTAIN } from '../../data/world.js';
import { DATA_HALF } from './textures.js';
import { plotGLSL, ROW_SPACE, HILL_SPACE } from './paddyLayout.js';
import { meadowPattern } from '../flora/meadowPattern.js';

/** sRGB hex -> GLSL vec3 literal in linear space. */
export function lin(hex, k = 1) {
  const c = new THREE.Color().setHex(hex);
  return `vec3(${(c.r * k).toFixed(4)}, ${(c.g * k).toFixed(4)}, ${(c.b * k).toFixed(4)})`;
}

// settlement kinds: 1 raked gravel, 2 stone plaza, 3 dirt yard, 4 dirt + leaves, 5 stone (palace), 6 stone (snowy shrine)
// w = kind + plaza radius fraction
// practice (errands round): a grass field with only a small worn spot where Saya stands; its earth track is the
// 'practice_track' footpath loop (data/world.js), which a dirt kind keeps unpaved (it was a 12 m stone plaza)
const SETTLE = [
  ['hometown', 1.62], ['bellcrown', 2.34], ['gate', 3.2], ['inn', 4.26],
  ['bellkeep', 5.78], ['roof', 6.7], ['practice', 3.1], ['trial', 2.18],
];


// ---- large-scale ground variation, shared with the grass field (flora/grass.js can call it on its ground colour so the
// blades match the soil): dry / lush patches, damp hollows, bare knolls, night ash-blue soil, alpine sward on 霜见岳.
// curv = mean height 8 m around minus the height (+ = hollow, metres); w = (sun, dusk, night) weights; mm = mountain mask.
export const GROUND_TINT_GLSL = /* glsl */`
vec3 trGroundTint(vec3 col, float h, float curv, float n0, float n1, float n2, float n3, vec3 w, float mm) {
  float hollow = smoothstep(0.12, 0.8, curv + (n2 - 0.5) * 0.4);
  float knoll = smoothstep(0.15, 0.8, -curv + (n2 - 0.5) * 0.4);
  float dryP = smoothstep(0.56, 0.72, n1 * 0.55 + n0 * 0.45 + knoll * 0.22);
  // look round: the meadow as a painting: broad soft swells of lush cool green and sun-dried warm green, sunlit warm
  // crowns on the knolls, deeper cool green in the hollows
  float lush = smoothstep(0.3, 0.72, n2 * 0.6 + n1 * 0.4);
  vec3 s = col * mix(vec3(1.06, 1.04, 0.92), vec3(0.83, 1.01, 1.04), lush);
  s = mix(s, s * vec3(0.68, 0.86, 0.84), hollow * 0.7);
  s = mix(s, s * vec3(1.12, 1.08, 0.86), knoll * 0.5);
  s = mix(s, ${lin(0xb7bf66)} * (0.9 + 0.2 * n3), dryP * 0.3);
  vec3 d = mix(col, col * vec3(0.7, 0.64, 0.7), hollow * 0.6);
  d = mix(d, d * vec3(1.12, 1.06, 0.92), dryP * 0.4);
  float ash = smoothstep(0.48, 0.68, n1 * 0.5 + n2 * 0.5 + knoll * 0.2);
  vec3 nn = mix(col, ${lin(0x485670)} * (0.85 + 0.25 * n3), ash * 0.55);
  nn = mix(nn, nn * vec3(0.74, 0.8, 0.96), hollow * 0.5);
  vec3 r = s * w.x + d * w.y + nn * w.z;
  float alp = smoothstep(0.1, 0.32, mm) * smoothstep(30.0, 75.0, h + (n1 - 0.5) * 30.0);
  return mix(r, mix(${lin(0x7d8c5e)}, ${lin(0xa39e74)}, smoothstep(0.4, 0.62, n2)) * (0.88 + 0.16 * n3), alp * 0.8);
}
`;

// look round: the colour open grass shows from a little way off (the lit upper half of the blades), relative to the
// ground colour. flora/grass.js converges its far blades on col * GRASS_TOP and the terrain paints open grass with it
// beyond the dense blades, so the hand-over from blades to painted ground has no line and no change of hue.
export const GRASS_TOP = 'vec3(1.07, 1.1, 0.98)';

export const terrainGLSL = GROUND_TINT_GLSL + plotGLSL + /* glsl */`
uniform vec4 trGust;   // wind direction xz, strength (0.15..1.6), grass time: the grass's travelling sheen
uniform sampler2D trData;
uniform sampler2D trScorch;
uniform sampler2D trNoise;
uniform float trTime;
uniform vec4 trVeil;
uniform vec4 trMount;
uniform vec4 trSettle[8];
uniform vec4 trFarm;
uniform vec4 trHill;
uniform sampler2DArray trDetA;
uniform sampler2DArray trDetN;
varying vec3 vTrW;
varying vec3 vTrN;
varying float vTrDef;
${meadowPattern}
float trHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 trHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// jittered-grid voronoi: returns (F2-F1, cell hash)
vec2 trVoronoi(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0; vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = trHash2(ip + g) * 0.8 + 0.1;
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = ip + g; } else if (d < f2) { f2 = d; }
  }
  return vec2(sqrt(f2) - sqrt(f1), trHash(id));
}
// ---- material detail (terrain/detail.js): two virtual tilings picked by macro noise hide the repetition
struct TrS { vec4 a; vec4 n; };
vec2 trDX, trDY;
float trDistG;
const vec4 TR_N0 = vec4(0.5, 0.5, 0.85, 0.0);
TrS trSamp(vec2 p, float S, float l, float kq) {
  vec2 uv = p / S, dx = trDX / S, dy = trDY / S;
  TrS r;
  float k = kq * 7.0, i = floor(k), f = fract(k);
  vec2 oa = sin(vec2(3.0, 7.0) * i) * 4.1;
#if TR_Q > 0
  if (trDistG < TR_NEAR) {
    // near: two virtual tilings picked by macro noise, height-aware blend; normals + accent
    vec2 ob = sin(vec2(3.0, 7.0) * (i + 1.0)) * 4.1;
    vec4 a1 = textureGrad(trDetA, vec3(uv + oa, l), dx, dy), a2 = textureGrad(trDetA, vec3(uv + ob, l), dx, dy);
    float b = smoothstep(0.25, 0.75, f + (a2.a - a1.a) * 0.6);
    r.a = mix(a1, a2, b);
    r.n = mix(textureGrad(trDetN, vec3(uv + oa, l), dx, dy), textureGrad(trDetN, vec3(uv + ob, l), dx, dy), b);
    return r;
  }
#endif
  // mid distance: one tiling (the region offset still breaks the repetition), accent only
  r.a = textureGrad(trDetA, vec3(uv + oa, l), dx, dy);
  r.n = vec4(TR_N0.xyz, textureGrad(trDetN, vec3(uv + oa, l), dx, dy).a);
  return r;
}
// single tiling (side projections, rotated / special coordinates)
TrS trSamp1(vec2 uv, vec2 dx, vec2 dy, float l) {
  TrS r; r.a = textureGrad(trDetA, vec3(uv, l), dx, dy);
#if TR_Q > 0
  r.n = trDistG < TR_NEAR ? textureGrad(trDetN, vec3(uv, l), dx, dy) : TR_N0;
#else
  r.n = TR_N0;
#endif
  return r;
}
// height-blended transition: material on top (hTop) wins where it stands taller than the one below (hBot)
float trHB(float m, float hTop, float hBot) {
  float e = 1.0 - abs(2.0 * m - 1.0);
  return smoothstep(0.28, 0.72, m + (hTop - hBot) * 0.9 * e);
}
// tint for neutral materials (sand, rock, dirt, stone) by land
vec3 trLand(vec3 c, float wd, float wn) {
  c = mix(c, c * vec3(0.98, 0.94, 0.96), wd);
  return mix(c, c * vec3(0.33, 0.37, 0.5), wn);
}
`;

// Both the actual blades and their distant terrain colour use these reflectances.
export const MEADOW = {
  sun: lin(0x8cc351), sunDark: lin(0x70a75b), sunLight: lin(0xb6ce69),
  sunDeep: lin(0x55a475), sunTeal: lin(0x68ad7d), hill: lin(0xbac85b)
};

const C = {
  ...MEADOW,
  duskOchre: lin(0xa29a5c), duskGold: lin(0xc8bb6a), duskRed: lin(0xa86a46), duskPlum: lin(0x7c6a72),
  nightA: lin(0x2e3d4a), nightB: lin(0x222b38), nightTeal: lin(0x274a4a),
  sand: lin(0xf0dfae), sandB: lin(0xdcc690), sandWet: lin(0xb8a27a), seabed: lin(0x5e8c86),
  gravelA: lin(0xc9bda0), gravelB: lin(0xa39a86),
  rock: lin(0xb8b6ab), rockDark: lin(0x7c8582), rockDusk: lin(0x8a7076), rockNight: lin(0x3e4152),
  snow: lin(0xf4f8ff), snowShade: lin(0xdde8fa),
  dirtA: lin(0xc6ab86), dirtB: lin(0xa58c6c), stoneA: lin(0xc2bcb0), stoneB: lin(0xa29c92), gravelW: lin(0xcfc6b3),
  paddyA: lin(0x9fdc5e), paddyB: lin(0x78c450), soilA: lin(0x9a6c46), soilB: lin(0x7a5236), grainA: lin(0xe2c35e), grainB: lin(0xc9a440),
  vegA: lin(0x5c9e3e), vegB: lin(0x447e32), dike: lin(0x6f9a46),
  craterA: lin(0x7a5a42), craterB: lin(0x5c4232), charA: lin(0x2e2622), charB: lin(0x463a32), frost: lin(0xe4f2ff),
  glowTeal: lin(0x3de0c0), glowViolet: lin(0x9c7cff), leaf: lin(0xc06a3a),
};

const FRAG_COLOR = /* glsl */`
vec3 trP = vTrW;
vec3 trN = normalize(vTrN);
float trH = trP.y;
vec3 trDP = dFdx(trP), trDQ = dFdy(trP);
trDX = trDP.xz; trDY = trDQ.xz;
float trDist = distance(cameraPosition, trP);
trDistG = trDist;
vec2 trUV = (trP.xz + ${DATA_HALF.toFixed(1)}) / ${(DATA_HALF * 2).toFixed(1)};
vec4 trD = texture2D(trData, trUV);
vec4 trS = texture2D(trScorch, trUV);
float trRoad = trD.g, trRiver = trD.b;
float n0 = texture2D(trNoise, trP.xz / 1300.0).r;
float n1 = texture2D(trNoise, trP.xz / 270.0 + 0.31).g;
float n2 = texture2D(trNoise, trP.xz / 57.0 + 0.77).b;
float n3 = texture2D(trNoise, trP.xz / 9.1).r;
float n4 = texture2D(trNoise, trP.xz / 23.0 + 0.45).g;
float kq = texture2D(trNoise, trP.xz / 31.0 + 0.19).b;
float trV = 1.0 - smoothstep(trVeil.z, trVeil.w, distance(trP.xz, trVeil.xy));
trV = clamp(trV + (n1 - 0.5) * 0.09, 0.0, 1.0);
float wSun = 1.0 - smoothstep(0.05, 0.34, trV);
float wNight = smoothstep(0.56, 0.86, trV);
float wDusk = max(0.0, 1.0 - wSun - wNight);
float trSlope = 1.0 - trN.y;
float trDefo = vTrDef;
// fine noise (2.7 m) that frays the edges of magic's marks, so a pit or a heave is never a vertex polygon
float trNF = texture2D(trNoise, trP.xz / 2.7 + 0.37).g;
// detail strength by distance: full near, fading into the painted far look (no ring: a long smooth ramp)
float trDetK = 1.0 - smoothstep(TR_FAR * 0.42, TR_FAR, trDist);
float trNK = 1.0 - smoothstep(TR_NEAR * 0.5, TR_NEAR * 0.95, trDist);
bool trNear = trDist < TR_FAR;
float trLichen = 0.0;
vec4 dAcc = vec4(0.5, 0.5, 1.0, 0.0);   // accumulated detail normal (xy), cavity, accent
float dH = 0.5;                            // height of the material on top

// ---- grass by land
vec3 gSun = mix(${C.sunDark}, ${C.sun}, smoothstep(0.36, 0.64, n1));
gSun = mix(gSun, ${C.sunLight}, smoothstep(0.58, 0.8, n2) * 0.55);
gSun = mix(gSun, ${C.sunDeep}, smoothstep(0.55, 0.78, n0) * 0.45);
gSun = mix(gSun, ${C.sunTeal}, smoothstep(0.55, 0.72, n4) * 0.35);
gSun = mix(gSun, ${C.sunLight}, smoothstep(0.62, 0.75, n4 * 0.5 + n2 * 0.5) * 0.25);
vec3 gDusk = mix(${C.duskOchre}, ${C.duskGold}, smoothstep(0.36, 0.64, n1));
gDusk = mix(gDusk, ${C.duskRed}, smoothstep(0.64, 0.8, n2) * 0.45);
gDusk = mix(gDusk, ${C.duskPlum}, smoothstep(0.58, 0.8, n0) * 0.35);
vec3 gNight = mix(${C.nightB}, ${C.nightA}, smoothstep(0.36, 0.64, n1));
gNight = mix(gNight, ${C.nightTeal}, smoothstep(0.56, 0.78, n2) * 0.7);
vec3 trCol = gSun * wSun + gDusk * wDusk + gNight * wNight;
// sunflower hill: warm yellow-green
float hillW = exp(-dot(trP.xz - trHill.xy, trP.xz - trHill.xy) / (trHill.z * trHill.z));
trCol = mix(trCol, ${C.hill}, hillW * 0.5 * smoothstep(0.35, 0.6, n2 + 0.2));
trCol *= 0.9 + 0.12 * n3 + 0.08 * n4;
vec2 md = (trP.xz - trMount.xy) / trMount.zw;
float mm = exp(-dot(md, md));
const float TR_O = 8.0 / ${(DATA_HALF * 2).toFixed(1)};
float trCurv = (texture2D(trData, trUV + vec2(TR_O, 0.0)).r + texture2D(trData, trUV - vec2(TR_O, 0.0)).r
  + texture2D(trData, trUV + vec2(0.0, TR_O)).r + texture2D(trData, trUV - vec2(0.0, TR_O)).r) * 0.25 - trD.r;
trCol = trGroundTint(trCol, trH, trCurv, n0, n1, n2, n3, vec3(wSun, wDusk, wNight), mm);
// painted grass material: blade strokes, clover patches in the meadow, combed dry grass at dusk, leaf litter in the woods
float woodFloor = smoothstep(.24,.86,trS.a) * smoothstep(2.4,5.,trRoad);
float litter = max(woodFloor,smoothstep(0.56, 0.7, n2 + (n4 - 0.5) * 0.5) * wDusk);
vec3 humus=mix(${lin(0x72634c)},${lin(0x78825c)},smoothstep(.35,.73,n3));
trCol=mix(trCol,humus*(.88+.18*n4),woodFloor*.82);
vec3 gFlowerC = vec3(0.0);
if (trNear) {
  TrS g = trSamp(trP.xz, 2.4, 0.0, kq);
  float clov = smoothstep(0.56, 0.8, n4 + (n3 - 0.5) * 0.2) * wSun * 0.75;
  if (clov > 0.01) { TrS c = trSamp(trP.xz, 1.5, 1.0, kq); clov = trHB(clov, c.a.a, g.a.a); g.a = mix(g.a, c.a, clov); g.n = mix(g.n, c.n, clov); }
  float dry = wDusk * (0.55 + 0.45 * smoothstep(0.4, 0.6, n1));
  if (dry > 0.01) { TrS c = trSamp(trP.xz, 3.1, 2.0, kq); g.a = mix(g.a, c.a, dry); g.n = mix(g.n, c.n, dry); }
  if (litter > 0.01) { TrS c = trSamp(trP.xz, 2.2, 11.0, kq); float lw = trHB(litter, c.a.a, g.a.a); g.a = mix(g.a, c.a, lw); g.n = mix(g.n, c.n, lw); }
  vec3 ratio = g.a.rgb * 2.0;
  ratio = mix(ratio, vec3(dot(ratio, vec3(0.333))), wNight * 0.4);      // night: calmer strokes
  trCol *= mix(vec3(1.0), ratio, trDetK);
  dAcc = g.n; dH = g.a.a;
  // The near relief contributes flecks; the same drift boundaries and local
  // colour family remain visible from a broom after the real stems fade out.
  float flecks = g.n.a * trDetK * (1.0 - litter);
  gFlowerC = vec3(flecks);
}
float floralBroad = texture2D(trNoise,trP.xz/128.0+.31).g;
float floralDetail = texture2D(trNoise,trP.xz/20.0+.42).b;
float floralDrift = meadowRibbon(trP.xz,floralBroad,floralDetail);
float floralWet = 1.0 - smoothstep(17.0,33.0,trRiver);
float floralShade = smoothstep(.47,.70,floralBroad);
float floralPick = smoothstep(.38,.62,texture2D(trNoise,trP.xz/52.0+.12).r);
vec3 flowerTone = meadowDayPetalAt(floralPick, floralShade, floralWet, trP.xz); // map round: regional meadow colours
flowerTone = mix(flowerTone,mix(vec3(.91,.22,.18),vec3(.96,.54,.15),floralPick),wDusk*(1.-.83*floralWet));
flowerTone = mix(flowerTone,vec3(.43,.65,.79),wNight);
float meadowRoom = smoothstep(3.15,5.5,trRoad)*smoothstep(9.5,13.,trRiver);
float colourAtDistance = smoothstep(20.,70.,trDist)*(1.-smoothstep(235.,540.,trDist));
float paint = (.07 + .14*smoothstep(.44,.59,n4))*colourAtDistance;
float petalPaint = meadowRoom*floralDrift*(.62*gFlowerC.x+paint)*(1.-.64*litter);
trCol = mix(trCol,flowerTone,clamp(petalPaint,0.,.45));
gFlowerC = flowerTone*gFlowerC.x*floralDrift*wNight;

// ---- settlements
float inSet = 0.0, plaza = 0.0, setKind = 0.0, setD = 1e5, setR = 1.0;
for (int i = 0; i < 8; i++) {
  vec4 s = trSettle[i];
  float d = distance(trP.xz, s.xy);
  float w = 1.0 - smoothstep(s.z * 0.8, s.z, d);
  if (w > inSet) { inSet = w; setKind = floor(s.w); }
  float pr = fract(s.w) * s.z;
  float pw = 1.0 - smoothstep(pr, pr + 2.5, d + (n3 - 0.5) * 2.0);
  if (pw > plaza) { plaza = pw; setKind = floor(s.w); setD = d; setR = pr; }
}

// ---- farm plots around the morning-glory village
float farm = paddyFarm(trP.xz,trH,trSlope,trRoad,trRiver,trFarm,trSettle[0].xy);
if (farm > 0.002) {
  vec2 q = paddyGrid(trP.xz);
  vec2 cs = vec2(26.0, 17.0);
  vec2 cell = floor(q / cs); vec2 f = fract(q / cs);
  float r = paddySeed(cell);
  vec2 e = min(f, 1.0 - f) * cs;
  float bankDist=min(e.x,e.y);
  float dike = 1.0 - smoothstep(0.37,0.72,bankDist);
  float rows = paddyRows(f.x*cs.x,r);
  float rowBlur=smoothstep(.14,.65,fwidth(q.x));
  rows=mix(rows,.5,rowBlur);
  float distanceMix=smoothstep(13.,64.,trDist);
  vec2 rowID=f*cs-vec2(1.06+r*.12,.98);
  float rowNumber=floor(rowID.x/${ROW_SPACE.toFixed(2)}+.5);
  vec2 rootOffset=vec2(rowID.x-rowNumber*${ROW_SPACE.toFixed(2)},
    (fract(rowID.y/${HILL_SPACE.toFixed(2)}-.28*mod(rowNumber,2.)+.5)-.5)*${HILL_SPACE.toFixed(2)});
  float contact=(1.-smoothstep(.035,.16,length(rootOffset)))*(1.-distanceMix)*(1.-rowBlur);
  vec3 fc;
  vec4 fn = vec4(0.5, 0.5, 1.0, 0.0);
  if (r < .32) {
    // Irrigated soil between transplant rows reflects the open sky at grazing angles.
    float skyFacing=1.-abs(normalize(cameraPosition-trP).y);
    float reflected=smoothstep(.2,.96,skyFacing)*(.68+.24*n3);
    vec3 water=mix(${lin(0x526a54)},${lin(0x91b5af)},reflected);
    float ripple=.5+.5*sin(q.y*6.+q.x*1.3+sin(q.x*.62+trTime*.46)+trTime*.78);
    water+=vec3(.024,.041,.041)*smoothstep(.82,.97,ripple)*(1.-rowBlur);
    float flooded=1.-smoothstep(.008,.045,trSlope);
    vec3 dampBed=mix(${lin(0x727345)},${lin(0x8b8c51)},n2*.62+rows*.3);
    fc=mix(mix(dampBed,water,flooded),${lin(0x6e9e50)},(.10+.56*distanceMix)*rows);
    fc*=1.-contact*.13;
    fc=mix(fc,${lin(0x7a6545)},.28*(1.-smoothstep(.72,1.5,bankDist)));
  }
  else if (r < 0.55) {
    fc = mix(${C.soilB}, ${C.soilA}, smoothstep(0.3, 0.7, rows));
    if (trNear) {
      // furrows follow the plot's rows
      mat2 rq = mat2(0.94, -0.34, 0.34, 0.94);
      vec2 su = vec2(q.y, q.x) / 2.86;
      vec2 qx = rq * trDX, qy = rq * trDY;
      TrS so = trSamp1(su, qx.yx / 2.86, qy.yx / 2.86, 9.0);
      fc *= mix(vec3(1.0), so.a.rgb * 2.0, trDetK); fn = so.n;
    }
  }
  else if (r < .8) {
    vec3 stubble=mix(${lin(0x80673d)},${lin(0xa29853)},rows*.48+n3*.32);
    vec3 tops=mix(${lin(0x9d994a)},${lin(0xceaf58)},rows*.64+n2*.29);
    fc=mix(stubble,tops,.25+.75*distanceMix)*(1.-contact*.13);
  }
  else fc = mix(${C.vegB}, ${C.vegA}, smoothstep(0.35, 0.65, rows));
  fc = mix(fc, ${C.dike}, dike);
  trCol = mix(trCol, fc, farm);
  dAcc = mix(dAcc, fn, farm);
}

// ---- river banks and the sea shore
float bank = 1.0 - smoothstep(8.0, 11.5 + n2 * 3.0, trRiver);
float damp = (1.0 - smoothstep(10.0, 24.0, trRiver)) * (1.0 - bank);
trCol = mix(trCol, trCol * vec3(0.8, 0.9, 0.84), damp * 0.7);
vec3 gravel = trLand(mix(${C.gravelB}, ${C.gravelA}, n3), wDusk, wNight);
if (bank > 0.002 && trNear) {
  TrS gv = trSamp(trP.xz, 1.7, 5.0, kq);
  gravel *= mix(vec3(1.0), gv.a.rgb * 2.0, trDetK * 0.6);
  bank = trHB(bank, gv.a.a, dH);
  dAcc = mix(dAcc, gv.n, bank); dH = mix(dH, gv.a.a, bank);
}
trCol = mix(trCol, gravel, bank);
float awayRiver = smoothstep(30.0, 60.0, trRiver);
float sandL = 0.9 + n2 * 1.8;
float sand = (1.0 - smoothstep(sandL, sandL + 1.1, trH)) * awayRiver;
vec3 sandC = trLand(mix(${C.sandB}, ${C.sand}, n3), wDusk, wNight);
if (sand > 0.002 && trNear) {
  TrS sd = trSamp(trP.xz, 3.6, 4.0, kq);
  sandC *= mix(vec3(1.0), sd.a.rgb * 2.0, trDetK * 0.5);
  sand = trHB(sand, sd.a.a, dH);
  dAcc = mix(dAcc, sd.n, sand); dH = mix(dH, sd.a.a, sand);
}
// beach bands: wind ripples on the dry sand, a dune-grass fringe where the sand meets the grass, a wrack line of
// drift weed and shells at the top of the swash
float ripS = 0.5 + 0.5 * sin(dot(trP.xz, vec2(0.72, 0.69)) * 4.2 + n3 * 7.0 + n4 * 3.0);
sandC *= 1.0 + (ripS - 0.5) * 0.09 * (1.0 - smoothstep(15.0, 45.0, trDist)) * smoothstep(1.0, 1.6, trH);
float dune = sand * (1.0 - sand) * 4.0 * smoothstep(0.35, 0.6, n4 + n3 * 0.3);
sandC = mix(sandC, trLand(${lin(0xb9b47c)}, wDusk, wNight) * (0.9 + 0.2 * n3), dune * 0.55);
float wrk = (1.0 - smoothstep(0.05, 0.16, abs(trH - (0.92 + (n2 - 0.5) * 0.35)))) * smoothstep(0.42, 0.62, texture2D(trNoise, trP.xz / 2.7 + 0.11).r);
sandC = mix(sandC, trLand(${lin(0x6a6040)}, wDusk, wNight) * (0.8 + 0.4 * n3), wrk * 0.7);
trCol = mix(trCol, sandC, sand);

// ---- snow line of the frost peak (rock needs it for ledge snow)
float snowL = 104.0 + (n1 - 0.5) * 36.0 + (n3 - 0.5) * 5.0;
float snowZ = smoothstep(snowL, snowL + 9.0, trH) * smoothstep(0.12, 0.3, mm);

// ---- steep ground (> ~35°): slope-aware stratified rock. Everything is laid out in (along-the-contour, height)
// coordinates, so nothing stretches on any face: horizontal strata with a regional dip, a lit up-facing ledge at the top
// of each band and a shadowed undercut below it, vertical joints splitting the bands into blocks, rain / moss streaks
// running down from the ledges low on the mountain, snow sitting on the ledges above the snow line. Lines are
// antialiased by their own screen footprint (fwidth) so the far mountain stays calm.
float rock = smoothstep(0.16, 0.27, trSlope + (n2 - 0.5) * 0.1);
rock = max(rock, smoothstep(0.75, 1.7, trDefo + (trNF - 0.5) * 0.5));
vec3 trNW = trN;
float rLip = 0.0, bhS = 0.0;
if (rock > 0.01) {
  // major beds (5.5–11 m, irregular thickness) carry the ledges; minor strata (≈1.4 m) are paint only
  // beds share the levels of the 3D contour bands (landforms/bands.js: 5.75 + k·5.5 m), so the painted ledges continue
  // the built ones where a band breaks off
  float sw = trH + (n2 - 0.5) * 0.9 + (n3 - 0.5) * 0.3;
  float sy = (sw - 5.75) / 5.5 + 0.02;
  float bid = floor(sy), fs = fract(sy);
  float bh = trHash(vec2(bid, 3.1));
  float jw = 3.0 + 5.0 * trHash(vec2(bid, 9.7));
  // look round: joints and blocks come from a voronoi in plain xz (its cell walls are vertical planes, so on a steep face
  // they read as vertical joints). The old along-contour coordinate dot(xz, tangent) swung by metres with every small
  // change of the normal and painted the faces with dense wavy stripes.
  vec2 jv = trVoronoi(trP.xz / jw + bh * 7.0);
  float jid = floor(jv.y * 251.0);
  float steepJ = smoothstep(0.32, 0.6, trSlope);              // blocks / joints only on real cliffs, not on rounded tops
  float blk = mix(0.5, trHash(vec2(bid * 1.7, jid)), steepJ);
  float aaS = fwidth(sy) + 1e-4, aaJ = length(fwidth(trP.xz)) / jw + 1e-4;
  float lf = 1.0 - smoothstep(0.06, 0.25, aaS);              // bed detail fades when a bed is ~4 px tall
  float jf = 1.0 - smoothstep(0.08, 0.3, aaJ);
  // the ledge runs along the bed but breaks off in places (segments of 10–30 m along the contour)
  float seg = texture2D(trNoise, trP.xz / (14.0 + 20.0 * bh) + bh * 3.7).r * 0.8 + 0.1;
  float ledgeOn = smoothstep(0.25, 0.45, seg) * (fract(bid * 0.5) < 0.25 ? 1.0 : 0.2);
  rLip = smoothstep(0.9, 0.975, fs) * lf * ledgeOn * (0.55 + 0.45 * bh);
  float under = (1.0 - smoothstep(0.0, 0.08, fs)) * lf * ledgeOn;
  bhS = bh;
  float my = sw / 1.37 + 0.4 * n3;
  float minor = smoothstep(0.85, 1.0, abs(fract(my) - 0.5) * 2.0) * (1.0 - smoothstep(0.15, 0.5, fwidth(my))) * smoothstep(0.3, 0.5, trSlope);
  float joint = (1.0 - smoothstep(0.0, 0.06 + aaJ * 1.5, jv.x)) * step(0.45, trHash(vec2(bid, jid + 0.5))) * jf * steepJ * (1.0 - smoothstep(0.85, 0.95, fs));
  // block-wise relief: each block leans a little; the lip faces up, the undercut faces down
  vec3 bj = vec3(trHash(vec2(blk, 1.3)), trHash(vec2(blk, 7.1)), trHash(vec2(blk, 3.7))) - 0.5;
  vec3 rn = normalize(trN + bj * vec3(0.35, 0.15, 0.35) * lf * steepJ);
  rn = normalize(rn + vec3(0.0, 1.6, 0.0) * rLip - vec3(0.0, 0.7, 0.0) * under);
  trNW = normalize(mix(trN, rn, rock));
  vec3 rc = mix(${C.rockDark}, ${C.rock}, smoothstep(0.2, 0.8, n2 * 0.45 + blk * 0.35 + bh * 0.2));
  // warm / cool beds. Tone is shared by a FORMATION of about three beds and only nudged per bed: one tone per bed read as
  // zebra rings on the mountain from afar. The per-bed part also fades as beds get small on screen.
  float fid = floor(sy / 3.0 + 0.5 * trHash(vec2(floor(sy / 3.0), 5.5)));
  float tone = mix(trHash(vec2(fid, 3.1)), bh, 0.3 * lf);
  rc *= mix(vec3(1.0), mix(vec3(1.04, 1.0, 0.96), vec3(0.95, 0.98, 1.04), tone), 0.7) * (0.93 + 0.12 * tone);
  rc *= 1.0 - 0.04 * minor;
  rc *= 1.0 + 0.12 * rLip;
  rc *= 1.0 - 0.22 * under;
  rc *= 1.0 - 0.42 * joint;
  // rain streaks and moss streaks running down from the ledges, low on the mountain
  // streaks: xz noise is constant down a steep face, i.e. it runs downhill by itself
  float st = texture2D(trNoise, trP.xz / 11.0 + 0.37).r;
  float st2 = texture2D(trNoise, trP.xz / 3.7 + 0.61).g;
  float streak = smoothstep(0.56, 0.74, st * 0.7 + st2 * 0.3) * (1.0 - smoothstep(0.35, 0.9, fs)) * jf;
  rc *= 1.0 - 0.18 * streak;
  float low = 1.0 - smoothstep(35.0, 95.0, trH + (n2 - 0.5) * 30.0);
  float rMoss = clamp(rLip * 0.9 + streak * 0.55 + (1.0 - smoothstep(0.18, 0.3, trSlope)) * 0.35, 0.0, 1.0) * low * smoothstep(0.4, 0.62, n4 + st2 * 0.3);
  vec3 mossR = mix(${lin(0x6f9a4c)}, ${lin(0x9a9248)}, wDusk) * (0.85 + 0.3 * st2);
  rc = mix(rc, mossR, rMoss * 0.75 * (1.0 - wNight));
  // night: faint teal lichen in the moss places (glows a little, see emission)
  if (trNear) {
    // painted rock material: world triplanar at one uniform scale (never stretched)
    vec3 bw = pow(abs(trN), vec3(4.0)); bw /= max(bw.x + bw.y + bw.z, 1e-4);
    const float RS = 6.0;
    TrS ax = trSamp1(trP.zy / RS + blk * 0.37, trDP.zy / RS, trDQ.zy / RS, 6.0);
    TrS az = trSamp1(trP.xy / RS + blk * 0.53, trDP.xy / RS, trDQ.xy / RS, 6.0);
    TrS ay = trSamp1(trP.xz / RS, trDP.xz / RS, trDQ.xz / RS, 6.0);
    vec4 ra = ax.a * bw.x + az.a * bw.z + ay.a * bw.y;
    vec4 rnn = ax.n * bw.x + az.n * bw.z + ay.n * bw.y;
    rc *= mix(vec3(1.0), ra.rgb * 2.0, trDetK * 0.8);
    vec2 nx = ax.n.xy * 2.0 - 1.0, nz = az.n.xy * 2.0 - 1.0, ny = ay.n.xy * 2.0 - 1.0;
    vec3 rN2 = normalize(trNW + (vec3(0.0, nx.y, nx.x) * bw.x + vec3(nz.x, nz.y, 0.0) * bw.z + vec3(ny.x, 0.0, ny.y) * bw.y) * 0.8 * trNK);
    trNW = normalize(mix(trNW, rN2, rock));
    // pebbles and scree collecting at the foot of the rock
    float foot = rock * (1.0 - rock) * 4.0 * (1.0 - smoothstep(0.35, 0.6, trSlope));
    if (foot > 0.02) {
      TrS sc = trSamp(trP.xz, 1.9, 5.0, kq);
      float fw = trHB(foot * 0.9, sc.a.a, dH);
      trCol = mix(trCol, trLand(mix(${C.gravelB}, ${C.rock}, 0.5), wDusk, wNight) * sc.a.rgb * 2.0, fw);
      dAcc = mix(dAcc, sc.n, fw);
    }
    rock = trHB(rock, ra.a + rLip * 0.3, dH);
    dAcc.b = mix(dAcc.b, rnn.b, rock);
  }
  rc = mix(rc, ${C.rockDusk} * (0.8 + 0.4 * blk) * (rc / max(${C.rock}, vec3(0.01))), wDusk * 0.6);
  rc = mix(rc, ${C.rockNight} * (0.75 + 0.35 * blk + 0.2 * rLip) * (1.0 - 0.3 * joint) * (1.0 - 0.25 * under), wNight * 0.9);
  rc = mix(rc, rc * vec3(0.7, 1.0, 1.05), rMoss * wNight * 0.6);
  trCol = mix(trCol, rc, rock);
  dAcc.xy = mix(dAcc.xy, vec2(0.5), rock);
  trLichen = rMoss * wNight * rock;
}

// ---- snow on the northern peak (Frostpeak): open slopes, and on steep rock only the up-facing ledges
float snow = snowZ * mix(1.0, max(rLip * smoothstep(0.45, 0.65, n3 + bhS * 0.3), smoothstep(0.62, 0.86, trNW.y + (n3 - 0.5) * 0.1)), rock);
snow *= 1.0 - smoothstep(0.24, 0.45, trSlope + (n3 - 0.5) * 0.1) * 0.75 * (1.0 - rock);
vec3 snowC = mix(${C.snowShade}, ${C.snow}, n3);
float sparkle = 0.0;
if (snow > 0.002 && trNear) {
  TrS sn = trSamp(trP.xz, 4.5, 7.0, kq);
  float snFlat = 1.0 - smoothstep(0.1, 0.28, trSlope);
  snowC *= mix(vec3(1.0), sn.a.rgb * 2.0, trDetK * snFlat * 0.6);
  snow = trHB(snow, sn.a.a + 0.2, dH);
  dAcc = mix(dAcc, sn.n, snow * snFlat);
  sparkle = sn.n.a * snow * (1.0 - smoothstep(20.0, 70.0, trDist));
}
trCol = mix(trCol, snowC, snow);

// ---- footpaths, paving, plazas
float pave = inSet * ((setKind == 3.0 || setKind == 4.0) ? 0.0 : 1.0);
float pathW = 1.3 + 0.7 * inSet;
float path = 1.0 - smoothstep(pathW, pathW + 0.9, trRoad + (n3 - 0.5) * 0.9);
float worn = (1.0 - smoothstep(pathW + 0.6, pathW + 2.8, trRoad + (n2 - 0.5) * 1.4)) * (1.0 - path);
trCol = mix(trCol, trCol * vec3(1.06, 0.97, 0.8), worn * 0.55 * (1.0 - snow));
vec3 dirt = trLand(mix(${C.dirtB}, ${C.dirtA}, n3 * 0.7 + n2 * 0.3), wDusk, wNight);
vec3 stone = trLand(mix(${C.stoneB}, ${C.stoneA}, 0.5 + (n3 - 0.5) * 0.6), wDusk, wNight);
vec4 dirtN = vec4(0.5, 0.5, 1.0, 0.0), stoneN = dirtN;
float dirtH = 0.5, stoneH = 0.5, moss = 0.0;
bool needGround = (path + plaza + abs(trDefo)) > 0.002;
if (needGround && trNear) {
  TrS er = trSamp(trP.xz, 3.2, 3.0, kq);
  dirt *= mix(vec3(1.0), er.a.rgb * 2.0, trDetK * 0.6);
  dirtN = er.n; dirtH = er.a.a;
  // wheel / foot ruts along dirt paths (outside the paved settlements)
  float rut = (1.0 - smoothstep(0.05, 0.22, abs(trRoad - 0.62 - (n3 - 0.5) * 0.12))) * (1.0 - pave) * path;
  dirt *= 1.0 - rut * 0.22;
  dirtN.x = mix(dirtN.x, 0.5 + sign(trRoad - 0.62) * 0.2, rut * 0.5);
  dirtH -= rut * 0.25;
  if (pave + plaza > 0.002) {
    TrS pv = trSamp(trP.xz, 3.4, 8.0, kq);
    stone *= mix(vec3(1.0), pv.a.rgb * 2.0, trDetK);
    stoneN = pv.n; stoneH = pv.a.a; moss = pv.n.a;
  }
} else {
  vec2 sq = trP.xz / vec2(1.7, 1.15); sq.x += floor(sq.y) * 0.5;
  stone *= 0.92 + 0.16 * trHash(floor(sq));
}
vec3 mossC = mix(${lin(0x6f8f54)}, ${lin(0x8a8a50)}, wDusk) * (1.0 - wNight * 0.6);
stone = mix(stone, trLand(mossC, 0.0, wNight), moss * 0.85 * (1.0 - snow));
vec3 pathC = mix(dirt, stone, pave);
// a path climbing a steep face gives way to the rock (planar path detail would stretch there)
float pathM = path * (1.0 - rock * 0.7) * (1.0 - snow * 0.6) * (1.0 - smoothstep(0.2, 0.34, trSlope));
pathM = trHB(pathM, mix(dirtH, stoneH, pave) - 0.1, dH);            // grass creeps over the path edges
trCol = mix(trCol, pathC, pathM);
dAcc = mix(dAcc, mix(dirtN, stoneN, pave), pathM);
if (plaza > 0.001) {
  vec3 pc; vec4 pn = stoneN; float ph = stoneH;
  if (setKind == 1.0) {          // raked gravel rings
    float ring = sin(setD * 5.5 + n3 * 2.0);
    // look round: few clear shapes: bold raked ridges catching the light, soft grain, darker damp gravel at the rim
    pc = trLand(${C.gravelW}, wDusk, wNight) * (0.9 + 0.1 * ring) * (0.96 + 0.08 * n4);
    pc *= mix(1.0, 0.86, smoothstep(0.6, 1.0, setD / setR));
    if (trNear) {
      TrS rk = trSamp(trP.xz, 1.3, 10.0, kq);
      pc *= mix(vec3(1.0), rk.a.rgb * 2.0, trDetK * 0.4);
      pn = mix(TR_N0, rk.n, 0.4); pn.y += cos(setD * 5.5 + n3 * 2.0) * 0.3 * (1.0 - smoothstep(10.0, 40.0, trDist)); ph = rk.a.a;
    }
  }
  else if (setKind == 3.0 || setKind == 4.0) {
    // packed earth yard: foot-worn pale centre, damp packed patches, pale dust, reddish clay, footprints and cart ruts,
    // darker damp ground and drifted leaves along the walls, grass islands at the rim
    float rr = setD / setR;
    pc = dirt * mix(1.1, 0.94, smoothstep(0.2, 1.0, rr));
    float m1 = texture2D(trNoise, trP.xz / 13.0 + 0.57).r, m2 = texture2D(trNoise, trP.xz / 5.3 + 0.21).g;
    pc *= mix(vec3(1.0), vec3(0.78, 0.76, 0.8), smoothstep(0.55, 0.75, m1) * 0.8);
    pc *= mix(vec3(1.0), vec3(1.12, 1.08, 1.0), smoothstep(0.5, 0.7, m2) * (1.0 - smoothstep(0.55, 0.75, m1)) * 0.7);
    pc *= mix(vec3(1.0), vec3(1.05, 0.92, 0.82), smoothstep(0.6, 0.8, n4) * 0.5);
    // surface r2 request: large soft value shapes — pale dry swells, a darker compacted (slightly redder) way along the
    // paths to the houses
    float m3 = texture2D(trNoise, trP.xz / 23.0 + 0.13).b;
    pc *= mix(vec3(1.0), vec3(1.09, 1.07, 1.02), smoothstep(0.45, 0.7, m3) * 0.8);
    pc *= mix(vec3(1.0), vec3(0.86, 0.82, 0.8), path * 0.85);
    pn = dirtN; ph = dirtH;
    if (trNear) {
      // footprints: one oval print in some 0.8 m cells, busier toward the centre and on the paths through the yard
      vec2 fq = trP.xz / 0.8, fcl = floor(fq), ff = fract(fq) - 0.5 - (trHash2(fcl) - 0.5) * 0.4;
      float fh = trHash(fcl + 3.7), fa = fh * 37.0;
      vec2 fr = mat2(cos(fa), -sin(fa), sin(fa), cos(fa)) * ff;
      float busy = 0.07 + 0.22 * (1.0 - smoothstep(0.3, 1.0, rr)) + 0.2 * path;
      // a pressed sole: darker heel and toe, the rim pushed up and catching light on one side
      float pe = length(fr / vec2(0.065, 0.14));
      float prt = 0.0 * pe * busy;   // surface r2 request: the stamped footprints are what read as dimples
      float toe = smoothstep(0.0, 0.1, abs(fr.y)) ;
      pc *= 1.0 - 0.13 * prt * toe;
      // (no lit footprint rims)
      // cart ruts: two worn tracks swinging across the yard
      float ca = trHash(vec2(setR, 1.7)) * 3.14;
      vec2 cd = vec2(cos(ca), sin(ca));
      float cu = dot(trP.xz, vec2(-cd.y, cd.x)) + sin(dot(trP.xz, cd) * 0.06) * 4.0;
      float trk = abs(fract(cu / 9.0 + 0.5) - 0.5) * 9.0;
      float rut2 = (1.0 - smoothstep(0.15, 0.45, abs(trk - 0.75))) * (1.0 - smoothstep(0.6, 0.95, rr)) * smoothstep(0.3, 0.5, m2 * 0.5 + n4 * 0.5);
      pc *= 1.0 - 0.2 * rut2;
      pn.x = mix(pn.x, 0.5 + sign(trk - 0.75) * 0.18, rut2 * 0.6);
      ph -= rut2 * 0.2;
      // leaves: in drifts against the walls and the rim (dusk yards get many, sunny yards a few)
      TrS lv = trSamp(trP.xz, 2.0, 11.0, kq);
      float drift = trD.a * 0.75 + smoothstep(0.7, 1.0, rr) * 0.35;
      float lw = setKind == 4.0
        ? smoothstep(0.45, 0.72, n3 + n4 * 0.3 + drift * 0.3 + (lv.a.a - 0.5) * 0.3) * 0.88 * (1.0 - 0.45 * (1.0 - smoothstep(0.25, 0.6, rr)))
        : smoothstep(0.55, 0.85, n3 * 0.5 + n4 * 0.3 + drift * 0.6 + (lv.a.a - 0.5) * 0.4) * 0.35 * wSun;
      pc = mix(pc, trLand(dirt * lv.a.rgb * 2.0, 0.0, 0.0), lw);
      pn = mix(pn, lv.n, lw);
    }
  }
  else {
    // flagstone plazas (town, palace, shrines on the peak / isle): worn paler lanes where people walk, darker stained
    // slabs, moss in the joints toward the rim, a few wind-blown leaves, snow drifted against the stones on the peak
    float rr = setD / setR;
    pc = stone * mix(1.06, 0.95, smoothstep(0.25, 1.0, rr));
    float m1 = texture2D(trNoise, trP.xz / 11.0 + 0.41).r;
    pc *= mix(vec3(1.0), vec3(0.84, 0.83, 0.86), smoothstep(0.58, 0.78, m1) * 0.7);
    pc *= 1.0 + 0.08 * path;
    pc = mix(pc, trLand(mossC, 0.0, wNight), moss * smoothstep(0.35, 0.9, rr) * 0.5 * (1.0 - snow));
    if (trNear && setKind != 6.0) {
      TrS lv = trSamp(trP.xz, 2.0, 11.0, kq);
      float lw = smoothstep(0.62, 0.86, n3 * 0.5 + n4 * 0.3 + trD.a * 0.4 + (lv.a.a - 0.5) * 0.4) * (0.3 + 0.5 * wDusk) * (1.0 - wNight * 0.6);
      pc = mix(pc, trLand(stone * lv.a.rgb * 2.0, 0.0, 0.0), lw);
      pn = mix(pn, lv.n, lw);
    }
    if (setKind == 6.0) pc = mix(pc, ${C.snowShade}, smoothstep(0.4, 0.75, n3 * 0.6 + n4 * 0.4 + rr * 0.3) * 0.75);
  }
  // damp, darker ground at the foot of the walls (every yard / plaza)
  pc *= mix(vec3(1.0), vec3(0.7, 0.7, 0.76), trD.a * (setKind == 1.0 ? 0.45 : 0.75));
  float pm = plaza * (1.0 - rock * 0.8);
  // ragged, height-blended rim: grass tufts creep in over the yard and between flagstones
  float grassIsl = setKind == 3.0 || setKind == 4.0 ? smoothstep(0.6, 0.78, n4 + (n3 - 0.5) * 0.4) * smoothstep(0.45, 1.0, setD / setR) : 0.0;
  pm = trHB(pm * (1.0 - grassIsl), ph, dH);
  trCol = mix(trCol, pc, pm);
  dAcc = mix(dAcc, pn, pm);
}
// outside the yards too: a damp, darker, cooler skirt along every building wall
trCol *= mix(vec3(1.0), vec3(0.8, 0.8, 0.84), trD.a * 0.5 * (1.0 - plaza) * (1.0 - rock) * (1.0 - snow));

// ---- dusk woods: puddles in damp hollows and in the ruts of the paths (dark water film; the sky shows in emission)
float puddle = 0.0;
if (trNear && wDusk > 0.05) {
  float pz = texture2D(trNoise, trP.xz / 7.0 + 0.83).g;
  float site = max(smoothstep(0.3, 0.9, trCurv) * (1.0 - smoothstep(0.04, 0.1, trSlope)), path * (1.0 - pave) * 0.9);
  puddle = smoothstep(0.64, 0.69, pz + site * 0.25 - (1.0 - site) * 0.35) * wDusk * (1.0 - rock) * (1.0 - snow) * (1.0 - smoothstep(0.3, 0.8, sand + bank));
  trCol = mix(trCol, trCol * vec3(0.34, 0.31, 0.36), puddle);
  dAcc = mix(dAcc, vec4(0.5, 0.5, 1.0, 0.0), puddle);
  trNW = normalize(mix(trNW, vec3(0.0, 1.0, 0.0), puddle));
}
// ---- under water: wet sand fading to the sea bed
float uw = (1.0 - smoothstep(-0.5, 0.3, trH));
vec3 bedC = trLand(mix(${C.sandWet}, ${C.seabed}, (1.0 - smoothstep(-7.0, -0.5, trH))), wDusk, wNight);
// rivers: rounded bed stones showing through the shallows, a pale gravel bar where the bed shelves up to the bank
float rvK = 1.0 - smoothstep(12.0, 26.0, trRiver);
if (rvK > 0.01 && uw > 0.01 && trNear) {
  vec2 vo = trVoronoi(trP.xz / 0.7);
  float stT = trHash(vec2(vo.y, 2.1));
  vec3 cob = trLand(mix(${C.gravelB}, ${C.gravelA}, stT), wDusk, wNight) * (0.62 + 0.4 * stT);
  cob *= mix(0.5, 1.0, smoothstep(0.03, 0.16, vo.x));
  float shallow = smoothstep(-2.4, -0.5, trH);
  float bar = smoothstep(-0.7, -0.15, trH) * smoothstep(0.45, 0.6, n2 + n4 * 0.2);
  bedC = mix(bedC, cob, rvK * shallow * 0.85 * (1.0 - smoothstep(30.0, 90.0, trDist)));
  bedC = mix(bedC, trLand(${C.gravelA}, wDusk, wNight) * (0.92 + 0.12 * n3), rvK * bar * 0.7);
}
trCol = mix(trCol, bedC, uw);
// undercut river banks: a shadowed lip just above the water where the bank is steep, a lit grass edge above it
float ucut = rvK * smoothstep(0.07, 0.2, trSlope) * (1.0 - uw);
float ucBand = (1.0 - smoothstep(0.15, 0.75, trH)) * ucut;
trCol *= 1.0 - 0.45 * ucBand;
trNW = normalize(trNW - vec3(0.0, 0.6 * ucBand, 0.0));
trCol *= 1.0 + 0.1 * ucut * smoothstep(0.8, 1.1, trH) * (1.0 - smoothstep(1.3, 1.8, trH));
// round 2: a darker, slightly cooler wet band just above the water line (ragged with the noise), on every shore
float wetB = (1.0 - smoothstep(0.12, 0.55 + n2 * 0.5, trH)) * smoothstep(-0.2, 0.05, trH);
trCol = mix(trCol, trCol * vec3(0.66, 0.69, 0.72), wetB * 0.85);

// ---- craters (bare earth, darker when deep). Destruction round: even a lightning pit half a metre deep shows its earth.
float earth = smoothstep(0.1, 0.62, -trDefo + (trNF - 0.5) * 0.24);
vec3 ce = trLand(mix(${C.craterB}, ${C.craterA}, n3), wDusk, wNight) * mix(1.0, 0.7, smoothstep(1.0, 6.0, -trDefo));
ce *= mix(vec3(1.0), dirt / max(trLand(mix(${C.dirtB}, ${C.dirtA}, n3 * 0.7 + n2 * 0.3), wDusk, wNight), vec3(0.01)), 0.8);
trCol = mix(trCol, ce, earth);
dAcc = mix(dAcc, dirtN, earth);
// thrown earth: crater lips and heaved ground (small positive offsets) are loose soil lying over the grass in clumps,
// thinning to scattered clods at the edge; taller heaps turn to rock above (see rock)
float ejecta = smoothstep(0.12, 0.42, trDefo + (trNF - 0.5) * 0.5 + (n3 - 0.5) * 0.2) * (1.0 - smoothstep(0.85, 1.7, trDefo));
trCol = mix(trCol, ce * (0.92 + 0.16 * n2), ejecta * 0.9);
dAcc = mix(dAcc, dirtN, ejecta);
earth = max(earth, ejecta);

// ---- scorch layer: burn / wet / frost
// the burn channel falls 1 -> 0 over 6 min (textures.js FADE): char stays black for about a minute, then thins out in
// patches and is gone by ~4 min (the grass blades come back over it from 2.5 to 6 min)
float burnK = smoothstep(0.3, 0.8, trS.r * (0.85 + 0.3 * n3));
// bare earth (craters, thrown soil) only browns under a burn: a blasted pit stays readable inside the black of a grass fire
trCol = mix(trCol, mix(${C.charA}, ${C.charB}, n3) * (0.85 + 0.3 * dH), burnK * (0.92 - 0.5 * earth));
// mud: water on bare or burnt earth turns it dark, warm and glossy (the sheen is added with the emission below)
float trMud = trS.g * max(earth, burnK * 0.7) * (1.0 - uw);
trCol *= mix(vec3(1.0), vec3(0.62, 0.5, 0.42), trMud);
trCol *= mix(vec3(1.0), vec3(0.58, 0.64, 0.74), trS.g * (1.0 - uw));
trCol = mix(trCol, ${C.frost} * (1.0 - 0.5 * wNight), smoothstep(0.0, 0.6, trS.b) * 0.85); // HDR: the night ambient is strong, frost must not glare

// ---- material relief: cavity darkening + detail normal (gentle: the toon ramp turns strong relief into speckle)
trCol *= mix(1.0, 0.55 + 0.45 * dAcc.b, 0.5 * trDetK * (1.0 - uw));
// open grass: near the camera the ground is the deep, cool shade between the blades' roots; from ~8 m on it turns
// into the colour of the blade tops (GRASS_TOP) carrying the same travelling wind sheen as the blades
float grassy = (1.0 - pathM) * (1.0 - bank) * (1.0 - sand) * (1.0 - rock) * (1.0 - snow) * (1.0 - farm) * (1.0 - uw) * (1.0 - earth) * (1.0 - plaza);
{
  vec2 gp = trP.xz * 0.014 - trGust.xy * trGust.w * (0.05 + 0.03 * trGust.z);
  float gg = texture2D(trNoise, gp).g * 0.7 + texture2D(trNoise, gp * 2.3 + 0.37).b * 0.3;
  float sheen = smoothstep(0.38, 0.74, gg) * min(1.0, trGust.z * 1.4);
  vec3 gk = mix(vec3(0.6, 0.68, 0.74), ${GRASS_TOP} * (1.0 + 0.12 * sheen), smoothstep(3.0, 32.0, trDist));
  trCol *= mix(vec3(1.0), gk, grassy * (1.0 - wNight * 0.5));
}
vec2 dn = (dAcc.xy * 2.0 - 1.0) * 0.55 * trNK * (1.0 - uw);
trNW = normalize(trNW + vec3(dn.x, 0.0, dn.y));

diffuseColor.rgb *= trCol;

// ---- emission: night glow veins, embers of fresh burns, moonlit sheen, snow sparkle
float va = texture2D(trNoise, trP.xz / 150.0 + 0.13).a;
float va2 = texture2D(trNoise, trP.xz / 37.0 + 0.61).a;
float vline = smoothstep(0.955, 0.992, va) * smoothstep(0.35, 0.8, va2);
vline *= 1.0 - smoothstep(90.0, 320.0, trDist);
float pulse = 0.6 + 0.4 * sin(trTime * 0.7 + trP.x * 0.021 + trP.z * 0.017);
vec3 veinC = mix(${C.glowTeal}, ${C.glowViolet}, smoothstep(0.3, 0.7, n1));
float noVein = (1.0 - rock) * (1.0 - path) * (1.0 - sand) * (1.0 - uw) * (1.0 - plaza) * (1.0 - burnK);
totalEmissiveRadiance += veinC * vline * wNight * noVein * pulse * 0.26;
// embers: small flickering specks inside the freshest char, not glowing blotches (those read as cream paint on the burn)
float trEmb = smoothstep(0.82, 1.0, trS.r) * smoothstep(0.55, 0.9, n3) * smoothstep(0.7, 0.93, texture2D(trNoise, trP.xz / 2.3 + 0.21).g);
trEmb *= 0.55 + 0.45 * sin(trTime * 3.1 + trP.x * 1.7 + trP.z * 2.3);
totalEmissiveRadiance += vec3(1.0, 0.36, 0.08) * trEmb * 1.1;
vec3 trVd = normalize(cameraPosition - trP);
float trFres = pow(clamp(1.0 - max(dot(trNW, trVd), 0.0), 0.0, 1.0), 4.0);
totalEmissiveRadiance += ${lin(0xa9c4ff)} * trFres * wNight * 0.05 * (0.6 + 0.4 * dH) * (1.0 - uw);   // moonlit sheen
totalEmissiveRadiance += gFlowerC * 0.12 * noVein;
totalEmissiveRadiance += ${lin(0xe0a888)} * puddle * (0.06 + 0.3 * pow(clamp(1.0 - max(trVd.y, 0.0), 0.0, 1.0), 3.0)) * (1.0 - smoothstep(30.0, 90.0, trDist));
totalEmissiveRadiance += ${lin(0xbfc6cc)} * trMud * (0.03 + 0.22 * pow(clamp(1.0 - max(trVd.y, 0.0), 0.0, 1.0), 3.0)) * (1.0 - wNight * 0.6) * (1.0 - smoothstep(25.0, 80.0, trDist));
if (wNight > 0.05 && trDist < 40.0) {
  // faintly glowing lichen rosettes on the ash-blue night soil, in patches
  vec2 lq = trP.xz / 0.9, lc = floor(lq);
  vec2 lo = fract(lq) - 0.2 - trHash2(lc + 1.3) * 0.6;
  float lpatch = smoothstep(0.5, 0.72, n2 * 0.6 + n4 * 0.4);
  float lich = step(trHash(lc + 9.1), 0.4 * lpatch) * (1.0 - smoothstep(0.05, 0.12, length(lo))) * wNight * noVein;
  totalEmissiveRadiance += mix(${C.glowTeal}, ${lin(0x9fe8ff)}, trHash(lc)) * lich * 0.22 * (1.0 - smoothstep(18.0, 40.0, trDist));
}
totalEmissiveRadiance += ${C.glowTeal} * trLichen * 0.05 * (1.0 - smoothstep(60.0, 200.0, trDist));                                                         // night flowers glow faintly
totalEmissiveRadiance += vec3(1.0, 0.98, 0.92) * sparkle * sparkle * 0.9 * (1.0 - wNight * 0.7);
`;

export function createTerrainMaterial({ data, noise, scorch, detail, quality = 'high' }) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
  m.name = 'terrain';
  const settle = SETTLE.map(([id, w]) => new THREE.Vector4(POI[id].x, POI[id].z, POI[id].id === 'palace' ? 54 : POI[id].r, w));
  const uniforms = {
    trData: { value: data }, trScorch: { value: scorch }, trNoise: { value: noise }, trTime: { value: 0 },
    trVeil: { value: new THREE.Vector4(VEIL.x, VEIL.z, VEIL.inner, VEIL.outer) },
    trMount: { value: new THREE.Vector4(MOUNTAIN.x, MOUNTAIN.z, MOUNTAIN.rx, MOUNTAIN.rz) },
    trSettle: { value: settle },
    trFarm: { value: new THREE.Vector4(POI.hometown.x, POI.hometown.z, POI.hometown.r + 6, 170) },
    trHill: { value: new THREE.Vector4(POI.eastmoor.x, POI.eastmoor.z, 115, 0) },
    trLodCam: { value: new THREE.Vector3() }, trGust: { value: new THREE.Vector4(1, 0, 0.4, 0) },
    trDetA: { value: detail?.albedo || null }, trDetN: { value: detail?.normal || null },
  };
  m.defines = { ...(m.defines || {}), TR_Q: quality === 'low' ? 0 : 1, TR_NEAR: quality === 'high' ? '40.0' : '26.0', TR_FAR: quality === 'high' ? '190.0' : quality === 'med' ? '140.0' : '90.0' };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aMorph;
uniform vec3 trLodCam;
varying vec3 vTrW;
varying vec3 vTrN;
varying float vTrDef;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float trDist = distance(trLodCam, transformed);
  float trK = smoothstep(aMorph.y * 0.7, aMorph.y, trDist);
  transformed.y = mix(transformed.y, aMorph.x, trK);
  vTrW = transformed;
  vTrN = objectNormal;
  vTrDef = aMorph.w;
  transformed.y -= aMorph.z;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + terrainGLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize( ( viewMatrix * vec4( trNW, 0.0 ) ).xyz );');
  };
  m.customProgramCacheKey = () => 'mvTerrain7';
  return hookMaterial(m);
}

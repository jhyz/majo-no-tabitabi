// Saya's practice field outside the City of Magic (episode two; errands round, 2026-11-23): the worn earth track that
// rings the field is a footpath loop in src/data/world.js ROADS ('practice_track', painted by the terrain shader:
// pale dirt, wheel / foot ruts, grass kept off it and thinned along its shoulders). This builder adds the props a
// training ground has: round targets on easel stands along the south edge, striped slalom posts on the west side, a
// bench by the path from the city, a broom rack. Everything stays outside the track's width, away from the story spots
// (the practice anchor where Saya teaches, the ring course to the north-west: story/episode-scenes.js flightOffsets).
import * as THREE from 'three';
import { box, cyl, sphere, torus } from '../../core/geo.js';
import { Site, mat } from './kit.js';
import { JOURNEY_ANCHORS } from '../../data/journey-map.js';
import { PRACTICE_TRACK } from '../../data/world.js';

const wood = mat.wood(0x7b5c3e), dark = mat.wood(0x4d3b2b), straw = mat.cloth(0xd8be7a), paintW = mat.paint(0xf1e9d6),
  paintR = mat.paint(0xb5453a), paintB = mat.paint(0x3f5f8f), iron = mat.metal(0x4b4642), bristle = mat.cloth(0xb9955a);

/** A round practice target: a straw boss painted with rings, leaning on an easel stand (faces local +z). */
function target(site, x, z, ry) {
  const g = new THREE.Group(), y = site.h(x, z);
  for (const s of [-1, 1]) { const leg = box(0.07, 1.5, 0.07, wood, s * 0.42, 0.72, 0.08); leg.rotation.z = s * 0.16; leg.rotation.x = 0.1; g.add(leg); }
  const back = box(0.07, 1.45, 0.07, wood, 0, 0.66, -0.42); back.rotation.x = -0.42; g.add(back);
  const face = new THREE.Group(); face.position.set(0, 1.18, 0.12); face.rotation.x = -0.12;
  const boss = cyl(0.56, 0.56, 0.16, straw, 0, 0, 0, 20); boss.rotation.x = Math.PI / 2; face.add(boss);
  [[0.5, paintW], [0.38, paintB], [0.26, paintW], [0.14, paintR]].forEach(([r, m], i) => { const d = cyl(r, r, 0.02, m, 0, 0, 0.085 + i * 0.004, 20); d.rotation.x = Math.PI / 2; face.add(d); });
  g.add(face);
  site.add(g, x, y, z, ry);
  site.colBox(x, z, 0.62, 0.3, ry, y - 0.5, y + 1.8);
}
/** A tall slalom post with painted bands and a pennant at the top. */
function post(site, x, z, k) {
  const y = site.h(x, z), g = new THREE.Group();
  g.add(cyl(0.09, 0.11, 3.2, wood, 0, 1.6, 0, 8));
  for (let i = 0; i < 4; i++) g.add(cyl(0.1, 0.1, 0.22, i % 2 ? paintW : (k % 2 ? paintR : paintB), 0, 1.1 + i * 0.55, 0, 8));
  const flag = box(0.02, 0.32, 0.5, k % 2 ? paintR : paintB, 0, 3.0, 0.27); g.add(flag);
  g.add(sphere(0.1, iron, 0, 3.25, 0, 8, 6));
  site.add(g, x, y, z, k * 0.7);
  site.colCyl(x, z, 0.14, y - 0.5, y + 3.3);
}
/** A plain plank bench on two trestles (faces local +z). */
function bench(site, x, z, ry) {
  const y = site.h(x, z), g = new THREE.Group();
  g.add(box(1.9, 0.08, 0.42, wood, 0, 0.46, 0));
  for (const s of [-1, 1]) { g.add(box(0.08, 0.44, 0.36, dark, s * 0.75, 0.22, 0)); }
  g.add(box(1.9, 0.3, 0.05, wood, 0, 0.78, -0.2));
  for (const s of [-1, 1]) g.add(box(0.06, 0.4, 0.06, dark, s * 0.85, 0.62, -0.2));
  site.add(g, x, y, z, ry);
  site.colBox(x, z, 0.98, 0.26, ry, y - 0.5, y + 0.95);
}
/** A broom rack: two posts, a rail, three practice brooms leaning on it. */
function rack(site, x, z, ry) {
  const y = site.h(x, z), g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.09, 1.3, 0.09, dark, s * 0.8, 0.65, 0));
  g.add(box(1.8, 0.07, 0.07, wood, 0, 1.12, 0));
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Group();
    b.add(cyl(0.025, 0.03, 1.5, wood, 0, 0.75, 0, 6));
    const head = cyl(0.05, 0.16, 0.42, bristle, 0, 0.12, 0, 8); b.add(head);
    b.add(torus(0.06, 0.015, iron, 0, 0.36, 0, 5, 10));
    b.position.set(-0.55 + i * 0.55, 0, 0.22); b.rotation.x = -0.28; b.rotation.z = (i - 1) * 0.06;
    g.add(b);
  }
  site.add(g, x, y, z, ry);
  site.colBox(x, z, 0.9, 0.3, ry, y - 0.5, y + 1.4);
}

export async function buildPracticeField(ctx) {
  const a = JOURNEY_ANCHORS.practice;
  const site = new Site('practiceField', a.x, a.z, 0);
  const { rx, rz } = PRACTICE_TRACK;
  // three targets in a row beyond the south curve, facing the field
  for (const [x, k] of [[-9, 0], [-2.5, 1], [4, 2]]) target(site, x, rz + 5.6 + (k === 1 ? 0.8 : 0), Math.PI + (x * 0.012));
  // slalom posts down the west side, inside the track
  for (let k = 0; k < 4; k++) post(site, -rx + 7.5 + (k % 2) * 1.6, -2 + k * 4.2, k);
  // a bench by the path from the city, outside the east curve, looking over the field; the broom rack beside it
  bench(site, rx + 5.2, 7.5, -Math.PI / 2 - 0.25);
  rack(site, rx + 4.4, 11.6, -Math.PI / 2 - 0.4);
  await site.bakeSliced(ctx.step);
  ctx.place('practiceField', { site, group: site.baked });
}

// Pickups: 星屑, hearts, mana orbs and food that hop out, sparkle, magnet to the heroine and go into the purse / inventory.
import * as THREE from 'three';
import { G } from '../core/game.js';
import { t } from '../core/i18n.js';
import { addItem } from '../core/save.js';
import { glow, toon, PAL, hookMaterial } from '../core/mats.js';
import { cone, sphere, cyl, box } from '../core/geo.js';
import { ITEMS, PICKUPS } from '../data/items.js';
import { makeInstanced } from './common.js';
import { gemStar, lathe } from '../props/shapes.js';

const CAP = { star: 160, heart: 40, orb: 40 };
const FOOD_CAP = 40;
const GRAV = 15;

function starShape(r0, r1, n = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? r1 : r0;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}
function heartShape(k) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9 * k);
  s.bezierCurveTo(0.35 * k, -0.55 * k, 1.0 * k, -0.2 * k, 0.95 * k, 0.3 * k);
  s.bezierCurveTo(0.9 * k, 0.8 * k, 0.25 * k, 0.9 * k, 0, 0.45 * k);
  s.bezierCurveTo(-0.25 * k, 0.9 * k, -0.9 * k, 0.8 * k, -0.95 * k, 0.3 * k);
  s.bezierCurveTo(-1.0 * k, -0.2 * k, -0.35 * k, -0.55 * k, 0, -0.9 * k);
  return s;
}
function extruded(shape, depth, mat, bevelSegments = 2) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: depth * 0.45, bevelSegments, curveSegments: 12 });
  g.center();
  const m = new THREE.Mesh(g, mat); m.castShadow = false;
  return m;
}

export function createPickups(api) {
  const live = [];          // { kind, look, slot, food(obj)|null, pos, vel, t, life, value, item, settled, spin, magnet }
  const pools = {};
  const free = { star: [], heart: [], orb: [] };
  const foodPool = [];
  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  let sparkleT = 0;

  function init() {
    // 星屑: a faceted gold gem star (lit facets catch the cel band and a crisp highlight) inside a soft glowing halo
    // shell (back faces of a larger star), so it reads as a jewel up close and as a warm spark from afar
    const star = new THREE.Group();
    { const gem = gemStar(0.2, 0.085, 0.075, toon(0xffc83d, { emissive: 0x8a5208, surface: 'none', look: { spec: 0.9, specPower: 64, rim: 0.9, wrap: 0.6 } }));
      const halo = gemStar(0.25, 0.12, 0.1, glow(0xffd76a, 1.5, { side: THREE.BackSide }));
      const core = gemStar(0.09, 0.05, 0.085, glow(0xfff4c8, 2.4));
      gem.castShadow = false; halo.castShadow = false; core.castShadow = false;
      // the core peeks out on both faces through a tiny inset (front and back apex)
      star.add(gem, halo, core); }
    // heart: a puffy rounded heart in lit rose lacquer with a glowing back shell
    const heart = new THREE.Group();
    { const body = extruded(heartShape(0.2), 0.09, toon(0xff5a7a, { emissive: 0x7a1428, surface: 'none', look: { spec: 0.7, specPower: 48, rim: 0.8, wrap: 0.6 } }), 5);
      const shell = extruded(heartShape(0.235), 0.1, glow(0xff7a96, 1.3, { side: THREE.BackSide }), 3);
      heart.add(body, shell); }
    const orb = new THREE.Group();
    { const core = sphere(0.13, glow(0xbfe8ff, 1.8), 0, 0, 0, 12, 8); core.castShadow = false;
      const shell = sphere(0.22, glow(0x5aa8ff, 0.8, { transparent: true, opacity: 0.45, depthWrite: false }), 0, 0, 0, 14, 10); shell.castShadow = false;
      orb.add(core, shell); }
    for (const [look, proto] of [['star', star], ['heart', heart], ['orb', orb]]) {
      const inst = makeInstanced(proto, CAP[look], { castShadow: false, name: 'gp:pickup:' + look });
      G.scene.add(inst.group);
      pools[look] = inst;
      for (const im of inst.meshes) im.count = 0;
      for (let i = CAP[look] - 1; i >= 0; i--) free[look].push(i);
    }
  }

  // ---- food look (model or a small procedural build), cached per item and cloned ----
  const foodProto = {};
  function foodModel(item) {
    if (!foodProto[item]) {
      const def = ITEMS[item] || {};
      let g = null;
      if (def.model && G.assets?.has?.(def.model)) {
        g = G.assets.model(def.model);
        if (g) {
          const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(_v);
          const k = 0.38 / Math.max(0.01, sz.x, sz.y, sz.z);
          g.scale.multiplyScalar(k);
          const c = bb.getCenter(_t).multiplyScalar(k);
          const w = new THREE.Group(); g.position.sub(c); w.add(g); g = w;
          if (def.tint) g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiply?.(new THREE.Color(def.tint)); hookMaterial(o.material); } });
        }
      }
      if (!g) g = proceduralFood(item);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
      foodProto[item] = g;
    }
    return foodProto[item].clone();
  }
  function proceduralFood(item) {
    const g = new THREE.Group();
    if (item === 'carrot') { const c = lathe([[0.004, -0.17], [0.03, -0.1], [0.05, 0.0], [0.066, 0.1], [0.07, 0.15], [0.05, 0.175], [0, 0.18]], toon(0xf08a24, { surface: 'none', look: { spec: 0.2, specPower: 30 } }), 0, 0, 0, 12); g.add(c); for (let i = 0; i < 3; i++) { const l = cone(0.03, 0.16, toon(0x5fae48), 0, 0.22, 0, 5); l.rotation.z = (i - 1) * 0.4; g.add(l); } }
    else if (item === 'berry') { for (const [x, y, z] of [[0, 0, 0], [0.07, 0.03, 0.04], [-0.06, 0.02, 0.05], [0.01, 0.08, -0.03]]) g.add(sphere(0.07, toon(0xc8234a), x, y, z, 8, 6)); g.add(cone(0.03, 0.08, toon(0x5fae48), 0, 0.15, 0, 5)); }
    else if (item === 'sun_tea') { g.add(cyl(0.11, 0.08, 0.16, toon(0xf3ead2), 0, 0, 0, 12)); g.add(cyl(0.095, 0.095, 0.02, glow(0xffc35a, 1.6), 0, 0.075, 0, 12)); }
    else if (item === 'moon_mochi') { const m = sphere(0.15, toon(0xfbf6ec), 0, 0, 0, 12, 8); m.scale.y = 0.7; g.add(m, sphere(0.05, glow(PAL.moonGold, 1.6), 0.0, 0.1, 0.06, 6, 4)); }
    else if (item === 'glowshroom') { g.add(cyl(0.035, 0.05, 0.18, toon(0xdfe9ff), 0, -0.04, 0, 6)); const c = sphere(0.14, glow(PAL.glowCyan, 1.8), 0, 0.07, 0, 12, 6); c.scale.y = 0.55; g.add(c); }
    else if (item === 'sunseed') { for (let i = 0; i < 5; i++) { const s = sphere(0.05, toon(i % 2 ? 0x3b2a1a : 0x6a5236), (i - 2) * 0.06, 0, (i % 2) * 0.05, 6, 4); s.scale.set(0.6, 1, 0.6); g.add(s); } }
    else g.add(sphere(0.13, toon(0xffd27a), 0, 0, 0, 10, 8));
    return g;
  }

  function alloc(look) {
    if (look === 'food') {
      if (foodPool.length >= FOOD_CAP) { const old = live.find((p) => p.look === 'food'); if (old) release(old); }
      return -1;
    }
    let slot = free[look].pop();
    if (slot === undefined) { const old = live.find((p) => p.look === look); if (!old) return null; release(old); slot = free[look].pop(); }
    return slot;
  }
  // draw only up to the live high-water slot (instances past it would be zero-scale triangles still sent to the GPU)
  const hi = { star: 0, heart: 0, orb: 0 };
  function setHi(look, n) { hi[look] = n; for (const im of pools[look].meshes) im.count = n; }
  function release(p) {
    const i = live.indexOf(p); if (i >= 0) live.splice(i, 1);
    if (p.look === 'food') { if (p.obj) { p.obj.removeFromParent(); const j = foodPool.indexOf(p.obj); if (j >= 0) foodPool.splice(j, 1); } }
    else {
      pools[p.look]?.hide(p.slot); free[p.look].push(p.slot);
      if (p.slot + 1 >= hi[p.look]) { let n = 0; for (const q of live) if (q.look === p.look && q.slot + 1 > n) n = q.slot + 1; setHi(p.look, n); }
    }
  }

  /** ★ spawnPickup(kind, pos, n): stardust n = amount (split into up to 8 pieces); others n = pieces. */
  function spawn(kind, pos, n = 1) {
    const def = PICKUPS[kind];
    if (!def || !pos) { if (!def) console.warn('[gameplay] unknown pickup kind', kind); return []; }
    n = Math.max(1, Math.round(n || 1));
    const out = [];
    let pieces = n, value = 1;
    if (kind === 'stardust') { pieces = Math.min(8, n); value = n / pieces; }
    pieces = Math.min(pieces, 24);
    for (let i = 0; i < pieces; i++) {
      const slot = alloc(def.look);
      if (slot === null) break;
      const a = Math.random() * Math.PI * 2, sp = (pieces > 1 ? 1.6 : 0.8) + Math.random() * 1.6;
      const p = {
        kind, def, look: def.look, slot, obj: null,
        pos: new THREE.Vector3(pos.x, (pos.y ?? 0) + 0.3, pos.z),
        vel: new THREE.Vector3(Math.cos(a) * sp, 4.8 + Math.random() * 2.2, Math.sin(a) * sp),
        t: 0, life: def.look === 'food' ? 150 : 60, value: kind === 'stardust' ? (i === pieces - 1 ? n - Math.floor(value) * (pieces - 1) : Math.floor(value)) : 1,
        settled: false, spin: Math.random() * 6, magnet: false, item: def.item || null,
      };
      if (def.look === 'food') { p.obj = foodModel(def.item); G.scene.add(p.obj); foodPool.push(p.obj); }
      live.push(p);
      if (def.look !== 'food' && slot + 1 > hi[def.look]) setHi(def.look, slot + 1);
      out.push(p);
      place(p, 0);
    }
    return out;
  }

  function place(p, time) {
    const bob = p.settled ? 0.25 + Math.sin(time * 2.6 + p.spin) * 0.08 : 0;
    const blink = p.life - p.t < 5 ? (Math.sin(p.t * 18) > 0 ? 1 : 0.0001) : 1;
    const pop = Math.min(1, p.t * 6);
    _v.copy(p.pos); _v.y += bob;
    const yaw = time * 2.2 + p.spin;
    if (p.look === 'food') { p.obj.position.copy(_v); p.obj.rotation.y = yaw; p.obj.scale.setScalar(pop * blink); }
    else pools[p.look].set(p.slot, _v, yaw, pop * blink * (p.look === 'star' ? 1.1 : 1));
  }

  function wants(p) {
    const P = G.player; if (!P || P.dead) return false;
    if (p.kind === 'heart') return P.hp < P.maxHp;
    if (p.def.mana) return P.mana < P.maxMana;
    return true;
  }
  function collect(p) {
    const P = G.player;
    const d = p.def;
    if (d.item) {
      addItem(G, d.item, p.value);
      if (d.look === 'food') G.fx?.text?.(_v.copy(p.pos).setY(p.pos.y + 0.8), t('gameplay.item.' + d.item + '.name'), { color: '#fff1c9', size: 0.8, dur: 0.9 });
    }
    if (d.heal) P?.heal?.(d.heal);
    if (d.mana) P?.addMana?.(d.mana);
    G.fx?.burst?.('pickup', p.pos, { color: d.color || 0xffe6a6, scale: d.look === 'star' ? 0.6 : 0.9 });
    G.events.emit('item:collected', { id: p.kind, kind: p.kind, pos: p.pos.clone() });
    release(p);
  }

  function update(dt) {
    if (!live.length) return;
    const P = G.player, W = G.world, time = G.time.t;
    const chest = _t;
    if (P) chest.copy(P.pos).y += 0.9;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t += dt;
      if (p.t > p.life) { release(p); continue; }
      const d2 = P ? p.pos.distanceToSquared(chest) : Infinity;
      if (!p.magnet && p.t > 0.45 && d2 < (p.kind === 'stardust' ? 30 : 16) && wants(p)) p.magnet = true;
      if (p.magnet) {
        if (!wants(p)) { p.magnet = false; p.settled = false; continue; }
        _v.subVectors(chest, p.pos);
        const d = Math.max(0.001, _v.length());
        if (d < 0.75) { collect(p); continue; }
        const speed = Math.min(26, 6 + p.t * 3 + 12 / d);
        p.vel.lerp(_v.multiplyScalar(speed / d), Math.min(1, dt * 9));
        p.pos.addScaledVector(p.vel, dt);
        p.settled = false;
      } else if (!p.settled) {
        p.vel.y -= GRAV * dt;
        p.pos.addScaledVector(p.vel, dt);
        const g = W.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.5);
        const floor = Math.max(g, W.isWater?.(p.pos.x, p.pos.z) ? (W.seaLevel ?? 0) + 0.15 : -Infinity);
        if (p.pos.y <= floor + 0.12) {
          p.pos.y = floor + 0.12;
          if (p.vel.y < -2.2) { p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; }
          else { p.vel.set(0, 0, 0); p.settled = true; }
        }
      }
      place(p, time);
    }
    // gentle sparkle on one nearby pickup at a time
    sparkleT -= dt;
    if (sparkleT <= 0 && live.length && P) {
      sparkleT = 0.35;
      const p = live[(Math.random() * live.length) | 0];
      if (p.look !== 'food' && p.pos.distanceToSquared(P.pos) < 900) G.fx?.burst?.('spark', _v.copy(p.pos).setY(p.pos.y + 0.3), { color: p.def.color, scale: 0.25, count: 0.3 });
    }
  }
  function clear() { while (live.length) release(live[live.length - 1]); }

  return { init, spawn, update, clear, live, get count() { return live.length; } };
}
